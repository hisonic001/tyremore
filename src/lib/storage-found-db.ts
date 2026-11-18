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
  /** 차종 (선택 — 「쏘렌토」) — 새 차면 그대로, 이미 있는 차면 비어 있을 때만 채운다 (사장님 2026-11-18) */
  model?: string;
  owner: FoundOwner;
  drop: StorageDropInput;
  /** null = 맡긴 날 모름 → 등록한 날로 넣고 원문에 적는다 */
  storedOn: string | null;
  /** 「10월쯤」처럼 달만 고른 것 — 날짜 칸은 그 달 15일, 원문에 「대략」 (2026-11-18) */
  storedApprox?: boolean;
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
  const model = (input.model ?? "").trim().slice(0, 40) || null;
  const sourceText = dated && input.storedApprox ? `맡긴 날 대략 ${storedOn.slice(0, 7)}쯤 — 날짜 칸은 그 달 가운데` : dated ? null : `맡긴 날 모름 — ${input.loc ? "창고 실사 중 발견" : "맡김 등록"}(${today}), 맡긴 날 칸은 등록한 날`;

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
        /* ⭐ 이름 몰라도 된다 (사장님 2026-11-18 「실사 중 손님 이름이 없는 것도 있음 — 옵션화」).
           비면 「이름 모름 12가3456」 — **그 차 전용 이름**. 🔴 공용 자리표시(「고객」 등)에 묶지 않는다:
           여러 손님 차가 한 손님 줄에 붙으면 한쪽을 고칠 때 전부 바뀐다(D-27 사고). 오시면 손님 화면에서 이름을 고친다. */
        const unnamed = !input.owner.name.trim();
        const name = unnamed ? `이름 모름 ${plate}` : input.owner.name.trim();
        if (isPlaceholderCustomerName(name)) throw new Error(`「${name}」은 자리표시 이름이라 보관을 붙일 수 없습니다 — 실제 이름을 넣어 주세요`);
        const phone = (input.owner.phone ?? "").replace(/\D/g, "");
        let cid: number | null = null;
        if (!unnamed && phone.length >= 9 && !isPlaceholderPhone(phone)) {
          const [c] = await tx.execute<{ id: number; name: string }>(sql`
            SELECT id, name FROM customer WHERE replace(replace(phone,'-',''),' ','') = ${phone} AND is_active ORDER BY id LIMIT 1`);
          if (c && normalizeName(name) === normalizeName(c.name)) cid = Number(c.id);
        }
        if (cid == null) {
          const [c] = await tx.execute<{ id: number }>(sql`
            INSERT INTO customer (name, name_search, phone, type, memo)
            VALUES (${name}, ${name.replace(/\s/g, "").toLowerCase()}, ${input.owner.phone?.trim() || null}, '개인',
                    ${unnamed
                      ? `보관 타이어 실사 때 이름 몰라 차번호로 임시 이름(${today}) — 오시면 이름·주소·동의 채우기`
                      : `보관 타이어로 등록(${today}) — 주소·동의 아직 없음, 다시 오시면 판매 때 채우기`})
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
        INSERT INTO vehicle (customer_id, plate_no, plate_no_norm, model) VALUES (${customerId}, ${plate}, ${plateNorm}, ${model}) RETURNING id`);
      vehicleId = Number(v.id);
    }
  }

  // 이미 있던 차인데 차종이 비어 있으면 적어 준 것으로 채운다 (있는 값은 안 덮는다)
  if (reused && model) {
    await tx.execute(sql`UPDATE vehicle SET model = ${model} WHERE id = ${vehicleId} AND (model IS NULL OR btrim(model) = '')`);
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

/** 더미 안 순서 다시 매기기 (트랜잭션 안) — 설명은 storage-area.ts reorderStack. 시험: scripts/test-found-set.ts */
export async function reorderStackTx(tx: Tx, input: { areaId: number; slotId: string; stackNo: number }, ids: number[]): Promise<void> {
  const rows = await tx.execute<{ id: number; ms: number | null }>(sql`
    SELECT id, (extract(epoch FROM located_at) * 1000)::float8 AS ms FROM tire_storage
    WHERE area_id = ${input.areaId} AND slot_id = ${input.slotId} AND stack_no = ${input.stackNo} AND status = '보관중'
    ORDER BY id FOR UPDATE`);
  const have = rows.map((r) => Number(r.id)).sort((a, b) => a - b);
  const want = [...ids].sort((a, b) => a - b);
  if (have.length !== want.length || have.some((v, i) => v !== want[i])) throw new Error("그 사이 더미가 바뀌었습니다 — 새로 고침 후 다시 해 주세요");
  const known = rows.map((r) => (r.ms == null ? null : Number(r.ms)));
  const base = Math.min(...known.filter((v): v is number => v != null), Date.now());
  let k = 0;
  const times = known.map((v) => v ?? base - (rows.length - k++) * 1000).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) if (times[i] <= times[i - 1]) times[i] = times[i - 1] + 1;
  for (const [i, id] of ids.entries()) {
    await tx.execute(sql`UPDATE tire_storage SET located_at = to_timestamp(${times[i] / 1000}), updated_at = now() WHERE id = ${id}`);
  }
}

/**
 * ⭐ 끌어다 놓기 한 번 (트랜잭션 안) — 같은 자리 안 다른 더미면 옮기고, 그 더미 순서를 화면이 준 대로(아래→위).
 *   잠금 순서는 placeHere 와 같다: 세트 줄 → 구역(resolveLoc FOR SHARE) → 그 더미 세트들.
 */
export async function dropSetTx(
  tx: Tx,
  input: { id: number; areaId: number; slotId: string; stackNo: number; bottomToTop: number[] },
  userId: number | null,
): Promise<void> {
  if (!input.bottomToTop.includes(input.id)) throw new Error("순서가 이상합니다 — 새로 고침해 보세요");
  const [t] = await tx.execute<{ status: string; area_id: number | null; slot_id: string | null; stack_no: number | null }>(sql`
    SELECT status, area_id, slot_id, stack_no FROM tire_storage WHERE id = ${input.id} FOR UPDATE`);
  if (!t || t.status !== "보관중") throw new Error("보관 중인 세트가 아닙니다 — 새로 고침해 보세요");
  const same = Number(t.area_id) === input.areaId && t.slot_id === input.slotId && Number(t.stack_no) === input.stackNo;
  if (!same) {
    const stackNo = await resolveLoc(tx, { areaId: input.areaId, slotId: input.slotId, stack: input.stackNo }, input.id);
    await tx.execute(sql`
      UPDATE tire_storage SET area_id = ${input.areaId}, slot_id = ${input.slotId}, stack_no = ${stackNo},
             located_at = now(), located_by = ${userId}, updated_at = now()
      WHERE id = ${input.id}`);
  }
  await reorderStackTx(tx, input, input.bottomToTop);
}

/* ------------------------------------------------------------------
 * 처음 보는 세트 등록 칸 돕기 (사장님 2026-11-18 — 「차량 정보가 있으면 사이즈는 바로」 「차종은 앞글자만 쓰면 자동완성」)
 * ---------------------------------------------------------------- */

// 숫자 칸이 「19.0」처럼 읽히므로 끝의 .0 은 뗀다(17.5 같은 건 그대로)
const SIZE_SQL = sql`(regexp_replace(p.width::text, '[.]0+$', '') || COALESCE('/' || regexp_replace(p.aspect_ratio::text, '[.]0+$', ''), '') || 'R' || regexp_replace(p.rim_inch::text, '[.]0+$', ''))`;

/**
 * 이 차에 끼운 타이어 규격 — 최근 것부터 (판매 기록 → 지난 보관 세트).
 *   🔴 vehicle.last_fitted_size 는 비어 있다(2026-11-18 실측 3,354대 전부) — 그래서 판매 품목에서 직접 읽는다.
 */
export async function tireSizesForVehicle(ex: Pick<Tx, "execute">, vehicleId: number): Promise<string[]> {
  const rows = await ex.execute<{ size: string }>(sql`
    SELECT size FROM (
      SELECT ${SIZE_SQL} AS size, max(COALESCE(q.work_date::timestamptz, q.created_at)) AS at
      FROM quote q JOIN quote_item i ON i.quote_id = q.id JOIN product p ON p.id = i.product_id
      WHERE q.vehicle_id = ${vehicleId} AND q.status = '성사' AND p.item_type = 'tire' AND p.width IS NOT NULL AND p.rim_inch IS NOT NULL
      GROUP BY 1
      UNION ALL
      SELECT btrim(size), max(created_at) FROM tire_storage WHERE vehicle_id = ${vehicleId} AND btrim(COALESCE(size, '')) <> '' GROUP BY 1
    ) x GROUP BY size ORDER BY max(at) DESC LIMIT 4`);
  return rows.map((r) => r.size);
}

/** 같은 차종 손님 차에 많이 끼운 규격 — 새 차일 때 「바로 고르기」 후보 */
export async function tireSizesForModel(ex: Pick<Tx, "execute">, model: string): Promise<string[]> {
  const key = model.replace(/\s/g, "").toLowerCase();
  if (key.length < 2) return [];
  const rows = await ex.execute<{ size: string }>(sql`
    SELECT ${SIZE_SQL} AS size, count(*) n
    FROM quote q JOIN vehicle v ON v.id = q.vehicle_id JOIN quote_item i ON i.quote_id = q.id JOIN product p ON p.id = i.product_id
    WHERE q.status = '성사' AND p.item_type = 'tire' AND p.width IS NOT NULL AND p.rim_inch IS NOT NULL
      AND replace(lower(COALESCE(v.model, '')), ' ', '') LIKE ${key + "%"}
    GROUP BY 1 ORDER BY n DESC LIMIT 4`);
  return rows.map((r) => r.size);
}

/**
 * 차종 자동완성 — 앞글자로. 차종 목록(vehicle_model) 먼저, 그다음 손님 차에 많이 적힌 이름.
 *   앞글자로 맞는 게 적으면 가운데 들어간 것도 뒤에 붙인다.
 */
export async function suggestModelNames(ex: Pick<Tx, "execute">, prefix: string): Promise<string[]> {
  const key = prefix.replace(/\s/g, "").toLowerCase();
  if (!key) return [];
  const rows = await ex.execute<{ name: string }>(sql`
    WITH c AS (
      SELECT btrim(name_ko) AS name, 100000 AS w FROM vehicle_model
      UNION ALL
      SELECT btrim(model), count(*)::int FROM vehicle WHERE btrim(COALESCE(model, '')) <> '' GROUP BY btrim(model)
    ), k AS (SELECT name, max(w) w, replace(lower(name), ' ', '') nk FROM c GROUP BY name)
    SELECT name FROM k
    WHERE nk LIKE ${key + "%"} OR nk LIKE ${"%" + key + "%"}
    ORDER BY (nk LIKE ${key + "%"}) DESC, w DESC, length(name) LIMIT 8`);
  return rows.map((r) => r.name);
}
