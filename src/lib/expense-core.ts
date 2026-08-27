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
import { CARD_SETTLE_PATTERN_SQL, PAYER_KEY_SQL } from "./expense-cats";
import { monthRange } from "./ym";

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
}

/** scope: 업로드 배치 하나 또는 달 하나 */
export async function applyAutoCategories(scope: { uploadId: number } | { ym: string }): Promise<AutoCatResult> {
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
      AND r.key = (${sql.raw(PAYER_KEY_SQL.replace(/\bsource\b/g, "c.source").replace(/\bdescription\b/g, "c.description"))})
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
  return {
    rule: rule.length, internal: internal.length, cardSettle: cardSettle.length, localPay: localPay.length,
    shareholder: shareholder.length, interest: interest.length, refund: refund.length,
  };
}
