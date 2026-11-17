"use server";

/**
 * ⭐ 타이어 보관 — 화면이 부르는 액션 (D-42, 2026-11-17)
 *
 *   권한: 등록·찾아감·인쇄 크기·실사 = sale / 폐기·제외·되돌리기·고치기 = sale_edit.
 *   새 권한 키는 만들지 않았다 — 새 키는 꺼진 채 시작해 직원이 하룻밤 사이 막힌다.
 *   쓰기 정본은 tire-storage-db.ts, 규칙은 tire-storage-pure.ts.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "./auth";
import { setSetting } from "./app-setting";
import { ymdKst } from "./tire-age";
import { insertStoredSet, nextStorageNo, storageOwnerProblem } from "./tire-storage-db";
import { storageForVehicle, type StorageRow } from "./tire-storage-data";
import {
  cleanDrop,
  formatLabelSize,
  LABEL_SIZE_KEY,
  parseLabelSize,
  validateDrop,
  type StorageDropInput,
} from "./tire-storage-pure";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const NO_SALE = "판매 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다";
const NO_EDIT = "판매 수정 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다";

function touch(vehicleId?: number | null) {
  revalidatePath("/storage");
  if (vehicleId) revalidatePath(`/vehicle/${vehicleId}`);
}

function errText(e: unknown): string {
  const err = e as Error & { cause?: { message?: string } };
  return err.cause?.message ?? err.message?.split("\n")[0] ?? "알 수 없는 오류";
}

/** 판매 없이 맡김 등록 (차량 화면·보관 화면) */
export async function registerStorage(input: { vehicleId: number; drop: StorageDropInput; storedOn?: string }): Promise<Result<{ id: number; no: number }>> {
  if (!(await hasPerm("sale"))) return { ok: false, error: NO_SALE };
  const s = await getSession();
  const bad = validateDrop(input.drop);
  if (bad) return { ok: false, error: bad };
  const [v] = await db.execute<{ customer_id: number }>(sql`SELECT customer_id FROM vehicle WHERE id = ${input.vehicleId} AND is_active`);
  if (!v) return { ok: false, error: "차량을 찾지 못했습니다" };
  const customerId = Number(v.customer_id);
  const problem = await storageOwnerProblem(db, customerId);
  if (problem) return { ok: false, error: problem };
  const storedOn = /^\d{4}-\d{2}-\d{2}$/.test(input.storedOn ?? "") ? input.storedOn! : ymdKst(new Date());
  try {
    const r = await db.transaction((tx) =>
      insertStoredSet(tx, { customerId, vehicleId: input.vehicleId, drop: input.drop, storedOn, userId: s?.uid ?? null }),
    );
    touch(input.vehicleId);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** 찾아감(sale) · 폐기(sale_edit) — 판매 없이 손으로 */
export async function releaseStorage(id: number, to: "찾아감" | "폐기", note?: string): Promise<Result> {
  if (!(await hasPerm(to === "폐기" ? "sale_edit" : "sale"))) return { ok: false, error: to === "폐기" ? NO_EDIT : NO_SALE };
  const s = await getSession();
  const rows = await db.execute<{ vehicle_id: number | null }>(sql`
    UPDATE tire_storage SET status = ${to}, released_on = (now() AT TIME ZONE 'Asia/Seoul')::date,
           release_note = ${note?.trim() || null}, released_by = ${s?.uid ?? null}, updated_at = now()
    WHERE id = ${id} AND status = '보관중'
    RETURNING vehicle_id`);
  if (!rows.length) return { ok: false, error: "보관 중인 세트가 아닙니다 — 새로 고침해 보세요" };
  touch(rows[0].vehicle_id);
  return { ok: true };
}

/** 잘못 등록한 것 지우기 → 「제외」(줄은 남는다 — 삭제하지 않는다) */
export async function excludeStorage(id: number, note: string): Promise<Result> {
  if (!(await hasPerm("sale_edit"))) return { ok: false, error: NO_EDIT };
  const s = await getSession();
  const rows = await db.execute<{ vehicle_id: number | null }>(sql`
    UPDATE tire_storage SET status = '제외', released_on = (now() AT TIME ZONE 'Asia/Seoul')::date,
           release_note = ${note.trim() || "잘못 등록"}, released_by = ${s?.uid ?? null}, updated_at = now()
    WHERE id = ${id} AND status IN ('보관중','확인대기')
    RETURNING vehicle_id`);
  if (!rows.length) return { ok: false, error: "지울 수 없는 상태입니다" };
  touch(rows[0].vehicle_id);
  return { ok: true };
}

/**
 * 손으로 찾아감·폐기한 것을 되돌리기 — 판매로 찾아간 것은 판매를 취소해야 한다(판매와 어긋나지 않게).
 */
export async function restoreStorage(id: number): Promise<Result> {
  if (!(await hasPerm("sale_edit"))) return { ok: false, error: NO_EDIT };
  const rows = await db.execute<{ vehicle_id: number | null }>(sql`
    UPDATE tire_storage SET status = '보관중', released_on = NULL, release_note = NULL, released_by = NULL, updated_at = now()
    WHERE id = ${id} AND status IN ('찾아감','폐기') AND released_quote_id IS NULL AND storage_no IS NOT NULL
    RETURNING vehicle_id`);
  if (!rows.length) return { ok: false, error: "판매로 찾아간 세트는 그 판매를 취소하면 돌아옵니다" };
  touch(rows[0].vehicle_id);
  return { ok: true };
}

/** 내용 고치기 (브랜드·규격·본수·종류·DOT·메모) */
export async function updateStorage(id: number, drop: StorageDropInput): Promise<Result> {
  if (!(await hasPerm("sale_edit"))) return { ok: false, error: NO_EDIT };
  const bad = validateDrop(drop);
  if (bad) return { ok: false, error: bad };
  const d = cleanDrop(drop);
  const rows = await db.execute<{ vehicle_id: number | null }>(sql`
    UPDATE tire_storage SET kind = ${d.kind}, brand = ${d.brand}, size = ${d.size}, qty = ${d.qty}, dot = ${d.dot}, memo = ${d.memo},
           updated_at = now()
    WHERE id = ${id} AND status IN ('보관중','확인대기')
    RETURNING vehicle_id`);
  if (!rows.length) return { ok: false, error: "고칠 수 없는 상태입니다" };
  touch(rows[0].vehicle_id);
  return { ok: true };
}

/** 스티커 크기 — 매장 라벨프린터에 맞춰 한 번 */
export async function setLabelSize(raw: string): Promise<Result<{ size: string }>> {
  if (!(await hasPerm("sale"))) return { ok: false, error: NO_SALE };
  const size = formatLabelSize(parseLabelSize(raw));
  await setSetting(LABEL_SIZE_KEY, size);
  revalidatePath("/print/storage");
  return { ok: true, size };
}

/**
 * 실사 「있음」 — 확인대기 후보에 번호를 주고 보관중으로. 맡긴 날은 원래 판매일 그대로.
 */
export async function confirmCandidate(id: number, drop: StorageDropInput): Promise<Result<{ no: number }>> {
  if (!(await hasPerm("sale"))) return { ok: false, error: NO_SALE };
  const bad = validateDrop(drop);
  if (bad) return { ok: false, error: bad };
  const d = cleanDrop(drop);
  try {
    const no = await db.transaction(async (tx) => {
      const [c] = await tx.execute<{ customer_id: number; status: string }>(
        sql`SELECT customer_id, status FROM tire_storage WHERE id = ${id} FOR UPDATE`,
      );
      if (!c || c.status !== "확인대기") throw new Error("이미 확인한 후보입니다 — 새로 고침해 보세요");
      const problem = await storageOwnerProblem(tx, Number(c.customer_id));
      if (problem) throw new Error(problem);
      const n = await nextStorageNo(tx);
      await tx.execute(sql`
        UPDATE tire_storage SET storage_no = ${n}, status = '보관중', kind = ${d.kind}, brand = ${d.brand}, size = ${d.size},
               qty = ${d.qty}, dot = ${d.dot}, memo = ${d.memo}, release_note = NULL, updated_at = now()
        WHERE id = ${id}`);
      return n;
    });
    revalidatePath("/storage");
    return { ok: true, no };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** 실사 「없음」 — 창고에 없다 → 제외 */
export async function dismissCandidate(id: number): Promise<Result> {
  if (!(await hasPerm("sale"))) return { ok: false, error: NO_SALE };
  const s = await getSession();
  const rows = await db.execute(sql`
    UPDATE tire_storage SET status = '제외', released_on = (now() AT TIME ZONE 'Asia/Seoul')::date, release_note = '실사 없음',
           released_by = ${s?.uid ?? null}, updated_at = now()
    WHERE id = ${id} AND status = '확인대기' RETURNING id`);
  if (!rows.length) return { ok: false, error: "이미 확인한 후보입니다" };
  revalidatePath("/storage");
  return { ok: true };
}

/** 판매 화면 — 차를 고르면 그 차의 보관 세트 */
export async function findStoredSets(vehicleId: number | null, customerId: number | null): Promise<StorageRow[]> {
  if (!(await hasPerm("sale"))) return [];
  return storageForVehicle(vehicleId, customerId);
}
