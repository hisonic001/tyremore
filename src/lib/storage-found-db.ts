/**
 * ⭐ 보관 위치 넣기·처음 보는 세트 등록 — 트랜잭션 안에서 부르는 서버 코드 (2026-11-18)
 *
 *   🔴 "use server" 아님 — 화면이 직접 부르는 공개 액션이 아니라 storage-area.ts 액션과
 *      시험 스크립트(scripts/test-found-set.ts, 끝에 되돌림)가 같이 부르는 정본이다.
 */
import { sql } from "drizzle-orm";
import { sanitizePlan, type Plan } from "./storage-plan-pure";
import { insertStoredSet, storageOwnerProblem, type Tx } from "./tire-storage-db";
import type { StorageDropInput } from "./tire-storage-pure";
import { isPlaceholderCustomerName, isPlaceholderPhone, normalizeName, normalizePlate } from "./normalize";
import { ensureGarageCustomer } from "./garage";
import { ymdKst } from "./tire-age";

export interface Loc {
  areaId: number;
  slotId: string;
  /** 더미 번호 또는 「새 더미」 */
  stack: number | "new";
}

/**
 * 자리 확인 + 더미 번호 정하기 (트랜잭션 안).
 *   구역 줄을 FOR SHARE 로 잡아 도면 저장(FOR UPDATE)과 줄 세운다 — 저장 중에 지워진 자리에 넣지 않게.
 *   「새 더미」는 자리별 잠금 아래 MAX+1 — 두 사람이 동시에 눌러도 같은 번호가 안 나온다.
 */
export async function resolveLoc(tx: Tx, loc: Loc, selfId?: number): Promise<number> {
  const [a] = await tx.execute<{ plan: unknown }>(sql`SELECT plan FROM storage_area WHERE id = ${loc.areaId} AND is_active AND NOT is_site FOR SHARE`);
  if (!a) throw new Error("구역을 찾지 못했습니다 — 새로 고침해 보세요");
  const plan = sanitizePlan(a.plan) as Plan | null;
  if (!plan?.shapes.some((s) => s.id === loc.slotId && s.kind === "block")) throw new Error("그 자리가 도면에서 지워졌습니다 — 새로 고침해 보세요");
  if (loc.stack !== "new") {
    if (!Number.isInteger(loc.stack) || loc.stack < 1 || loc.stack > 99) throw new Error("더미 번호가 이상합니다");
    return loc.stack;
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`slot:${loc.areaId}:${loc.slotId}`}))`);
  const [m] = await tx.execute<{ m: number }>(sql`
    SELECT COALESCE(MAX(stack_no), 0)::int AS m FROM tire_storage
    WHERE area_id = ${loc.areaId} AND slot_id = ${loc.slotId} AND status IN ('보관중','확인대기') AND id <> ${selfId ?? 0}`);
  const n = Number(m.m) + 1;
  if (n > 99) throw new Error("한 자리에 더미가 너무 많습니다 — 자리를 나눠 주세요");
  return n;
}

/** 누구의 타이어인가 — 이미 있는 차 / 새 손님 / 거래처(차고) */
export type FoundOwner =
  | { kind: "차량"; vehicleId: number }
  | { kind: "손님"; name: string; phone?: string }
  | { kind: "거래처"; supplier: string };

export interface FoundSetInput {
  plate: string;
  owner: FoundOwner;
  drop: StorageDropInput;
  /** null = 맡긴 날 모름 → 등록한 날로 넣고 원문에 적는다 */
  storedOn: string | null;
  /** 창고 실사 화면이면 지금 위치, 맡김 등록 화면이면 null */
  loc: Loc | null;
}

/**
 * ⭐ 처음 보는 세트 등록 (사장님 2026-11-18 —
 *    「오늘 맡긴 것도 아니고 실사 중에 나오는데 등록된 손님·차·거래처가 없음.
 *      맡김 등록하면서 그걸 할 수 있게 넘어가서 빠르게 실사·등록이 되어야」)
 *
 *   한 트랜잭션: (없으면) 손님/거래처 차고 + 차량 만들기 → 보관중 + 번호 → (실사 화면이면) 지금 더미에 놓기.
 *   전엔 「판매 등록에서 손님·차량을 먼저」라는 안내에서 막혀 실사가 끊겼다.
 *
 *   🔴 손님 만들기 규칙은 판매 쪽(createCustomerAndVehicle)과 같다 — 같은 번호판이면 그 차를 쓰고(중복 차 금지),
 *      전화가 같고 이름도 같을 때만 그 손님에 붙인다(더미 전화 제외 — 손님 섞임 사고, 2026-09-09).
 *      자리표시 이름(「고객」 등)은 보관 불가(D-42). MARS 필수 항목(주소·동의)은 안 받는다 — 다시 오시면 판매 때 채운다.
 *   🔴 잠금 순서는 placeHere 와 같다: 구역(FOR SHARE)·자리 → 번호.
 */
export async function registerFoundSetTx(
  tx: Tx,
  input: FoundSetInput,
  userId: number | null,
): Promise<{ id: number; no: number; stackNo: number | null; vehicleId: number; plate: string; owner: string; reused: boolean }> {
  const today = ymdKst(new Date());
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(input.storedOn ?? "") && input.storedOn! <= today;
  const storedOn = dated ? input.storedOn! : today;
  const sourceText = dated ? null : `맡긴 날 모름 — ${input.loc ? "창고 실사 중 발견" : "맡김 등록"}(${today}), 맡긴 날 칸은 등록한 날`;

  let vehicleId: number;
  let customerId: number;
  let plate: string;
  let ownerName: string;
  let reused = false;

  if (input.owner.kind === "차량") {
    const [v] = await tx.execute<{ id: number; customer_id: number; plate_no: string; name: string }>(sql`
      SELECT v.id, v.customer_id, v.plate_no, c.name FROM vehicle v JOIN customer c ON c.id = v.customer_id
      WHERE v.id = ${input.owner.vehicleId} AND v.is_active`);
    if (!v) throw new Error("차량을 찾지 못했습니다 — 새로 고침해 보세요");
    [vehicleId, customerId, plate, ownerName, reused] = [Number(v.id), Number(v.customer_id), v.plate_no, v.name, true];
  } else {
    plate = input.plate.trim();
    if (!plate) throw new Error("타이어에 적힌 차량번호를 넣어 주세요");
    const plateNorm = normalizePlate(plate);
    // 같은 번호판이 이미 있으면 그 차 — 중복 차량을 만들지 않는다 (판매 쪽과 같은 규칙)
    const [dup] = await tx.execute<{ id: number; customer_id: number; plate_no: string; name: string }>(sql`
      SELECT v.id, v.customer_id, v.plate_no, c.name FROM vehicle v JOIN customer c ON c.id = v.customer_id
      WHERE v.plate_no_norm = ${plateNorm} ORDER BY v.is_active DESC, v.id LIMIT 1`);
    if (dup) {
      [vehicleId, customerId, plate, ownerName, reused] = [Number(dup.id), Number(dup.customer_id), dup.plate_no, dup.name, true];
    } else {
      if (input.owner.kind === "손님") {
        const name = input.owner.name.trim();
        if (!name) throw new Error("손님 이름을 넣어 주세요 — 모르면 거래처 차인지 확인해 주세요");
        if (isPlaceholderCustomerName(name)) throw new Error(`「${name}」은 자리표시 이름이라 보관을 붙일 수 없습니다 — 실제 이름을 넣어 주세요`);
        const phone = (input.owner.phone ?? "").replace(/\D/g, "");
        let cid: number | null = null;
        if (phone.length >= 9 && !isPlaceholderPhone(phone)) {
          const [c] = await tx.execute<{ id: number; name: string }>(sql`
            SELECT id, name FROM customer WHERE replace(replace(phone,'-',''),' ','') = ${phone} AND is_active ORDER BY id LIMIT 1`);
          if (c && normalizeName(name) === normalizeName(c.name)) cid = Number(c.id);
        }
        if (cid == null) {
          const [c] = await tx.execute<{ id: number }>(sql`
            INSERT INTO customer (name, name_search, phone, type, memo)
            VALUES (${name}, ${name.replace(/\s/g, "").toLowerCase()}, ${input.owner.phone?.trim() || null}, '개인',
                    ${`보관 타이어로 등록(${today}) — 주소·동의 아직 없음, 다시 오시면 판매 때 채우기`})
            RETURNING id`);
          cid = Number(c.id);
        }
        customerId = cid;
        ownerName = name;
      } else {
        const [s] = await tx.execute<{ name: string }>(sql`
          SELECT name FROM supplier WHERE name = ${input.owner.supplier.trim()} AND is_active LIMIT 1`);
        if (!s) throw new Error("거래처를 목록에서 골라 주세요");
        customerId = await ensureGarageCustomer(s.name, tx);
        ownerName = s.name;
      }
      const [v] = await tx.execute<{ id: number }>(sql`
        INSERT INTO vehicle (customer_id, plate_no, plate_no_norm) VALUES (${customerId}, ${plate}, ${plateNorm}) RETURNING id`);
      vehicleId = Number(v.id);
    }
  }

  const problem = await storageOwnerProblem(tx, customerId);
  if (problem) throw new Error(problem);
  const stackNo = input.loc ? await resolveLoc(tx, input.loc) : null;
  const r = await insertStoredSet(tx, {
    customerId,
    vehicleId,
    drop: input.drop,
    storedOn,
    userId,
    origin: input.loc ? "실사" : "등록",
    sourceText,
  });
  if (input.loc) {
    await tx.execute(sql`
      UPDATE tire_storage SET area_id = ${input.loc.areaId}, slot_id = ${input.loc.slotId}, stack_no = ${stackNo},
             located_at = now(), located_by = ${userId}, updated_at = now()
      WHERE id = ${r.id}`);
  }
  return { id: r.id, no: r.no, stackNo, vehicleId, plate, owner: ownerName, reused };
}
