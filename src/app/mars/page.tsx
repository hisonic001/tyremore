import { redirect } from "next/navigation";

/**
 * 🔴 MARS 입력 대기열 페이지는 없앴다 (사장님 지시 2026-08-09).
 *
 *   "판매 등록시에 MARS 입력 대기열 화면으로도 판매내역이 넘어가는데
 *    MARS 입력 대기열 페이지 자체를 삭제."
 *
 * 이제 MARS 올리기는 **정비 내역(/sales)** 에서 카드를 체크해서 한다.
 * 북마크·습관으로 들어온 사람을 위해 주소만 남겨 넘겨보낸다.
 */
export default function MarsPage() {
  redirect("/sales");
}
