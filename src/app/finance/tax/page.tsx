import { redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
import { FinShell } from "@/components/fin/shell";
import { pickYm } from "@/lib/ym";
import { taxBook } from "@/lib/tax-book";
import { TaxBookView } from "./tax-book-ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 세금계산서 (개편 2026-09-11 — 사장님 "세금계산서 정리하는 부분도 굉장히 불편")
 *
 *   뷰 둘(돈 확인·계산서 정리)을 하나로: 상대별 한 줄 → 펼치면 한 장 = 한 카드(누구 → 돈).
 *   매입·매출 한 화면(색으로만 구분). 데이터는 taxBook(ym) 정본 하나.
 *   🔴 옛 딥링크 호환: `view`·`direction` 파라미터는 받아도 무시한다 (인박스 링크 4종이 아직 이 주소를 쓴다).
 */
export default async function FinanceTaxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("finance"))) redirect("/"); // 권한 스위치 (2026-09-02)

  const sp = await searchParams;
  const ym = pickYm(sp.ym);
  const book = await taxBook(ym);

  return (
    <FinShell tab="tax" monthNav={{ ym, basePath: "/finance/tax" }}>
      <TaxBookView book={book} ym={ym} />
    </FinShell>
  );
}
