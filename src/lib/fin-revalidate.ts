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
] as const;

export function revalidateFinance(): void {
  for (const p of PATHS) revalidatePath(p);
  revalidatePath("/finance/party/[key]", "page");
}
