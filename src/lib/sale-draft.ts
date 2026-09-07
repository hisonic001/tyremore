"use server";

/**
 * ⭐ 판매 임시저장 — 서버 보관 (사장님 요청 2026-09-07)
 *
 *   "임시저장된 내용은 다른 계정들에서도 공유가 가능해서 같이 볼 수 있어야 함."
 *   계정 필터 없이 매장이 sale_draft 한 표를 같이 본다. 카드에는 누가·언제
 *   접어뒀는지 보인다 (공유되니 누구 것인지 보여야 한다).
 *
 *   수명 (사장님 확정): 지워지는 경우는 딱 둘 — ①카드의 x(확인 후)
 *   ②펼쳐서 등록을 마치고 **판매완료** 성공. 펼치고 다시 접으면 같은 줄 UPDATE.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "./auth";
import type { SaleDraftState } from "@/app/sale/draft-store";

const PERM_DENIED = "판매 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다";

export interface ServerSaleDraft {
  id: number;
  label: string;
  /** 「14:02」 — 오늘이 아니면 「09-06 14:02」 */
  savedAt: string;
  /** 접어둔 계정 이름 — 공유 목록이라 누구 것인지 보인다 */
  byName: string | null;
  state: SaleDraftState;
}

export async function listSaleDrafts(): Promise<ServerSaleDraft[]> {
  if (!(await hasPerm("sale"))) return [];
  const rows = await db.execute<{
    id: number;
    label: string;
    state: SaleDraftState;
    by_name: string | null;
    saved_at: string;
  }>(sql`
    SELECT d.id, d.label, d.state, u.name by_name,
           CASE WHEN (d.updated_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date
                THEN to_char(d.updated_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI')
                ELSE to_char(d.updated_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') END saved_at
    FROM sale_draft d LEFT JOIN app_user u ON u.id = d.created_by
    ORDER BY d.updated_at DESC LIMIT 20
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    label: r.label,
    savedAt: r.saved_at,
    byName: r.by_name,
    state: r.state,
  }));
}

/** id 있으면 그 카드를 갱신(펼쳤다 다시 접기), 없으면 새 카드 */
export async function saveSaleDraft(
  label: string,
  state: SaleDraftState,
  id?: number | null,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  if (!(await hasPerm("sale"))) return { ok: false, error: PERM_DENIED };
  const s = await getSession();
  const json = JSON.stringify(state);
  if (json.length > 200_000) return { ok: false, error: "임시 저장 내용이 너무 큽니다" };
  if (id) {
    const upd = await db.execute<{ id: number }>(sql`
      UPDATE sale_draft SET label = ${label}, state = ${json}::jsonb, updated_at = now()
      WHERE id = ${id} RETURNING id`);
    // 그 사이 다른 계정이 지웠으면(판매완료 등) 새 카드로 살린다 — 내용을 잃는 것보다 낫다
    if (upd.length > 0) return { ok: true, id: Number(upd[0].id) };
  }
  const [ins] = await db.execute<{ id: number }>(sql`
    INSERT INTO sale_draft (label, state, created_by)
    VALUES (${label}, ${json}::jsonb, ${s?.uid ?? null}) RETURNING id`);
  return { ok: true, id: Number(ins.id) };
}

export async function removeSaleDraft(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPerm("sale"))) return { ok: false, error: PERM_DENIED };
  await db.execute(sql`DELETE FROM sale_draft WHERE id = ${id}`);
  return { ok: true };
}
