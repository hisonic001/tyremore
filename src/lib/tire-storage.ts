"use server";

/**
 * ⭐ 타이어 보관 — 화면이 부르는 액션 (D-42, 2026-11-17)
 *
 *   권한(2026-11-18~): 등록·찾아감·인쇄 크기·실사 = hasStoragePerm("use") / 폐기·제외·되돌리기·고치기·주인·번호 = hasStoragePerm("edit")
 *   — 「타이어 보관 관리」(storage) 하나로 전부, 옛 키(판매 등록 / 정비 내역 수정)도 계속 통한다.
 *   새 권한 키는 만들지 않았다 — 새 키는 꺼진 채 시작해 직원이 하룻밤 사이 막힌다.
 *   쓰기 정본은 tire-storage-db.ts, 규칙은 tire-storage-pure.ts.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm, hasStoragePerm } from "./auth";
import { setSetting } from "./app-setting";
import { ymdKst } from "./tire-age";
import { applySaleStorage, hasSaleStorage, insertStoredSet, nextStorageNo, storageOwnerProblem } from "./tire-storage-db";
import { storageForSale, storageForVehicle, type StorageRow } from "./tire-storage-data";
import {
  cleanDrop,
  formatLabelSize,
  LABEL_PAPER_KEY,
  LABEL_PER_KEY,
  LABEL_SIZE_KEY,
  parseLabelPaper,
  parseLabelPer,
  parseLabelSize,
  validateDrop,
  type SaleStorageInput,
  type StorageDropInput,
} from "./tire-storage-pure";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const NO_SALE = "판매 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다";
const NO_STORE = "보관 관리 권한이 없습니다 — 사장님이 설정→계정에서 「타이어 보관 관리」를 켤 수 있습니다";
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
  if (!(await hasStoragePerm("use"))) return { ok: false, error: NO_STORE };
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
      insertStoredSet(tx, { customerId, vehicleId: input.vehicleId, drop: input.drop, storedOn, userId: s?.uid ?? null, origin: "등록" }),
    );
    touch(input.vehicleId);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** 찾아감(sale) · 폐기(sale_edit) — 판매 없이 손으로 */
export async function releaseStorage(id: number, to: "찾아감" | "폐기", note?: string): Promise<Result> {
  if (!(await hasStoragePerm(to === "폐기" ? "edit" : "use"))) return { ok: false, error: NO_STORE };
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
  if (!(await hasStoragePerm("edit"))) return { ok: false, error: NO_STORE };
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
  if (!(await hasStoragePerm("edit"))) return { ok: false, error: NO_STORE };
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
  if (!(await hasStoragePerm("edit"))) return { ok: false, error: NO_STORE };
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

/** 스티커 — 타이어마다 한 장 / 한 세트에 한 장 */
export async function setLabelPer(per: string): Promise<Result<{ per: string }>> {
  if (!(await hasStoragePerm("use"))) return { ok: false, error: NO_STORE };
  const v = parseLabelPer(per);
  await setSetting(LABEL_PER_KEY, v);
  revalidatePath("/print/storage");
  return { ok: true, per: v };
}

/** 스티커 용지 — 일반 프린터(A4) / 라벨프린터 */
export async function setLabelPaper(paper: string): Promise<Result<{ paper: string }>> {
  if (!(await hasStoragePerm("use"))) return { ok: false, error: NO_STORE };
  const v = parseLabelPaper(paper);
  await setSetting(LABEL_PAPER_KEY, v);
  revalidatePath("/print/storage");
  return { ok: true, paper: v };
}

/** 스티커 크기 — 매장 라벨프린터에 맞춰 한 번 */
export async function setLabelSize(raw: string): Promise<Result<{ size: string }>> {
  if (!(await hasStoragePerm("use"))) return { ok: false, error: NO_STORE };
  const size = formatLabelSize(parseLabelSize(raw));
  await setSetting(LABEL_SIZE_KEY, size);
  revalidatePath("/print/storage");
  return { ok: true, size };
}

/**
 * 실사 「있음」 — 확인대기 후보에 번호를 주고 보관중으로. 맡긴 날은 원래 판매일 그대로.
 */
export async function confirmCandidate(id: number, drop: StorageDropInput): Promise<Result<{ no: number }>> {
  if (!(await hasStoragePerm("use"))) return { ok: false, error: NO_STORE };
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
  if (!(await hasStoragePerm("use"))) return { ok: false, error: NO_STORE };
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
  // 실사 전 후보도 보인다(주황) — 실사가 끝나기 전에 손님이 오셔도 찾아감을 적을 수 있게 (2026-11-18)
  return storageForVehicle(vehicleId, customerId, false, true);
}

/** 정비 내역 카드 — 이 판매에 걸린 보관 (펼칠 때 부른다) */
export async function saleStorage(quoteId: number): Promise<{ stored: StorageRow[]; released: StorageRow[] }> {
  if (!(await hasPerm("sale"))) return { stored: [], released: [] };
  return storageForSale(quoteId);
}

/**
 * ⭐ 이미 저장한 판매에 보관 붙이기 (사장님 지시 2026-11-17 — 예약 「시공 완료」 · 판매 때 깜빡한 경우)
 *
 *   판매 저장 때와 **같은 정본**(applySaleStorage)으로, 그 판매에 연결해서 적는다 — 판매를 취소하면
 *   지금처럼 같이 되돌아간다. 맡긴 날 = 시공한 날(예약이면 시공 완료일) → 없으면 작업일.
 *   예약중(아직 시공 전)·취소된 판매·차 없는 판매는 안 된다.
 */
export async function attachSaleStorage(quoteId: number, storage: SaleStorageInput): Promise<Result<{ stored: { id: number; no: number }[]; released: number }>> {
  if (!(await hasPerm("sale"))) return { ok: false, error: NO_SALE };
  if (!hasSaleStorage(storage)) return { ok: false, error: "맡긴 타이어를 적거나 찾아간 세트를 골라 주세요" };
  for (const d of storage.drops) {
    const bad = validateDrop(d);
    if (bad) return { ok: false, error: `맡긴 타이어: ${bad}` };
  }
  // 🔴 별칭은 AS 로 — 「day」·「at」 같은 낱말은 AS 없이 쓰면 문법 오류다 (2026-11-17 실측)
  const [q] = await db.execute<{ status: string; reservation_status: string | null; vehicle_id: number | null; owner_id: number | null; on_day: string }>(sql`
    SELECT q.status, q.reservation_status, q.vehicle_id, v.customer_id AS owner_id,
           to_char(COALESCE(q.fulfilled_on, q.work_date), 'YYYY-MM-DD') AS on_day
    FROM quote q LEFT JOIN vehicle v ON v.id = q.vehicle_id
    WHERE q.id = ${quoteId}`);
  if (!q) return { ok: false, error: "판매 기록을 찾지 못했습니다" };
  if (q.status !== "성사") return { ok: false, error: "취소된 판매에는 보관을 붙일 수 없습니다" };
  if (q.reservation_status === "예약중") return { ok: false, error: "아직 시공 전인 예약입니다 — 「시공 완료」를 먼저 눌러 주세요" };
  if (q.vehicle_id == null || q.owner_id == null) return { ok: false, error: "차량이 없는 판매입니다 — 「손님·거래처 바꾸기」로 차를 먼저 붙여 주세요" };
  const s = await getSession();
  try {
    const r = await db.transaction((tx) =>
      applySaleStorage(tx, {
        quoteId,
        customerId: Number(q.owner_id),
        vehicleId: Number(q.vehicle_id),
        workDate: q.on_day,
        userId: s?.uid ?? null,
        storage,
      }),
    );
    touch(Number(q.vehicle_id));
    revalidatePath("/sales");
    return { ok: true, stored: r.stored, released: r.released.length };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/**
 * ⭐ 다른 차·주인으로 옮기기 (사장님 지시 2026-11-17 — 「84고0717보관 이 차량번호로 바꿔 적어서 붙이기」 같은 메모)
 *   주인은 그 차의 주인(거래처 차량이면 차고 손님). 실사 후보(확인대기)는 판매 권한, 보관중은 판매 수정 권한.
 *   흔적은 원문(source_text)에 남긴다.
 */
export async function moveStorage(id: number, vehicleId: number): Promise<Result<{ plate: string }>> {
  const [t] = await db.execute<{ status: string; vehicle_id: number | null; plate: string | null }>(sql`
    SELECT t.status, t.vehicle_id, v.plate_no AS plate FROM tire_storage t LEFT JOIN vehicle v ON v.id = t.vehicle_id WHERE t.id = ${id}`);
  if (!t) return { ok: false, error: "보관 세트를 찾지 못했습니다" };
  if (!(await hasStoragePerm(t.status === "확인대기" ? "use" : "edit"))) return { ok: false, error: NO_STORE };
  if (t.status !== "확인대기" && t.status !== "보관중") return { ok: false, error: "보관 중이거나 실사 확인 전인 세트만 옮길 수 있습니다" };
  if (Number(t.vehicle_id) === vehicleId) return { ok: false, error: "이미 그 차의 세트입니다" };
  const [v] = await db.execute<{ customer_id: number; plate: string }>(sql`
    SELECT customer_id, plate_no AS plate FROM vehicle WHERE id = ${vehicleId} AND is_active`);
  if (!v) return { ok: false, error: "차량을 찾지 못했습니다" };
  const problem = await storageOwnerProblem(db, Number(v.customer_id));
  if (problem) return { ok: false, error: problem };
  const stamp = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(5).replace("-", "/");
  const trace = `${stamp} 차 바꿈 ${t.plate ?? "차량 없음"} → ${v.plate}`;
  // 옮기면 옛 판매와 끊는다(origin 판매 → 등록) — 그 판매를 취소해도 옮긴 세트는 그대로 (검토 갈래 발견 2026-11-18)
  const moved = await db.execute(sql`
    UPDATE tire_storage SET vehicle_id = ${vehicleId}, customer_id = ${v.customer_id},
           origin = CASE WHEN origin = '판매' THEN '등록' ELSE origin END,
           source_text = left(COALESCE(source_text || ' · ', '') || ${trace}, 900), updated_at = now()
    WHERE id = ${id} AND status IN ('확인대기','보관중') RETURNING id`);
  if (!moved.length) return { ok: false, error: "그 사이 상태가 바뀌었습니다 — 새로 고침해 보세요" };
  touch(vehicleId);
  if (t.vehicle_id) revalidatePath(`/vehicle/${t.vehicle_id}`);
  return { ok: true, plate: v.plate };
}

/**
 * ⭐ 보관번호 바꾸기 — 이미 다른 번호를 적어 붙인 세트에 맞출 때. 비어 있는 번호로만(다른 세트가 쓴 번호는
 *   찾아갔어도 다시 안 쓴다 — 재사용 금지 D-42). 판매 수정 권한.
 */
export async function renumberStorage(id: number, newNo: number): Promise<Result<{ no: number }>> {
  if (!(await hasStoragePerm("edit"))) return { ok: false, error: NO_STORE };
  if (!Number.isInteger(newNo) || newNo < 1 || newNo > 99999) return { ok: false, error: "번호는 1~99999 사이 숫자로 적어 주세요" };
  try {
    const no = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tire_storage_no'))`);
      const [t] = await tx.execute<{ status: string; storage_no: number | null }>(sql`SELECT status, storage_no FROM tire_storage WHERE id = ${id} FOR UPDATE`);
      if (!t || t.status !== "보관중") throw new Error("보관 중인 세트만 번호를 바꿀 수 있습니다");
      if (Number(t.storage_no) === newNo) throw new Error("지금 번호와 같습니다");
      const [used] = await tx.execute<{ status: string }>(sql`SELECT status FROM tire_storage WHERE storage_no = ${newNo}`);
      if (used) throw new Error(`#${String(newNo).padStart(4, "0")} 는 이미 쓴 번호입니다(${used.status}) — 비어 있는 번호로 해 주세요`);
      // 지금 가장 큰 번호보다 큰 번호로는 못 간다 — 잘못 치면(1200) 다음 새 번호가 1201부터 시작해 버린다
      const [mx] = await tx.execute<{ m: number }>(sql`SELECT COALESCE(MAX(storage_no), 0)::int AS m FROM tire_storage`);
      if (newNo > Number(mx.m)) throw new Error(`#${String(Number(mx.m)).padStart(4, "0")} 보다 큰 번호로는 바꿀 수 없습니다 — 새 번호는 저절로 매겨집니다`);
      const stamp = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(5).replace("-", "/");
      await tx.execute(sql`
        UPDATE tire_storage SET storage_no = ${newNo},
               source_text = left(COALESCE(source_text || ' · ', '') || ${`${stamp} 번호 바꿈 #${String(t.storage_no).padStart(4, "0")} → #${String(newNo).padStart(4, "0")}`}, 900),
               updated_at = now()
        WHERE id = ${id}`);
      return newNo;
    });
    revalidatePath("/storage");
    return { ok: true, no };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}
