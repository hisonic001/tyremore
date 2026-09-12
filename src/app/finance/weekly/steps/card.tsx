/**
 * ⭐ ② 카드 마감 — 얇은 단계 (개편 3단계, 2026-09-12; 사장님: 7단계 그대로)
 *
 *   카드 일마감은 매일 저녁 하는 일(결정 12)이라 흐름 안에서 POS 대조까지 하지 않는다(그건 4단계
 *   「카드 마감 인라인」). 여기는 **안 된 날 목록 → 그날 카드 마감 화면**으로 보내는 것까지.
 *   조회는 posDaysSummary 한 번(한 달치 집계 SQL) — 날마다 posDayData 를 부르면 안 된다(pos-close.ts 머리말).
 */
import Link from "@/lib/link";
import { posDaysSummary } from "@/lib/pos-close";
import { won } from "@/components/fin/money";
import { kstToday } from "@/lib/ym";

export async function CardStep({ ym, status }: { ym: string; status: string }) {
  const days = await posDaysSummary(ym);
  const today = kstToday();
  const open = days.filter((d) => !d.closed).sort((a, b) => (a.day === today ? -1 : b.day === today ? 1 : a.day < b.day ? -1 : 1));
  return (
    <section className="mt-4">
      <p className="text-sm text-slate-600">{status}</p>
      {open.length === 0 ? (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">이 달 카드 마감 다 됨 ✓</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {open.map((d) => (
            <li key={d.day} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="tabular">
                <strong>{d.day.slice(5)}</strong>
                {d.day === today && <span className="ml-1 text-xs text-brand-700">오늘</span>}
                <span className="ml-2 text-slate-500">
                  POS {won(d.posCard)} · 앱 {won(d.appCard)}
                  {d.posCard !== d.appCard && <span className="ml-1 text-amber-700">({d.posCard - d.appCard > 0 ? "+" : ""}{won(d.posCard - d.appCard)})</span>}
                </span>
                {d.open > 0 && <span className="ml-2 text-amber-800">남은 {d.open}건</span>}
              </span>
              <Link href={`/finance/card?ym=${ym}&d=${d.day}`} className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
                마감하러 →
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-slate-400">그날 화면에서 대조·마감을 마치고 「이번 주 정리」 탭으로 돌아오면 됩니다.</p>
    </section>
  );
}
