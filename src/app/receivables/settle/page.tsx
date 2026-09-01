import Link from "@/lib/link";
import { isOwner, requireSession } from "@/lib/auth";
import { settlementBook, settleCandidates } from "@/lib/settlement-data";
import { kstToday } from "@/lib/ym";
import { StartForm } from "./start-form";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

/** 상태별 색 — 관리대장 한눈에 */
const TONE: Record<string, string> = {
  작성중: "bg-slate-100 text-slate-600",
  회신반영중: "bg-sky-100 text-sky-800",
  적용완료: "bg-violet-100 text-violet-800",
  입금완료: "bg-emerald-100 text-emerald-800",
};

/**
 * ⭐ 거래처 월 정산 관리대장 (사장님 요청 2026-09-01)
 *
 *   수기 「렌트카_거래처_청구입금_관리대장.xlsx」 를 앱이 대신한다 —
 *   거래처×월 한 줄: 청구액 / 합의액 / 입금액 / 미수 / 상태.
 */
export default async function SettleIndexPage() {
  await requireSession();
  const owner = await isOwner();
  if (!owner) {
    return (
      <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
        <p className="mt-6 rounded-xl bg-slate-100 p-6 text-center text-sm text-slate-600">
          월 정산은 사장님 계정 전용입니다.
        </p>
      </main>
    );
  }

  const runs = await settlementBook();
  const candidates = await settleCandidates();
  // 기본 달 = 지난달 — 월초에 지난달 내역을 정산하는 업무라서
  const today = kstToday();
  const prev = new Date(Date.parse(`${today.slice(0, 7)}-01`) - 86400000).toISOString().slice(0, 7);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6 lg:max-w-4xl">
      <Link href="/receivables" className="text-sm text-slate-500 underline underline-offset-4">
        ← 외상 장부
      </Link>
      <h1 className="mt-3 text-xl font-bold">거래처 월 정산</h1>
      <p className="mt-1 text-sm text-slate-600">
        청구서 내보내기 → 회신 반영 → 한꺼번에 적용 → 입금까지, 거래처×달 단위로.
      </p>

      <StartForm candidates={candidates} defaultYm={prev} />

      {runs.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          아직 정산 회차가 없습니다 — 위에서 거래처와 달을 골라 시작해 보세요.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {runs.map((r) => (
            <li key={r.id}>
              <Link
                href={`/receivables/settle/${encodeURIComponent(r.supplierName)}?ym=${r.ym}`}
                className="block rounded-2xl border border-slate-200 bg-white p-3 active:bg-slate-50"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold">
                    {r.supplierName} <span className="tabular text-sm text-slate-500">{r.ym}</span>
                  </span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${TONE[r.status] ?? TONE.작성중}`}>
                    {r.status}
                  </span>
                </div>
                <div className="tabular mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  <span>{r.lineCount}건</span>
                  {r.invoicedAmount != null && <span>청구 {won(r.invoicedAmount)}원</span>}
                  {r.agreedAmount != null && <span>합의 {won(r.agreedAmount)}원</span>}
                  {r.depositedAmount != null && (
                    <span className="text-emerald-700">
                      입금 {won(r.depositedAmount)}원{r.depositedOn ? ` (${r.depositedOn.slice(5)})` : ""}
                    </span>
                  )}
                  {r.remain > 0 && <span className="font-semibold text-amber-800">미수 {won(r.remain)}원</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
