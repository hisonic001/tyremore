/**
 * DB 적재 — 변환이 끝난 결과를 넣는다.
 *
 * 원칙: **여러 번 돌려도 같은 결과**여야 한다 (멱등).
 *   한 번에 완벽하게 되는 이관은 없다. 이상치를 고치고 다시 돌리는 일이 반복된다.
 *   그래서 전부 upsert(있으면 갱신)로 짠다. 지우고 다시 넣지 않는다.
 */
import { sql } from "drizzle-orm";
import { db } from "../../src/db";
import {
  brand,
  customer,
  importIssue,
  priceRule,
  product,
  serviceItem,
  stockItem,
  vehicle,
  vehicleMaker,
  vehicleMakerAlias,
} from "../../src/db/schema";
import { BRANDS, MAKER_ALIASES, VAT_EXCLUDED_BRANDS, VEHICLE_MAKERS } from "./seed-data";
import type {
  CustomerRow,
  Issue,
  PartRow,
  ProductRow,
  ServiceRow,
  TireStockRow,
  Transformed,
  VehicleRow,
} from "./transform";

/** 파라미터 한도(65535)를 넘지 않도록 나눠 넣는다 */
async function inBatches<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
    process.stdout.write(`\r     ${Math.min(i + size, rows.length)}/${rows.length}`);
  }
  if (rows.length) process.stdout.write("\n");
}

export async function load(data: {
  svc: Transformed<ServiceRow>;
  prod: Transformed<ProductRow>;
  parts: Transformed<PartRow>;
  cust: Transformed<CustomerRow>;
  veh: Transformed<VehicleRow>;
  stock: Transformed<TireStockRow>;
  issues: Issue[];
}) {
  console.log(`\n${"─".repeat(64)}\nDB 적재 시작`);

  /* --- 확장 (Supabase에서는 여기서 켠다) ------------------- */
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  /* --- 1·2. 시드 ------------------------------------------ */
  console.log("\n  1·2. 시드");
  await db
    .insert(brand)
    .values(
      BRANDS.map((b) => ({ ...b, priceExcludesVat: VAT_EXCLUDED_BRANDS.includes(b.code) })),
    )
    .onConflictDoUpdate({
      target: brand.code,
      // ⚠️ is_handled / price_excludes_vat 는 덮어쓰지 않는다. 사장님이 화면에서 정한 값이다
      set: { nameKo: sql`excluded.name_ko`, sortOrder: sql`excluded.sort_order` },
    });

  await db
    .insert(vehicleMaker)
    .values(VEHICLE_MAKERS)
    .onConflictDoUpdate({
      target: vehicleMaker.code,
      set: { nameKo: sql`excluded.name_ko`, isImported: sql`excluded.is_imported` },
    });

  await db
    .insert(vehicleMakerAlias)
    .values(Object.entries(MAKER_ALIASES).map(([rawName, code]) => ({ rawName, code })))
    .onConflictDoUpdate({ target: vehicleMakerAlias.rawName, set: { code: sql`excluded.code` } });
  console.log(`     브랜드 ${BRANDS.length} · 제조사 ${VEHICLE_MAKERS.length} · 표기 ${Object.keys(MAKER_ALIASES).length}`);

  /* --- 3. service_item ------------------------------------ */
  console.log("\n  3. service_item");
  await inBatches(data.svc.rows, 500, (chunk) =>
    db
      .insert(serviceItem)
      .values(chunk)
      .onConflictDoUpdate({
        target: serviceItem.marsServiceNo,
        set: {
          name: sql`excluded.name`,
          shortName: sql`excluded.short_name`,
          price: sql`excluded.price`,
          qtyRule: sql`excluded.qty_rule`,
          rimMin: sql`excluded.rim_min`,
          rimMax: sql`excluded.rim_max`,
          forImported: sql`excluded.for_imported`,
          isTireRelated: sql`excluded.is_tire_related`,
          autoSuggest: sql`excluded.auto_suggest`,
          isFavorite: sql`excluded.is_favorite`,
        },
      }),
  );

  /* --- 4. product (MARS 상품) ----------------------------- */
  console.log("\n  4. product (MARS 상품)");
  await inBatches(data.prod.rows, 800, (chunk) =>
    db
      .insert(product)
      .values(chunk)
      .onConflictDoUpdate({
        target: product.marsItemNo,
        set: {
          rawName: sql`excluded.raw_name`,
          brandCode: sql`excluded.brand_code`,
          pattern: sql`excluded.pattern`,
          width: sql`excluded.width`,
          aspectRatio: sql`excluded.aspect_ratio`,
          rimInch: sql`excluded.rim_inch`,
          loadIndex: sql`excluded.load_index`,
          speedRating: sql`excluded.speed_rating`,
          season: sql`excluded.season`,
          isRunflat: sql`excluded.is_runflat`,
          isAcoustic: sql`excluded.is_acoustic`,
          isSuv: sql`excluded.is_suv`,
          listPriceExcl: sql`excluded.list_price_excl`,
          supplierCode: sql`excluded.supplier_code`,
          barcode: sql`excluded.barcode`,
          specParsed: sql`excluded.spec_parsed`,
          updatedAt: sql`now()`,
        },
      }),
  );

  /**
   * ⭐ VAT 적용 — MARS 「단가1」은 VAT 미포함이다 (사장님 확인 2026-08-01).
   *
   * 기표가는 **고객에게 말하는 금액**이므로 세금이 들어 있어야 한다.
   * 그대로 띄우면 상담 중에 10% 낮은 금액을 부르게 된다.
   *
   * 브랜드 단위로 갈린다(brand.price_excludes_vat). 여기서 처리해야
   * **재이관해도 자동으로 다시 붙는다.** 한 번 손으로 고치면 다음 이관 때 날아간다.
   */
  const vat = await db.execute<{ n: number }>(sql`
    WITH u AS (
      UPDATE product p SET
        list_price = CASE WHEN b.price_excludes_vat
                          THEN round(p.list_price_excl * 1.1)::int
                          ELSE p.list_price_excl END,
        updated_at = now()
      FROM brand b
      WHERE b.code = p.brand_code AND p.list_price_excl IS NOT NULL
      RETURNING 1
    ) SELECT count(*)::int n FROM u
  `);
  // 브랜드가 없는 상품은 원본을 그대로 쓴다
  await db.execute(sql`
    UPDATE product SET list_price = list_price_excl
    WHERE brand_code IS NULL AND list_price_excl IS NOT NULL
  `);
  const [vatBrands] = await db.execute<{ names: string | null }>(
    sql`SELECT string_agg(name_ko, ', ') names FROM brand WHERE price_excludes_vat`,
  );
  console.log(`     기표가 ${vat[0]?.n ?? 0}건 정리 · VAT 가산 브랜드: ${vatBrands?.names ?? "없음"}`);

  /* --- 5. product (부품) ---------------------------------- */
  console.log("\n  5. product (부품)");
  const partRows = data.parts.rows.map((p) => ({
    // MARS에 없는 품목이므로 우리가 식별자를 만든다 (D-12 3번)
    marsItemNo: `PART-${p.partNo}`,
    itemType: "part" as const,
    isSerialized: false,
    rawName: p.rawName,
    partNo: p.partNo,
    fitment: p.fitment,
    position: p.position,
    category: p.category,
    specParsed: true,
  }));
  await inBatches(partRows, 800, (chunk) =>
    db
      .insert(product)
      .values(chunk)
      .onConflictDoUpdate({
        target: product.marsItemNo,
        set: {
          fitment: sql`excluded.fitment`,
          position: sql`excluded.position`,
          rawName: sql`excluded.raw_name`,
          updatedAt: sql`now()`,
        },
      }),
  );

  /* --- 6. customer ---------------------------------------- */
  console.log("\n  6. customer");
  await inBatches(data.cust.rows, 800, (chunk) =>
    db
      .insert(customer)
      .values(chunk)
      .onConflictDoUpdate({
        target: customer.marsContactNo,
        set: {
          name: sql`excluded.name`,
          nameSearch: sql`excluded.name_search`,
          memo: sql`excluded.memo`,
          phone: sql`excluded.phone`,
          type: sql`excluded.type`,
          isActive: sql`excluded.is_active`,
        },
      }),
  );

  // 같은 전화번호를 쓰는 고객을 연결한다. ⚠️ 합치지 않는다 (D-10)
  await db.execute(sql`
    WITH g AS (
      SELECT phone, MIN(id) AS gid
      FROM customer
      WHERE phone IS NOT NULL
      GROUP BY phone HAVING COUNT(*) > 1
    )
    UPDATE customer c SET family_group_id = g.gid
    FROM g WHERE c.phone = g.phone
  `);

  /* --- 7. vehicle ----------------------------------------- */
  console.log("\n  7. vehicle");
  const custIdByContact = new Map<string, number>();
  for (const c of await db
    .select({ id: customer.id, no: customer.marsContactNo })
    .from(customer)) {
    if (c.no) custIdByContact.set(c.no, c.id);
  }

  const vehRows = data.veh.rows
    .map((v) => {
      const customerId = v.marsContactNo ? custIdByContact.get(v.marsContactNo) : undefined;
      if (!customerId) return null; // 연결 실패는 import_issue 로 이미 잡혀 있다
      return {
        marsVehicleNo: v.marsVehicleNo,
        customerId,
        plateNo: v.plateNo,
        plateNoNorm: v.plateNoNorm,
        makerCode: v.makerCode,
        model: v.model,
        year: v.year,
        mileage: v.mileage,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  await inBatches(vehRows, 800, (chunk) =>
    db
      .insert(vehicle)
      .values(chunk)
      .onConflictDoUpdate({
        target: vehicle.marsVehicleNo,
        set: {
          plateNo: sql`excluded.plate_no`,
          plateNoNorm: sql`excluded.plate_no_norm`,
          makerCode: sql`excluded.maker_code`,
          model: sql`excluded.model`,
          year: sql`excluded.year`,
          mileage: sql`excluded.mileage`,
        },
      }),
  );

  /* --- 8. stock_item (미쉐린 타이어) ----------------------- */
  console.log("\n  8. stock_item (타이어)");
  const prodIdByMars = new Map<string, number>();
  for (const p of await db.select({ id: product.id, no: product.marsItemNo }).from(product)) {
    if (p.no) prodIdByMars.set(p.no, p.id);
  }

  /**
   * 재이관 시 중복 생성을 막는다. 이관분(stock_no 접두 IMP-)만 지운다.
   * ⚠️ 입출고 이력이 먼저 지워져야 한다. 안 그러면 외래키에 걸려 재이관이 통째로 실패한다
   *    ("Key (id)=… is still referenced from table stock_movement") — 2026-08-01 발견.
   */
  await db.execute(sql`
    DELETE FROM stock_movement
    WHERE stock_item_id IN (SELECT id FROM stock_item WHERE stock_no LIKE 'IMP-%')
  `);
  await db.execute(sql`DELETE FROM stock_item WHERE stock_no LIKE 'IMP-%'`);

  let seq = 0;
  const tireStock = data.stock.rows
    .map((s) => {
      const productId = prodIdByMars.get(s.marsItemNo);
      if (!productId) return null;
      seq += 1;
      return {
        stockNo: `IMP-T${String(seq).padStart(6, "0")}`,
        productId,
        qty: 1,
        status: "재고",
        dot: s.dot,
        /** ⭐ 실사 데이터이므로 확인된 것으로 본다 (부품과 다르다) */
        verifiedAt: new Date(),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  await inBatches(tireStock, 800, (chunk) => db.insert(stockItem).values(chunk));

  /* --- 9. stock_item (부품) — 수량 없이 「미확인」 ---------- */
  console.log("\n  9. stock_item (부품 · 미확인)");
  let pseq = 0;
  const partStock = partRows
    .map((p) => {
      const productId = prodIdByMars.get(p.marsItemNo);
      if (!productId) return null;
      pseq += 1;
      return {
        stockNo: `IMP-P${String(pseq).padStart(6, "0")}`,
        productId,
        qty: 0,
        status: "재고",
        /** ⭐ verified_at 을 비운다 → 화면에 숫자 대신 「미확인」 (D-12 5번) */
        verifiedAt: null,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  await inBatches(partStock, 800, (chunk) => db.insert(stockItem).values(chunk));

  /**
   * ⭐ 재고 행이 생긴 상품만 stock_tracked = true.
   *    ⚠️ 반드시 타이어·부품 재고를 모두 넣은 뒤에 실행해야 한다.
   *       8번 뒤에 두면 부품이 「미확인」이 아니라 「미등록」으로 뜬다.
   *
   *    stock_tracked=false → ⚪ 미등록 (창고엔 있을 수 있다. 0본이 아니다) — D-12 6번
   *    stock_tracked=true + verified_at NULL → ⚪ 미확인 (부품) — D-12 5번
   */
  const tracked = await db.execute<{ n: number }>(sql`
    WITH u AS (
      UPDATE product SET stock_tracked = true
      WHERE id IN (SELECT DISTINCT product_id FROM stock_item) AND stock_tracked = false
      RETURNING 1
    ) SELECT count(*)::int n FROM u
  `);
  console.log(`     stock_tracked 켜짐: ${tracked[0]?.n ?? 0}종 (나머지는 「미등록」)`);

  /**
   * ⭐ 사장님이 고친 세부사항을 되살린다 (2026-08-01).
   *    이관은 상품명에서 계절·런플랫 등을 다시 판정해 덮어쓴다.
   *    이 단계가 없으면 **애써 고친 것이 이관할 때마다 전부 날아간다.**
   */
  const { reapplyOverrides } = await import("../../src/lib/attrs");
  const restored = await reapplyOverrides();
  if (restored > 0) console.log(`     사람이 고친 세부사항 ${restored}건 복원`);

  /* --- 10. import_issue ----------------------------------- */
  console.log("\n  10. import_issue");
  await db.execute(sql`DELETE FROM import_issue WHERE status = '대기'`);
  await inBatches(
    data.issues.map((i) => ({
      kind: i.kind,
      refTable: i.refTable,
      rawValue: i.rawValue,
      suggestion: i.suggestion,
      detail: i.detail,
    })),
    800,
    (chunk) => db.insert(importIssue).values(chunk),
  );

  /* --- 확인 ----------------------------------------------- */
  const counts = await db.execute<{ t: string; n: number }>(sql`
    SELECT 'product' t, count(*) n FROM product
    UNION ALL SELECT 'customer', count(*) FROM customer
    UNION ALL SELECT 'vehicle', count(*) FROM vehicle
    UNION ALL SELECT 'service_item', count(*) FROM service_item
    UNION ALL SELECT 'stock_item', count(*) FROM stock_item
    UNION ALL SELECT 'import_issue', count(*) FROM import_issue
    UNION ALL SELECT 'price_rule (비어있어야 정상)', count(*) FROM ${priceRule}
  `);
  console.log(`\n${"─".repeat(64)}\n적재 완료 — DB 실제 건수`);
  for (const r of counts) console.log(`   ${String(r.t).padEnd(28)} ${String(r.n).padStart(8)}`);
  console.log("\n이제 검색 화면에서 확인하실 수 있습니다:  npm run dev");
}
