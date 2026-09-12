/**
 * ⭐ 「N월 자료, 어디까지 올라왔나」 칩 격자 (개편 3단계, 2026-09-12)
 *
 *   upload/page.tsx 에 인라인이던 칩(원천별 마지막 자료 날짜 · 빈 곳 ⚠)을 부품으로 —
 *   올리기·올린 자료·「이번 주 정리」① 세 곳이 같은 것을 그린다. 판정은 정본 coverageStatus 하나.
 *   서버 컴포넌트(훅 없음) — 클라이언트에서 불러도 된다.
 *
 * 🔴 기존 두 화면은 픽셀 동일이 목표 — 머리·꼬리 문구가 서로 달라(아직입니다/비었습니다, ⚠/⚠ 비었음)
 *    heading·foot·lagMark 로 끄고 켠다. 기본값은 올리기 화면 것.
 */
import type { CoverageRow, CoverageStatus } from "@/lib/upload-coverage";

export function CoverageGrid({
  rows,
  status,
  heading = true,
  foot = true,
  lagMark = " ⚠",
}: {
  rows: CoverageRow[];
  status: CoverageStatus;
  /** 「N월 자료, 어디까지 올라왔나 — …」 머리 (올린 자료 화면은 SectionCard 제목으로 직접 그린다) */
  heading?: boolean;
  /** 「기준일 … 3일 전까지 안 온 자료에 ⚠ …」 꼬리 */
  foot?: boolean;
  /** 빈 원천 칩 끝에 붙는 표시 */
  lagMark?: string;
}) {
  const lag = new Set(status.lagging.map((r) => r.key));
  /* 기준일(endShown)은 보는 달 안의 날짜(이 달이면 오늘, 지난 달이면 말일)라 달 표시는 여기서 읽는다 */
  const m = Number(status.endShown.slice(5, 7));
  return (
    <>
      {heading && (
        <h2 className="font-semibold">
          {m}월 자료, 어디까지 올라왔나{" "}
          {status.ok ? (
            <span className="text-sm font-normal text-emerald-700">— 다 올라왔습니다 ✓</span>
          ) : (
            <span className="text-sm font-normal text-amber-700">— {status.lagging.length}곳이 아직입니다</span>
          )}
        </h2>
      )}
      <ul className="mt-2 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <li
            key={r.key}
            className={`tabular flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 ${
              lag.has(r.key) ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-600"
            }`}
          >
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 text-xs">
              {r.last ? `~${r.granularity === "month" ? r.last : r.last.slice(5)}` : "없음"}
              {lag.has(r.key) && lagMark}
            </span>
          </li>
        ))}
      </ul>
      {foot && (
        <p className="mt-1.5 text-xs text-slate-400">
          기준일 {status.endShown.slice(5)} 3일 전까지 안 온 자료에 ⚠ — 은행·카드사는 하루이틀 늦게 나옵니다.
        </p>
      )}
    </>
  );
}
