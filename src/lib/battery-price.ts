"use server";

/**
 * ⭐ 배터리 단가표 화면 정본 (2026-09-12) — 화면은 이 함수 하나만 부른다.
 *
 *   줄의 **순서·묶음·품명**은 `battery-price-list.ts`(사진을 옮긴 표)에서 오고,
 *   **값은 DB 의 지금 값**(`product.purchase_price` · `list_price`)이다 —
 *   매입가가 나중에 바뀌어도 화면이 진실을 말하게.
 *
 * 🔴 질의 순차 2번(풀 max 3). 145행이라 전부 한 번에 내려보내고
 *    브랜드 칩·검색·「안 받는 것 보기」는 화면에서 거른다(재질의 0).
 * 🔴 「사 오는 값」은 `hasPerm("cost")` 인 사람에게만 — 서버에서 아예 빼고 보낸다
 *    (`receiving/page.tsx`·`stock/export/route.ts` 와 같은 관례).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { hasPerm } from "./auth";
import { getSetting } from "./app-setting";
import {
  BATTERY_PRICES,
  PRICE_HISTORY_KEY,
  PRICE_LIST_DATE,
  PRICE_LIST_SOURCE,
  type PriceHistory,
} from "./battery-price-list";

export interface BatteryPriceRow {
  /** 앱에 없으면 null — 화면에서 「앱에 없음」 */
  productId: number | null;
  /** 단가표 품명 (앱에만 있는 줄은 앱 품번) */
  name: string;
  /** 앱에서 쓰는 이름 */
  displayName: string | null;
  /** 단가표에 적힌 값. null = 사진에서 안 읽힘 → 「확인 필요」 */
  listedCost: number | null;
  /** 지금 앱 원가 (권한 없으면 null) */
  cost: number | null;
  /** 이번 반영 전 값 (권한 없으면 null) */
  prevCost: number | null;
  /** 파는 값 — 기표가 VAT 포함. null 이면 팔 때 친다 */
  price: number | null;
  qty: number;
  isActive: boolean;
  note: string | null;
}

export interface BatteryPriceGroup {
  brand: string;
  series: string;
  rows: BatteryPriceRow[];
}

export interface BatteryPriceView {
  groups: BatteryPriceGroup[];
  /** 단가표에 없는 배터리 품목 (바르타·에너자이저 등) */
  others: BatteryPriceRow[];
  listDate: string;
  source: string;
  /** 사 오는 값을 보여 줘도 되는 사람인가 */
  costShown: boolean;
  /** 파는 값을 고칠 수 있는 사람인가 */
  canEdit: boolean;
  /** 이번 인상으로 바뀐 줄 수 (0이면 띠 안 띄움) */
  changed: number;
}

type DbRow = {
  id: number;
  part_no: string | null;
  name: string;
  purchase_price: string | number | null;
  list_price: number | null;
  is_active: boolean;
  qty: number;
};

function num(v: string | number | null): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export async function batteryPriceTable(): Promise<BatteryPriceView> {
  const costShown = await hasPerm("cost");
  const canEdit = await hasPerm("master");

  const rows = await db.execute<DbRow>(sql`
    SELECT p.id, p.part_no,
           COALESCE(NULLIF(p.display_name, ''), p.raw_name) name,
           p.purchase_price, p.list_price, p.is_active,
           COALESCE(s.qty, 0)::int qty
    FROM product p
    LEFT JOIN (
      SELECT product_id, SUM(qty)::int qty FROM stock_item WHERE status = '재고' GROUP BY product_id
    ) s ON s.product_id = p.id
    WHERE p.item_type = 'part' AND p.category = '배터리'
  `);

  /** 이번 인상의 「전 값」 — 없으면 빈 손 (스크립트를 아직 안 돌린 경우). 공용 정본 getSetting (5단계 정리) */
  const hist = await getSetting(PRICE_HISTORY_KEY);
  const prevOf = new Map<number, number | null>();
  if (hist) {
    try {
      const h = JSON.parse(hist) as PriceHistory;
      for (const r of h.rows ?? []) prevOf.set(Number(r.productId), r.from);
    } catch {
      /* 값이 깨졌으면 「전 값」만 안 보인다 — 표는 그대로 */
    }
  }

  const byPartNo = new Map<string, DbRow>();
  const byId = new Map<number, DbRow>();
  for (const r of rows) {
    byId.set(Number(r.id), r);
    if (r.part_no) byPartNo.set(r.part_no, r);
  }

  const used = new Set<number>();
  const groups: BatteryPriceGroup[] = [];
  for (const t of BATTERY_PRICES) {
    const hit = t.productId ? byId.get(t.productId) : byPartNo.get(t.name);
    if (hit) used.add(Number(hit.id));
    const row: BatteryPriceRow = {
      productId: hit ? Number(hit.id) : null,
      name: t.name,
      displayName: hit?.name ?? null,
      listedCost: t.price,
      cost: costShown && hit ? num(hit.purchase_price) : null,
      prevCost: costShown && hit ? (prevOf.get(Number(hit.id)) ?? null) : null,
      price: hit?.list_price ?? null,
      qty: hit ? Number(hit.qty) : 0,
      isActive: hit ? hit.is_active : false,
      note: t.note ?? null,
    };
    const last = groups[groups.length - 1];
    if (last && last.brand === t.brand && last.series === t.series) last.rows.push(row);
    else groups.push({ brand: t.brand, series: t.series, rows: [row] });
  }

  const others: BatteryPriceRow[] = rows
    .filter((r) => !used.has(Number(r.id)))
    .map((r) => ({
      productId: Number(r.id),
      name: r.part_no ?? r.name,
      displayName: r.name,
      listedCost: null,
      cost: costShown ? num(r.purchase_price) : null,
      prevCost: null,
      price: r.list_price ?? null,
      qty: Number(r.qty),
      isActive: r.is_active,
      note: null,
    }))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.displayName!.localeCompare(b.displayName!));

  return {
    groups,
    others,
    listDate: PRICE_LIST_DATE,
    source: PRICE_LIST_SOURCE,
    costShown,
    canEdit,
    changed: prevOf.size,
  };
}
