/**
 * ⭐ 지출 분류 상수 (ERP ⑥, 2026-08-25)
 *
 * 🔴 이 파일은 **순수 상수** — DB 를 건드리지 않는다. 화면(클라이언트)과 서버가
 *    같이 쓰므로 recon-data(DB 포함)에 두면 postgres 가 브라우저 번들에 끌려
 *    들어가 빌드가 깨진다 (2026-08-25 실사고 — 그래서 분리했다).
 */

/** 지출 분류 목록 — 화면 칩·검증·손익이 같은 목록을 쓴다 */
export const EXPENSE_CATS = [
  "매입대금",
  "카드대금",
  "내부이체",
  "주주거래",
  "지역화폐정산",
  "임차료",
  "인건비",
  "공과금",
  "세금·보험",
  "수수료",
  "기타경비",
] as const;

/** 손익의 「쓴 돈」에 들어가는 분류 — 매입대금·카드대금·내부이체·주주거래는 제외
 *  (주주거래 = 조준호·이현숙 등 내부 관계자와의 입출금 — 매출도 경비도 아니다) */
export const EXPENSE_IN_PL = ["임차료", "인건비", "공과금", "세금·보험", "수수료", "기타경비"] as const;

/** 통장 「[적요] 내용」/카드 가맹점명 → 상대명 원문 (expense_rule 의 key) */
export const payerKeyOf = (source: string, description: string): string =>
  source === "통장" ? description.replace(/^\[[^\]]*\]\s*/, "").trim() : description.trim();

/** 카드 정산 입금 적요 패턴 — SQL 3곳(fin-ingest·recon-data·카드 대사)이 이 한 벌을 쓴다.
 *  🔴 감사 L1(2026-08-25): 세 곳에 복제돼 있던 것을 정본화 — 카드사 추가는 여기서만. */
export const CARD_SETTLE_PATTERN_SQL =
  "(description LIKE '%FB자금%' OR description LIKE '%매출표%' OR description ~ '\\] ?(KB|NH|하나|현|우|삼성|롯데|신한|비씨|BC|SHC)[0-9]')";
