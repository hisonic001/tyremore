"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLabelSize } from "@/lib/tire-storage";
import { formatLabelSize, formatStorageNo } from "@/lib/tire-storage-pure";

export interface LabelData {
  id: number;
  no: number;
  kind: string | null;
  plate: string | null;
  owner: string;
  describe: string;
  qty: number;
  storedOn: string;
}

/**
 * 스티커 한 장 = 종이 한 장(@page 크기 = 라벨 크기). 여백 0 — 크롬이 머리글·바닥글을 안 찍는다
 * (print/[id]/frame.tsx 와 같은 까닭). 글자 크기는 라벨 높이에 비례한다.
 */
export function LabelSheet({ size, labels }: { size: { w: number; h: number }; labels: LabelData[] }) {
  const router = useRouter();
  const [raw, setRaw] = useState(formatLabelSize(size));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { w, h } = size;
  const u = h / 40; // 40mm 기준 배율

  return (
    <div className="min-h-dvh bg-slate-200 print:bg-white">
      <style>{`@media print { @page { size: ${w}mm ${h}mm; margin: 0 } html, body { margin: 0 } }`}</style>

      <div className="mx-auto flex max-w-xl flex-wrap items-center gap-2 px-4 py-3 print:hidden">
        <button onClick={() => history.back()} className="text-sm text-slate-600 underline underline-offset-4">
          ← 돌아가기
        </button>
        <label className="ml-auto flex items-center gap-1 text-sm text-slate-600">
          라벨 크기(mm)
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            className="tabular w-24 rounded border border-slate-300 bg-white px-2 py-1.5"
            placeholder="62x40"
          />
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
        <button
          onClick={() => window.print()}
          disabled={labels.length === 0}
          className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          인쇄 {labels.length}장
        </button>
        {msg && <p className="w-full text-xs text-slate-600">{msg}</p>}
        <p className="w-full text-xs text-slate-500">
          처음 한 번: 인쇄 창에서 프린터를 라벨프린터로, 용지를 라벨 크기와 같게, 배율 「기본/100%」로 맞춰 주세요.
        </p>
      </div>

      {labels.length === 0 && <p className="p-8 text-center text-slate-500 print:hidden">인쇄할 보관 세트가 없습니다.</p>}

      <div className="flex flex-col items-center gap-4 pb-10 print:block print:gap-0 print:p-0">
        {labels.map((l, i) => (
          <div
            key={l.id}
            className="box-border overflow-hidden bg-white text-black shadow print:shadow-none"
            style={{
              width: `${w}mm`,
              height: `${h}mm`,
              padding: `${2 * u}mm ${2.5 * u}mm`,
              breakAfter: i < labels.length - 1 ? "page" : "auto",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: `${1.5 * u}mm` }}>
              <span style={{ fontSize: `${17 * u}mm`, lineHeight: 0.9, fontWeight: 900, letterSpacing: "-0.03em" }} className="tabular">
                {formatStorageNo(l.no)}
              </span>
              {l.kind && (
                <span
                  style={{
                    fontSize: `${4.6 * u}mm`,
                    fontWeight: 800,
                    padding: `${0.6 * u}mm ${1.4 * u}mm`,
                    background: l.kind === "스노" ? "#000" : "#fff",
                    color: l.kind === "스노" ? "#fff" : "#000",
                    border: `${0.4 * u}mm solid #000`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {l.kind}
                </span>
              )}
            </div>
            <div style={{ fontSize: `${4.8 * u}mm`, fontWeight: 800, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden" }}>
              {l.plate ?? ""} {l.owner}
            </div>
            <div
              style={{ fontSize: `${3.4 * u}mm`, lineHeight: 1.2, display: "flex", justifyContent: "space-between", gap: `${1 * u}mm`, whiteSpace: "nowrap" }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {l.describe} {l.qty}본
              </span>
              <span className="tabular">{l.storedOn.slice(2).replaceAll("-", ".")}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
