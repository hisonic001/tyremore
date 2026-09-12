/**
 * ⭐ ⑦ 지난달 마감 — 흐름의 마지막 단계 (개편 3단계, 2026-09-12; 사장님 결정 15)
 *
 *   달이 바뀐 뒤 첫 정리에서 「지난달 마감」. 체크리스트는 장부 첫 화면과 **같은 함수**(closeChecklist —
 *   이제 weeklySteps 한 벌에서 나온다, weekly-close.ts). 마감 버튼 조건도 장부와 같다: 지난 달이고
 *   참고(ⓘ) 빼고 전부 ✓. 마감 뒤 고치면 「최근 한 일」에 남고 마감 때 숫자와의 차이를 보여 준다(2단계).
 *   「이번 주 정리 끝 ✓」 단추는 page.tsx 가 이 아래에 붙인다.
 */
import Link from "@/lib/link";
import { closeChecklist, closeMonthForm, monthCloseStatus } from "@/lib/month-close";
import { finHealth } from "@/lib/fin-health";
import { kstToday, ymAdd } from "@/lib/ym";
import { won } from "@/components/fin/money";
import { W } from "@/lib/fin-words";

export async function CloseStep() {
  const today = kstToday();
  const thisYm = today.slice(0, 7);
  const prevYm = ymAdd(thisYm, -1); // weekly-steps.ts 와 같은 식
  const label = `${Number(prevYm.slice(5, 7))}월`;
  const mc = await monthCloseStatus(prevYm);

  if (mc.closed) {
    return (
      <section className="mt-4 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
        ✅ {label} 마감됨 ({mc.closedAt})
        {mc.profit !== null && mc.dataComplete ? (
          <>
            {" "}— {W.profit} <strong className="tabular">{won(mc.profit)}원</strong>
          </>
        ) : null}
        <Link href={`/finance/ledger?ym=${prevYm}`} className="ml-2 underline underline-offset-2">
          장부에서 보기 →
        </Link>
      </section>
    );
  }

  const health = await finHealth();
  const checks = await closeChecklist(prevYm, health.allOk);
  const ready = checks.length > 0 && checks.filter((c) => !c.soft).every((c) => c.ok);
  const due = Number(today.slice(8, 10)) <= 10;

  return (
    <section className="mt-4">
      <p className="text-sm text-slate-600">
        {label} 마감 조건 — 참고(ⓘ) 빼고 전부 ✓면 마감할 수 있습니다.
        {!due && <span className="ml-1 text-slate-400">(달 초 1~10일에 하는 일이지만 지금 해도 됩니다)</span>}
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {checks.map((c) => (
          <li key={c.key}>
            {c.ok ? (
              <span className="text-emerald-700">✓ {c.text}</span>
            ) : (
              <Link href={c.href} className={`underline underline-offset-2 ${c.soft ? "text-slate-500" : "text-amber-700"}`}>
                {c.soft ? "ⓘ" : "⚠"} {c.text} →{c.soft && <span className="text-slate-400"> (참고)</span>}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {ready ? (
        <form action={closeMonthForm.bind(null, prevYm)} className="mt-3">
          <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            {label} 마감하기
          </button>
        </form>
      ) : (
        <p className="mt-2 text-xs text-slate-400">⚠ 항목을 먼저 정리하면 마감 버튼이 나옵니다 — 위 단계로 돌아가 처리하세요.</p>
      )}
    </section>
  );
}
