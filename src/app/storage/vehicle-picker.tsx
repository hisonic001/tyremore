"use client";

import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { searchVehicles } from "@/lib/search-actions";
import type { VehicleHit } from "@/lib/search";

/**
 * ⭐ 보관 세트를 다른 차로 옮길 때 차 고르기 (2026-11-17)
 *   메모에 다른 차 번호가 적혀 있으면(「84고0717보관 이 차량번호로…」) 그 번호로 바로 찾는 버튼을 띄운다.
 */
export function VehiclePicker({
  suggestions = [],
  onPick,
  onCancel,
  pending,
}: {
  suggestions?: string[];
  onPick: (h: VehicleHit) => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<VehicleHit[] | null>(null);
  const [busy, start] = useTransition();
  const find = (text: string) => {
    setQ(text);
    if (!text.trim()) return;
    start(async () => setHits(await searchVehicles(text)));
  };

  return (
    <div className="mt-2 rounded-control border border-slate-300 bg-white p-3">
      <p className="text-sm font-semibold text-slate-700">어느 차의 타이어인가요?</p>
      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => find(s)} className="min-h-10 rounded-full border border-brand-500 bg-brand-50 px-3 text-sm font-medium text-brand-700">
              메모의 {s} 찾기
            </button>
          ))}
        </div>
      )}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          find(q);
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="차량번호 · 끝 4자리 · 전화 · 이름"
          className="min-w-0 flex-1 rounded-control border border-slate-300 bg-white px-3 py-2.5 text-base placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
        />
        <Button type="submit" pending={busy} aria-label="찾기" className="w-12 !px-0">
          <Search className="size-5" />
        </Button>
      </form>
      {hits && hits.length === 0 && <Notice tone="info">찾는 차가 없습니다 — 처음 오신 차면 판매 등록에서 먼저 등록해 주세요.</Notice>}
      <div className="mt-1 divide-y divide-slate-100">
        {hits?.map((h) => (
          <button
            key={h.vehicleId}
            type="button"
            disabled={pending}
            onClick={() => onPick(h)}
            className="block w-full py-2.5 text-left active:bg-slate-50 disabled:opacity-50"
          >
            <span className="block font-medium">
              {h.plateNo} · {h.customerName}
            </span>
            <span className="block text-xs text-slate-500">{[h.makerName, h.model, h.lastFittedSize].filter(Boolean).join(" · ")}</span>
          </button>
        ))}
      </div>
      <button type="button" onClick={onCancel} className="mt-1 text-sm text-slate-500 underline underline-offset-2">
        그만두기
      </button>
    </div>
  );
}

/** 메모에 적힌 차량번호 중 지금 차와 다른 것 */
export function otherPlatesIn(text: string | null | undefined, current: string | null | undefined): string[] {
  const norm = (p: string) => p.replace(/\s/g, "");
  const cur = norm(current ?? "");
  return [...new Set([...(text ?? "").matchAll(/\d{2,3}\s?[가-힣]\s?\d{4}/g)].map((m) => norm(m[0])))].filter((p) => p !== cur).slice(0, 3);
}
