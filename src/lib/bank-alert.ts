/**
 * ⭐ 폰 은행 알림 → 통장 줄 「속보」 (2026-11-17, D-41)
 *
 *   intake.ts 가 부른다. 해석은 bank-alert-pure.ts.
 *
 *   ① 계좌표(「입금(1210)」의 1210)를 계정 이름에 잇는다 — 환경 변수 BANK_ALERT_ACCOUNTS="1210=신한입금;…"
 *      🔴 모르는 계좌표는 넣지 않는다(엉뚱한 통장에 섞이면 대조가 틀어진다) → intake_log 에 「보관」.
 *   ② 같은 거래가 이미 **통장 파일 줄**로 있으면 넣지 않는다(파일이 먼저 온 경우).
 *   ③ 날마다 fin_upload 한 장(「폰 알림 YYYY-MM-DD」)에 묶는다 — 기존 「올린 자료 취소」로 하루치를 되돌릴 수 있다.
 *   ④ 줄은 cash_txn(source '통장')에 dedup_key 「알림|…」로 들어간다. 통장 파일이 올라오면
 *      fin-ingest.ingestCashTxns 가 이 줄을 파일 내용으로 **확정**한다(새 줄을 더 만들지 않는다).
 *
 * 🔴 질의는 순차 (커넥션 max 3).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { applyAutoCategories } from "./expense-core";
import { alertDedupKey, matchAlertToStatement, parseAccountMap, parseBankAlert, type CashLineLite } from "./bank-alert-pure";

export type BankAlertOutcome =
  | { status: "반영"; cashTxnId: number; label: string; result: string }
  | { status: "중복"; result: string; cashTxnId?: number }
  | { status: "보관" | "해석불가"; result: string };

export async function ingestBankAlertText(text: string, now: Date = new Date()): Promise<BankAlertOutcome> {
  const a = parseBankAlert(text, now);
  if (!a) return { status: "해석불가", result: "입출금 알림 형식이 아닙니다" };

  const accounts = parseAccountMap(process.env.BANK_ALERT_ACCOUNTS);
  const label = (a.accountTag && accounts.get(a.accountTag)) || (accounts.size === 0 ? null : accounts.get("*") ?? null);
  const money = `${a.direction} ${a.amount.toLocaleString()}원 ${a.occurredAt.slice(5, 16)}`;
  if (!label) {
    return {
      status: "보관",
      result: `${money} — 계좌표 ${a.accountTag ?? "(없음)"} 를 어느 통장인지 모릅니다. BANK_ALERT_ACCOUNTS 에 「${a.accountTag ?? "*"}=계정이름」을 더해 주세요`,
    };
  }

  const inAmt = a.direction === "입금" ? a.amount : 0;
  const outAmt = a.direction === "출금" ? a.amount : 0;

  // ② 통장 파일 줄이 이미 있으면 그쪽이 정본
  const fileRows = await db.execute<{ id: number; at: string; in_amount: number; out_amount: number; balance: number | null }>(sql`
    SELECT id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') at, in_amount, out_amount, balance
    FROM cash_txn
    WHERE is_active AND source = '통장' AND account_label = ${label}
      AND dedup_key NOT LIKE '알림|%'
      AND in_amount = ${inAmt} AND out_amount = ${outAmt}
      AND occurred_at BETWEEN (${a.occurredAt}::timestamp - interval '1 day') AT TIME ZONE 'Asia/Seoul'
                          AND (${a.occurredAt}::timestamp + interval '1 day') AT TIME ZONE 'Asia/Seoul'
    LIMIT 20
  `);
  const asLite: CashLineLite = { id: 0, occurredAt: a.occurredAt, inAmount: inAmt, outAmount: outAmt, balance: a.balance };
  const already = matchAlertToStatement(
    asLite,
    fileRows.map((r) => ({ id: Number(r.id), occurredAt: r.at, inAmount: r.in_amount, outAmount: r.out_amount, balance: r.balance == null ? null : Number(r.balance) })),
    new Set(),
  );
  if (already != null) return { status: "중복", cashTxnId: already, result: `${money} — 통장 파일에 이미 있는 거래` };

  // ③ 오늘 치 알림 묶음
  const day = a.occurredAt.slice(0, 10);
  const fileName = `폰 알림 ${day}`;
  const [found] = await db.execute<{ id: number }>(sql`
    SELECT id FROM fin_upload WHERE source = '통장' AND account_label = ${label} AND file_name = ${fileName} AND status = '반영'
    ORDER BY id LIMIT 1
  `);
  let uploadId = found ? Number(found.id) : 0;
  if (!uploadId) {
    const [up] = await db.execute<{ id: number }>(sql`
      INSERT INTO fin_upload (source, account_label, file_name, raw_text, row_count, period_from, period_to)
      VALUES ('통장', ${label}, ${fileName}, '', 0, ${day}::date, ${day}::date)
      RETURNING id
    `);
    uploadId = Number(up.id);
  }

  // ④ 줄 넣기 — 같은 알림이 두 번 와도 dedup_key 로 한 줄
  const desc = `[알림] ${a.counterparty ?? a.direction}`;
  const key = alertDedupKey(label, a);
  const ins = await db.execute<{ id: number }>(sql`
    INSERT INTO cash_txn (source, account_label, occurred_at, description, in_amount, out_amount, balance, dedup_key, upload_id, memo)
    VALUES ('통장', ${label}, ${a.occurredAt + "+09"}::timestamptz, ${desc}, ${inAmt}, ${outAmt}, ${a.balance},
            ${key}, ${uploadId}, '폰 알림 — 통장 파일이 올라오면 확정됩니다')
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING id
  `);
  if (ins.length === 0) {
    const [old] = await db.execute<{ id: number }>(sql`SELECT id FROM cash_txn WHERE dedup_key = ${key}`);
    return { status: "중복", cashTxnId: old ? Number(old.id) : undefined, result: `${money} — 이미 받은 알림` };
  }
  const id = Number(ins[0].id);
  await db.execute(sql`
    UPDATE fin_upload SET row_count = row_count + 1, new_count = new_count + 1 WHERE id = ${uploadId}
  `);
  await applyAutoCategories({ uploadId }, null);
  return {
    status: "반영",
    cashTxnId: id,
    label,
    result: `${label} ${money}${a.counterparty ? ` ${a.direction === "입금" ? "←" : "→"} ${a.counterparty}` : ""}${a.balance != null ? ` · 잔액 ${a.balance.toLocaleString()}원` : " · 잔액 없음(잘린 알림)"}`,
  };
}
