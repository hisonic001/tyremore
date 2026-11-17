"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLabelPaper, setLabelSize } from "@/lib/tire-storage";
import { formatLabelSize, formatStorageNo, labelKind, type LabelPaper } from "@/lib/tire-storage-pure";

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
}

/** A4 한 장 = 2칸 × 4줄 = 8개. 칸 100×70mm (종이 210×297, 여백 5mm) */
const A4 = { cols: 2, rows: 4, w: 100, h: 70, pad: 5 } as const;
const PER_PAGE = A4.cols * A4.rows;

/**
 * 스티커 한 장의 그림 — 라벨프린터·A4 칸이 같이 쓴다. 글자 크기는 높이에 비례(40mm 기준).
 *   보관번호(크게) · 일반/윈터 · 차번호 · 이름 · 전화 · 타이어 · 사이즈 · 갯수 · 보관날짜 (사장님 2026-11-17)
 */
function LabelBody({ l, w, h }: { l: LabelData; w: number; h: number }) {
  const u = h / 40;
  const kind = labelKind(l.kind);
  const line = { whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" };
  return (
    <div
      style={{
        width: `${w}mm`,
        height: `${h}mm`,
        padding: `${1.8 * u}mm ${2.4 * u}mm`,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        overflow: "hidden",
        background: "#fff",
        color: "#000",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: `${1.5 * u}mm` }}>
        <span className="tabular" style={{ fontSize: `${14 * u}mm`, lineHeight: 0.9, fontWeight: 900, letterSpacing: "-0.03em" }}>
          {formatStorageNo(l.no)}
        </span>
        {kind && (
          <span
            style={{
              fontSize: `${5 * u}mm`,
              fontWeight: 900,
              padding: `${0.6 * u}mm ${1.6 * u}mm`,
              background: kind === "윈터" ? "#000" : "#fff",
              color: kind === "윈터" ? "#fff" : "#000",
              border: `${0.45 * u}mm solid #000`,
              whiteSpace: "nowrap",
            }}
          >
            {kind}
          </span>
        )}
      </div>
      <div style={{ ...line, fontSize: `${4.4 * u}mm`, fontWeight: 800, lineHeight: 1.15 }}>
        {l.plate ?? ""} {l.owner}
      </div>
      <div className="tabular" style={{ ...line, fontSize: `${3.6 * u}mm`, fontWeight: 600, lineHeight: 1.15 }}>
        {l.phone ?? ""}
      </div>
      <div style={{ ...line, fontSize: `${3.6 * u}mm`, fontWeight: 700, lineHeight: 1.15 }}>
        {[l.brand, l.size, `${l.qty}개`].filter(Boolean).join(" · ")}
      </div>
      <div className="tabular" style={{ ...line, fontSize: `${3 * u}mm`, lineHeight: 1.1 }}>
        보관 {l.storedOn.replaceAll("-", ".")}
      </div>
    </div>
  );
}

export function LabelSheet({ size, paper: initialPaper, labels }: { size: { w: number; h: number }; paper: LabelPaper; labels: LabelData[] }) {
  const router = useRouter();
  const [paper, setPaper] = useState<LabelPaper>(initialPaper);
  const [raw, setRaw] = useState(formatLabelSize(size));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pages: LabelData[][] = [];
  for (let i = 0; i < labels.length; i += PER_PAGE) pages.push(labels.slice(i, i + PER_PAGE));

  const choose = (p: LabelPaper) =>
    start(async () => {
      setPaper(p);
      const r = await setLabelPaper(p);
      if (!r.ok) setMsg(r.error);
      router.refresh();
    });

  return (
    <div className="min-h-dvh bg-slate-200 print:bg-white">
      {/* 여백 0 — 크롬이 머리글·바닥글(URL)을 안 찍는다 (print/[id]/frame.tsx 와 같은 까닭) */}
      <style>
        {paper === "a4"
          ? `@media print { @page { size: A4; margin: 0 } html, body { margin: 0 } }`
          : `@media print { @page { size: ${size.w}mm ${size.h}mm; margin: 0 } html, body { margin: 0 } }`}
      </style>

      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2 px-4 py-3 print:hidden">
        <button onClick={() => history.back()} className="text-sm text-slate-600 underline underline-offset-4">
          ← 돌아가기
        </button>
        <div className="ml-auto flex overflow-hidden rounded-lg border border-slate-400 bg-white text-sm">
          <button onClick={() => choose("a4")} disabled={pending} className={`px-3 py-1.5 ${paper === "a4" ? "bg-slate-900 text-white" : ""}`}>
            일반 프린터 (A4 8칸)
          </button>
          <button onClick={() => choose("label")} disabled={pending} className={`px-3 py-1.5 ${paper === "label" ? "bg-slate-900 text-white" : ""}`}>
            라벨프린터
          </button>
        </div>
        <button
          onClick={() => window.print()}
          disabled={labels.length === 0}
          className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          인쇄 {labels.length}개{paper === "a4" && labels.length > 0 ? ` (A4 ${pages.length}장)` : ""}
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
          {paper === "a4"
            ? "인쇄 창에서 용지 A4 · 배율 「기본/100%」 · 여백 「없음」으로. 점선대로 잘라 투명 테이프로 붙이세요 (A4 라벨지 8칸에 바로 찍어도 됩니다)."
            : "처음 한 번: 인쇄 창에서 프린터를 라벨프린터로, 용지를 라벨 크기와 같게, 배율 「기본/100%」로 맞춰 주세요."}
        </p>
      </div>

      {labels.length === 0 && <p className="p-8 text-center text-slate-500 print:hidden">인쇄할 보관 세트가 없습니다.</p>}

      {paper === "a4" ? (
        <div className="flex flex-col items-center gap-4 pb-10 print:block print:gap-0 print:p-0">
          {pages.map((pg, pi) => (
            <div
              key={pi}
              className="bg-white shadow print:shadow-none"
              style={{
                width: "210mm",
                height: "297mm",
                padding: `${A4.pad}mm`,
                boxSizing: "border-box",
                display: "grid",
                gridTemplateColumns: `repeat(${A4.cols}, ${A4.w}mm)`,
                gridTemplateRows: `repeat(${A4.rows}, ${A4.h}mm)`,
                gap: 0,
                alignContent: "start",
                breakAfter: pi < pages.length - 1 ? "page" : "auto",
                overflow: "hidden",
              }}
            >
              {pg.map((l) => (
                <div key={l.id} style={{ outline: "0.3mm dashed #999", outlineOffset: "-0.15mm" }}>
                  <LabelBody l={l} w={A4.w} h={A4.h} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 pb-10 print:block print:gap-0 print:p-0">
          {labels.map((l, i) => (
            <div key={l.id} className="shadow print:shadow-none" style={{ breakAfter: i < labels.length - 1 ? "page" : "auto", width: `${size.w}mm` }}>
              <LabelBody l={l} w={size.w} h={size.h} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
