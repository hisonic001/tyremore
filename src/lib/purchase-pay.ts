"use server";

/**
 * ⭐ 매입 대금 지급 — 쓰기 액션 (ERP ⑦, 사장님 지시 2026-08-25)
 *
 *   외상 수금(settleReceivables)의 거울상: 거래처에 준 돈을 오래된 인보이스부터
 *   선입선출로 채운다. 잔액은 파생값 — 넘치게 못 넣는다.
 *
 * 🔴 사장님 전용. 트랜잭션 + FOR UPDATE + IN(sql.join) 관용구 (receivable.ts 계보).
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { cashUsedSql, normName } from "./recon-data";
import { planSettlement } from "./receivable-plan";
import { exactPlan } from "./payables-plan";
import { restoreCashLine } from "./cash-restore";
import { logActivity } from "./fin-activity";
import type { UndoItem } from "./fin-activity-types";
import { W } from "./fin-words";

const won = (n: number) => n.toLocaleString("ko-KR");
const payerOf = (description: string) => description.replace(/^\[[^\]]*\]\s*/, "").trim();

const METHODS = ["계좌이체", "현금", "카드", "기타"];

/** 거래처에 준 돈을 오래된 매입부터 채운다 */
export async function payToSupplier(input: {
  supplier: string;
  amount: number;
  method: string;
  paidOn?: string | null;
  memo?: string | null;
}): Promise<
  | { ok: true; applied: number; settled: number; leftover: number }
  | { ok: false; error: string }
> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const session = await getSession();
  const supplier = input.supplier?.trim();
  if (!supplier) return { ok: false, error: "거래처를 골라 주세요" };
  if (!Number.isInteger(input.amount) || input.amount <= 0) return { ok: false, error: "지급 금액이 올바르지 않습니다" };
  if (!METHODS.includes(input.method)) return { ok: false, error: "수단이 올바르지 않습니다" };
  const paidOn = input.paidOn?.trim() || null;
  if (paidOn && !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { ok: false, error: "날짜는 2026-08-25 형식입니다" };

  try {
    const out = await db.transaction(async (tx) => {
      // 🔴 FOR UPDATE — 같은 인보이스에 동시에 지급을 넣으면 잔액을 넘길 수 있다
      const rows = await tx.execute<{ id: number; invoice_no: string; total: number; paid: string }>(sql`
        SELECT pi.id, pi.invoice_no, pi.total,
               COALESCE((SELECT SUM(pp.amount)::int FROM purchase_payment pp WHERE pp.invoice_id = pi.id), 0) paid
        FROM purchase_invoice pi
        WHERE pi.status <> '취소' AND pi.supplier = ${supplier} AND pi.total IS NOT NULL AND pi.total > 0
        ORDER BY COALESCE(pi.issued_at, to_char(pi.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) ASC, pi.id ASC
        LIMIT 200
        FOR UPDATE OF pi
      `);
      const open = rows
        .map((r) => ({ quoteId: Number(r.id), quoteNo: r.invoice_no, remain: Number(r.total) - Number(r.paid) }))
        .filter((r) => r.remain > 0);
      if (open.length === 0) return { ok: false as const, error: "그 거래처의 미지급 매입이 없습니다" };

      // 선입선출 배분 — 외상 수금과 같은 규칙 (receivable-plan)
      const plan = planSettlement(open, input.amount);
      if (plan.plan.length === 0) return { ok: false as const, error: "배분할 금액이 없습니다" };

      const items: UndoItem[] = [];
      for (const p of plan.plan) {
        const [pp] = await tx.execute<{ id: number }>(sql`
          INSERT INTO purchase_payment (invoice_id, amount, method, paid_on, memo, created_by)
          VALUES (${p.quoteId}, ${p.amount}, ${input.method},
                  ${paidOn ?? sql`(now() AT TIME ZONE 'Asia/Seoul')::date`}, ${input.memo?.trim() || null},
                  ${session?.uid ?? null})
          RETURNING id
        `);
        items.push({
          kind: "payment",
          args: { paymentId: Number(pp.id) },
          label: `${open.find((o) => o.quoteId === p.quoteId)?.quoteNo ?? `#${p.quoteId}`} ${won(p.amount)}`,
          amount: p.amount,
        });
      }
      const applied = plan.plan.reduce((s, p) => s + p.amount, 0);
      const settled = plan.plan.filter((p) => p.amount === open.find((o) => o.quoteId === p.quoteId)?.remain).length;

      revalidatePath("/finance/payables");
      revalidatePath("/finance");
      return { ok: true as const, applied, settled, leftover: plan.leftover, items };
    });
    if (out.ok) {
      /* ⭐ 최근 한 일 — 커밋 뒤. 건별 되돌리기 = removePurchasePayment(paymentId) */
      const { items, ...rest } = out;
      await logActivity({
        ym: paidOn?.slice(0, 7) ?? null,
        actor: session?.uid ?? null,
        how: "사람",
        verb: "지급",
        n: items.length,
        amount: out.applied,
        label: `${supplier} 지급 ${won(out.applied)} (${input.method}, 매입 ${items.length}건)`,
        undo: items.length === 1 ? { kind: "payment", args: items[0].args } : { kind: "bulk", args: { items } },
      });
      return rest;
    }
    return out;
  } catch (e) {
    return { ok: false, error: `지급을 넣지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 지급 기록 지우기 — 잘못 넣었을 때 (수금 removeCollection 의 거울상).
 *  🔴 2026 감사 G2: 「출금에서 지급 잡기」로 생긴 지급이면 짝 자국(recon_match 매입지급)도 지우고
 *     통장 줄을 복원한다 — 전에는 지급만 지워 그 출금이 영구 소진 상태로 남았다 */
export async function removePurchasePayment(
  paymentId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const session = await getSession();
  const [pp] = await db.execute<{ id: number; invoice_id: number; amount: number; memo: string | null; supplier: string | null; paid_on: string | null }>(sql`
    SELECT p.id, p.invoice_id, p.amount, p.memo, i.supplier, to_char(p.paid_on, 'YYYY-MM-DD') paid_on
    FROM purchase_payment p LEFT JOIN purchase_invoice i ON i.id = p.invoice_id WHERE p.id = ${paymentId}
  `);
  if (!pp) return { ok: false, error: "지급 기록을 찾을 수 없습니다" };
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM purchase_payment WHERE id = ${paymentId}`);
    if (pp.memo && pp.memo.startsWith("통장 출금 연결")) {
      const gone = await tx.execute<{ src_id: number }>(sql`
        DELETE FROM recon_match WHERE id IN (
          SELECT id FROM recon_match
          WHERE kind = '매입지급' AND ref_table = 'purchase_invoice' AND ref_id = ${pp.invoice_id}
            AND amount = ${pp.amount} AND status = '확정'
          ORDER BY id DESC LIMIT 1)
        RETURNING src_id
      `);
      for (const gRow of gone) await restoreCashLine(tx, Number(gRow.src_id));
    }
  });
  await logActivity({
    ym: pp.paid_on?.slice(0, 7) ?? null,
    actor: session?.uid ?? null,
    how: "사람",
    verb: "되돌리기",
    target: { table: "purchase_payment", id: paymentId },
    amount: Number(pp.amount),
    label: `${W.undo}: ${pp.supplier ?? ""} 지급 ${won(Number(pp.amount))} 지우기${pp.paid_on ? ` (${pp.paid_on.slice(5)})` : ""}`,
  });
  revalidatePath("/finance/payables");
  revalidatePath("/finance");
  revalidatePath("/finance/tax");
  revalidatePath("/finance/expenses");
  return { ok: true };
}

/**
 * ⭐ 「출금에서 지급 잡기」 되돌리기 (2026 감사 G2, 2026-08-26) — 출금 한 줄의 지급 전체를 원상복구.
 *   자국(매입지급) 삭제 → 그 자국이 만든 지급 기록(memo '통장 출금 연결 …'·같은 금액)만 삭제 →
 *   통장 줄 상태·'매입대금' 분류 복원(줄 단위 정본 restoreCashLine).
 */
export async function undoPayFromWithdrawal(
  cashTxnId: number,
): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const session = await getSession();
  const marks = await db.execute<{ id: number; ref_id: number; amount: number }>(sql`
    SELECT id, ref_id, amount FROM recon_match
    WHERE kind = '매입지급' AND src_table = 'cash_txn' AND src_id = ${cashTxnId} AND status = '확정'
    ORDER BY id LIMIT 100
  `);
  if (marks.length === 0) return { ok: false, error: `이 출금에 ${W.recon}된 지급이 없습니다` };
  await db.transaction(async (tx) => {
    for (const m of marks) {
      await tx.execute(sql`
        DELETE FROM purchase_payment WHERE id IN (
          SELECT id FROM purchase_payment
          WHERE invoice_id = ${m.ref_id} AND amount = ${m.amount} AND memo LIKE '통장 출금 연결%'
          ORDER BY id DESC LIMIT 1)
      `);
      await tx.execute(sql`DELETE FROM recon_match WHERE id = ${m.id}`);
    }
    await restoreCashLine(tx, cashTxnId);
  });
  await logActivity({
    actor: session?.uid ?? null,
    how: "사람",
    verb: "되돌리기",
    target: { table: "cash_txn", id: cashTxnId },
    n: marks.length,
    amount: marks.reduce((s, m) => s + Number(m.amount), 0),
    label: `${W.undo}: 출금 ${won(marks.reduce((s, m) => s + Number(m.amount), 0))} ${W.reconPay} 풀기 (지급 ${marks.length}건 지움)`,
  });
  revalidatePath("/finance/payables");
  revalidatePath("/finance");
  revalidatePath("/finance/tax");
  revalidatePath("/finance/expenses");
  revalidatePath("/finance/party");
  return { ok: true, removed: marks.length };
}

/**
 * ⚡ 원단위 자동 잇기 (리모델링 ②, 사장님 승인 2026-08-31)
 *
 *   출금 남은 돈이 그 거래처 인보이스(하나 또는 같은 작성일 묶음)와 **정확히 일치**할 때
 *   한 번에 잇는다. 제안은 payables-view.exactPlan 이 만들지만, 🔴 실행 시점에 서버가
 *   같은 계산을 다시 한다 — 화면이 열려 있던 사이 잔액이 바뀌었으면 거절되는 게 맞다.
 */
export async function autoLinkExact(input: {
  cashTxnId: number;
  supplier: string;
}): Promise<{ ok: true; n: number; amount: number } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const session = await getSession();
  const supplier = input.supplier?.trim();
  if (!supplier) return { ok: false, error: "거래처가 없습니다" };

  const [dep] = await db.execute<{ id: number; out_amount: number; date: string; l: string; description: string }>(sql`
    SELECT id, out_amount, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           account_label l, description
    FROM cash_txn WHERE id = ${input.cashTxnId} AND source = '통장' AND is_active AND out_amount > 0
  `);
  if (!dep) return { ok: false, error: "출금 줄을 찾을 수 없습니다" };
  const dupe = await db.execute<{ id: number }>(sql`
    SELECT id FROM recon_match WHERE src_table = 'cash_txn' AND src_id = ${input.cashTxnId} AND kind = '매입지급' LIMIT 1
  `);
  if (dupe.length > 0) return { ok: false, error: `이미 지급으로 ${W.recon}된 출금입니다` };
  const [usedRow] = await db.execute<{ s: string }>(sql`
    SELECT ${cashUsedSql("c")}::bigint s FROM cash_txn c WHERE c.id = ${input.cashTxnId}
  `);
  const avail = Number(dep.out_amount) - Number(usedRow?.s ?? 0);
  if (avail <= 0) return { ok: false, error: "이 출금은 남은 금액이 없습니다" };

  try {
    const out = await db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: number; no: string; d: string | null; remain: string }>(sql`
        SELECT pi.id, pi.invoice_no no, pi.issued_at d,
               (pi.total - COALESCE((SELECT SUM(amount)::int FROM purchase_payment pp WHERE pp.invoice_id = pi.id), 0))::bigint remain
        FROM purchase_invoice pi
        WHERE pi.status <> '취소' AND pi.supplier = ${supplier} AND pi.total > 0
        ORDER BY pi.issued_at LIMIT 100
        FOR UPDATE OF pi
      `);
      const plan = exactPlan(
        avail,
        rows.map((r) => ({ id: Number(r.id), no: r.no, d: r.d, remain: Number(r.remain) })),
      );
      if (!plan) return { ok: false as const, error: "지금은 금액이 정확히 맞지 않습니다 — 잔액이 바뀌었으면 새로고침해 주세요" };

      let total = 0;
      for (const id of plan.ids) {
        const r = rows.find((x) => Number(x.id) === id)!;
        const amt = Number(r.remain);
        await tx.execute(sql`
          INSERT INTO purchase_payment (invoice_id, amount, method, paid_on, memo, created_by)
          VALUES (${id}, ${amt}, '계좌이체', ${dep.date},
                  ${"통장 출금 연결 (" + dep.l + " " + dep.date + ") — 원단위 자동"}, ${session?.uid ?? null})
        `);
        await tx.execute(sql`
          INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
          VALUES ('매입지급', 'cash_txn', ${input.cashTxnId}, 'purchase_invoice', ${id}, ${amt}, '확정', '자동', ${session?.uid ?? null}, now())
        `);
        total += amt;
      }
      await tx.execute(sql`
        UPDATE cash_txn SET recon_status = '확정', category = COALESCE(category, '매입대금')
        WHERE id = ${input.cashTxnId}
      `);
      // 별명 학습 — payFromWithdrawal 과 같은 규칙
      try {
        const payer = dep.description.replace(/^\[[^\]]*\]\s*/, "").trim();
        const key = normName(payer);
        if (key.length >= 2) {
          await tx.execute(sql`
            INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
            VALUES (${key}, ${payer}, ${"S:" + supplier}, ${"거래처 " + supplier})
            ON CONFLICT (alias_key) DO UPDATE SET party_key = EXCLUDED.party_key,
              party_label = EXCLUDED.party_label, updated_at = now()
          `);
        }
      } catch {
        /* 학습 실패는 지급을 막지 않는다 */
      }
      revalidatePath("/finance/payables");
      revalidatePath("/finance");
      return { ok: true as const, n: plan.ids.length, amount: total };
    });
    if (out.ok) {
      /* ⭐ 최근 한 일 — 원단위 자동은 「자동」. 되돌리기 = undoPayFromWithdrawal(cashTxnId) */
      await logActivity({
        ym: dep.date.slice(0, 7),
        actor: session?.uid ?? null,
        how: "자동",
        verb: "지급",
        target: { table: "cash_txn", id: input.cashTxnId },
        n: out.n,
        amount: out.amount,
        label: `출금 ${won(out.amount)} ${payerOf(dep.description)} → ${supplier} 지급 (매입 ${out.n}건, 원단위 자동)`,
        undo: { kind: "pay", args: { cashTxnId: input.cashTxnId } },
      });
    }
    return out;
  } catch (e) {
    return { ok: false, error: `${W.recon}하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** ④ 통장 이름 별명 — 거래처 카드에서 직접 관리 (2026-08-31 "맨날 알려줘야 하는 것은 문제") */
export async function addSupplierAlias(
  supplier: string,
  raw: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const name = raw.trim();
  const sup = supplier.trim();
  if (!sup) return { ok: false, error: "거래처가 없습니다" };
  const key = normName(name);
  if (key.length < 2) return { ok: false, error: "통장에 찍히는 이름을 2자 이상 적어 주세요" };
  await db.execute(sql`
    INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
    VALUES (${key}, ${name}, ${"S:" + sup}, ${"거래처 " + sup})
    ON CONFLICT (alias_key) DO UPDATE SET party_key = EXCLUDED.party_key,
      party_label = EXCLUDED.party_label, updated_at = now()
  `);
  await logActivity({
    actor: (await getSession())?.uid ?? null,
    how: "사람",
    verb: "규칙",
    label: `규칙 저장: 통장 이름 「${name}」 = 거래처 ${sup}`,
  });
  revalidatePath("/finance/payables");
  return { ok: true };
}

export async function removeSupplierAlias(
  supplier: string,
  aliasKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const done = await db.execute<{ alias_key: string }>(sql`
    DELETE FROM party_alias WHERE alias_key = ${aliasKey} AND party_key = ${"S:" + supplier.trim()}
    RETURNING alias_key
  `);
  if (done.length === 0) return { ok: false, error: "그 별명을 찾을 수 없습니다" };
  await logActivity({
    actor: (await getSession())?.uid ?? null,
    how: "사람",
    verb: "되돌리기",
    label: `${W.undo}: 통장 이름 규칙 지우기 「${aliasKey}」 ≠ 거래처 ${supplier.trim()}`,
  });
  revalidatePath("/finance/payables");
  return { ok: true };
}

/**
 * ⭐ 「이을 것 없음 — 접기」 (사장님 질문 2026-08-31 "존재 이유를 잘 모르겠음")
 *
 *   지급 잡기 목록의 태반이 **앱 이전 기간(7월분 이하) 대금**이라 이을 인보이스가
 *   없었다 — 그 줄들이 영영 남아 화면이 숙제처럼 보였다. 접으면 목록에서 빠지고
 *   「접어둔 출금」에서 언제든 되살린다. 분류(매입대금)·손익은 그대로다.
 */
export async function skipWithdrawal(
  cashTxnId: number,
  restore = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const [c] = await db.execute<{ id: number; st: string; out_amount: number; description: string; d: string }>(sql`
    SELECT id, recon_status st, out_amount, description, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d
    FROM cash_txn
    WHERE id = ${cashTxnId} AND source = '통장' AND is_active AND out_amount > 0 AND category = '매입대금'
  `);
  if (!c) return { ok: false, error: "출금 줄을 찾을 수 없습니다" };
  if (!restore) {
    if (c.st === "무시") return { ok: false, error: "이미 접힌 출금입니다" };
    const linked = await db.execute<{ id: number }>(sql`
      SELECT id FROM recon_match WHERE kind = '매입지급' AND src_table = 'cash_txn' AND src_id = ${cashTxnId} LIMIT 1
    `);
    if (linked.length > 0) return { ok: false, error: `이미 지급으로 ${W.recon}된 출금입니다 — 먼저 되돌려 주세요` };
    await db.execute(sql`
      UPDATE cash_txn SET recon_status = '무시',
        memo = COALESCE(memo || ' · ', '') || '지급 잡기에서 접음 (이을 인보이스 없음)'
      WHERE id = ${cashTxnId}
    `);
  } else {
    if (c.st !== "무시") return { ok: false, error: "접힌 출금이 아닙니다" };
    await db.execute(sql`UPDATE cash_txn SET recon_status = '미대조' WHERE id = ${cashTxnId}`);
  }
  /* ⭐ 최근 한 일 — 접기는 「제외」, 되돌리기 = skipWithdrawal(id, true) */
  await logActivity({
    ym: c.d.slice(0, 7),
    actor: (await getSession())?.uid ?? null,
    how: "사람",
    verb: restore ? "되돌리기" : "제외",
    target: { table: "cash_txn", id: cashTxnId },
    amount: Number(c.out_amount),
    label: restore
      ? `${W.undo}: 접어둔 출금 되살리기 ${c.d.slice(5)} ${won(Number(c.out_amount))} ${payerOf(c.description)}`
      : `${W.excluded}: 출금 ${c.d.slice(5)} ${won(Number(c.out_amount))} ${payerOf(c.description)} 접음`,
    undo: restore ? null : { kind: "skip", args: { cashTxnId } },
  });
  revalidatePath("/finance/payables");
  revalidatePath("/finance");
  return { ok: true };
}

/**
 * 🔴 감사 P2(2026-08-25): 「출금에서 지급 잡기」 — '매입대금' 통장 출금 한 건으로
 *   거래처 미지급을 선입선출로 턴다. 지급 기록 + 연결 자국('매입지급') + 출금 확정 + 별명 학습.
 *   미지급 장부가 "이미 준 돈"을 알게 되는 핵심 고리.
 */
export async function payFromWithdrawal(input: {
  cashTxnId: number;
  supplier: string;
}): Promise<
  | { ok: true; applied: number; settled: number; leftover: number }
  | { ok: false; error: string }
> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const session = await getSession();
  const supplier = input.supplier?.trim();
  if (!supplier) return { ok: false, error: "거래처를 골라 주세요" };

  const [dep] = await db.execute<{
    id: number; out_amount: number; recon_status: string; date: string; l: string; description: string;
  }>(sql`
    SELECT id, out_amount, recon_status,
           to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           account_label l, description
    FROM cash_txn WHERE id = ${input.cashTxnId} AND source = '통장' AND is_active AND out_amount > 0
  `);
  if (!dep) return { ok: false, error: "출금 줄을 찾을 수 없습니다" };
  const dupe = await db.execute<{ id: number }>(sql`
    SELECT id FROM recon_match WHERE src_table = 'cash_txn' AND src_id = ${input.cashTxnId}
      AND kind = '매입지급' LIMIT 1
  `);
  if (dupe.length > 0) return { ok: false, error: `이미 지급으로 ${W.recon}된 출금입니다` };
  /* 🔴 감사 B4(2026-08-25): 계산서 확인·수금이 이미 쓴 몫을 빼고 배분 — 같은 출금
     이중 소진 차단. 2026 감사 G7: 손 복제본 대신 소진량 정본 cashUsedSql */
  const [usedRow] = await db.execute<{ s: string }>(sql`
    SELECT ${cashUsedSql("c")}::bigint s FROM cash_txn c WHERE c.id = ${input.cashTxnId}
  `);
  const avail = Number(dep.out_amount) - Number(usedRow?.s ?? 0);
  if (avail <= 0)
    return { ok: false, error: `이 출금은 남은 금액이 없습니다 — ${W.reconTax}가 이미 썼습니다` };

  try {
    const out = await db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: number; invoice_no: string; total: number; paid: string }>(sql`
        SELECT pi.id, pi.invoice_no, pi.total,
               COALESCE((SELECT SUM(pp.amount)::int FROM purchase_payment pp WHERE pp.invoice_id = pi.id), 0) paid
        FROM purchase_invoice pi
        WHERE pi.status <> '취소' AND pi.supplier = ${supplier} AND pi.total IS NOT NULL AND pi.total > 0
        ORDER BY COALESCE(pi.issued_at, to_char(pi.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) ASC, pi.id ASC
        LIMIT 200
        FOR UPDATE OF pi
      `);
      const open = rows
        .map((r) => ({ quoteId: Number(r.id), quoteNo: r.invoice_no, remain: Number(r.total) - Number(r.paid) }))
        .filter((r) => r.remain > 0);
      if (open.length === 0)
        return {
          ok: false as const,
          error: `「${supplier}」는 지금 ${W.payable}이 0원입니다 — 인보이스가 아직 앱에 안 들어온 선지급이면 입고 뒤에 ${W.recon}해 주세요`,
        };
      const plan = planSettlement(open, avail);
      if (plan.plan.length === 0) return { ok: false as const, error: "배분할 금액이 없습니다" };

      for (const p of plan.plan) {
        await tx.execute(sql`
          INSERT INTO purchase_payment (invoice_id, amount, method, paid_on, memo, created_by)
          VALUES (${p.quoteId}, ${p.amount}, '계좌이체', ${dep.date},
                  ${"통장 출금 연결 (" + dep.l + " " + dep.date + ")"}, ${session?.uid ?? null})
        `);
        await tx.execute(sql`
          INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
          VALUES ('매입지급', 'cash_txn', ${input.cashTxnId}, 'purchase_invoice', ${p.quoteId}, ${p.amount},
                  '확정', '수동', ${session?.uid ?? null}, now())
        `);
      }
      await tx.execute(sql`
        UPDATE cash_txn SET recon_status = '확정', category = COALESCE(category, '매입대금')
        WHERE id = ${input.cashTxnId}
      `);

      const applied = plan.plan.reduce((s, p) => s + p.amount, 0);
      const settled = plan.plan.filter((p) => p.amount === open.find((o) => o.quoteId === p.quoteId)?.remain).length;

      // 별명 학습 — 이 출금 상대명 = 이 거래처 (다음부터 자동 제안)
      try {
        const payer = dep.description.replace(/^\[[^\]]*\]\s*/, "").trim();
        const key = normName(payer);
        if (key.length >= 2) {
          await tx.execute(sql`
            INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
            VALUES (${key}, ${payer}, ${"S:" + supplier}, ${"거래처 " + supplier})
            ON CONFLICT (alias_key) DO UPDATE SET party_key = EXCLUDED.party_key,
              party_label = EXCLUDED.party_label, updated_at = now()
          `);
        }
      } catch {
        // 학습 실패는 지급을 막지 않는다
      }

      revalidatePath("/finance/payables");
      revalidatePath("/finance/expenses");
      revalidatePath("/finance/tax"); // CASH_LAT 의 간접 확인(ind)이 바뀐다 (2026 감사 N9)
      revalidatePath("/finance/party");
      revalidatePath("/finance");
      return { ok: true as const, applied, settled, leftover: Number(dep.out_amount) - applied };
    });
    if (out.ok) {
      /* ⭐ 최근 한 일 — 커밋 뒤. 되돌리기 = undoPayFromWithdrawal(cashTxnId) */
      await logActivity({
        ym: dep.date.slice(0, 7),
        actor: session?.uid ?? null,
        how: "사람",
        verb: "지급",
        target: { table: "cash_txn", id: input.cashTxnId },
        n: Math.max(1, out.settled),
        amount: out.applied,
        label: `출금 ${won(out.applied)} ${payerOf(dep.description)} → ${supplier} 지급 (${W.reconPay})`,
        undo: { kind: "pay", args: { cashTxnId: input.cashTxnId } },
      });
    }
    return out;
  } catch (e) {
    return { ok: false, error: `지급을 넣지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}
