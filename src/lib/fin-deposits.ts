"use server";

/**
 * ⭐ 통장 입금 대조 — 쓰기 액션 (ERP 4단계, 2026-08-24)
 *
 *   ① 카드 정산 표시(적요 패턴 일괄) ② 계좌이체 판매와 잇기 ③ 외상 수금 등록.
 *   수금은 기존 정본 settleReceivables(선입선출·FOR UPDATE·잔액 방어)를 그대로 쓴다 —
 *   여기서 새 수금 로직을 만들지 않는다.
 *
 * 🔴 전부 사장님 전용. 질의 순차.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { payerKeyOf } from "./expense-cats";
import {
  DEPOSIT_KINDS,
  UNDO_DEPOSIT_KINDS,
  confirmSureDepositsCore,
  getDeposit,
  learnAlias,
  learnDepositRule,
  linkDepositToQuoteCore,
  linkDepositsToQuoteCore,
  markCardSettlementsCore,
} from "./deposit-core";
import { revalidateFinance } from "./fin-revalidate";
import { receivableKeyCond } from "./receivable-key";
import { planSettlement } from "./receivable-plan";
import { settleReceivables } from "./receivable";
import { restoreCashLine } from "./cash-restore";
import { logActivity } from "./fin-activity";
import { W } from "./fin-words";

const won = (n: number) => n.toLocaleString("ko-KR");

async function guard(): Promise<{ ok: true; uid: number | null } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const s = await getSession();
  return { ok: true, uid: s?.uid ?? null };
}

const payerOf = (description: string): string => payerKeyOf("통장", description); // 감사 L2: 정본

/** 이 달의 카드 정산 패턴 입금을 한꺼번에 「카드 정산」으로 — 규칙은 deposit-core */
export async function markCardSettlements(
  ym: string,
): Promise<{ ok: true; marked: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return { ok: false, error: "달이 올바르지 않습니다" };
  const marked = await markCardSettlementsCore(ym, g.uid); // 기록은 코어가 남긴다
  revalidateFinance();
  return { ok: true, marked };
}

/**
 * ⭐ 「☑ 다음부터 자동으로」 (개편 4단계, 2026-09-12 — 사장님 결정 7③, **기본 켜짐**)
 *
 *   맞추기 단추 옆 작은 체크칸이 이 `learn` 을 끈다 — 그러면 그 건만 맞추고
 *   입금자 별명(party_alias)은 안 배운다.
 * 🔴 **맨 끝 선택 인자**다. 이 인자를 안 주는 기존 호출(연간 실행기·되돌리기 라우팅 등)은
 *    전과 똑같이 배운다 — 시그니처를 바꾸면서 동작을 조용히 바꾸지 않는다.
 */
type LearnOpts = { learn?: boolean };

/** 입금 한 건 ↔ 판매 한 건 (부분 연결 가능) — 규칙은 deposit-core */
export async function linkDepositToQuote(
  cashTxnId: number,
  quoteId: number,
  opts?: LearnOpts,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const r = await linkDepositToQuoteCore(cashTxnId, quoteId, g.uid, "수동", { learn: opts?.learn });
  if (r.ok) revalidateFinance();
  return r;
}

/** 나눠 받은 판매 — 입금 여러 줄을 한 판매에 */
export async function linkDepositsToQuote(
  quoteId: number,
  cashTxnIds: number[],
  opts?: LearnOpts,
): Promise<{ ok: true; applied: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const r = await linkDepositsToQuoteCore(quoteId, cashTxnIds, g.uid, "수동", { learn: opts?.learn });
  if (r.ok) revalidateFinance();
  return r;
}

/**
 * 입금 한 건으로 외상 대상의 미납 건들을 턴다 — 선입선출.
 * 수금 기록은 settleReceivables 정본이 만들고, 여기서는 연결(recon_match)만 얹는다.
 */
export async function collectFromDeposit(
  cashTxnId: number,
  partyKey: string,
  opts?: LearnOpts,
): Promise<
  | { ok: true; applied: number; settled: number; leftover: number }
  | { ok: false; error: string }
> {
  const g = await guard();
  if (!g.ok) return g;
  const dep = await getDeposit(cashTxnId);
  if (!dep) return { ok: false, error: "입금 줄을 찾을 수 없습니다" };
  if (dep.recon_status === "확정") return { ok: false, error: "이미 정리된 입금입니다" };
  if (dep.remain <= 0) return { ok: false, error: `이 입금은 남은 금액이 없습니다 — ${W.reconTax}가 이미 썼습니다` };

  /* 대상 조건 — 정본 receivable-key.ts (외상 장부의 열쇠와 같은 규칙, 2026-09-10
     추출). 본사청구(claim_party)도 거래처와 같이 묶여 수금이 된다 */
  if (!partyKey.startsWith("S:") && !partyKey.startsWith("C:")) {
    return { ok: false, error: "대상이 올바르지 않습니다 (비회원 외상은 정비 내역에서 건별로)" };
  }
  const cond = receivableKeyCond(partyKey);

  const rows = await db.execute<{ id: number; quote_no: string; total: number; paid: number }>(sql`
    SELECT q.id, q.quote_no, q.total_amount total,
           COALESCE((SELECT SUM(amount)::int FROM receivable_payment rp WHERE rp.quote_id = q.id), 0) paid
    FROM quote q
    WHERE q.status = '성사' AND q.payment_method = '외상' AND ${cond}
      AND q.total_amount > COALESCE((SELECT SUM(amount)::int FROM receivable_payment rp WHERE rp.quote_id = q.id), 0)
    ORDER BY COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) ASC, q.id ASC LIMIT 100
  `);
  if (rows.length === 0) return { ok: false, error: "그 대상의 미납 외상이 없습니다" };

  const plan = planSettlement(
    rows.map((r) => ({ quoteId: Number(r.id), quoteNo: r.quote_no, remain: Number(r.total) - Number(r.paid) })),
    dep.remain, // 남은 금액만 배분 (G1)
  );
  if (plan.plan.length === 0) return { ok: false, error: "배분할 금액이 없습니다" };

  /* 🔴 감사 H5(2026-08-25): 입금이 외상 잔액보다 크면(합산·선입금) settleReceivables 가
     잔액 초과로 거부했다 — 배분된 만큼만 넘긴다. 남는 돈은 leftover 로 안내 */
  const planned = plan.plan.reduce((s, p) => s + p.amount, 0);
  const r = await settleReceivables({
    quoteIds: plan.plan.map((p) => p.quoteId),
    method: "계좌이체",
    paidOn: dep.date,
    received: Math.min(dep.remain, planned),
    memo: `통장 입금 대조 (${dep.l} ${dep.date})`,
    quiet: true, // 기록은 아래서 「수금+대조」 한 줄로 (settleReceivables 의 수금 줄과 이중 기록 금지)
  });
  if (!r.ok) return r;

  /* 연결 자국 — 어느 입금이 어느 판매를 털었는지. 🔴 2026 감사 G5: 자국+확정을 한 트랜잭션으로
     (settleReceivables 는 자기 트랜잭션이라 여기 못 넣는다 — 수금은 남고 자국만 없는 사고를
     되돌리기(undoDepositLink)가 memo 로 찾아 지운다) */
  await db.transaction(async (tx) => {
    for (const p of plan.plan) {
      await tx.execute(sql`
        INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
        VALUES ('이체입금', 'cash_txn', ${cashTxnId}, 'quote', ${p.quoteId}, ${p.amount}, '확정', '수동', ${g.uid}, now())
      `);
    }
    await tx.execute(sql`UPDATE cash_txn SET recon_status = '확정' WHERE id = ${cashTxnId}`);
  });

  // 별명 학습 — 다음부터 이 입금자명이 오면 이 외상 대상을 맨 위에 보여준다
  {
    const payer = payerOf(dep.description);
    let label = partyKey;
    if (partyKey.startsWith("S:")) label = `거래처 ${partyKey.slice(2)}`;
    else {
      const [c] = await db.execute<{ name: string }>(sql`
        SELECT name FROM customer WHERE id = ${Number(partyKey.slice(2))}
      `);
      label = c?.name ?? partyKey;
    }
    /* 개편 4단계(2026-09-12): 체크를 끄면(learn:false) 안 배운다. 🔴 quiet 아님 —
       규칙을 새로 배웠으면 「최근 한 일」에 규칙 한 줄이 남아야 되돌릴 길이 생긴다 */
    await learnAlias(payer, partyKey, label, { uid: g.uid, learn: opts?.learn });
    /* ⭐ 최근 한 일 — 되돌리기 = undoDepositLink(cashTxnId) (자국 + 그 자국이 만든 수금 기록을 함께 지운다) */
    await logActivity({
      ym: dep.date.slice(0, 7),
      actor: g.uid,
      how: "사람",
      verb: "수금",
      target: { table: "cash_txn", id: cashTxnId },
      n: r.settled,
      amount: r.applied,
      label: `입금 ${won(r.applied)} ${payer} → ${label} ${W.receivable} ${W.collect} (${r.settled}건)`,
      undo: { kind: "deposit", args: { cashTxnId } },
    });
  }

  revalidateFinance(); // 3단계(2026-09-12): 돈관리 화면 목록은 fin-revalidate 하나 — /finance/weekly 포함
  revalidatePath("/receivables");
  revalidatePath("/sales");
  return { ok: true, applied: r.applied, settled: r.settled, leftover: plan.leftover };
}

/**
 * ⭐ 입금 연결 되돌리기 (2026 감사 G3, 2026-08-26) — 판매 잇기·외상 수금으로 이은 입금을 원상복구.
 *   자국(recon_match 이체입금) 삭제 → 그 자국이 만든 수금 기록(memo '통장 입금 대조 …'·같은 날·같은
 *   금액)만 삭제(손으로 넣은 수금은 안 건드림) → 통장 줄 상태 복원(줄 단위 정본).
 */
export async function undoDepositLink(
  cashTxnId: number,
): Promise<{ ok: true; removed: number; payments: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const dep = await getDeposit(cashTxnId);
  if (!dep) return { ok: false, error: "입금 줄을 찾을 수 없습니다" };
  const marks = await db.execute<{ id: number; ref_table: string; ref_id: number; amount: number }>(sql`
    SELECT id, ref_table, ref_id, amount FROM recon_match
    WHERE kind = '이체입금' AND src_table = 'cash_txn' AND src_id = ${cashTxnId} AND status = '확정'
    ORDER BY id LIMIT 100
  `);
  if (marks.length === 0) return { ok: false, error: `이 입금에 ${W.recon}된 판매·수금이 없습니다` };
  let payments = 0;
  await db.transaction(async (tx) => {
    for (const m of marks) {
      if (m.ref_table === "quote") {
        const del = await tx.execute<{ id: number }>(sql`
          DELETE FROM receivable_payment WHERE id IN (
            SELECT id FROM receivable_payment
            WHERE quote_id = ${m.ref_id} AND method = '계좌이체' AND amount = ${m.amount}
              AND paid_on = ${dep.date}::date AND memo LIKE '통장 입금 대조%'
            ORDER BY id DESC LIMIT 1)
          RETURNING id
        `);
        payments += del.length;
      }
      await tx.execute(sql`DELETE FROM recon_match WHERE id = ${m.id}`);
    }
    await restoreCashLine(tx, cashTxnId);
  });
  await logActivity({
    ym: dep.date.slice(0, 7),
    actor: g.uid,
    how: "사람",
    verb: "되돌리기",
    target: { table: "cash_txn", id: cashTxnId },
    n: marks.length,
    amount: marks.reduce((s, m) => s + Number(m.amount), 0),
    label: `${W.undo}: 입금 ${won(dep.in_amount)} ${payerOf(dep.description)} ${W.recon} 풀기 (${marks.length}건${payments > 0 ? ` · 수금 ${payments}건 지움` : ""})`,
  });
  revalidateFinance(); // 3단계(2026-09-12): 목록 통일
  revalidatePath("/receivables");
  return { ok: true, removed: marks.length, payments };
}

/** 판매와 무관한 입금 분류 — 이자·지원금·환불·기타 (사장님 요청 2026-08-26: 「무시」로 매출 입금을 접지 않게) */
/* 🔴 사장님 지적(2026-08-26): 「판매와 무관」으로 뺀 것 대부분이 실은 **앱에 기록이 없는 판매 대금**이었다 —
   따로 분류해 손익의 번 돈에 넣고, 나중에 정비내역을 등록하면 되돌려 잇는다
   개편 4단계(2026-09-12): 목록은 코어(deposit-core.DEPOSIT_KINDS)로 옮겼다 — deposit_rule 표의
   CHECK 값과 「자동 규칙」 화면의 검사가 같은 한 벌을 봐야 한다 */

export async function setDepositKind(
  cashTxnId: number,
  kind: string,
  opts?: LearnOpts,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!(DEPOSIT_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "분류가 올바르지 않습니다" };
  const dep = await getDeposit(cashTxnId);
  if (!dep) return { ok: false, error: "입금 줄을 찾을 수 없습니다" };
  if (dep.remain < dep.in_amount) return { ok: false, error: `이미 계산서·판매에 일부 ${W.recon}된 입금입니다 — 먼저 되돌려 주세요` };
  await db.execute(sql`
    UPDATE cash_txn SET category = ${kind}, recon_status = '확정' WHERE id = ${cashTxnId} AND source = '통장'
  `);
  /* ⭐ 입금 성격 규칙 학습 (개편 4단계, 2026-09-12 — 계획서 §1-1)
     전엔 이 줄만 고치고 입금자를 안 외웠다. 이제 「☑ 다음부터 자동으로」가 켜져 있으면 기억해 두고
     **다음 통장 파일부터** 같은 입금자에 이 성격을 자동으로 붙인다.
     🔴 과거분 일괄 적용은 안 한다 — 입금은 판매와 이어질 수 있어 조용히 확정하면 위험하다.
     🔴 규칙 줄은 learnDepositRule 이 남긴다(코어 안에서만 기록) — 아래 분류 줄과 별개다:
        분류 되돌리기(depositKind)와 규칙 끄기(ruleOff)는 되돌릴 대상이 서로 다르다 */
  await learnDepositRule(payerOf(dep.description), kind, { uid: g.uid, learn: opts?.learn });
  /* ⭐ 최근 한 일 — 되돌리기 = undoDepositKind(cashTxnId) */
  await logActivity({
    ym: dep.date.slice(0, 7),
    actor: g.uid,
    how: "사람",
    verb: "분류",
    target: { table: "cash_txn", id: cashTxnId },
    amount: dep.in_amount,
    label: `분류 → ${kind}: ${dep.date.slice(5)} 입금 ${won(dep.in_amount)} ${payerOf(dep.description)}`,
    undo: { kind: "depositKind", args: { cashTxnId } },
  });
  revalidateFinance(); // 3단계(2026-09-12): 목록 통일
  return { ok: true };
}

export async function undoDepositKind(cashTxnId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  /* 🔴 두 칸(category·recon_status)을 같이 되돌린다 — unmarkCardSettlement 와 같은 모양.
     목록은 UNDO_DEPOSIT_KINDS(사람이 고르는 넷 + 자동 「지역화폐정산」, 5단계 정리 2026-09-13) */
  const rows = await db.execute<{ id: number; in_amount: number; description: string; d: string }>(sql`
    UPDATE cash_txn SET category = NULL, recon_status = '미대조'
    WHERE id = ${cashTxnId} AND category IN (${sql.join(UNDO_DEPOSIT_KINDS.map((k) => sql`${k}`), sql`, `)})
    RETURNING id, in_amount, description, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d
  `);
  if (rows.length === 0) return { ok: false, error: "판매와 무관으로 분류한 줄이 아닙니다" };
  await logActivity({
    ym: rows[0].d.slice(0, 7),
    actor: g.uid,
    how: "사람",
    verb: "되돌리기",
    target: { table: "cash_txn", id: cashTxnId },
    amount: Number(rows[0].in_amount),
    label: `${W.undo}: 입금 분류 해제 ${rows[0].d.slice(5)} ${won(Number(rows[0].in_amount))} ${payerOf(rows[0].description)}`,
  });
  revalidateFinance(); // 3단계(2026-09-12): 목록 통일
  return { ok: true };
}

/**
 * ⭐ 짝이 확실한 입금 모두 잇기 (사장님 요청 2026-08-26) — 정확 일치 + 아는 상대 하나뿐인 계산서,
 *    또는 이름 맞는 판매 하나뿐인 것. 서버가 같은 규칙으로 다시 계산한다(화면 목록을 믿지 않음).
 *    3단계(2026-09-12): 본문은 deposit-core.confirmSureDepositsCore — 「이번 주 정리」 ③의 체크 일괄이
 *    ids 를 넘긴다(재계산 맵에 있는 것만, 없으면 skipped). ids 없이 부르면 전과 같다. 기록은 코어가 한 줄.
 */
export async function confirmSureDeposits(
  ym: string,
  ids?: number[],
  /** 「☐ 이번 일괄은 규칙 학습 안 함」(일괄은 머리에 체크 하나) — 기본은 배움 */
  opts?: LearnOpts,
): Promise<{ ok: true; tax: number; quote: number; failed: number; skipped: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return { ok: false, error: "달이 올바르지 않습니다" };
  const r = await confirmSureDepositsCore(ym, g.uid, ids, { learn: opts?.learn });
  revalidateFinance();
  return r;
}

/** 무시 / 무시 해제 */
export async function ignoreDeposit(
  cashTxnId: number,
  back = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const rows = await db.execute<{ in_amount: number; description: string; d: string }>(sql`
    UPDATE cash_txn SET recon_status = ${back ? "미대조" : "무시"}
    WHERE id = ${cashTxnId} AND source = '통장' AND recon_status <> '확정'
    RETURNING in_amount, description, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d
  `);
  /* ⭐ 최근 한 일 — 🔴 되돌리기 종류가 없어(ignoreDeposit(id, true)) undo 없이 기록만 (갈래 A 에 알림) */
  if (rows[0]) {
    await logActivity({
      ym: rows[0].d.slice(0, 7),
      actor: g.uid,
      how: "사람",
      verb: back ? "되돌리기" : "제외",
      target: { table: "cash_txn", id: cashTxnId },
      amount: Number(rows[0].in_amount),
      label: `${back ? `${W.undo}: ${W.ignore} 풀기` : W.ignore}: ${rows[0].d.slice(5)} 입금 ${won(Number(rows[0].in_amount))} ${payerOf(rows[0].description)}`,
    });
  }
  revalidateFinance(); // 3단계(2026-09-12): 목록 통일
  return { ok: true };
}

/** 🔴 감사 H10(2026-08-25): 카드정산 표시 취소 — 우연히 패턴에 걸린 진짜 입금을 되살린다 */
export async function unmarkCardSettlement(
  cashTxnId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const rows = await db.execute<{ id: number; in_amount: number; d: string }>(sql`
    UPDATE cash_txn SET category = NULL, recon_status = '미대조'
    WHERE id = ${cashTxnId} AND category = '카드정산'
    RETURNING id, in_amount, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d
  `);
  if (rows.length === 0) return { ok: false, error: "카드정산으로 표시된 줄이 아닙니다" };
  await logActivity({
    ym: rows[0].d.slice(0, 7),
    actor: g.uid,
    how: "사람",
    verb: "되돌리기",
    target: { table: "cash_txn", id: cashTxnId },
    amount: Number(rows[0].in_amount),
    label: `${W.undo}: 카드정산 표시 취소 ${rows[0].d.slice(5)} 입금 ${won(Number(rows[0].in_amount))}`,
  });
  revalidateFinance(); // 3단계(2026-09-12): 목록 통일
  return { ok: true };
}
