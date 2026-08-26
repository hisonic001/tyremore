"use client";

/**
 * ⭐ 잇기 공통 조각 (tax 재설계 배치2, 2026-08-25)
 *
 *   tax-ui 에 2벌씩 복제돼 있던 후보 목록·통장 후보·통장 검색 렌더의 수렴.
 *   돈 확인 뷰(money-view)와 계산서 정리 뷰(tax-ui)가 같이 쓴다.
 */
import { useState, useTransition } from "react";
import { searchBankLines, type BankHit } from "@/lib/recon";

export interface PickItem {
  key: string | number;
  label: string;
  onPick: () => void;
}

/** 후보 목록 — hint 한 줄 + [잇기] 버튼들. strong 이면 채움 버튼(확실한 추천) */
export function PickList({
  hint,
  items,
  pending,
  strong,
  buttonLabel = "잇기",
}: {
  hint?: string;
  items: PickItem[];
  pending: boolean;
  strong?: boolean;
  buttonLabel?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 text-xs">
      {hint && <li className="font-medium text-slate-600">{hint}</li>}
      {items.map((it) => (
        <li key={it.key} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate">{it.label}</span>
          <button
            type="button"
            disabled={pending}
            onClick={it.onPick}
            className={
              strong
                ? "shrink-0 rounded bg-brand-600 px-2 py-0.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
                : "shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 font-medium active:bg-slate-100 disabled:opacity-40"
            }
          >
            {buttonLabel}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 통장 직접 검색 — 전체 기간, 남은 금액 있는 줄만 (searchBankLines 재사용) */
export function BankSearch({
  direction,
  pending,
  onPick,
  anchor,
}: {
  direction: "매입" | "매출";
  pending: boolean;
  onPick: (cashTxnId: number) => void;
  /** 계산서 날짜 — 이 날짜에 가까운 줄부터 (2025 감사 F9) */
  anchor?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<BankHit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();

  const search = () =>
    startSearch(async () => {
      setErr(null);
      const r = await searchBankLines(direction, q, anchor);
      if (!r.ok) return setErr(r.error);
      setHits(r.rows);
    });

  return (
    <div className="text-xs">
      <div className="flex gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={direction === "매입" ? "출금 검색 (이름·금액)" : "입금 검색 (입금자·금액)"}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (q.trim()) search();
            }
          }}
          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 focus:border-brand-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={searching || !q.trim()}
          onClick={search}
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium active:bg-slate-100 disabled:opacity-40"
        >
          {searching ? "찾는 중…" : "검색"}
        </button>
      </div>
      {err && <p className="mt-1 text-red-600">{err}</p>}
      {hits !== null && hits.length === 0 && (
        <p className="mt-1 text-slate-400">
          맞는 통장 줄이 없습니다 — 이름 일부만(예: 「맥스런」) 치거나 금액으로 찾아 보세요
        </p>
      )}
      {hits !== null && hits.some((h) => h.opposite) && (
        <p className="mt-1 rounded bg-amber-50 px-1.5 py-1 text-amber-800">
          <strong>↔ 표시</strong>는 반대 방향입니다 —{" "}
          {direction === "매입"
            ? "수수료를 정산 입금에서 떼는 곳(온라인몰 정산사 등)이면 이어도 됩니다"
            : "받을 돈을 매입 대금과 상계한 곳이면 이어도 됩니다"}
        </p>
      )}
      {hits !== null && hits.length > 0 && (
        <PickList pending={pending} items={hits.map((h) => ({ key: h.id, label: h.label, onPick: () => onPick(h.id) }))} />
      )}
    </div>
  );
}
