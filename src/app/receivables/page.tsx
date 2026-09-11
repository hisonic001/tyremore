import Link from "@/lib/link";
import { requirePerm } from "@/lib/auth";
import { receivableBook } from "@/lib/receivable-book";
import { W } from "@/lib/fin-words";
import { BookFilter } from "./filter";
import { BookList } from "./client";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * ⭐ 미수금 장부 (사장님 지시 2026-08-17 · 이름 「외상 장부」→「미수금 장부」 2026-09-12 ERP 용어)
 *
 *   "거래처의 경우는 외상이 많은데 거래처별로 내역을 확인하고 한번에 외상을
 *    떨어버릴 수 있는 방법(한꺼번에 입금하는 경우도 있음)도 필요함"
 *
 * 정비 내역과 따로 둔 이유: 거기는 기간 필터·MARS 올리기 판이 붙은 「지나간 정비」
 * 화면이다. 여기는 「미수금」 하나만 본다.
 *
 * 개인 손님 미수금도 함께 보여 준다 (사장님 결정) — 미수금을 한 화면에서.
 * 🔴 결제수단 값 '외상'(pay=외상 등)은 DB 값이라 그대로 — 바꾸는 건 화면 글자뿐.
 */
export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; settled?: string }>;
}) {
  await requirePerm("receivable_view"); // 외상 보기 권한 (2026-09-02)
  /* 2026-09-02 사장님 지시: 외상 보기와 수금을 한 스위치로 —
     이 페이지에 들어왔다 = 외상 권한이 있다 = 수금 버튼도 보인다. */
  const owner = true;
  const sp = await searchParams;
  const kind = sp.kind === "supplier" || sp.kind === "customer" ? sp.kind : undefined;
  const includeSettled = sp.settled === "1";

  const book = await receivableBook({ kind, includeSettled });

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6 lg:max-w-4xl">
      <Link href="/sales" className="text-sm text-slate-500 underline underline-offset-4">
        ← 정비 내역
      </Link>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">{W.receivable} 장부</h1>
        {owner && (
          <Link
            href="/receivables/settle"
            className="shrink-0 rounded-control border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700"
          >
            거래처 월 정산 →
          </Link>
        )}
      </div>
      <p className="tabular mt-1 text-sm text-slate-600">
        {W.receivable} <strong>{book.totalCount}건</strong> · 잔액{" "}
        <strong className="text-amber-800">{won(book.totalRemain)}원</strong> · {book.targets.length}곳
      </p>
      {/* ⭐ 예약 잔금은 「미수금」이 아니라 아직 받을 때가 안 된 돈 (2026-09-10) —
          위 잔액에 포함돼 있으니 갈라서 보여 준다. 독촉 대상이 아니다 */}
      {book.reserveCount > 0 && (
        <p className="tabular mt-1 text-sm text-violet-800">
          그중 📌 예약 잔금 <strong>{book.reserveCount}건 · {won(book.reserveRemain)}원</strong> — 시공 때 받는 잔금
          {" · "}{W.receivable}(예약 잔금 제외)은 <strong>{won(book.totalRemain - book.reserveRemain)}원</strong>
        </p>
      )}

      <BookFilter kind={kind ?? null} includeSettled={includeSettled} />

      {book.detailCapped > 0 && (
        <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
          건별 목록은 {book.detailCapped}건을 못 실었습니다 — 위 필터로 좁혀 보세요.
        </p>
      )}

      {book.targets.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          {W.receivable}이 없습니다 👍
        </p>
      ) : (
        <BookList targets={book.targets} owner={owner} />
      )}

      {!owner && (
        <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
          수금 넣기·털기는 <strong>사장님 계정</strong>에서만 됩니다 — 여기서는 {W.receivable}을 보기만 합니다.
        </p>
      )}
      <p className="mt-8 text-xs leading-relaxed text-slate-400">
        거래처를 펼쳐 받은 건들을 체크하고 「한꺼번에 털기」를 누르면 한 번에 수금됩니다. 받은 금액이
        고른 건들의 합보다 적으면 <strong>오래된 건부터</strong> 채웁니다 — 마지막 한 건만 잔액이
        남습니다. 완납돼도 결제수단은 「외상」 그대로입니다(그렇게 판 것이 사실이니) — 단 📌 예약 건은
        잔금까지 받으면 앱이 알아서 보통 결제로 정리합니다(예약금·잔금이 각각 받은 날로 남습니다).
      </p>
    </main>
  );
}
