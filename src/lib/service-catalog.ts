"use server";

/**
 * ⭐ 공임·정비 목록 관리 (사장님 요청 2026-08-31)
 *
 *   "판매 등록, 판매 내역에서 공임정비 추가 항목들을 수정 및 추가가 가능하게. …
 *    목록의 것도 수정가능. 직접 적는 것은 별로임. 또한 새로운 공임과 정비 추가도 가능했으면."
 *
 *   지금까지 이 목록(69건)은 MARS 이관으로만 채워졌고 고칠 화면이 없었다.
 *   그래서 사장님은 「기타」를 고르고 메모에 실제 내용을 적어 오셨다 (450줄 중 381줄에 메모).
 *
 * 🔴 MARS 를 안 깨는 경계선:
 *   · `mars_service_no` 는 여기서 **아예 입력으로 받지 않는다** — 원본을 절대 덮어쓰지
 *     않는다(D-08, product.mars_item_no 와 같은 이치). 화면은 보여만 준다.
 *   · 새로 만든 항목은 번호가 NULL → MARS 입력 로봇이 범용 품번 S001/1290(기타)으로
 *     넣고 이름은 그대로 들어간다 (mars-queue.ts · mars-fill.ts, 이미 뚫려 있는 길).
 *   · 삭제는 없다 — **사용중지**뿐. 과거 판매 줄들이 service_item_id 로 물려 있다.
 *   · 금액을 고쳐도 과거 판매는 안 바뀐다 — quote_item.final_price 는 판 순간의 스냅샷.
 *
 * 🔴 사장님 전용. 질의 순차 · LIMIT.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, isOwner } from "@/lib/auth";

function refresh() {
  for (const p of ["/settings/services", "/sale", "/sales"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

async function guard(): Promise<{ ok: true; uid: number | null } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "공임·정비 목록은 사장님 계정 전용입니다" };
  const s = await getSession();
  return { ok: true, uid: s?.uid ?? null };
}

/** 공백·대소문자를 지운 비교용 이름 (supplier.ts 와 같은 규칙) */
const nameKey = (s: string) => s.replace(/\s/g, "").toLowerCase();

export interface ServiceCatalogRow {
  id: number;
  /** MARS 품번 — 이관분에만 있다. 화면은 보여만 준다 (여기 액션들은 손대지 않는다) */
  marsNo: string | null;
  name: string;
  shortName: string | null;
  /** NULL = 건별로 정한다 (담을 때 0원으로 들어가므로 그때 적는다) */
  price: number | null;
  category: string | null;
  /** per_unit·per_2_units·per_job — 지금은 어디서도 자동 적용하지 않는다. 보여만 준다 */
  qtyRule: string;
  isFavorite: boolean;
  isActive: boolean;
  /** 판매에 붙은 횟수 — 사용중지할지 판단하는 근거 */
  usedCount: number;
  /** 화면에서 만든 시각 — 이관분 69건은 NULL */
  createdAt: string | null;
}

export async function listServiceCatalog(): Promise<
  { ok: true; rows: ServiceCatalogRow[] } | { ok: false; error: string }
> {
  const g = await guard();
  if (!g.ok) return g;
  const rows = await db.execute<{
    id: number;
    mars_no: string | null;
    name: string;
    short_name: string | null;
    price: number | null;
    category: string | null;
    qty_rule: string;
    is_favorite: boolean;
    is_active: boolean;
    used: number;
    created_at: string | null;
  }>(sql`
    SELECT s.id, s.mars_service_no mars_no, s.name, s.short_name, s.price, s.category,
           s.qty_rule, s.is_favorite, s.is_active,
           (SELECT count(*)::int FROM quote_item qi WHERE qi.service_item_id = s.id) used,
           to_char(s.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') created_at
    FROM service_item s
    ORDER BY s.is_active DESC, s.name
    LIMIT 300
  `);
  return {
    ok: true,
    rows: rows.map((r) => ({
      id: Number(r.id),
      marsNo: r.mars_no,
      name: r.name,
      shortName: r.short_name,
      price: r.price === null ? null : Number(r.price),
      category: r.category,
      qtyRule: r.qty_rule,
      isFavorite: r.is_favorite,
      isActive: r.is_active,
      usedCount: Number(r.used),
      createdAt: r.created_at,
    })),
  };
}

/** 이름·금액 공통 검사 — 금액은 비우면 「건별로 정한다」(NULL) */
function checkInput(name: string, price: number | null): { name: string } | { error: string } {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) return { error: "이름을 적어 주세요" };
  if (n.length > 80) return { error: "이름이 너무 깁니다 (80자까지)" };
  if (price !== null && (!Number.isInteger(price) || price < 0 || price > 10_000_000)) {
    return { error: "금액이 올바르지 않습니다 (비우면 「건별로 정함」이 됩니다)" };
  }
  return { name: n };
}

/** 같은 이름이 이미 있으면 그 항목을 알려 준다 — 목록이 갈라지는 것을 막는다 */
async function findDup(name: string, exceptId?: number): Promise<string | null> {
  const [dup] = await db.execute<{ name: string; is_active: boolean }>(sql`
    SELECT name, is_active FROM service_item
    WHERE replace(lower(name), ' ', '') = ${nameKey(name)}
      ${exceptId ? sql`AND id <> ${exceptId}` : sql``}
    LIMIT 1
  `);
  if (!dup) return null;
  return dup.is_active
    ? `같은 이름이 이미 있습니다 — 「${dup.name}」`
    : `같은 이름이 사용중지 상태로 있습니다 — 「${dup.name}」을 다시 켜 주세요`;
}

/** 새 공임·정비 만들기 — MARS 번호는 없이(NULL) 태어난다 → MARS 에는 범용 S001/1290 으로 */
export async function createService(input: {
  name: string;
  shortName?: string | null;
  price?: number | null;
  isFavorite?: boolean;
}): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const chk = checkInput(input.name, input.price ?? null);
  if ("error" in chk) return { ok: false, error: chk.error };
  const dup = await findDup(chk.name);
  if (dup) return { ok: false, error: dup };
  const [made] = await db.execute<{ id: number }>(sql`
    INSERT INTO service_item (name, short_name, price, category, qty_rule, is_favorite, created_at, created_by)
    VALUES (${chk.name}, ${input.shortName?.trim() || null}, ${input.price ?? null},
            '90-SERVICE', 'per_job', ${input.isFavorite ?? false}, now(), ${g.uid})
    RETURNING id
  `);
  refresh();
  return { ok: true, id: Number(made.id) };
}

/**
 * 항목 고치기 — 이름·짧은 이름·금액·즐겨찾기만.
 * 🔴 금액을 고쳐도 과거 판매(final_price 스냅샷)는 안 바뀐다. 앞으로 담는 것부터 적용된다.
 */
export async function updateService(input: {
  id: number;
  name: string;
  shortName?: string | null;
  price?: number | null;
  isFavorite?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const chk = checkInput(input.name, input.price ?? null);
  if ("error" in chk) return { ok: false, error: chk.error };
  const dup = await findDup(chk.name, input.id);
  if (dup) return { ok: false, error: dup };
  const [done] = await db.execute<{ id: number }>(sql`
    UPDATE service_item
    SET name = ${chk.name}, short_name = ${input.shortName?.trim() || null},
        price = ${input.price ?? null}, is_favorite = ${input.isFavorite ?? false},
        updated_at = now()
    WHERE id = ${input.id}
    RETURNING id
  `);
  if (!done) return { ok: false, error: "항목을 찾을 수 없습니다" };
  refresh();
  return { ok: true };
}

/** 사용중지/다시 켜기 — 검색에서만 사라진다. 과거 판매 줄은 그대로 남는다 */
export async function setServiceActive(
  id: number,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const [done] = await db.execute<{ id: number }>(sql`
    UPDATE service_item SET is_active = ${active}, updated_at = now() WHERE id = ${id} RETURNING id
  `);
  if (!done) return { ok: false, error: "항목을 찾을 수 없습니다" };
  refresh();
  return { ok: true };
}
