"use client";

/**
 * ⭐ 스캔 대기 중임을 눈에 보이게 (사장님 요청 2026-08-01)
 *
 * 전역 감지라 커서가 어디 있든 잡히는데, 그래서 **지금 찍어도 되는지**가
 * 화면에 안 보인다. 찍었는데 아무 일도 안 일어나면 리더기를 의심하게 된다.
 */
export function ScanIndicator({
  active,
  busy,
  tone = "emerald",
}: {
  active: boolean;
  busy?: boolean;
  tone?: "emerald" | "indigo";
}) {
  const color =
    tone === "indigo"
      ? { on: "bg-indigo-600", text: "text-indigo-900", off: "bg-slate-300" }
      : { on: "bg-emerald-600", text: "text-emerald-900", off: "bg-slate-300" };

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${
        active ? `bg-white ${color.text}` : "bg-slate-100 text-slate-500"
      }`}
      aria-live="polite"
    >
      <span className="relative flex h-3 w-3">
        {active && !busy && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${color.on}`} />
        )}
        <span className={`relative inline-flex h-3 w-3 rounded-full ${active ? color.on : color.off}`} />
      </span>
      {busy ? "읽는 중…" : active ? "스캔 대기 중" : "스캔 멈춤"}
    </span>
  );
}
