/**
 * 검색 — 두 갈래 (2026-08-01 개정)
 *
 * 원래는 검색창 하나로 전부 자동 판별했다(D-11 1번). 그런데 현장에서
 * 고객 조회와 상품 조회는 **목적이 다르다** — 손님 앞에서 이력을 볼 때와,
 * 재고·가격을 찾을 때는 보고 싶은 것이 다르다. 결과가 섞이면 오히려 느리다.
 *
 * 그래서 **버튼 하나로 갈랐다.** 다만 자동 판별은 그대로 남긴다:
 *   차량번호를 치면 고객 쪽으로, 규격을 치면 상품 쪽으로 알아서 넘어간다.
 *   정비사는 평소처럼 치기만 하면 되고, 필요할 때만 버튼을 누른다.
 */
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { brand, customer, product, vehicle } from "@/db/schema";
import { normalizePhone, normalizePlate } from "./normalize";
import { parseSpecQuery } from "./tire-spec";
import type { Season } from "./tire-attrs";

export type Mode = "customer" | "product";

export interface ProductFilter {
  brands?: string[];
  seasons?: Season[];
  runflat?: boolean;
  acoustic?: boolean;
  suv?: boolean;
  /** 재고 있는 것만 */
  inStock?: boolean;
}

export interface VehicleHit {
  vehicleId: number;
  plateNo: string;
  makerName: string | null;
  model: string | null;
  year: number | null;
  mileage: number | null;
  lastFittedSize: string | null;
  customerId: number;
  customerName: string;
  phone: string | null;
  memo: string | null;
  familyGroupId: number | null;
}

export interface ProductHit {
  productId: number;
  name: string;
  pattern: string | null;
  brandName: string | null;
  spec: string | null;
  loadSpeed: string | null;
  season: Season | null;
  isRunflat: boolean;
  isAcoustic: boolean;
  isSuv: boolean;
  /** ⭐ 공장도가 (MARS 단가1) */
  listPrice: number | null;
  stockQty: number;
  stockTracked: boolean;
  verified: boolean;
  itemType: string;
  fitment: string | null;
  partNo: string | null;
}

/**
 * 입력만 보고 어느 쪽을 볼지 정한다.
 * 사용자가 버튼으로 지정했으면 그쪽이 이긴다.
 */
export function guessMode(q: string): Mode | null {
  const t = q.trim();
  if (!t) return null;
  if (parseSpecQuery(t)) return "product";
  if (/^\d{2,3}[가-힣]\s?\d{4}$/.test(t) || /^[가-힣]{2}\d{2,3}[가-힣]\d{4}$/.test(t)) return "customer";
  if (/^\d{4}$/.test(t)) return "customer"; // 고객은 "3456이요" 라고 말한다
  if (/^01\d{1,2}-?\d{3,4}-?\d{4}$/.test(t) || /^\d{9,11}$/.test(t.replace(/\D/g, ""))) return "customer";
  return null; // 글자만으로는 알 수 없다 — 현재 모드를 유지한다
}

/* ---------------------------------------------------------- */

export async function findVehicles(q: string): Promise<VehicleHit[]> {
  const t = q.trim();
  if (!t) return [];

  const plate = normalizePlate(t);
  const isPlate = /^(?:[가-힣]{2})?\d{2,3}[가-힣]?\d{0,4}$/.test(plate) && /\d/.test(plate);
  const digits = normalizePhone(t);

  const conds: SQL[] = [];
  if (isPlate) {
    conds.push(
      plate.length === 4
        ? sql`right(${vehicle.plateNoNorm}, 4) = ${plate}`
        : sql`${vehicle.plateNoNorm} LIKE ${"%" + plate + "%"}`,
    );
  }
  if (digits && digits.length >= 4) conds.push(sql`${customer.phone} LIKE ${"%" + digits + "%"}`);

  // 이름은 원문·정규화·메모를 전부 뒤진다 (D-10)
  const like = `%${t}%`;
  conds.push(
    sql`${customer.name} ILIKE ${like}`,
    sql`${customer.nameSearch} ILIKE ${"%" + t.replace(/\s/g, "").toLowerCase() + "%"}`,
    sql`${customer.memo} ILIKE ${like}`,
    sql`${vehicle.model} ILIKE ${like}`,
  );

  return db
    .select({
      vehicleId: vehicle.id,
      plateNo: vehicle.plateNo,
      makerName: sql<string | null>`(SELECT name_ko FROM vehicle_maker m WHERE m.code = ${vehicle.makerCode})`,
      model: vehicle.model,
      year: vehicle.year,
      mileage: vehicle.mileage,
      lastFittedSize: vehicle.lastFittedSize,
      customerId: customer.id,
      customerName: customer.name,
      phone: customer.phone,
      memo: customer.memo,
      familyGroupId: customer.familyGroupId,
    })
    .from(vehicle)
    .innerJoin(customer, eq(vehicle.customerId, customer.id))
    .where(and(or(...conds), eq(vehicle.isActive, true)))
    .limit(40);
}

export async function findProducts(q: string, f: ProductFilter = {}): Promise<ProductHit[]> {
  const t = q.trim();
  const conds: SQL[] = [eq(product.isActive, true)];

  if (t) {
    const spec = parseSpecQuery(t);
    if (spec) {
      conds.push(
        eq(product.width, spec.width),
        eq(product.aspectRatio, spec.aspectRatio),
        sql`${product.rimInch} = ${String(spec.rimInch)}`,
      );
    } else if (/^\d{8,13}$/.test(t)) {
      conds.push(eq(product.barcode, t));
    } else {
      // 모델명 · 부품번호 · 적용차종
      const like = `%${t}%`;
      conds.push(
        or(
          sql`${product.pattern} ILIKE ${like}`,
          sql`${product.partNo} ILIKE ${like}`,
          sql`${product.fitment} ILIKE ${like}`,
          sql`${product.rawName} ILIKE ${like}`,
        )!,
      );
    }
  }

  // ⚠️ `= ANY(${배열})` 은 postgres.js 가 스칼라로 직렬화해 깨진다. inArray 를 쓴다.
  if (f.brands?.length) conds.push(inArray(product.brandCode, f.brands));
  if (f.seasons?.length) conds.push(inArray(product.season, f.seasons));
  if (f.runflat) conds.push(eq(product.isRunflat, true));
  if (f.acoustic) conds.push(eq(product.isAcoustic, true));
  if (f.suv) conds.push(eq(product.isSuv, true));

  const stockQty = sql<number>`COALESCE((
    SELECT SUM(s.qty)::int FROM stock_item s
    WHERE s.product_id = ${product.id} AND s.status = '재고'
  ), 0)`;

  if (f.inStock) {
    conds.push(sql`EXISTS (
      SELECT 1 FROM stock_item s
      WHERE s.product_id = ${product.id} AND s.status = '재고' AND s.qty > 0
    )`);
  }

  // 검색어도 조건도 없으면 전체를 긁지 않는다
  if (!t && !f.brands?.length && !f.seasons?.length && !f.runflat && !f.acoustic && !f.suv && !f.inStock) {
    return [];
  }

  const rows = await db
    .select({
      productId: product.id,
      name: product.rawName,
      pattern: product.pattern,
      brandName: brand.nameKo,
      width: product.width,
      aspectRatio: product.aspectRatio,
      rimInch: product.rimInch,
      loadIndex: product.loadIndex,
      speedRating: product.speedRating,
      season: product.season,
      isRunflat: product.isRunflat,
      isAcoustic: product.isAcoustic,
      isSuv: product.isSuv,
      listPrice: product.listPrice,
      stockTracked: product.stockTracked,
      itemType: product.itemType,
      fitment: product.fitment,
      partNo: product.partNo,
      stockQty,
      verified: sql<boolean>`EXISTS (
        SELECT 1 FROM stock_item s
        WHERE s.product_id = ${product.id} AND s.verified_at IS NOT NULL
      )`,
    })
    .from(product)
    .leftJoin(brand, eq(product.brandCode, brand.code))
    .where(and(...conds))
    // ⭐ 지금 팔 수 있는 것이 먼저. 그다음 미등록, 소진은 맨 뒤
    .orderBy(
      sql`CASE WHEN ${stockQty} > 0 THEN 0 WHEN ${product.stockTracked} = false THEN 1 ELSE 2 END`,
      brand.sortOrder,
      product.pattern,
    )
    .limit(60);

  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    pattern: r.pattern,
    brandName: r.brandName,
    spec:
      r.width && r.aspectRatio && r.rimInch
        ? `${r.width}/${r.aspectRatio}R${Number(r.rimInch)}`
        : null,
    loadSpeed: r.loadIndex ? `${r.loadIndex}${r.speedRating ?? ""}` : null,
    season: (r.season as Season) ?? null,
    isRunflat: r.isRunflat,
    isAcoustic: r.isAcoustic,
    isSuv: r.isSuv,
    listPrice: r.listPrice,
    stockQty: Number(r.stockQty ?? 0),
    stockTracked: r.stockTracked,
    verified: r.verified,
    itemType: r.itemType,
    fitment: r.fitment,
    partNo: r.partNo,
  }));
}

/** 필터 화면에 쓸 브랜드 목록 — 타이어를 가진 브랜드만 */
export async function tireBrands() {
  return db.execute<{ code: string; name_ko: string; n: number }>(sql`
    SELECT b.code, b.name_ko, count(*)::int n
    FROM product p JOIN brand b ON b.code = p.brand_code
    WHERE p.item_type = 'tire' AND p.is_active
    GROUP BY b.code, b.name_ko, b.sort_order
    ORDER BY b.sort_order
  `);
}
