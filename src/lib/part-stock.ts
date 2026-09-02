"use server";

/**
 * ⭐ 부품 재고 (사장님 선택 2026-08-11 — "부품류 재고관리: 배터리, 필터류,
 *    브레이크패드, 엔진오일 등")
 *
 * 타이어는 1본 1행·DOT 로 관리하지만 부품은 행 하나에 수량이다 (엔진오일도 통 단위 —
 * 사장님 확인). 화면은 종류별로 묶어 보여주고, 실사 수정은 기존 setDotQty(부품 분기)를
 * 그대로 쓴다. min_qty(재주문점) 이하로 떨어지면 「부족」이 뜬다.
 */

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { product } from "@/db/schema";
import { getSession } from "./auth";
import { PERM_DENIED } from "./perm-keys";

/**
 * 표시 묶음 — 분류(category)가 있으면 그것을 믿고 (부품몰 이관 2026-08-14 부터
 * 제대로 들어 있다), 없으면 이름·품번으로 짐작한다. 데이터는 안 바꾼다.
 */
function partGroup(name: string, partNo: string | null, category: string | null): string {
  if (category) {
    if (category === "배터리") return "배터리";
    if (category === "브레이크패드") return "브레이크";
    if (category.includes("필터")) return "필터";
  }
  const t = `${name} ${partNo ?? ""}`.toUpperCase();
  if (/배터리|AGM|DIN|BAT|델코|바르타/.test(t)) return "배터리";
  if (/오일필터|에어필터|에어컨|캐빈|필터|FILTER/.test(t)) return "필터";
  if (/패드|라이닝|PAD|슈/.test(t)) return "브레이크";
  if (/오일|0W|5W|10W|OIL|미션유|부동액|워셔/.test(t)) return "오일·유류";
  if (/와이퍼|WIPER/.test(t)) return "와이퍼";
  return "기타";
}

export interface PartStockRow {
  productId: number;
  name: string;
  partNo: string | null;
  group: string;
  qty: number;
  minQty: number | null;
  /** 실사(확인)한 적이 있는가 — 없으면 수량을 못 믿는다 */
  verified: boolean;
  verifiedAt: string | null;
}

type RawRow = {
  id: number;
  name: string;
  part_no: string | null;
  category: string | null;
  min_qty: number | null;
  qty: number;
  verified_at: string | null;
};

function toRow(r: RawRow): PartStockRow {
  return {
    productId: Number(r.id),
    name: r.name,
    partNo: r.part_no,
    group: partGroup(r.name, r.part_no, r.category),
    qty: Number(r.qty),
    minQty: r.min_qty === null ? null : Number(r.min_qty),
    verified: r.verified_at !== null,
    verifiedAt: r.verified_at,
  };
}

/**
 * 부품 재고 목록 — **재고가 실제로 있거나, 재주문점을 정해 둔 부품만**.
 * ⚠️ 전에는 0개짜리 재고 행만 있어도 다 보여줬는데, 부품 카탈로그가 2,100여 종이
 *    되면서 목록이 감당이 안 됐다 (사장님 2026-08-14 — "부품리스트가 너무 기니
 *    검색 형식으로"). 나머지는 아래 searchPartStock 으로 찾아 실사부터 한다.
 */
export async function listPartStock(): Promise<PartStockRow[]> {
  const rows = await db.execute<RawRow>(sql`
    SELECT p.id, COALESCE(NULLIF(p.display_name, ''), p.raw_name) name, p.part_no, p.category,
           p.min_qty,
           COALESCE(s.qty, 0)::int qty,
           to_char(s.verified_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') verified_at
    FROM product p
    LEFT JOIN (
      SELECT product_id, SUM(qty)::int qty, MAX(verified_at) verified_at
      FROM stock_item WHERE status = '재고' GROUP BY product_id
    ) s ON s.product_id = p.id
    WHERE p.item_type = 'part' AND p.is_active
      AND (COALESCE(s.qty, 0) > 0 OR p.min_qty IS NOT NULL)
    ORDER BY name
    LIMIT 300
  `);
  return rows.map(toRow);
}

/** 부품 검색 — 이름·품번·적용차종으로. 목록에 없는 부품에 실사·기준을 넣는 입구다 */
export async function searchPartStock(q: string): Promise<PartStockRow[]> {
  if (!(await getSession())) return [];
  const toks = q.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (toks.length === 0) return [];
  const conds = toks.map(
    (t) => sql`(
      COALESCE(NULLIF(p.display_name, ''), p.raw_name) ILIKE ${"%" + t + "%"}
      OR p.part_no ILIKE ${"%" + t + "%"}
      OR p.fitment ILIKE ${"%" + t + "%"}
    )`,
  );
  const rows = await db.execute<RawRow>(sql`
    SELECT p.id, COALESCE(NULLIF(p.display_name, ''), p.raw_name) name, p.part_no, p.category,
           p.min_qty,
           COALESCE(s.qty, 0)::int qty,
           to_char(s.verified_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') verified_at
    FROM product p
    LEFT JOIN (
      SELECT product_id, SUM(qty)::int qty, MAX(verified_at) verified_at
      FROM stock_item WHERE status = '재고' GROUP BY product_id
    ) s ON s.product_id = p.id
    WHERE p.item_type = 'part' AND p.is_active AND ${sql.join(conds, sql` AND `)}
    ORDER BY COALESCE(s.qty, 0) DESC, name
    LIMIT 30
  `);
  return rows.map(toRow);
}

/** 재주문점 설정 — 0 이하나 빈 값이면 지운다 */
export async function setMinQty(
  productId: number,
  minQty: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await (await import("./auth")).hasPerm("stock"))) return { ok: false, error: PERM_DENIED };
  if (!(await getSession())) return { ok: false, error: "로그인이 필요합니다" };
  const v = minQty === null || !Number.isFinite(minQty) || minQty <= 0 ? null : Math.round(minQty);
  await db.update(product).set({ minQty: v }).where(eq(product.id, productId));
  try {
    revalidatePath("/stock");
  } catch {
    /* 요청 밖 */
  }
  return { ok: true };
}
