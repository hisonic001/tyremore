/**
 * ⭐ 원단위 자동 잇기 — 코어 (리모델링 ②, 사장님 승인 2026-08-31; 3단계 2026-09-12 에 purchase-pay 에서 분리)
 *
 *   출금 남은 돈이 그 거래처 인보이스(하나 또는 같은 작성일 묶음)와 **정확히 일치**할 때 한 번에
 *   잇는다. 제안은 payables-view(exactPlan)가 만들지만, 🔴 실행 시점에 서버가 같은 계산을
 *   FOR UPDATE 안에서 다시 한다 — 화면이 열려 있던 사이 잔액이 바뀌었으면 거절되는 게 맞다.
 *
 *   왜 분리했나: 「이번 주 정리」 ⑥의 「짝 확실 N건 한 번에」(confirmSureWithdrawals)가 같은 규칙을
 *   순차로 돌리며 기록만 quiet 로 모아 한 줄로 남겨야 해서. 낱장 액션(autoLinkExact)은
 *   권한 → 이 코어 → revalidate 만 한다(동작·기록 불변).
 *
 * 🔴 "use server" 아님. 권한 검사 없음 — 부르는 쪽이 책임진다. 질의 순차.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { cashUsedSql } from "./recon-data";
import { exactPlan } from "./payables-plan";
import { learnAlias } from "./deposit-core";
import { logActivity } from "./fin-activity";
import type { ActivityEntry, UndoItem } from "./fin-activity-types";
import { activityItems, type ActivityOpts } from "./recon-core";
import { weeklyPayableStep } from "./weekly-payables";
import { autoReconLabel, W } from "./fin-words";

export const won = (n: number) => n.toLocaleString("ko-KR");
/** 통장 적요의 머리표(「[이체] 」)를 뗀 상대명 — purchase-pay 의 기록 글자가 쓴다 */
export const payerOf = (description: string) => description.replace(/^\[[^\]]*\]\s*/, "").trim();

export async function autoLinkExactCore(
  cashTxnId: number,
  supplierRaw: string,
  uid: number | null,
  opts: ActivityOpts = {},
): Promise<{ ok: true; n: number; amount: number; activity: ActivityEntry } | { ok: false; error: string }> {
  const supplier = supplierRaw?.trim();
  if (!supplier) return { ok: false, error: "거래처가 없습니다" };

  const [dep] = await db.execute<{ id: number; out_amount: number; date: string; l: string; description: string }>(sql`
    SELECT id, out_amount, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           account_label l, description
    FROM cash_txn WHERE id = ${cashTxnId} AND source = '통장' AND is_active AND out_amount > 0
  `);
  if (!dep) return { ok: false, error: "출금 줄을 찾을 수 없습니다" };
  /* 🔴 2026-09-16: 일부만 붙은 출금의 남은 조각도 이을 수 있어야 한다 (purchase-pay 와 같은 이유) —
     이중 소진은 바로 아래 avail 계산이 막는다. */
  const [usedRow] = await db.execute<{ s: string }>(sql`
    SELECT ${cashUsedSql("c")}::bigint s FROM cash_txn c WHERE c.id = ${cashTxnId}
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
                  ${"통장 출금 연결 (" + dep.l + " " + dep.date + ") — 원단위 자동"}, ${uid})
        `);
        await tx.execute(sql`
          INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
          VALUES ('매입지급', 'cash_txn', ${cashTxnId}, 'purchase_invoice', ${id}, ${amt}, '확정', '자동', ${uid}, now())
        `);
        total += amt;
      }
      await tx.execute(sql`
        UPDATE cash_txn SET recon_status = '확정', category = COALESCE(category, '매입대금')
        WHERE id = ${cashTxnId}
      `);
      return { ok: true as const, n: plan.ids.length, amount: total };
    });
    if (!out.ok) return out;
    /* 별명 학습 — payFromWithdrawal 과 같은 규칙. 개편 4단계(2026-09-12): 손 INSERT 를 정본
       learnAlias 로 바꾸고 **트랜잭션 밖**으로 옮겼다(위 커밋 뒤). 전에는 트랜잭션 안에 있어서
       학습 INSERT 가 실패하면 그 트랜잭션이 통째로 깨져 지급까지 되돌아갈 수 있었다
       (Postgres 는 오류 뒤 같은 트랜잭션의 다음 질의를 전부 거부한다 — try/catch 로도 못 막는다).
       「☑ 다음부터 자동으로」를 끄면 안 배우고, 일괄(quiet)이면 규칙 줄도 접는다 */
    await learnAlias(payerOf(dep.description), `S:${supplier}`, `거래처 ${supplier}`, {
      uid,
      learn: opts.learn,
      quiet: opts.quiet,
    });
    /* ⭐ 최근 한 일 — 원단위 자동은 「자동」. 되돌리기 = undoPayFromWithdrawal(cashTxnId).
       quiet 면 안 남기고 activity 만 돌려준다 — 일괄(confirmSureWithdrawals)이 한 줄 n건으로 접는다 */
    const activity: ActivityEntry = {
      ym: dep.date.slice(0, 7),
      actor: uid,
      how: "자동",
      verb: "지급",
      target: { table: "cash_txn", id: cashTxnId },
      n: out.n,
      amount: out.amount,
      label: `출금 ${won(out.amount)} ${payerOf(dep.description)} → ${supplier} 지급 (매입 ${out.n}건, 원단위 자동)`,
      undo: { kind: "pay", args: { cashTxnId } },
    };
    if (!opts.quiet) await logActivity(activity);
    return { ok: true, n: out.n, amount: out.amount, activity };
  } catch (e) {
    return { ok: false, error: `${W.recon}하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * ⭐ 「짝 확실 N건 한 번에」 — 코어 (개편 3단계 2026-09-12; 4단계 2026-09-12 에 purchase-pay 에서 분리)
 *
 *   서버가 weeklyPayableStep(ym).sure(= payablesCardInfo.exact 를 flipExact 로 뒤집은 것)를 **다시
 *   계산**하고, ids 가 오면 그 안에 있는 것만(없는 건 skipped — 화면이 열려 있던 사이 바뀐 것) 순차로
 *   autoLinkExactCore(quiet) 를 돌린다 — 코어가 FOR UPDATE 안에서 exactPlan 을 재검사하므로 안 맞으면
 *   그 건만 실패. 기록은 끝에 **bulk 한 줄**(how 자동·verb 지급, items = kind "pay" → undoPayFromWithdrawal 로
 *   되돌리기 — fin-activity-types 의 undo 표 그대로). 🔴 낱장 기록은 quiet 로 막아 두 줄이 안 남는다.
 *
 *   왜 코어로 뗐나(4단계): 「올린 직후 자동 대조」(auto-recon.ts)가 입금·계산서와 나란히 준 돈까지
 *   돌려야 하는데, 준 돈만 액션(권한 검사 + revalidate 포함)이라 한 요청 안에서 부르는 모양이
 *   어긋났다. 본문은 **그대로** 옮겼다 — 판정·기록 불변.
 *
 * 🔴 "use server" 아님. 권한 검사 없음 — 부르는 쪽이 책임진다. revalidate 도 액션이 한다.
 */
export async function confirmSureWithdrawalsCore(
  ym: string,
  uid: number | null,
  ids?: number[],
  /** learn 만 본다 — 낱장 기록은 어차피 quiet(아래 한 줄로 접는다). 기본은 배움(결정 7③) */
  opts: ActivityOpts = {},
): Promise<{ ok: true; n: number; amount: number; failed: number; skipped: number }> {
  let picked = (await weeklyPayableStep(ym)).sure;
  let skipped = 0;
  if (ids) {
    const want = new Set(ids.filter((n) => Number.isInteger(n) && n > 0));
    picked = picked.filter((s) => want.has(s.cashTxnId));
    skipped = want.size - picked.length;
  }
  let n = 0;
  let amount = 0;
  let failed = 0;
  const items: UndoItem[] = [];
  for (const s of picked) {
    // 🔴 순차 — 풀 max 3. 코어가 FOR UPDATE 로 다시 검사한다(안 맞으면 그 건만 실패)
    const r = await autoLinkExactCore(s.cashTxnId, s.supplier, uid, { quiet: true, learn: opts.learn });
    if (!r.ok) {
      failed++;
      continue;
    }
    n++;
    amount += r.amount;
    items.push(...activityItems(r.activity));
  }
  if (items.length > 0) {
    await logActivity({
      ym,
      actor: uid,
      how: "자동",
      verb: "지급",
      n: items.length,
      amount: items.reduce((s, i) => s + (i.amount ?? 0), 0),
      label: `${autoReconLabel(items.length)} · 지급 ${ym}${failed > 0 ? ` (실패 ${failed})` : ""}`,
      undo: { kind: "bulk", args: { items } },
    });
  }
  return { ok: true, n, amount, failed, skipped };
}
