/**
 * ⭐ 타이어 보관 — 쓰기 정본 (D-42, 2026-11-17)
 *
 *   번호 매기기·넣기·판매와 함께 맡김/찾아감·판매 취소 되돌리기.
 *   🔴 "use server" 아님 — 권한 검사는 부르는 쪽(tire-storage.ts 액션 · sale.ts · sale-edit.ts)이 한다.
 *      여기서 내보내면 화면이 권한 없이 부를 수 있는 액션이 된다 (D-41 「정본 코어」 원칙).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isPlaceholderCustomerName } from "./normalize";
import { cleanDrop, validateDrop, type SaleStorageInput, type StorageDropInput } from "./tire-storage-pure";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 다음 보관번호 — MAX+1 을 **트랜잭션 잠금** 아래에서.
 *   시퀀스를 안 쓰는 까닭: ① restore-db.ts 는 id 시퀀스만 맞춘다 — 복원 뒤 번호가 겹친다
 *   ② 저장이 실패하면 시퀀스는 번호를 건너뛴다 — 창고에선 「빠진 세트」로 보인다.
 *   🔴 반드시 트랜잭션 안에서 부른다(잠금이 트랜잭션 끝까지 간다). 유일 제약이 마지막 그물.
 */
export async function nextStorageNo(tx: Tx): Promise<number> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tire_storage_no'))`);
  const [r] = await tx.execute<{ n: number }>(sql`SELECT (COALESCE(MAX(storage_no), 0) + 1)::int n FROM tire_storage`);
  return Number(r.n);
}

/** 맡길 수 있는 손님인가 — 자리표시 손님(고객·관광객, D-27)에 붙이면 남의 세트와 섞인다 */
export async function storageOwnerProblem(tx: Tx | typeof db, customerId: number): Promise<string | null> {
  const [c] = await tx.execute<{ name: string; is_active: boolean }>(
    sql`SELECT name, is_active FROM customer WHERE id = ${customerId}`,
  );
  if (!c) return "손님을 찾지 못했습니다";
  if (isPlaceholderCustomerName(c.name))
    return `「${c.name}」은 자리표시 손님이라 보관을 붙일 수 없습니다 — 손님 이름·전화를 먼저 등록해 주세요`;
  return null;
}

/** 보관중 한 세트 넣기 (번호 부여). 트랜잭션 안에서 */
export async function insertStoredSet(
  tx: Tx,
  o: {
    customerId: number;
    vehicleId: number | null;
    drop: StorageDropInput;
    storedOn: string;
    storedQuoteId?: number | null;
    userId: number | null;
  },
): Promise<{ id: number; no: number }> {
  const bad = validateDrop(o.drop);
  if (bad) throw new Error(bad);
  const d = cleanDrop(o.drop);
  const no = await nextStorageNo(tx);
  const [r] = await tx.execute<{ id: number }>(sql`
    INSERT INTO tire_storage (storage_no, status, customer_id, vehicle_id, kind, brand, size, qty, dot, memo,
                              stored_on, stored_quote_id, created_by)
    VALUES (${no}, '보관중', ${o.customerId}, ${o.vehicleId}, ${d.kind}, ${d.brand}, ${d.size}, ${d.qty}, ${d.dot}, ${d.memo},
            ${o.storedOn}::date, ${o.storedQuoteId ?? null}, ${o.userId})
    RETURNING id
  `);
  return { id: Number(r.id), no };
}

/* ------------------------------------------------------------------
 * 판매와 함께 (3단계) — sale.ts saveSale 트랜잭션 안에서 부른다
 * ---------------------------------------------------------------- */

export type { SaleStorageInput };

export function hasSaleStorage(s: SaleStorageInput | null | undefined): s is SaleStorageInput {
  return !!s && (s.drops.length > 0 || s.pickupIds.length > 0);
}

/**
 * 판매 저장과 **같은 트랜잭션**에서 맡김·찾아감을 적는다. 문제가 있으면 throw — 판매 전체가 되돌아간다
 * (세트만 빠지고 판매만 남으면 창고와 앱이 어긋난다).
 */
export async function applySaleStorage(
  tx: Tx,
  o: { quoteId: number; customerId: number; vehicleId: number | null; workDate: string; userId: number | null; storage: SaleStorageInput },
): Promise<{ stored: { id: number; no: number }[]; released: number[] }> {
  const stored: { id: number; no: number }[] = [];
  const released: number[] = [];

  for (const id of [...new Set(o.storage.pickupIds)]) {
    const [s] = await tx.execute<{ id: number; status: string; customer_id: number; vehicle_id: number | null; storage_no: number }>(sql`
      SELECT id, status, customer_id, vehicle_id, storage_no FROM tire_storage WHERE id = ${id} FOR UPDATE`);
    if (!s) throw new Error("찾아갈 보관 세트를 찾지 못했습니다 — 새로 고침 후 다시 해 주세요");
    if (s.status !== "보관중") throw new Error(`보관 #${String(s.storage_no).padStart(4, "0")} 는 이미 「${s.status}」입니다`);
    const sameOwner = Number(s.customer_id) === o.customerId || (o.vehicleId != null && Number(s.vehicle_id) === o.vehicleId);
    if (!sameOwner) throw new Error(`보관 #${String(s.storage_no).padStart(4, "0")} 는 다른 손님의 세트입니다`);
    await tx.execute(sql`
      UPDATE tire_storage SET status = '찾아감', released_on = ${o.workDate}::date, released_quote_id = ${o.quoteId},
             released_by = ${o.userId}, updated_at = now()
      WHERE id = ${id}`);
    released.push(id);
  }

  if (o.storage.drops.length > 0) {
    const problem = await storageOwnerProblem(tx, o.customerId);
    if (problem) throw new Error(problem);
    for (const d of o.storage.drops) {
      stored.push(
        await insertStoredSet(tx, {
          customerId: o.customerId,
          vehicleId: o.vehicleId,
          drop: d,
          storedOn: o.workDate,
          storedQuoteId: o.quoteId,
          userId: o.userId,
        }),
      );
    }
  }
  return { stored, released };
}

/**
 * 판매 취소 — 이 판매로 맡긴 세트는 「제외」(번호는 은퇴, 스티커는 떼야 한다),
 * 이 판매로 찾아간 세트는 다시 「보관중」. 그 사이 다른 판매가 찾아갔으면 손대지 않고 알린다.
 * 돌려준 문장은 화면에 그대로 보인다(없으면 null).
 */
export async function revertSaleStorage(tx: Tx, quoteId: number, quoteNo: string, userId: number | null): Promise<string | null> {
  const notes: string[] = [];
  const dropped = await tx.execute<{ id: number; storage_no: number | null; status: string }>(sql`
    SELECT id, storage_no, status FROM tire_storage WHERE stored_quote_id = ${quoteId} FOR UPDATE`);
  const retired: string[] = [];
  for (const s of dropped) {
    const no = String(s.storage_no ?? 0).padStart(4, "0");
    if (s.status === "보관중") {
      await tx.execute(sql`
        UPDATE tire_storage SET status = '제외', released_on = (now() AT TIME ZONE 'Asia/Seoul')::date,
               release_note = ${`${quoteNo} 판매 취소`}, released_by = ${userId}, updated_at = now()
        WHERE id = ${s.id}`);
      retired.push(`#${no}`);
    } else if (s.status !== "제외") {
      notes.push(`보관 #${no} 는 이미 「${s.status}」이라 그대로 뒀습니다`);
    }
  }
  if (retired.length) notes.unshift(`보관 ${retired.join(", ")} 등록을 지웠습니다 — 타이어의 스티커를 떼 주세요`);

  const back = await tx.execute<{ storage_no: number }>(sql`
    UPDATE tire_storage SET status = '보관중', released_on = NULL, released_quote_id = NULL, released_by = NULL, updated_at = now()
    WHERE released_quote_id = ${quoteId} AND status = '찾아감'
    RETURNING storage_no`);
  if (back.length) notes.push(`찾아간 것으로 했던 보관 ${back.map((b) => `#${String(b.storage_no).padStart(4, "0")}`).join(", ")} 를 다시 보관 중으로 돌렸습니다`);
  return notes.length ? notes.join(" · ") : null;
}
