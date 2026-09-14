import { sql } from "drizzle-orm";

/**
 * 타이어 규격 글자 조립 (SQL) — 상품 행 별칭 `p` 기준.
 * 편평비 80 은 생략한다(145R13, 사장님 지시 2026-08-08). sale-history 와 같은 식.
 * 재고 리포트 · 차량 리포트가 같이 쓴다 (2026-09-14 reports/stock 에서 옮김).
 */
export const SPEC_SQL = sql`
  CASE WHEN p.width IS NOT NULL AND p.rim_inch IS NOT NULL THEN
    p.width::text || COALESCE('/' || NULLIF(p.aspect_ratio, 80)::text, '')
      || 'R' || regexp_replace(p.rim_inch::text, '\.0$', '')
  END`;
