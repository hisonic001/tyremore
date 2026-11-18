"use server";

/**
 * ⭐ 보관 구역 도면 · 위치 — 화면이 부르는 액션 (2026-11-18, 3차 개정)
 *
 *   위치 = 구역 + 자리(구역 도면의 block 칸 id) + 더미 번호. 점(좌표)은 버렸다 — 사장님 「허술·허접」.
 *   도면 고치기·구역 더하기/이름/숨기기·배경 사진 = sale_edit / 위치 정하기·창고 실사 = sale.
 *   규칙은 storage-plan-pure.ts.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "./auth";
import { defaultRoomPlan, imageProblem, removedOccupiedSlots, sanitizePlan, slotLabel, slotNameProblem, type Plan } from "./storage-plan-pure";
import { registerFoundSetTx, resolveLoc, type FoundSetInput, type Loc } from "./storage-found-db";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const NO_SALE = "판매 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다";
const NO_EDIT = "판매 수정 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다";

function touch() {
  revalidatePath("/storage");
}
function errText(e: unknown): string {
  const err = e as Error & { cause?: { message?: string } };
  return err.cause?.message ?? err.message.split("\n")[0];
}

/** 도면 저장 — 🔴 세트가 든 자리는 지울 수 없다(그 세트가 어디 있는지 잃는다). 이름 바꾸기는 괜찮다(id 로 묶음) */
export async function saveAreaPlan(id: number, plan: unknown): Promise<Result> {
  if (!(await hasPerm("sale_edit"))) return { ok: false, error: NO_EDIT };
  const p = sanitizePlan(plan);
  if (!p) return { ok: false, error: "도면을 읽지 못했습니다" };
  try {
    await db.transaction(async (tx) => {
      const [a] = await tx.execute<{ plan: unknown; is_site: boolean }>(sql`SELECT plan, is_site FROM storage_area WHERE id = ${id} FOR UPDATE`);
      if (!a) throw new Error("구역을 찾지 못했습니다");
      if (!a.is_site) {
        const nameBad = slotNameProblem(p);
        if (nameBad) throw new Error(nameBad);
      }
      const before = sanitizePlan(a.plan);
      const occ = await tx.execute<{ slot_id: string; n: number }>(sql`
        SELECT slot_id, count(*)::int AS n FROM tire_storage WHERE area_id = ${id} AND slot_id IS NOT NULL AND status IN ('보관중','확인대기') GROUP BY 1`);
      const gone = removedOccupiedSlots(before, p, occ.map((o) => o.slot_id));
      if (gone.length) {
        const names = gone.map((g) => `「${slotLabel(before, g)}」에 ${occ.find((o) => o.slot_id === g)?.n}세트`).join(", ");
        throw new Error(`${names} — 먼저 다른 자리로 옮긴 뒤 지워 주세요`);
      }
      await tx.execute(sql`UPDATE storage_area SET plan = ${JSON.stringify(p)}::jsonb, updated_at = now() WHERE id = ${id}`);
    });
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
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

/** 숨기기 — 그 구역에 세트(보관중·실사 전)가 있으면 막는다 */
export async function hideArea(id: number): Promise<Result> {
  if (!(await hasPerm("sale_edit"))) return { ok: false, error: NO_EDIT };
  const [n] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM tire_storage WHERE area_id = ${id} AND status IN ('보관중','확인대기')`);
  if (Number(n.n) > 0) return { ok: false, error: `이 구역에 세트가 ${n.n}개 있습니다 — 먼저 다른 구역으로 옮겨 주세요` };
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

/* ------------------------------------------------------------------
 * 위치 — 구역 + 자리 + 더미
 * ---------------------------------------------------------------- */

export type { Loc } from "./storage-found-db";
export interface PrevLoc {
  areaId: number | null;
  slotId: string | null;
  stackNo: number | null;
  /** 「여기 ✓」가 지운 실사 메모(경리 명단 있음 등) — 되돌릴 때 살린다 */
  note?: string | null;
}

/** 위치 정하기·바꾸기 (상세 화면). loc null 이면 위치 지움 */
export async function setStorageLocation(storageId: number, loc: Loc | null): Promise<Result<{ stackNo: number | null }>> {
  if (!(await hasPerm("sale"))) return { ok: false, error: NO_SALE };
  const s = await getSession();
  try {
    const out = await db.transaction(async (tx) => {
      const stackNo = loc ? await resolveLoc(tx, loc, storageId) : null;
      const r = await tx.execute<{ vehicle_id: number | null }>(sql`
        UPDATE tire_storage SET area_id = ${loc?.areaId ?? null}, slot_id = ${loc?.slotId ?? null}, stack_no = ${stackNo},
               located_at = ${loc ? sql`now()` : null}, located_by = ${loc ? (s?.uid ?? null) : null}, updated_at = now()
        WHERE id = ${storageId} AND status IN ('보관중','확인대기') RETURNING vehicle_id`);
      if (!r.length) throw new Error("보관 중인 세트가 아닙니다 — 새로 고침해 보세요");
      return { stackNo, vehicleId: r[0].vehicle_id };
    });
    touch();
    if (out.vehicleId) revalidatePath(`/vehicle/${out.vehicleId}`);
    return { ok: true, stackNo: out.stackNo };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/**
 * ⭐ 창고 실사 「여기 ✓」 한 번 (사장님 2026-11-18 — 「실사 때 간편하게 한 번에」)
 *   실사 전 후보면 번호를 주고 보관중으로 + 위치, 이미 보관중이면 위치만. 한 트랜잭션. 되돌리기용으로 전 위치를 돌려준다.
 */
export async function placeHere(
  storageId: number,
  loc: Loc,
): Promise<Result<{ no: number; confirmed: boolean; stackNo: number; prev: PrevLoc }>> {
  if (!(await hasPerm("sale"))) return { ok: false, error: NO_SALE };
  const { nextStorageNo, storageOwnerProblem } = await import("./tire-storage-db");
  const sess = await getSession();
  try {
    const out = await db.transaction(async (tx) => {
      // 잠금 순서: 세트 줄 → 구역(FOR SHARE)·자리 → 번호 (되돌리기도 같은 순서 — 서로 기다리다 멈추지 않게)
      const [t] = await tx.execute<{ status: string; storage_no: number | null; customer_id: number; kind: string | null; area_id: number | null; slot_id: string | null; stack_no: number | null; release_note: string | null }>(sql`
        SELECT status, storage_no, customer_id, kind, area_id, slot_id, stack_no, release_note FROM tire_storage WHERE id = ${storageId} FOR UPDATE`);
      if (!t || (t.status !== "보관중" && t.status !== "확인대기")) throw new Error("보관 중이거나 실사 전인 세트가 아닙니다 — 새로 고침해 보세요");
      const stackNo = await resolveLoc(tx, loc, storageId);
      let no = t.storage_no == null ? null : Number(t.storage_no);
      const confirmed = t.status === "확인대기";
      if (confirmed) {
        if (!t.kind) throw new Error("스노/일반이 비어 있습니다 — 실사 후보 탭에서 내용을 채워 주세요");
        const problem = await storageOwnerProblem(tx, Number(t.customer_id));
        if (problem) throw new Error(problem);
        no = await nextStorageNo(tx);
      }
      await tx.execute(sql`
        UPDATE tire_storage SET status = '보관중', storage_no = ${no}, area_id = ${loc.areaId}, slot_id = ${loc.slotId}, stack_no = ${stackNo},
               located_at = now(), located_by = ${sess?.uid ?? null},
               release_note = CASE WHEN status = '확인대기' THEN NULL ELSE release_note END, updated_at = now()
        WHERE id = ${storageId}`);
      return {
        no: no!,
        confirmed,
        stackNo,
        prev: {
          areaId: t.area_id == null ? null : Number(t.area_id),
          slotId: t.slot_id,
          stackNo: t.stack_no == null ? null : Number(t.stack_no),
          note: confirmed ? t.release_note : null,
        },
      };
    });
    touch();
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/**
 * 「되돌리기」 — 방금 「여기 ✓」 를 무른다 (검토 2026-11-18 보강).
 *   ① 세트가 **아직 방금 놓은 그 자리**일 때만(그 사이 누가 옮겼으면 안 건드림)
 *   ② 돌아갈 자리가 도면에 아직 있을 때만(없으면 「위치 없음」으로)
 *   ③ 실사 확인까지 무르는 건 그 번호가 아직 가장 큰 번호이고 10분 안일 때만(번호 재사용 금지 — D-42)
 *   잠금 순서는 placeHere 와 같다: 세트 줄 → 구역 → 번호.
 */
export async function undoPlace(
  storageId: number,
  placed: { areaId: number; slotId: string; stackNo: number },
  prev: PrevLoc,
  unconfirm: boolean,
): Promise<Result<{ note: string; unconfirmed: boolean }>> {
  if (!(await hasPerm("sale"))) return { ok: false, error: NO_SALE };
  try {
    const out = await db.transaction(async (tx) => {
      const [t] = await tx.execute<{ storage_no: number | null; area_id: number | null; slot_id: string | null; stack_no: number | null; fresh: boolean }>(sql`
        SELECT storage_no, area_id, slot_id, stack_no, (located_at > now() - interval '10 minutes') AS fresh
        FROM tire_storage WHERE id = ${storageId} AND status = '보관중' FOR UPDATE`);
      if (!t) throw new Error("되돌릴 수 없는 상태입니다");
      if (Number(t.area_id) !== placed.areaId || t.slot_id !== placed.slotId || Number(t.stack_no) !== placed.stackNo)
        throw new Error("그 사이 위치가 바뀌었습니다 — 되돌리지 않았습니다");
      let back: PrevLoc = { areaId: null, slotId: null, stackNo: null };
      if (prev.areaId != null && prev.slotId && prev.stackNo != null) {
        const [a] = await tx.execute<{ plan: unknown }>(sql`SELECT plan FROM storage_area WHERE id = ${prev.areaId} AND is_active FOR SHARE`);
        const ok = !!a && !!sanitizePlan(a.plan)?.shapes.some((x) => x.id === prev.slotId && x.kind === "block");
        if (ok) back = { areaId: prev.areaId, slotId: prev.slotId, stackNo: prev.stackNo };
      }
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tire_storage_no'))`);
      const [top] = await tx.execute<{ m: number }>(sql`SELECT COALESCE(MAX(storage_no), 0)::int AS m FROM tire_storage`);
      const unconfirmed = unconfirm && !!t.fresh && Number(t.storage_no) === Number(top.m);
      await tx.execute(sql`
        UPDATE tire_storage SET area_id = ${back.areaId}, slot_id = ${back.slotId}, stack_no = ${back.stackNo},
               located_at = ${back.areaId == null ? null : sql`located_at`},
               status = ${unconfirmed ? "확인대기" : "보관중"}, storage_no = ${unconfirmed ? null : t.storage_no},
               release_note = ${unconfirmed ? (prev.note ?? null) : sql`release_note`}, updated_at = now()
        WHERE id = ${storageId}`);
      const note = unconfirmed
        ? "되돌렸습니다 — 다시 실사 전으로"
        : unconfirm
          ? "위치만 되돌렸습니다 — 번호는 그대로(이미 다음 번호가 나갔거나 10분 지남). 잘못이면 상세에서 「잘못 등록 — 지우기」"
          : back.areaId == null && prev.areaId != null
            ? "되돌렸습니다 — 전 자리가 도면에서 사라져 「위치 없음」으로"
            : "위치를 되돌렸습니다";
      return { note, unconfirmed };
    });
    touch();
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/* ------------------------------------------------------------------
 * 처음 보는 세트 — 손님·차·거래처가 앱에 없어도 그 자리에서 (사장님 2026-11-18)
 *   규칙·설명은 storage-found-db.ts registerFoundSetTx (스크립트 시험이 같은 코드를 부른다)
 * ---------------------------------------------------------------- */

export type { FoundOwner } from "./storage-found-db";

export async function registerFoundSet(
  input: FoundSetInput,
): Promise<Result<{ id: number; no: number; stackNo: number | null; vehicleId: number; plate: string; owner: string; reused: boolean }>> {
  if (!(await hasPerm("sale"))) return { ok: false, error: NO_SALE };
  const { validateDrop } = await import("./tire-storage-pure");
  const bad = validateDrop(input.drop);
  if (bad) return { ok: false, error: bad };
  const sess = await getSession();
  try {
    const out = await db.transaction((tx) => registerFoundSetTx(tx, input, sess?.uid ?? null));
    touch();
    revalidatePath(`/vehicle/${out.vehicleId}`);
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}
