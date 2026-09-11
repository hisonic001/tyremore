/**
 * ⭐ 지출·입금 자동 분류 정본 (2026-08-26) — 업로드 직후(fin-ingest)와 연간 실행기가 같은 한 벌을 쓴다.
 *
 *   ① expense_rule(배운 상대 → 분류) — 🔴 fin-ingest 의 손 복제 정규식(백슬래시 1개)은 통장 줄에 한 번도
 *      적용된 적이 없었다(2026-08-26 발견). PAYER_KEY_SQL 정본으로.
 *   ② 내부이체(우리 상호 ㈜싸이오토모티브) ③ 카드정산 패턴(입금) ④ 지역화폐정산(속초정산 입금)
 *   ⑤ 주주거래(조준호·이현숙 — 출금만; 입금은 동명 손님일 수 있어 자동 안 함)
 *
 * 🔴 "use server" 아님. 질의 순차.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { CARD_SETTLE_PATTERN_SQL, DESC_RULES, descRuleSql, payerKeyOf, payerKeySql } from "./expense-cats";
import { monthRange } from "./ym";
import { logActivity } from "./fin-activity";
import type { UndoItem } from "./fin-activity-types";

const won = (n: number) => n.toLocaleString("ko-KR");

export interface AutoCatResult {
  rule: number;
  internal: number;
  cardSettle: number;
  localPay: number;
  shareholder: number;
  /** 입금: 예금이자(기간 적요 「12.21~06.20」·이자) → 이자·지원금 */
  interest: number;
  /** 입금: 세무서 환급·카드사 환급 → 기타입금 */
  refund: number;
  /** ⭐ 적요 규칙표로 붙은 것 — 규칙 이름별 건수 (2026-08-27) */
  byDesc: { name: string; category: string; n: number }[];
  byDescTotal: number;
}

/** scope: 업로드 배치 하나 또는 달 하나. uid 는 기록(최근 한 일)의 actor 용 */
export async function applyAutoCategories(scope: { uploadId: number } | { ym: string }, uid: number | null = null): Promise<AutoCatResult> {
  let where: SQL;
  if ("uploadId" in scope) where = sql`c.upload_id = ${scope.uploadId}`;
  else {
    const { start, nextStart } = monthRange(scope.ym);
    where = sql`(c.occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date`;
  }
  const rule = await db.execute<{ id: number }>(sql`
    UPDATE cash_txn c SET category = r.category
    FROM expense_rule r
    WHERE ${where} AND c.is_active AND c.category IS NULL AND c.out_amount > 0
      AND r.key = (${sql.raw(payerKeySql("c."))})
    RETURNING c.id
  `);
  const internal = await db.execute<{ id: number }>(sql`
    UPDATE cash_txn c SET category = '내부이체'
    WHERE ${where} AND c.is_active AND c.category IS NULL AND c.source = '통장' AND c.description LIKE '%싸이오토모%'
    RETURNING c.id
  `);
  const cardSettle = await db.execute<{ id: number }>(sql`
    UPDATE cash_txn c SET category = '카드정산'
    WHERE ${where} AND c.is_active AND c.category IS NULL AND c.source = '통장' AND c.in_amount > 0
      AND ${sql.raw(CARD_SETTLE_PATTERN_SQL.replace(/\bdescription\b/g, "c.description"))}
    RETURNING c.id
  `);
  const localPay = await db.execute<{ id: number }>(sql`
    UPDATE cash_txn c SET category = '지역화폐정산'
    WHERE ${where} AND c.is_active AND c.category IS NULL AND c.source = '통장' AND c.in_amount > 0
      AND c.description LIKE '%속초정산%'
    RETURNING c.id
  `);
  const shareholder = await db.execute<{ id: number }>(sql`
    UPDATE cash_txn c SET category = '주주거래'
    WHERE ${where} AND c.is_active AND c.category IS NULL AND c.source = '통장' AND c.out_amount > 0
      AND (c.description LIKE '%조준호%' OR c.description LIKE '%이현숙%' OR c.description LIKE '%가수금%')
    RETURNING c.id
  `);

  /**
   * ⭐ 적요 규칙표 (사장님 지시 2026-08-27 — 전 기간 학습)
   *
   * 통장 적요의 **머리표**가 이미 분류를 알려주고 있었다 — `[유동CC]` 313건은 전부 내부이체,
   * `[BZ수수]` 43건은 전부 500원 이체 수수료, `[BZ공과]` 는 전부 국세·지방세…
   * 규칙과 그 근거는 `expense-cats.DESC_RULES` 한 곳에 있다.
   *
   * 🔴 **주주거래 다음에** 돈다 — 조준호·이현숙 급여가 「인건비」로 새면 안 된다.
   *    (규칙 조건 자체에도 제외를 못 박아 두었으니 순서가 바뀌어도 안전하다)
   * 🔴 이미 붙은 분류는 안 건드린다 (`category IS NULL`) — 사장님이 정한 것이 언제나 이긴다.
   */
  const byDesc: { name: string; category: string; n: number }[] = [];
  for (const r of DESC_RULES) {
    const src = r.source ? sql`AND c.source = ${r.source}` : sql``;
    const hit = await db.execute<{ id: number }>(sql`
      UPDATE cash_txn c SET category = ${r.category}
      WHERE ${where} AND c.is_active AND c.category IS NULL AND c.out_amount > 0 ${src}
        AND (${sql.raw(descRuleSql(r.cond, "c."))})
      RETURNING c.id
    `);
    if (hit.length > 0) byDesc.push({ name: r.name, category: r.category, n: hit.length });
  }
  /* 2025 진행(2026-08-27): 한 해 내내 열려 있던 잡음 — 예금이자(「[이자] 12.21~06.20」)·세무서 환급·카드사 환급 */
  const interest = await db.execute<{ id: number }>(sql`
    UPDATE cash_txn c SET category = '이자·지원금'
    WHERE ${where} AND c.is_active AND c.category IS NULL AND c.source = '통장' AND c.in_amount > 0
      AND (c.description ~ '\] *[0-9]{2}\.[0-9]{2}~[0-9]{2}\.[0-9]{2}' OR c.description LIKE '%예금이자%' OR c.description LIKE '%결산이자%' OR c.description LIKE '[이자]%')
    RETURNING c.id
  `);
  const refund = await db.execute<{ id: number }>(sql`
    UPDATE cash_txn c SET category = '기타입금'
    WHERE ${where} AND c.is_active AND c.category IS NULL AND c.source = '통장' AND c.in_amount > 0
      AND (c.description LIKE '%세무서%' OR c.description LIKE '%환급%')
    RETURNING c.id
  `);
  const out: AutoCatResult = {
    rule: rule.length, internal: internal.length, cardSettle: cardSettle.length, localPay: localPay.length,
    shareholder: shareholder.length, interest: interest.length, refund: refund.length,
    byDesc, byDescTotal: byDesc.reduce((s, d) => s + d.n, 0),
  };
  await logAutoCategories(scope, uid, out);
  return out;
}

/**
 * ⭐ 최근 한 일 — 자동 분류는 **한 줄 n건**(사장님 결정 d), label 에 규칙별 건수.
 *    건별 되돌리기 = setExpenseCategory(id, null, {scope:'one'}) — 🔴 그 줄의 상대 규칙(expense_rule)도 함께 지운다
 *    (기존 해제 함수의 동작 그대로 — 새 되돌리기 논리 없음, 결정 c). 0건이면 안 남긴다.
 *    붙은 줄을 한 번 더 읽는다(질의 1) — RETURNING 을 여덟 군데 고치는 것보다 낫다.
 */
async function logAutoCategories(scope: { uploadId: number } | { ym: string }, uid: number | null, r: AutoCatResult): Promise<void> {
  const total = r.rule + r.internal + r.cardSettle + r.localPay + r.shareholder + r.interest + r.refund + r.byDescTotal;
  if (total === 0) return;
  const where = "uploadId" in scope ? sql`c.upload_id = ${scope.uploadId}` : sql`false`;
  const rows =
    "uploadId" in scope
      ? await db.execute<{ id: number; source: string; description: string; amt: number; category: string; d: string }>(sql`
          SELECT c.id, c.source, c.description, (c.in_amount + c.out_amount)::bigint amt, c.category,
                 to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d
          FROM cash_txn c WHERE ${where} AND c.is_active AND c.category IS NOT NULL
          ORDER BY c.occurred_at LIMIT 1000
        `)
      : [];
  /* 달 범위 실행(연간 실행기)은 그 달의 「자동으로 붙은 줄」만 골라낼 열쇠가 없다(사장님이 붙인 것과 섞인다) —
     건별 items 없이 한 줄 n건만 남긴다. 업로드 배치는 그 배치 줄 전부가 이번에 붙은 것이라 items 를 넣는다 */
  const items: UndoItem[] = rows.map((x) => ({
    kind: "expense",
    args: { cashTxnId: Number(x.id), scope: "one" },
    label: `${x.d.slice(5)} ${payerKeyOf(x.source, x.description).slice(0, 20)} ${won(Number(x.amt))} → ${x.category}`,
    amount: Number(x.amt),
  }));
  const parts = [
    r.rule > 0 ? `배운 규칙 ${r.rule}` : "",
    r.internal > 0 ? `내부이체 ${r.internal}` : "",
    r.cardSettle > 0 ? `카드정산 ${r.cardSettle}` : "",
    r.localPay > 0 ? `지역화폐 ${r.localPay}` : "",
    r.shareholder > 0 ? `주주거래 ${r.shareholder}` : "",
    r.interest > 0 ? `이자 ${r.interest}` : "",
    r.refund > 0 ? `환급 ${r.refund}` : "",
    ...r.byDesc.map((d) => `${d.name} ${d.n}`),
  ].filter(Boolean);
  const ymOf = (): string | null => {
    if ("ym" in scope) return scope.ym;
    const n = new Map<string, number>();
    for (const x of rows) n.set(x.d.slice(0, 7), (n.get(x.d.slice(0, 7)) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  await logActivity({
    ym: ymOf(),
    actor: uid,
    how: "자동",
    verb: "분류",
    n: total,
    amount: items.length > 0 ? items.reduce((s, i) => s + (i.amount ?? 0), 0) : null,
    label: `자동 분류 ${total}건 (${parts.join(" · ")})`,
    undo: items.length > 0 ? { kind: "bulk", args: { items } } : null,
  });
}
