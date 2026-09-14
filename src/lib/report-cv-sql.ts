/**
 * ⭐ 손님·차량 리포트 공용 SQL 조각 (2026-09-14)
 *   report-customers.ts · report-vehicles.ts 가 같이 쓴다.
 */
import { sql, type SQL } from "drizzle-orm";
import { PLACEHOLDER_CUSTOMER_NAMES } from "./normalize";
import type { Bucket, Who } from "./report-cv-pure";

/** 실제 판 날 — 모든 리포트의 정본 식 (reports/page.tsx 와 같다) */
export const saleDate = (q: string): SQL =>
  sql.raw(`COALESCE(${q}.work_date, (${q}.created_at AT TIME ZONE 'Asia/Seoul')::date)`);

/** 개인/거래처 단추 → 판매 조건 */
export function whoSql(who: Who, q: string): SQL {
  if (who === "person") return sql.raw(`${q}.supplier_name IS NULL`);
  if (who === "biz") return sql.raw(`${q}.supplier_name IS NOT NULL`);
  return sql`TRUE`;
}

/**
 * 「누가 샀나」 열쇠 — 거래처 판매는 거래처 이름, 개인 판매는 고객 행.
 * 개인 판매 중 아래는 **한 사람이 아니므로** 뺀다 (realBuyerSql):
 *   · 고객 없음
 *   · 자리표시 이름 행(「고객」「관광객」…) — 서로 다른 손님 수백 건이 한 행에 모여 있다 (D-27)
 *   · 거래처 차고 고객(customer.supplier_name) — 사람 아닌 보관소
 */
export const buyerKeySql = (q: string): SQL =>
  sql.raw(`CASE WHEN ${q}.supplier_name IS NOT NULL THEN 's:' || ${q}.supplier_name ELSE 'c:' || ${q}.customer_id::text END`);

export function realBuyerSql(q: string, c: string): SQL {
  return sql`(${sql.raw(q)}.supplier_name IS NOT NULL OR (${sql.raw(q)}.customer_id IS NOT NULL
    AND ${sql.raw(c)}.supplier_name IS NULL
    AND trim(${sql.raw(c)}.name) NOT IN (${sql.join(PLACEHOLDER_CUSTOMER_NAMES.map((n) => sql`${n}`), sql`, `)})))`;
}

/** 구간마다 count(*) FILTER 한 칸씩 — 열 이름은 `${prefix}0`, `${prefix}1` … */
export function bucketCols(expr: SQL, buckets: Bucket[], prefix: string): SQL {
  return sql.join(
    buckets.map((b, i) => {
      const hi = b.hi === null ? sql`TRUE` : sql`${expr} < ${b.hi}`;
      return sql`count(*) FILTER (WHERE ${expr} >= ${b.lo} AND ${hi})::int ${sql.raw(`${prefix}${i}`)}`;
    }),
    sql`, `,
  );
}

/** bucketCols 결과 행 → 숫자 배열 */
export function bucketVals(row: Record<string, unknown> | undefined, buckets: Bucket[], prefix: string): number[] {
  return buckets.map((_, i) => Number(row?.[`${prefix}${i}`] ?? 0));
}
