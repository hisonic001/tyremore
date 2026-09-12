/**
 * ⭐ ⑤ 계산서 대조 — 「이번 주 정리」 단계 (개편 3단계, 2026-09-12)
 *
 *   어댑터 없음 — taxBook(ym) 이 이미 3층(autoDone·confirmIds·counts.hand)이라 계산서 화면을
 *   통째로 쓰고 머리만 숨긴다(flow). 확인 층은 tax-book-ui 의 ConfirmLayer(= CheckRunList).
 */
import { taxBook } from "@/lib/tax-book";
import { TaxBookView } from "@/app/finance/tax/tax-book-ui";

export async function TaxStep({ ym }: { ym: string }) {
  const book = await taxBook(ym);
  return <TaxBookView book={book} ym={ym} flow />;
}
