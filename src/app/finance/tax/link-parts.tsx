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
  /** 통장 줄 남은 금액 — 「골라서 잇기」 합계용 */
  amount?: number;
}

/** 골라서 잇기 — 체크 상태 (통장 줄 id → 남은 금액) */
export type Picked = Record<number, number>;
export const pickedSum = (p: Picked) => Object.values(p).reduce((s, n) => s + n, 0);
const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * ⭐ 골라서 잇기 막대 (사장님 요청 2026-08-26 — 규칙이 못 잡는 모든 합산 계산서의 최종 수단)
 *   체크한 줄 합 vs 계산서 남은 금액을 실시간으로 보여주고 버튼 하나로 잇는다.
 *   차이가 몇백 원(허용 오차)이면 서버가 잔돈·차액을 자동 정리한다.
 */
export function MultiPickBar({
  picked,
  target,
  pending,
  onLink,
  onClear,
}: {
  picked: Picked;
  target: number;
  pending: boolean;
  onLink: () => void;
  onClear: () => void;
}) {
  const n = Object.keys(picked).length;
  if (n === 0) return null;
  const sum = pickedSum(picked);
  const diff = sum - target;
  return (
    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-control border border-brand-500 bg-brand-50 p-2 text-xs">
      <span className="tabular">
        고른 {n}줄 합 <strong>{won(sum)}원</strong> / 계산서 {won(target)}원 ·{" "}
        {diff === 0 ? (
          <strong className="text-brand-700">정확히 맞음</strong>
        ) : (
          <span className={Math.abs(diff) <= Math.max(1000, Math.round(target * 0.001)) ? "text-brand-700" : "text-amber-700"}>
            {diff > 0 ? `${won(diff)}원 많음` : `${won(-diff)}원 모자람`}
            {Math.abs(diff) <= Math.max(1000, Math.round(target * 0.001)) && " (잔돈은 자동 정리)"}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onClear} className="text-slate-500 underline">
          선택 해제
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onLink}
          className="rounded-control bg-brand-600 px-3 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
        >
          고른 {n}줄 한 번에 잇기
        </button>
      </span>
    </div>
  );
}

/** 후보 목록 — hint 한 줄 + [잇기] 버튼들. strong 이면 채움 버튼(확실한 추천) */
export function PickList({
  hint,
  items,
  pending,
  strong,
  buttonLabel = "잇기",
  picked,
  onToggle,
}: {
  hint?: string;
  items: PickItem[];
  pending: boolean;
  strong?: boolean;
  buttonLabel?: string;
  /** 주면 줄마다 체크칸이 생긴다 (골라서 잇기) */
  picked?: Picked;
  onToggle?: (it: PickItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 text-xs">
      {hint && <li className="font-medium text-slate-600">{hint}</li>}
      {items.map((it) => (
        <li key={it.key} className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {picked && onToggle && typeof it.amount === "number" && (
              <input
                type="checkbox"
                checked={Number(it.key) in picked}
                onChange={() => onToggle(it)}
                aria-label="골라서 잇기"
                className="size-4 shrink-0 accent-brand-600"
              />
            )}
            <span className="min-w-0 truncate">{it.label}</span>
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={it.onPick}
            className={
              strong
                ? "shrink-0 rounded-control bg-brand-600 px-2.5 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
                : "shrink-0 rounded-control border border-slate-300 bg-white px-2.5 py-1.5 font-medium active:bg-slate-100 disabled:opacity-40"
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
  picked,
  onToggle,
}: {
  direction: "매입" | "매출";
  pending: boolean;
  onPick: (cashTxnId: number) => void;
  /** 계산서 날짜 — 이 날짜에 가까운 줄부터 (2025 감사 F9) */
  anchor?: string;
  picked?: Picked;
  onToggle?: (it: PickItem) => void;
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
        <PickList
          pending={pending}
          items={hits.map((h) => ({ key: h.id, label: h.label, amount: h.amount, onPick: () => onPick(h.id) }))}
          picked={picked}
          onToggle={onToggle}
        />
      )}
    </div>
  );
}
