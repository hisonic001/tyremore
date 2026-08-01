/**
 * ⭐ 통합 검색 — D-11 1번
 *
 * "무엇을 검색할지" 고르는 단계를 없앤다. 입력 패턴으로 자동 판별한다.
 * 현장 속도를 가장 크게 바꾸는 결정이다. 정비사는 검색창 하나만 본다.
 */
import { and, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { brand, customer, product, stockItem, vehicle } from "@/db/schema";
import { normalizePlate, normalizePhone } from "./normalize";
import { parseSpecQuery } from "./tire-spec";

export type SearchKind = "plate" | "phone" | "spec" | "name" | "barcode" | "part";

export interface SearchResult {
  kind: SearchKind;
  label: string;
  vehicles: VehicleHit[];
  products: ProductHit[];
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
  /** ⭐ 모델명 'PILOT SPORT 4 S' — 고객이 말하는 이름이다. 10,316건 보유 */
  pattern: string | null;
  brandName: string | null;
  spec: string | null;
  listPrice: number | null;
  /** 재고 본수 */
  stockQty: number;
  /** ⭐ false면 「미등록」 — 0본과 다르다 (D-12 6번) */
  stockTracked: boolean;
  /** 부품: NULL이면 「미확인」 (D-12 5번) */
  verified: boolean;
  itemType: string;
  fitment: string | null;
  partNo: string | null;
}

/** 입력만 보고 무엇을 찾는지 정한다 */
export function detectKind(q: string): SearchKind {
  const t = q.trim();
  if (parseSpecQuery(t)) return "spec";
  if (/^\d{2,3}[가-힣]\s?\d{4}$/.test(t) || /^[가-힣]{2}\d{2,3}[가-힣]\d{4}$/.test(t)) return "plate";
  // 뒷 4자리만 말하는 경우 — 고객은 "3456이요" 라고 한다
  if (/^\d{4}$/.test(t)) return "plate";
  if (/^01\d{1,2}-?\d{3,4}-?\d{4}$/.test(t) || /^\d{9,11}$/.test(t.replace(/\D/g, ""))) return "phone";
  if (/^\d{8,13}$/.test(t)) return "barcode";
  if (/^[A-Za-z]{2,}-?\d/.test(t)) return "part";
  return "name";
}

const KIND_LABEL: Record<SearchKind, string> = {
  plate: "차량번호",
  phone: "전화번호",
  spec: "규격",
  name: "이름·상품",
  barcode: "바코드",
  part: "부품",
};

export async function search(rawQuery: string): Promise<SearchResult> {
  const q = rawQuery.trim();
  const kind = detectKind(q);
  const empty: SearchResult = { kind, label: KIND_LABEL[kind], vehicles: [], products: [] };
  if (!q) return empty;

  if (kind === "plate" || kind === "phone") {
    return { ...empty, vehicles: await findVehicles(q, kind) };
  }

  /**
   * ⭐ 글자를 치면 고객과 상품을 동시에 찾는다.
   * '제네시스'는 고객 이름일 수도, 부품 적용차종일 수도 있다.
   * 'PILOT SPORT'는 타이어 모델명이다. 정비사에게 "무엇을 찾을지" 묻지 않는다.
   */
  if (kind === "name" || kind === "part") {
    const [vehicles, products] = await Promise.all([findVehicles(q, "name"), findProducts(q, kind)]);
    return { ...empty, vehicles, products };
  }
  return { ...empty, products: await findProducts(q, kind) };
}

/* ---------------------------------------------------------- */

async function findVehicles(q: string, kind: SearchKind): Promise<VehicleHit[]> {
  let where;
  if (kind === "plate") {
    const norm = normalizePlate(q);
    where =
      norm.length === 4
        ? sql`right(${vehicle.plateNoNorm}, 4) = ${norm}` // 뒷자리만
        : sql`${vehicle.plateNoNorm} LIKE ${"%" + norm + "%"}`;
  } else if (kind === "phone") {
    const digits = normalizePhone(q) ?? q;
    where = sql`${customer.phone} LIKE ${"%" + digits + "%"}`;
  } else {
    // 이름 검색은 원문·정규화·메모를 전부 뒤진다 (D-10)
    const like = `%${q}%`;
    where = or(
      sql`${customer.name} ILIKE ${like}`,
      sql`${customer.nameSearch} ILIKE ${"%" + q.replace(/\s/g, "").toLowerCase() + "%"}`,
      sql`${customer.memo} ILIKE ${like}`,
    );
  }

  const rows = await db
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
    .where(and(where, eq(vehicle.isActive, true)))
    .limit(30);

  return rows;
}

async function findProducts(q: string, kind: SearchKind): Promise<ProductHit[]> {
  let where;
  if (kind === "spec") {
    const s = parseSpecQuery(q)!;
    where = and(
      eq(product.itemType, "tire"),
      eq(product.width, s.width),
      eq(product.aspectRatio, s.aspectRatio),
      sql`${product.rimInch} = ${String(s.rimInch)}`,
    );
  } else if (kind === "barcode") {
    where = eq(product.barcode, q);
  } else {
    /**
     * 부품은 품번·적용차종으로, 타이어는 모델명으로 찾는다.
     * 적용차종이 부품 검색의 전부다 (D-12) — pg_trgm 인덱스가 이걸 받는다.
     */
    const like = `%${q}%`;
    where = or(
      sql`${product.partNo} ILIKE ${like}`,
      sql`${product.fitment} ILIKE ${like}`,
      sql`${product.pattern} ILIKE ${like}`,
    );
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
      listPrice: product.listPrice,
      stockTracked: product.stockTracked,
      itemType: product.itemType,
      fitment: product.fitment,
      partNo: product.partNo,
      stockQty: sql<number>`COALESCE((
        SELECT SUM(s.qty)::int FROM stock_item s
        WHERE s.product_id = ${product.id} AND s.status = '재고'
      ), 0)`,
      verified: sql<boolean>`EXISTS (
        SELECT 1 FROM stock_item s
        WHERE s.product_id = ${product.id} AND s.verified_at IS NOT NULL
      )`,
    })
    .from(product)
    .leftJoin(brand, eq(product.brandCode, brand.code))
    .where(and(where, eq(product.isActive, true)))
    // ⭐ 재고 있는 것 → 미등록 → 소진 순. 지금 팔 수 있는 것이 먼저다
    .orderBy(sql`
      CASE WHEN (SELECT COUNT(*) FROM stock_item s WHERE s.product_id = ${product.id} AND s.status='재고' AND s.qty > 0) > 0 THEN 0
           WHEN ${product.stockTracked} = false THEN 1
           ELSE 2 END`, brand.sortOrder, product.rawName)
    .limit(40);

  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    pattern: r.pattern,
    brandName: r.brandName,
    spec: r.width && r.aspectRatio && r.rimInch ? `${r.width}/${r.aspectRatio}R${Number(r.rimInch)}` : null,
    listPrice: r.listPrice,
    stockQty: Number(r.stockQty ?? 0),
    stockTracked: r.stockTracked,
    verified: r.verified,
    itemType: r.itemType,
    fitment: r.fitment,
    partNo: r.partNo,
  }));
}
