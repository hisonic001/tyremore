"use server";

/**
 * ⭐ 보관 구역 도면 · 위치 — 화면이 부르는 액션 (2026-11-18)
 *
 *   도면 고치기·구역 더하기/이름/숨기기·배경 사진 = sale_edit (사장님·관리) / 세트 위치 찍기 = sale (직원 매일 일).
 *   규칙은 storage-plan-pure.ts.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { hasPerm } from "./auth";
import { clamp01, defaultRoomPlan, imageProblem, sanitizePlan } from "./storage-plan-pure";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const NO_SALE = "판매 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다";
const NO_EDIT = "판매 수정 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다";

function touch() {
  revalidatePath("/storage");
}

export async function saveAreaPlan(id: number, plan: unknown): Promise<Result> {
  if (!(await hasPerm("sale_edit"))) return { ok: false, error: NO_EDIT };
  const p = sanitizePlan(plan);
  if (!p) return { ok: false, error: "도면을 읽지 못했습니다" };
  const r = await db.execute(sql`UPDATE storage_area SET plan = ${JSON.stringify(p)}::jsonb, updated_at = now() WHERE id = ${id} RETURNING id`);
  if (!r.length) return { ok: false, error: "구역을 찾지 못했습니다" };
  touch();
  return { ok: true };
}

export async function addArea(name: string): Promise<Result<{ id: number }>> {
  if (!(await hasPerm("sale_edit"))) return { ok: false, error: NO_EDIT };
  const n = name.trim().slice(0, 30);
  if (!n) return { ok: false, error: "구역 이름을 적어 주세요" };
  const [r] = await db.execute<{ id: number }>(sql`
    INSERT INTO storage_area (name, plan, sort)
    VALUES (${n}, ${JSON.stringify(defaultRoomPlan())}::jsonb, (SELECT COALESCE(MAX(sort), 0) + 1 FROM storage_area))
    RETURNING id`);
  touch();
  return { ok: true, id: Number(r.id) };
}

export async function renameArea(id: number, name: string): Promise<Result> {
  if (!(await hasPerm("sale_edit"))) return { ok: false, error: NO_EDIT };
  const n = name.trim().slice(0, 30);
  if (!n) return { ok: false, error: "구역 이름을 적어 주세요" };
  await db.execute(sql`UPDATE storage_area SET name = ${n}, updated_at = now() WHERE id = ${id}`);
  touch();
  return { ok: true };
}

/** 숨기기 — 그 구역에 보관 중인 세트가 있으면 막는다(먼저 옮기기) */
export async function hideArea(id: number): Promise<Result> {
  if (!(await hasPerm("sale_edit"))) return { ok: false, error: NO_EDIT };
  const [n] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM tire_storage WHERE area_id = ${id} AND status = '보관중'`);
  if (Number(n.n) > 0) return { ok: false, error: `이 구역에 보관 중인 세트가 ${n.n}개 있습니다 — 먼저 다른 구역으로 옮겨 주세요` };
  await db.execute(sql`UPDATE storage_area SET is_active = false, updated_at = now() WHERE id = ${id} AND NOT is_site`);
  touch();
  return { ok: true };
}

/** 배경 사진 (선택) — 화면에서 1600px·JPEG 로 줄여 보낸다. null 이면 지움 */
export async function setAreaImage(id: number, dataUrl: string | null): Promise<Result> {
  if (!(await hasPerm("sale_edit"))) return { ok: false, error: NO_EDIT };
  const bad = imageProblem(dataUrl);
  if (bad) return { ok: false, error: bad };
  await db.execute(sql`UPDATE storage_area SET image = ${dataUrl || null}, updated_at = now() WHERE id = ${id}`);
  touch();
  return { ok: true };
}

/** 세트 위치 — 구역 + 도면 위 점(0~1). areaId null 이면 위치 지움 */
export async function setStorageLocation(storageId: number, areaId: number | null, x: number, y: number): Promise<Result> {
  if (!(await hasPerm("sale"))) return { ok: false, error: NO_SALE };
  if (areaId != null) {
    const [a] = await db.execute<{ id: number }>(sql`SELECT id FROM storage_area WHERE id = ${areaId} AND is_active AND NOT is_site`);
    if (!a) return { ok: false, error: "구역을 찾지 못했습니다" };
  }
  const r = await db.execute<{ vehicle_id: number | null }>(sql`
    UPDATE tire_storage SET area_id = ${areaId}, pin_x = ${areaId == null ? null : clamp01(x)}, pin_y = ${areaId == null ? null : clamp01(y)},
           updated_at = now()
    WHERE id = ${storageId} AND status IN ('보관중','확인대기') RETURNING vehicle_id`);
  if (!r.length) return { ok: false, error: "보관 중인 세트가 아닙니다" };
  touch();
  if (r[0].vehicle_id) revalidatePath(`/vehicle/${r[0].vehicle_id}`);
  return { ok: true };
}

/**
 * ⭐ 창고 실사 「여기 ✓」 한 번 (사장님 2026-11-18 — 「위치 찍기 너무 불편, 실사 때 간편하게 한 번에」)
 *   실사 전 후보면 번호를 주고 보관중으로 + 위치, 이미 보관중이면 위치만. 한 트랜잭션.
 */
export async function placeHere(storageId: number, areaId: number, x: number, y: number): Promise<Result<{ no: number; confirmed: boolean }>> {
  if (!(await hasPerm("sale"))) return { ok: false, error: NO_SALE };
  const { nextStorageNo, storageOwnerProblem } = await import("./tire-storage-db");
  try {
    const out = await db.transaction(async (tx) => {
      const [a] = await tx.execute<{ id: number }>(sql`SELECT id FROM storage_area WHERE id = ${areaId} AND is_active AND NOT is_site`);
      if (!a) throw new Error("구역을 찾지 못했습니다");
      const [t] = await tx.execute<{ status: string; storage_no: number | null; customer_id: number; kind: string | null }>(sql`
        SELECT status, storage_no, customer_id, kind FROM tire_storage WHERE id = ${storageId} FOR UPDATE`);
      if (!t || (t.status !== "보관중" && t.status !== "확인대기")) throw new Error("보관 중이거나 실사 전인 세트가 아닙니다 — 새로 고침해 보세요");
      let no = t.storage_no == null ? null : Number(t.storage_no);
      const confirmed = t.status === "확인대기";
      if (confirmed) {
        if (!t.kind) throw new Error("스노/일반이 비어 있습니다 — 실사 탭에서 내용을 채워 주세요");
        const problem = await storageOwnerProblem(tx, Number(t.customer_id));
        if (problem) throw new Error(problem);
        no = await nextStorageNo(tx);
      }
      await tx.execute(sql`
        UPDATE tire_storage SET status = '보관중', storage_no = ${no}, area_id = ${areaId}, pin_x = ${clamp01(x)}, pin_y = ${clamp01(y)},
               release_note = CASE WHEN status = '확인대기' THEN NULL ELSE release_note END, updated_at = now()
        WHERE id = ${storageId}`);
      return { no: no!, confirmed };
    });
    touch();
    return { ok: true, ...out };
  } catch (e) {
    const err = e as Error & { cause?: { message?: string } };
    return { ok: false, error: err.cause?.message ?? err.message.split("\n")[0] };
  }
}
