import { sql } from "drizzle-orm";

/**
 * ⭐ 마진 정의 정본 (사장님 지시 2026-09-04 — "품목별 마진 문제점 파악·해결")
 *
 * 이 매장의 판매 구조: 엔진오일 교환 같은 정비는 돈을 **공임 줄**로 받고,
 * 거기 쓴 필터·배터리는 **0원 판매 + 원가만 기록**(line_type='use')으로 남는다.
 *
 * 옛 정의(원가 기록된 줄만)는 그래서 거짓말을 했다 —
 *   공임 매출은 통째로 빠지고, 공임에 녹은 소모품 원가만 들어가
 *   2026-09 마진이 -298,904원(적자)으로 보였다. 실제는 +2,548,031원.
 *
 * 새 정의 (한 줄의 마진):
 *   · 원가를 아는 줄            → margin (판매가 − 원가)      ← 소모품은 0−원가 = 마이너스
 *   · 공임(service) 줄          → 매출 전액                  ← 물건 원가가 없다
 *   · 원가 모르는 물품 줄        → 계산에서 제외(NULL)         ← 모르는 건 모른다고 — 커버리지로 명시
 *
 * ⚠️ 이 마진에는 **인건비가 없고, 엔진오일 원가도 아직 없다**(오일 리터 기입을
 *    안 하므로 — 사장님 확인 2026-09-04). 화면 각주에 반드시 명시할 것.
 *
 * 🔴 쓰는 쪽 규칙: quote_item 을 **qi** 로 별칭해야 한다. 마진율 분모는
 *    marginBaseSql (같은 포함 범위의 매출) — 다른 분모를 새로 만들지 말 것.
 */
export const marginSql = sql`CASE
  WHEN qi.purchase_cost IS NOT NULL THEN qi.margin
  WHEN qi.line_type = 'service' THEN qi.final_price * qi.qty
  ELSE NULL END`;

/** 마진율 분모 — 마진에 포함된 줄(원가 아는 물품 + 공임)의 매출 */
export const marginBaseSql = sql`CASE
  WHEN qi.purchase_cost IS NOT NULL OR qi.line_type = 'service' THEN qi.final_price * qi.qty
  ELSE NULL END`;
