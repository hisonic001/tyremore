/**
 * 돈 관리 화면 일괄 갱신 (2026 감사 N9, 2026-08-26)
 *
 *   계산서·입금·지급 연결은 현황 할 일 수·원장·지출 분류까지 바꾸는데 쓰기 액션 대부분이
 *   자기 화면만 revalidate 했다. 쓰기 뒤엔 이 하나를 부른다.
 */
import { revalidatePath } from "next/cache";

const PATHS = [
  "/finance",
  "/finance/tax",
  "/finance/deposits",
  "/finance/expenses",
  "/finance/payables",
  "/finance/party",
  "/finance/card",
  /** ⭐ 「이번 주 정리」 흐름 (개편 3단계, 2026-09-12) — 단계 안에서 쓴 액션이 같은 화면을 새로 그린다 */
  "/finance/weekly",
  /** ⭐ 5단계(2026-09-13) — 장부(마감 체크리스트·정합성 한 줄)·최근 한 일도 쓰기마다 바뀐다. 목록을 진실로 */
  "/finance/ledger",
  "/finance/activity",
  "/sales",
] as const;

export function revalidateFinance(): void {
  for (const p of PATHS) revalidatePath(p);
  revalidatePath("/finance/party/[key]", "page");
}
