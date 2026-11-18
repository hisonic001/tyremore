"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { setLabelPaper, setLabelPer, setLabelSize } from "@/lib/tire-storage";
import { expandPerTire, formatLabelSize, formatStorageNo, labelKind, type LabelPaper, type LabelPer } from "@/lib/tire-storage-pure";

export interface LabelData {
  id: number;
  no: number;
  kind: string | null;
  plate: string | null;
  owner: string;
  phone: string | null;
  brand: string | null;
  size: string | null;
  qty: number;
  storedOn: string;
  area: string | null;
}

/** A4 한 세트 한 장 = 2×4 = 8칸 (100×70mm) · 타이어마다 = 3×8 = 24칸 (70×36mm). 종이 높이는 296 — 빈 장 방지 */
const SHEET = {
  set: { cols: 2, rows: 4, w: 100, h: 70, padX: 5, padY: 5 },
  tire: { cols: 3, rows: 8, w: 70, h: 36, padX: 0, padY: 4 },
} as const;

/** 🔴 배경색 없이도 보이게 — 크롬 기본은 「배경 그래픽」 꺼짐이라 검정 바탕은 안 찍힌다 (검토 갈래 발견 11-18) */
const EXACT: CSSProperties = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" };

function KindBadge({ kind, u }: { kind: string; u: number }) {
  const winter = kind === "윈터";
  return (
    <span
      style={{
        ...EXACT,
        fontSize: `${5 * u}mm`,
        fontWeight: 900,
        padding: `${0.4 * u}mm ${1.4 * u}mm`,
        background: winter ? "#000" : "#fff",
        color: winter ? "#fff" : "#000",
        // 배경이 빠져도 글자가 보이게 — 윈터는 흰 글자 + 검은 외곽선(글자 테두리), 테두리 두 겹
        WebkitTextStroke: winter ? `${0.12 * u}mm #000` : undefined,
        border: `${winter ? 0.9 * u : 0.45 * u}mm ${winter ? "double" : "solid"} #000`,
        whiteSpace: "nowrap",
      }}
    >
      {winter ? "❄ 윈터" : "일반"}
    </span>
  );
}

/** 한 세트 한 장 — 보관번호(크게) · 종류 · 차번호 · 이름 · 전화 · 타이어 · 사이즈·갯수 · 보관날짜 · 구역 */
function SetLabel({ l, w, h }: { l: LabelData; w: number; h: number }) {
  const u = h / 40;
  const kind = labelKind(l.kind);
  const line: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  return (
    <div style={{ ...EXACT, width: `${w}mm`, height: `${h}mm`, padding: `${1.6 * u}mm ${2.2 * u}mm`, boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden", background: "#fff", color: "#000", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: `${1.5 * u}mm` }}>
        <span className="tabular" style={{ fontSize: `${13 * u}mm`, lineHeight: 0.9, fontWeight: 900, letterSpacing: "-0.03em" }}>
          {formatStorageNo(l.no)}
        </span>
        {kind && <KindBadge kind={kind} u={u} />}
      </div>
      <div style={{ ...line, fontSize: `${4.2 * u}mm`, fontWeight: 800, lineHeight: 1.15 }}>
        {l.plate ?? ""} {l.owner}
      </div>
      <div className="tabular" style={{ ...line, fontSize: `${3.4 * u}mm`, fontWeight: 600, lineHeight: 1.15 }}>
        {l.phone ?? ""}
      </div>
      <div style={{ ...line, fontSize: `${3.4 * u}mm`, fontWeight: 700, lineHeight: 1.15 }}>{l.brand ?? ""}</div>
      <div className="tabular" style={{ ...line, fontSize: `${3.4 * u}mm`, fontWeight: 700, lineHeight: 1.15 }}>
        {[l.size, `${l.qty}개`].filter(Boolean).join(" · ")}
      </div>
      <div className="tabular" style={{ ...line, fontSize: `${2.8 * u}mm`, lineHeight: 1.1 }}>
        보관 {l.storedOn.replaceAll("-", ".")}
        {l.area ? ` · 📍${l.area}` : ""}
      </div>
    </div>
  );
}

/** 타이어마다 한 장 (작게) — 보관번호(크게) · 종류 · 차번호 · 이름 · 「1/4」 · 사이즈 */
function TireLabel({ l, idx, w, h }: { l: LabelData; idx: number; w: number; h: number }) {
  const u = h / 36;
  const kind = labelKind(l.kind);
  const line: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  return (
    <div style={{ ...EXACT, width: `${w}mm`, height: `${h}mm`, padding: `${1.6 * u}mm ${2.4 * u}mm`, boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden", background: "#fff", color: "#000", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: `${1 * u}mm` }}>
        <span className="tabular" style={{ fontSize: `${11 * u}mm`, lineHeight: 0.9, fontWeight: 900, letterSpacing: "-0.03em" }}>
          {formatStorageNo(l.no)}
        </span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: `${0.6 * u}mm` }}>
          {kind && <KindBadge kind={kind} u={u * 0.75} />}
          <span className="tabular" style={{ fontSize: `${4 * u}mm`, fontWeight: 900 }}>
            {idx}/{l.qty}
          </span>
        </span>
      </div>
      <div style={{ ...line, fontSize: `${3.8 * u}mm`, fontWeight: 800, lineHeight: 1.15 }}>
        {l.plate ?? ""} {l.owner}
      </div>
      <div className="tabular" style={{ ...line, fontSize: `${3 * u}mm`, fontWeight: 600, lineHeight: 1.15 }}>
        {[l.size, l.brand].filter(Boolean).join(" · ")}
        {l.area ? ` · 📍${l.area}` : ""}
      </div>
    </div>
  );
}

export function LabelSheet({
  size,
  paper: initialPaper,
  per: initialPer,
  labels,
}: {
  size: { w: number; h: number };
  paper: LabelPaper;
  per: LabelPer;
  labels: LabelData[];
}) {
  const router = useRouter();
  const [paper, setPaper] = useState<LabelPaper>(initialPaper);
  const [per, setPer] = useState<LabelPer>(initialPer);
  const [raw, setRaw] = useState(formatLabelSize(size));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const items = per === "tire" ? expandPerTire(labels) : labels.map((l) => ({ ...l, idx: 1, key: String(l.id) }));
  const sheet = SHEET[per];
  const perPage = sheet.cols * sheet.rows;
  const pages: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));

  const choose = (patch: { paper?: LabelPaper; per?: LabelPer }) =>
    start(async () => {
      if (patch.paper) {
        setPaper(patch.paper);
        const r = await setLabelPaper(patch.paper);
        if (!r.ok) setMsg(r.error);
      }
      if (patch.per) {
        setPer(patch.per);
        const r = await setLabelPer(patch.per);
        if (!r.ok) setMsg(r.error);
      }
      router.refresh();
    });

  const seg = (on: boolean) => `px-3 py-1.5 ${on ? "bg-slate-900 text-white" : ""}`;

  return (
    <div className="min-h-dvh bg-slate-200 print:bg-white">
      {/* 여백 0 — 크롬이 머리글·바닥글(URL)을 안 찍는다 (print/[id]/frame.tsx 와 같은 까닭) */}
      <style>
        {paper === "a4"
          ? `@media print { @page { size: A4; margin: 0 } html, body { margin: 0 } * { -webkit-print-color-adjust: exact; print-color-adjust: exact } }`
          : `@media print { @page { size: ${size.w}mm ${size.h}mm; margin: 0 } html, body { margin: 0 } * { -webkit-print-color-adjust: exact; print-color-adjust: exact } }`}
      </style>

      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2 px-4 py-3 print:hidden">
        <button
          onClick={() => (window.opener || history.length <= 1 ? window.close() : history.back())}
          className="min-h-11 text-sm text-slate-600 underline underline-offset-4"
        >
          ← 닫기
        </button>
        <div className="ml-auto flex overflow-hidden rounded-lg border border-slate-400 bg-white text-sm">
          <button onClick={() => choose({ per: "tire" })} disabled={pending} className={seg(per === "tire")}>
            타이어마다 한 장
          </button>
          <button onClick={() => choose({ per: "set" })} disabled={pending} className={seg(per === "set")}>
            세트에 한 장
          </button>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-slate-400 bg-white text-sm">
          <button onClick={() => choose({ paper: "a4" })} disabled={pending} className={seg(paper === "a4")}>
            일반 프린터(A4)
          </button>
          <button onClick={() => choose({ paper: "label" })} disabled={pending} className={seg(paper === "label")}>
            라벨프린터
          </button>
        </div>
        <button
          onClick={() => window.print()}
          disabled={items.length === 0}
          className="min-h-11 rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white disabled:opacity-40"
        >
          인쇄 {items.length}장{paper === "a4" && items.length > 0 ? ` (A4 ${pages.length}장)` : ""}
        </button>
        {paper === "label" && (
          <div className="flex w-full items-center gap-2">
            <label className="flex items-center gap-1 text-sm text-slate-600">
              라벨 크기(mm)
              <input value={raw} onChange={(e) => setRaw(e.target.value)} className="tabular w-24 rounded border border-slate-300 bg-white px-2 py-1.5" placeholder="62x40" />
            </label>
            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await setLabelSize(raw);
                  if (r.ok) {
                    setRaw(r.size);
                    setMsg(`크기를 ${r.size}mm 로 저장했습니다`);
                    router.refresh();
                  } else setMsg(r.error);
                })
              }
              className="rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-sm"
            >
              크기 저장
            </button>
          </div>
        )}
        {msg && <p className="w-full text-xs text-slate-600">{msg}</p>}
        <p className="w-full text-xs text-slate-500">
          {per === "tire"
            ? "타이어마다 한 장 — 섞여 쌓여도 어느 타이어가 누구 것인지 보입니다. "
            : "세트에 한 장 — 한 대분씩 따로 쌓은 경우. "}
          {paper === "a4"
            ? `인쇄 창에서 용지 A4 · 배율 「기본/100%」 · 여백 「없음」. ${per === "tire" ? "A4 24칸(70×36) 라벨지에 바로 찍거나 잘라 붙이세요." : "점선대로 잘라 붙이세요."}`
            : "처음 한 번: 인쇄 창에서 프린터를 라벨프린터로, 용지를 라벨 크기와 같게, 배율 「기본/100%」로."}
        </p>
      </div>

      {items.length === 0 && <p className="p-8 text-center text-slate-500 print:hidden">인쇄할 보관 세트가 없습니다.</p>}

      {paper === "a4" ? (
        <div className="flex flex-col items-center gap-4 overflow-x-auto pb-10 print:block print:gap-0 print:overflow-visible print:p-0">
          {pages.map((pg, pi) => (
            <div
              key={pi}
              className="shrink-0 bg-white shadow print:shadow-none"
              style={{
                width: "210mm",
                height: "296mm",
                padding: `${sheet.padY}mm ${sheet.padX}mm`,
                boxSizing: "border-box",
                display: "grid",
                gridTemplateColumns: `repeat(${sheet.cols}, ${sheet.w}mm)`,
                gridTemplateRows: `repeat(${sheet.rows}, ${sheet.h}mm)`,
                alignContent: "start",
                breakAfter: pi < pages.length - 1 ? "page" : "auto",
                overflow: "hidden",
              }}
            >
              {pg.map((l) => (
                <div key={l.key} style={{ outline: "0.3mm dashed #999", outlineOffset: "-0.15mm" }}>
                  {per === "tire" ? <TireLabel l={l} idx={l.idx} w={sheet.w} h={sheet.h} /> : <SetLabel l={l} w={sheet.w} h={sheet.h} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 pb-10 print:block print:gap-0 print:p-0">
          {items.map((l, i) => (
            <div key={l.key} className="shadow print:shadow-none" style={{ breakAfter: i < items.length - 1 ? "page" : "auto", width: `${size.w}mm` }}>
              {per === "tire" ? <TireLabel l={l} idx={l.idx} w={size.w} h={size.h} /> : <SetLabel l={l} w={size.w} h={size.h} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
