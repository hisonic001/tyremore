import Link from "@/lib/link";
import { isOwner, requireSession } from "@/lib/auth";
import { receivableBook } from "@/lib/receivable-book";
import { BookFilter } from "./filter";
import { BookList } from "./client";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * ⭐ 외상 장부 (사장님 지시 2026-08-17)
 *
 *   "거래처의 경우는 외상이 많은데 거래처별로 내역을 확인하고 한번에 외상을
 *    떨어버릴 수 있는 방법(한꺼번에 입금하는 경우도 있음)도 필요함"
 *
 * 정비 내역과 따로 둔 이유: 거기는 기간 필터·MARS 올리기 판이 붙은 「지나간 정비」
 * 화면이다. 여기는 「못 받은 돈」 하나만 본다.
 *
 * 개인 손님 외상도 함께 보여 준다 (사장님 결정) — 못 받은 돈을 한 화면에서.
 */
export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; settled?: string }>;
}) {
  await requireSession();
  /* 🔴 2회차 수리 E1(2026-08-28): 수금은 사장님 전용이 됐다 — 직원에게는 보기만.
     버튼을 남겨 두면 눌렀을 때 오류만 나서 더 답답하다. */
  const owner = await isOwner();
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
        <h1 className="text-xl font-bold">외상 장부</h1>
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
        못 받은 외상 <strong>{book.totalCount}건</strong> · 잔액{" "}
        <strong className="text-amber-800">{won(book.totalRemain)}원</strong> · {book.targets.length}곳
      </p>

      <BookFilter kind={kind ?? null} includeSettled={includeSettled} />

      {book.detailCapped > 0 && (
        <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
          건별 목록은 {book.detailCapped}건을 못 실었습니다 — 위 필터로 좁혀 보세요.
        </p>
      )}

      {book.targets.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          못 받은 외상이 없습니다 👍
        </p>
      ) : (
        <BookList targets={book.targets} owner={owner} />
      )}

      {!owner && (
        <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
          수금 넣기·털기는 <strong>사장님 계정</strong>에서만 됩니다 — 여기서는 못 받은 돈을 보기만 합니다.
        </p>
      )}
      <p className="mt-8 text-xs leading-relaxed text-slate-400">
        거래처를 펼쳐 받은 건들을 체크하고 「한꺼번에 털기」를 누르면 한 번에 수금됩니다. 받은 금액이
        고른 건들의 합보다 적으면 <strong>오래된 건부터</strong> 채웁니다 — 마지막 한 건만 잔액이
        남습니다. 완납돼도 결제수단은 「외상」 그대로입니다(그렇게 판 것이 사실이니).
      </p>
    </main>
  );
}
