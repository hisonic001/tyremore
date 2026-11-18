"use client";

export function SignSheet({ areaName, slots }: { areaName: string; slots: string[] }) {
  return (
    <div className="min-h-dvh bg-slate-200 print:bg-white">
      <style>{`@media print { @page { size: A4 landscape; margin: 0 } html, body { margin: 0 } }`}</style>
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3 print:hidden">
        <button onClick={() => window.close()} className="min-h-11 text-sm text-slate-600 underline">
          ← 닫기
        </button>
        <span className="ml-auto text-sm text-slate-700">
          {areaName} 자리 {slots.length}장 (A4 가로)
        </span>
        <button onClick={() => window.print()} className="min-h-11 rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white">
          인쇄
        </button>
      </div>
      <div className="flex flex-col items-center gap-4 overflow-x-auto pb-10 print:block print:gap-0 print:overflow-visible print:p-0">
        {slots.map((s, i) => (
          <div
            key={i}
            className="shrink-0 bg-white text-black shadow print:shadow-none"
            style={{
              width: "297mm",
              height: "209mm",
              boxSizing: "border-box",
              padding: "14mm",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              breakAfter: i < slots.length - 1 ? "page" : "auto",
              border: "3mm solid #000",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <div style={{ fontSize: "16mm", fontWeight: 800 }}>{areaName}</div>
            <div style={{ fontSize: `${Math.min(80, 300 / Math.max(2, [...s].length))}mm`, fontWeight: 900, lineHeight: 1, textAlign: "center" }}>{s}</div>
            <div style={{ fontSize: "8mm", fontWeight: 600 }}>보관 타이어 자리 — 앱 「📦 창고 실사」에서 이 이름을 고르세요</div>
          </div>
        ))}
      </div>
    </div>
  );
}
