"use server";

/**
 * ⭐ 예약금·잔금 — 「일부만 받고 나머지는 나중에」의 정본 (사장님 결정 2026-09-10)
 *
 *   사장님: "그때그때 다름. 안 받고 진행도 하고 받기도 하고 결제 방식, 금액은 정해진 것이 없음."
 *
 *   저장 모양은 **기존 규약 그대로**다 — 덜 받은 판매 = `payment_method='외상'` + `receivable_payment`
 *   (21개 파일 40곳이 이 규약을 본다. 새 칸을 만들지 않는다). 이 파일은 그 규약 위에서
 *   예약이 빠뜨리고 있던 두 조각을 맡는다:
 *
 *   ① `restateReservationPaid` — **이미 저장된 예약**을 「외상 + 실제 받은 몫」으로 고친다.
 *      실측(09-10): 예약중 8건 전부 「전액 받음」으로 저장돼 있었다. 등록 화면에서 예약 체크 후
 *      카드만 누르고 금액을 비우면 전액 카드로 저장됐기 때문 (권미선 Q26-0910-002 — 20만원
 *      예약금이 메모 글자로만 남았다). 정비 내역 카드 펼침에는 「받은 금액」을 적을 곳이 없었다.
 *
 *   ② `normalizeSettledReservation` — **잔금까지 다 받으면 「보통 판매」로 되돌린다**.
 *      외상 딱지가 남으면 MARS 가 막고(mars-queue), 안내대로 결제를 카드로 바꾸면
 *      receivable_payment 는 그대로 남는데 카드 일마감(pos-close)은 외상 건의 수금만 세므로
 *      **먼저 받은 예약금이 일마감에서 사라졌다.** 수금 줄들을 quote_payment(받은 날 보존 —
 *      이 칸이 2026-09-01 에 정확히 이 용도로 생겼다)로 옮기고 '혼합'으로 두면 일마감·MARS 가
 *      예외 없이 맞물린다. 사장님 승인: "네, 자동으로".
 *
 * 🔴 「개인계좌」 수금이 섞였으면 못 옮긴다 (quote_payment CHECK 에 없음) — 외상으로 두고
 *    화면이 알린다. 본사청구(claim_party)는 이 파일의 대상이 아니다 — 돈은 본사가 준다.
 */
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { hasPerm } from "./auth";
import { COLLECT_METHODS, SPLITTABLE } from "./payments";
import { PERM_DENIED } from "./perm-keys";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Runner = Tx | typeof db;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function refresh() {
  for (const p of ["/sales", "/", "/receivables", "/finance", "/finance/card"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

export interface PaidPart {
  method: string;
  amount: number;
  /** YYYY-MM-DD — 비면 오늘 */
  paidOn?: string | null;
}

/**
 * 이미 저장된 예약을 「외상 + 실제 받은 몫」으로 고친다.
 *   parts 가 비면 = 아직 한 푼도 안 받음 (전액 잔금).
 *   parts 합 = 총액이면 곧바로 보통 판매로 정리된다(normalize).
 * 기존 분할(quote_payment)·수금(receivable_payment) 줄은 **전부 갈아 끼운다** — 「고치기」니까.
 */
export async function restateReservationPaid(input: {
  quoteId: number;
  parts: PaidPart[];
}): Promise<{ ok: true; remain: number; converted: boolean } | { ok: false; error: string }> {
  if (!(await hasPerm("receivable_view"))) return { ok: false, error: PERM_DENIED };
  const parts = (input.parts ?? [])
    .map((p) => ({ method: p.method, amount: Math.round(Number(p.amount)), paidOn: p.paidOn?.trim() || null }))
    .filter((p) => Number.isFinite(p.amount) && p.amount > 0)
    .slice(0, 5);
  for (const p of parts) {
    if (!COLLECT_METHODS.includes(p.method)) return { ok: false, error: `수단이 올바르지 않습니다 — ${p.method}` };
    if (p.paidOn && !DATE_RE.test(p.paidOn)) return { ok: false, error: "받은 날은 2026-09-10 형식입니다" };
  }
  const paidSum = parts.reduce((s, p) => s + p.amount, 0);

  try {
    const r = await db.transaction(async (tx) => {
      const [q] = await tx.execute<{
        id: number; status: string; total: number; reservation_status: string | null; claim_party: string | null;
      }>(sql`
        SELECT id, status, total_amount total, reservation_status, claim_party
        FROM quote WHERE id = ${input.quoteId} FOR UPDATE
      `);
      if (!q) throw new Error("판매 기록을 찾을 수 없습니다");
      if (q.status === "취소") throw new Error("취소된 판매입니다");
      if (!q.reservation_status) throw new Error("예약 건이 아닙니다 — 일반 판매의 결제는 「날짜·결제 고치기」로");
      if (q.claim_party) throw new Error("본사청구 건은 여기서 고치지 않습니다");
      const total = Number(q.total);
      if (paidSum > total) {
        throw new Error(`받은 금액(${paidSum.toLocaleString()}원)이 판매 합계(${total.toLocaleString()}원)보다 큽니다`);
      }

      await tx.execute(sql`DELETE FROM quote_payment WHERE quote_id = ${q.id}`);
      await tx.execute(sql`DELETE FROM receivable_payment WHERE quote_id = ${q.id}`);
      await tx.execute(sql`
        UPDATE quote SET payment_method = '외상', updated_at = now() WHERE id = ${q.id}
      `);
      for (const p of parts) {
        await tx.execute(sql`
          INSERT INTO receivable_payment (quote_id, amount, method, paid_on, memo)
          VALUES (${q.id}, ${p.amount}, ${p.method},
                  ${p.paidOn ?? sql`(now() AT TIME ZONE 'Asia/Seoul')::date`},
                  ${"예약금 — 받은 돈 고치기로 기록"})
        `);
      }
      const n = await normalizeSettledReservation(q.id, tx);
      return { remain: total - paidSum, converted: n.converted };
    });
    refresh();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "받은 돈을 고치지 못했습니다" };
  }
}

/**
 * 잔금까지 다 받은 예약을 「보통 판매」로 되돌린다 — 수금(receivable_payment) → 분할(quote_payment),
 * payment_method '외상' → '혼합'. 조건이 안 맞으면 아무것도 안 한다(멱등).
 *
 *   · 대상: reservation_status 가 있고, claim_party 없고, 외상이고, 수금 합 = 총액
 *   · 수단이 전부 SPLITTABLE(카드·현금·계좌이체·지역화폐·간편결제)이어야 옮길 수 있다 —
 *     「개인계좌」가 섞이면 외상으로 남긴다 (personal: true 로 알린다)
 *   · 줄이 하나여도 '혼합' + quote_payment 1줄로 둔다 — 받은 날(paid_on)을 잃지 않으려고.
 *     카드 일마감은 혼합이면 quote_payment 줄로 대사한다 (pos-close.ts).
 *
 * 부르는 곳: addCollection · settleReceivables (수금 뒤) · restateReservationPaid (고치기 뒤)
 */
export async function normalizeSettledReservation(
  quoteId: number,
  runner: Runner = db,
): Promise<{ converted: boolean; personal: boolean }> {
  const [q] = await runner.execute<{
    id: number; payment_method: string | null; total: number; reservation_status: string | null; claim_party: string | null;
  }>(sql`
    SELECT id, payment_method, total_amount total, reservation_status, claim_party
    FROM quote WHERE id = ${quoteId} AND status = '성사'
  `);
  if (!q || q.payment_method !== "외상" || !q.reservation_status || q.claim_party) {
    return { converted: false, personal: false };
  }
  const rows = await runner.execute<{ amount: number; method: string; paid_on: string }>(sql`
    SELECT amount, method, to_char(paid_on, 'YYYY-MM-DD') paid_on
    FROM receivable_payment WHERE quote_id = ${q.id} ORDER BY paid_on, id
  `);
  const paid = rows.reduce((s, r) => s + Number(r.amount), 0);
  if (rows.length === 0 || paid !== Number(q.total)) return { converted: false, personal: false };
  if (!rows.every((r) => (SPLITTABLE as readonly string[]).includes(r.method))) {
    return { converted: false, personal: true };
  }
  for (const r of rows) {
    await runner.execute(sql`
      INSERT INTO quote_payment (quote_id, method, amount, paid_on)
      VALUES (${q.id}, ${r.method}, ${Number(r.amount)}, ${r.paid_on}::date)
    `);
  }
  await runner.execute(sql`DELETE FROM receivable_payment WHERE quote_id = ${q.id}`);
  await runner.execute(sql`
    UPDATE quote SET payment_method = '혼합', updated_at = now() WHERE id = ${q.id}
  `);
  return { converted: true, personal: false };
}
