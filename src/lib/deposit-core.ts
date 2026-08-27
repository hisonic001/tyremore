/**
 * ⭐ 입금 정리 코어 (2026-08-26) — 화면(fin-deposits 서버 액션)과 연간 실행기가 같은 함수를 쓴다.
 * 🔴 "use server" 아님. 권한 검사 없음 — 부르는 쪽이 책임진다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { CARD_SETTLE_PATTERN_SQL, payerKeyOf } from "./expense-cats";
import { monthRange } from "./ym";
import { cashUsedSql, normName } from "./recon-data";

/** ⭐ 이름 별명 학습 (사장님 요청 2026-08-24) — 한 번 이어준 입금자명은 다음부터 바로 알아본다 */
export async function learnAlias(aliasRaw: string, partyKey: string, partyLabel: string): Promise<void> {
  const key = normName(aliasRaw);
  if (key.length < 2) return;
  try {
    await db.execute(sql`
      INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
      VALUES (${key}, ${aliasRaw}, ${partyKey}, ${partyLabel})
      ON CONFLICT (alias_key) DO UPDATE SET party_key = EXCLUDED.party_key,
        party_label = EXCLUDED.party_label, updated_at = now()
    `);
  } catch {
    // 학습 실패는 본 동작을 막지 않는다
  }
}

/* 🔴 2026 감사 G1: 입금 줄은 **남은 금액**(소진량 정본 cashUsedSql 을 뺀 값)으로 다룬다 */
export async function getDeposit(id: number) {
  const [d] = await db.execute<{
    id: number; in_amount: number; remain: number; recon_status: string; date: string; l: string; description: string;
  }>(sql`
    SELECT c.id, c.in_amount, (c.in_amount - ${cashUsedSql("c")})::bigint remain, c.recon_status,
           to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           c.account_label l, c.description
    FROM cash_txn c WHERE c.id = ${id} AND c.source = '통장' AND c.is_active AND c.in_amount > 0
  `);
  return d ? { ...d, in_amount: Number(d.in_amount), remain: Number(d.remain) } : null;
}

/** 이 달의 카드 정산 패턴 입금(FB자금·매출표·카드사 코드)을 한꺼번에 「카드 정산」으로 */
export async function markCardSettlementsCore(ym: string): Promise<number> {
  const { start, nextStart } = monthRange(ym);
  const rows = await db.execute<{ id: number }>(sql`
    UPDATE cash_txn SET recon_status = '확정', category = '카드정산'
    WHERE source = '통장' AND is_active AND in_amount > 0 AND recon_status = '미대조' AND category IS NULL
      AND ${sql.raw(CARD_SETTLE_PATTERN_SQL)}
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
    RETURNING id
  `);
  return rows.length;
}

/** 입금 한 건 ↔ 판매 한 건 (부분 연결 가능 — 나눠 받은 판매). 잇는 순간 입금자명을 배운다 */
export async function linkDepositToQuoteCore(
  cashTxnId: number,
  quoteId: number,
  uid: number | null,
  method: "수동" | "자동" = "수동",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dep = await getDeposit(cashTxnId);
  if (!dep) return { ok: false, error: "입금 줄을 찾을 수 없습니다" };
  if (dep.recon_status === "확정") return { ok: false, error: "이미 정리된 입금입니다" };
  if (dep.remain <= 0) return { ok: false, error: "이 입금은 남은 금액이 없습니다 — 계산서 확인이 이미 썼습니다" };
  const [q] = await db.execute<{ id: number; total: number; linked: string }>(sql`
    SELECT q.id, q.total_amount total,
           COALESCE((SELECT SUM(m.amount) FROM recon_match m WHERE m.kind = '이체입금' AND m.ref_table = 'quote' AND m.ref_id = q.id AND m.status = '확정'), 0)::bigint linked
    FROM quote q WHERE q.id = ${quoteId} AND q.status = '성사'
  `);
  if (!q) return { ok: false, error: "판매를 찾을 수 없습니다" };
  const remainQ = Number(q.total) - Number(q.linked);
  if (remainQ <= 0) return { ok: false, error: "그 판매는 이미 금액이 다 이어져 있습니다" };
  const linkAmt = Math.min(dep.remain, remainQ);
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
      VALUES ('이체입금', 'cash_txn', ${cashTxnId}, 'quote', ${quoteId}, ${linkAmt}, '확정', ${method}, ${uid}, now())
    `);
    await tx.execute(sql`
      UPDATE cash_txn SET recon_status = ${linkAmt === dep.remain ? "확정" : "제안"},
             category = CASE WHEN category = '판매입금' THEN NULL ELSE category END
      WHERE id = ${cashTxnId}
    `);
  });
  const [qp] = await db.execute<{ supplier_name: string | null; customer_id: number | null; cname: string | null }>(sql`
    SELECT q.supplier_name, q.customer_id, c.name cname
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id WHERE q.id = ${quoteId}
  `);
  const payer = payerKeyOf("통장", dep.description);
  if (qp?.supplier_name) await learnAlias(payer, `S:${qp.supplier_name}`, `거래처 ${qp.supplier_name}`);
  else if (qp?.customer_id) await learnAlias(payer, `C:${qp.customer_id}`, qp.cname ?? `고객 ${qp.customer_id}`);
  return { ok: true };
}

export async function linkDepositsToQuoteCore(
  quoteId: number,
  cashTxnIds: number[],
  uid: number | null,
  method: "수동" | "자동" = "수동",
): Promise<{ ok: true; applied: number } | { ok: false; error: string }> {
  const ids = [...new Set((cashTxnIds ?? []).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 8);
  if (ids.length === 0) return { ok: false, error: "이을 입금을 골라 주세요" };
  let applied = 0;
  for (const id of ids) {
    const r = await linkDepositToQuoteCore(id, quoteId, uid, method);
    if (!r.ok) return applied === 0 ? r : { ok: false, error: `${applied}줄까지 이었고 그다음에서 멈췄습니다 — ${r.error}` };
    applied++;
  }
  return { ok: true, applied };
}
