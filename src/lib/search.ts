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
import { looksLikeCai, parseTireName, type Badge } from "./tire-name";
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
  /** 숨긴 상품·미취급 브랜드까지 본다 (되살리려고 찾을 때) */
  includeHidden?: boolean;
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
  /** ⭐ CAI — 미쉐린 고유번호. 숫자로만 된 MARS 품번이 곧 CAI 다 (화면 표시용) */
  cai: string | null;
  /** MARS 품번 — 품번은 CAI 가 아닌 것도 있다 (`KM2284672`). 매입·MARS 입력에 쓴다 */
  marsItemNo: string | null;
  /** ⭐ 화면용 모델명 — "CROSSCLIMATE 2" 처럼 짧게 */
  model: string;
  /** 할인율 저장 범위를 만들기 위해 필요 */
  brandCode: string | null;
  /** 런플랫·흡음재·저연비·OE마킹·하중강화 … 세부사항 전부 */
  badges: Badge[];
  /** 사전에 없는 표기 — 버리지 않고 그대로 보여준다 */
  unknown: string[];
  /** ⚠️ MARS 입력용 원본. 화면 정리와 무관하게 유지된다 (D-08) */
  marsName: string;
  pattern: string | null;
  brandName: string | null;
  spec: string | null;
  loadSpeed: string | null;
  season: Season | null;
  isRunflat: boolean;
  isAcoustic: boolean;
  isSuv: boolean;
  /** ⭐ 기표가 (VAT 포함) */
  listPrice: number | null;
  /** 할인율 적용 판매가. 규칙이 없으면 null → 화면에 「할인율 미설정」 */
  salePrice: number | null;
  salesRate: number | null;
  stockQty: number;
  stockTracked: boolean;
  verified: boolean;
  itemType: string;
  fitment: string | null;
  partNo: string | null;
  /** 숨긴 상품(단종·미취급). includeHidden 으로 찾았을 때만 true 가 나온다 */
  isHidden: boolean;
}

/* ============================================================
 * 한글 모델명 ⭐ (2026-08-04)
 *
 * MARS 카탈로그의 모델명은 **전부 영문**이다 (`Solus TA51`, `Majesty 9`).
 * 그런데 사장님도 손님도 「솔루스」·「마제스티」라고 말한다.
 * 그대로 치면 0건이 나와서, 상품이 있는데도 없는 것처럼 보인다.
 *
 * ⚠️ 브랜드 이름은 여기 넣지 않는다 — `brand.name_ko` 로 이미 걸린다.
 * ⚠️ 한 낱말이 여러 철자를 가질 수 있다 (`컨티넨탈` → Conti / Continental).
 *    넓히기만 하고 좁히지 않으므로, 애매하면 여러 개를 적어 두는 편이 낫다.
 * ========================================================== */
const KO_MODEL: Record<string, string[]> = {
  // ── 금호 ──
  솔루스: ["Solus"],
  마제스티: ["Majesty"],
  크루젠: ["Crugen"],
  엑스타: ["Ecsta"],
  윈터크래프트: ["Wintercraft"],
  로드벤처: ["Road Venture"],
  포트란: ["PorTran"],
  이노브: ["Ennov"],
  // ── 미쉐린 ──
  프라이머시: ["Primacy"],
  파일럿: ["Pilot"],
  크로스클라이밋: ["CrossClimate", "CROSCLI"],
  라티튜드: ["Latitude"],
  에너지: ["Energy"],
  // ── 콘티넨탈 ──
  프리미엄콘택트: ["PremiumContact", "PREMC"],
  에코콘택트: ["EcoContact", "ECOC"],
  스포츠콘택트: ["SportContact", "SPOC"],
  울트라콘택트: ["UltraContact", "ULTC"],
  // ── 한국타이어 ──
  벤투스: ["Ventus"],
  다이나프로: ["Dynapro"],
  키너지: ["Kinergy"],
};
/**
 * 🔴 「겨울」·「사계절」·「런플랫」은 여기 넣지 않는다.
 *    이름 글자만 훑으면 `WinterCraft` 는 걸리고 미쉐린 `Alpin` 은 안 걸려
 *    **겨울 타이어 일부만** 나온다. 그게 전부인 줄 아시면 안 넣느니만 못하다.
 *    그건 `season` 칸을 보는 필터 버튼이 정확하다.
 */

/**
 * 입력만 보고 어느 쪽을 볼지 정한다.
 * 사용자가 버튼으로 지정했으면 그쪽이 이긴다.
 */
export function guessMode(q: string): Mode | null {
  const t = q.trim();
  if (!t) return null;
  if (parseSpecQuery(t)) return "product";
  if (looksLikeCai(t)) return "product"; // CAI — 미쉐린 고유번호 5~6자리
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
  const conds: SQL[] = [];

  /**
   * ⭐ 기본은 「지금 팔 수 있는 것」만 보여준다 (사장님 요청 2026-08-01).
   *   MARS 마스터 10,318건에는 단종품·미취급 브랜드가 섞여 있어 상담에 방해가 된다.
   *   지우지 않고 끄기만 한다 — 나중에 입고할 때 되살리면 기표가·규격이 그대로 있다.
   */
  if (!f.includeHidden) {
    conds.push(eq(product.isActive, true));
    conds.push(sql`(${brand.isHandled} IS NULL OR ${brand.isHandled} = true)`);
  }

  /**
   * ⭐ 규격과 단어를 섞어 칠 수 있다 (사장님 요청 2026-08-01)
   *   "2454518"           → 그 규격 전부
   *   "2454518 primacy"   → 그 규격 중 PRIMACY 만
   *   "405365"            → CAI 로 한 건
   * 띄어 쓴 토막을 따로 읽어 **전부 만족하는 것**만 남긴다.
   */
  if (t) {
    const parts = t.split(/\s+/).filter(Boolean);
    const words: string[] = [];

    for (const part of parts) {
      const spec = parseSpecQuery(part);
      if (spec) {
        conds.push(
          eq(product.width, spec.width),
          eq(product.aspectRatio, spec.aspectRatio),
          sql`${product.rimInch} = ${String(spec.rimInch)}`,
        );
        continue;
      }
      /**
       * 품번은 **단독으로 쳤을 때만** 번호로 본다.
       * 모델명과 섞여 있으면 그냥 단어로 취급해야 한다.
       *
       * 🔴 `product.barcode` 는 더 이상 보지 않는다 (2026-08-04).
       *    그 컬럼은 실제 라벨 바코드가 아니라 **품번을 복사해 둔 값**이라
       *    (스키마 주석 참조) `mars_item_no` 로 전부 찾힌다. 바코드를 걷어내면서
       *    같이 정리한다 — 컬럼 자체는 남겨 둔다.
       */
      if (parts.length === 1 && (looksLikeCai(part) || /^\d{7,13}$/.test(part))) {
        conds.push(
          or(eq(product.marsItemNo, part), sql`${product.marsItemNo} LIKE ${part + "%"}`)!,
        );
        continue;
      }
      words.push(part);
    }

    /**
     * 단어는 모델명·품번·적용차종·원문에서 찾는다.
     * 여러 단어를 치면 **전부** 들어 있어야 한다 — 칠수록 좁아진다.
     * 적용차종이 부품 검색의 전부다 (D-12).
     */
    for (const w of words) {
      /**
       * ⭐ 사장님은 모델을 한글로 부르신다 — 「솔루스」·「마제스티」·「크루젠」
       *    (2026-08-04, 금호 목록을 들이면서 드러났다).
       *    카탈로그에는 영문만 있어 그대로 치면 **0건**이 나온다.
       *    한 낱말을 여러 철자로 넓혀 그중 하나만 걸려도 되게 한다
       *    (낱말과 낱말 사이는 여전히 AND — 칠수록 좁아지는 성질은 그대로).
       */
      const spellings = [w, ...(KO_MODEL[w.toLowerCase()] ?? [])];
      const per = spellings.flatMap((s) => {
        const like = `%${s}%`;
        return [
          sql`${product.pattern} ILIKE ${like}`,
          sql`${product.partNo} ILIKE ${like}`,
          sql`${product.fitment} ILIKE ${like}`,
          sql`${product.rawName} ILIKE ${like}`,
          sql`${product.displayName} ILIKE ${like}`,
          /**
           * 🔴 **품번도 단어로 찾는다** (2026-08-04).
           *    위 「단독으로 친 번호」 갈래는 미쉐린 CAI(5~6자리)와 순수 숫자만 받는다.
           *    그래서 `KM2284552`·`180/001/00024` 처럼 글자가 섞인 우리 품번은
           *    어느 갈래에도 안 걸려 **0건**이 나왔다.
           *    바코드를 걷어낸 지금은 품번을 치는 것이 유일한 지름길이라 반드시 걸려야 한다.
           */
          sql`${product.marsItemNo} ILIKE ${like}`,
          // 브랜드는 한글로도 친다 — 원문에는 "Michelin" 뿐이라 "미쉐린"이 안 걸린다
          sql`${brand.nameKo} ILIKE ${like}`,
          sql`${brand.nameEn} ILIKE ${like}`,
        ];
      });
      conds.push(or(...per)!);
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

  const isHidden = sql<boolean>`(${product.isActive} = false OR ${brand.isHandled} = false)`;

  const rows = await db
    .select({
      productId: product.id,
      cai: product.marsItemNo,
      name: product.rawName,
      displayName: product.displayName,
      pattern: product.pattern,
      brandCode: product.brandCode,
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
      oeMarks: product.oeMarks,
      listPrice: product.listPrice,
      stockTracked: product.stockTracked,
      itemType: product.itemType,
      fitment: product.fitment,
      partNo: product.partNo,
      stockQty,
      isHidden,
      /**
       * ⭐ 판매 할인율 — 좁은 것이 이긴다 (개별 > 모델 > 브랜드 > 범주).
       * 상담 화면에서 바로 판매가를 보여주기 위해 검색에서 함께 가져온다.
       *
       * 🔴 `sales_discount_rate IS NOT NULL` 이 중요하다 (2026-08-03).
       *    인보이스에서 들어온 개별 규칙은 **매입 할인율만** 있고 판매는 비어 있는
       *    경우가 많은데, 그 줄이 우선순위에서 이기면 판매 할인율이 null 이 되어
       *    **기본 25% 가 아예 안 먹었다.** 값이 실제로 들어 있는 줄만 본다.
       */
      salesRate: sql<string | null>`(
        SELECT r.sales_discount_rate FROM price_rule r
        WHERE r.sales_discount_rate IS NOT NULL
          AND ( (r.scope='item'     AND r.target = ${product.marsItemNo})
             OR (r.scope='pattern'  AND r.target = ${product.pattern})
             OR (r.scope='brand'    AND r.target = ${product.brandCode})
             OR (r.scope='category' AND r.target = ${product.category}) )
        ORDER BY r.priority LIMIT 1
      )`,
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

  return rows.map((r) => {
    const n = parseTireName(r.name, r.pattern, {
      width: r.width,
      aspectRatio: r.aspectRatio,
      rimInch: r.rimInch,
      brandCode: r.brandCode,
    });
    const rate = r.salesRate !== null ? Number(r.salesRate) : null;
    /**
     * ⚠️ 배지는 **저장된 값**으로 만든다. 이름에서 다시 읽으면
     *    사장님이 고쳐 놓은 것이 화면에 안 나타난다 (2026-08-01).
     */
    const badges: Badge[] = [
      ...(r.isRunflat ? [{ code: "런플랫", label: "런플랫", kind: "runflat" as const }] : []),
      ...(r.isAcoustic ? [{ code: "흡음재", label: "흡음재", kind: "feature" as const }] : []),
      ...(r.isSuv ? [{ code: "SUV", label: "SUV", kind: "structure" as const }] : []),
      ...(r.oeMarks ?? "")
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
        .map((m) => ({ code: m, label: m, kind: "oe" as const })),
      // 구조 표기(XL 등)는 이름에서 읽은 것을 그대로 쓴다
      ...n.badges.filter((b) => b.kind === "structure" && b.code !== "SUV"),
    ];
    return {
    salesRate: rate,
    salePrice: r.listPrice !== null && rate !== null ? Math.round(r.listPrice * (1 - rate)) : null,
    productId: r.productId,
    // 숫자로만 된 품번이 곧 CAI(미쉐린). 나머지 브랜드·자체 등록품은 CAI가 없다
    cai: r.cai && /^\d+$/.test(r.cai) ? r.cai : null,
    // 할인율 저장은 CAI 유무와 상관없이 품번으로 한다
    marsItemNo: r.cai,
    // 사장님이 정한 이름이 있으면 그것이 이긴다
    model: r.displayName?.trim() || n.model,
    badges,
    brandCode: r.brandCode,
    // 상품명 접미(GO=BFGoodrich)가 brand_code 보다 정확하다 — MARS 분류가 틀려 있다
    brandName: n.brandHint ?? r.brandName,
    unknown: n.unknown,
    marsName: n.marsName,
    pattern: r.pattern,
    spec: n.spec,
    loadSpeed: n.loadSpeed ?? (r.loadIndex ? `${r.loadIndex}${r.speedRating ?? ""}` : null),
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
    isHidden: r.isHidden,
    };
  });
}

/** 필터 화면에 쓸 브랜드 목록 — 취급 중이고 타이어를 가진 브랜드만 */
export async function tireBrands() {
  return db.execute<{ code: string; name_ko: string; n: number }>(sql`
    SELECT b.code, b.name_ko, count(*)::int n
    FROM product p JOIN brand b ON b.code = p.brand_code
    WHERE p.item_type = 'tire' AND p.is_active AND b.is_handled
    GROUP BY b.code, b.name_ko, b.sort_order
    ORDER BY b.sort_order
  `);
}
