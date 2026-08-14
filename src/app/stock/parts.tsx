"use client";

/**
 * ⭐ 부품 재고 (사장님 선택 2026-08-11) — 종류별 묶음 · 수량 실사 · 재주문점.
 * 수량 수정은 타이어 실사와 같은 setDotQty(부품은 DOT 없이 한 행 수량)를 쓴다.
 *
 * 2026-08-14 부품 카탈로그가 2,100여 종이 되면서 **검색 형식**으로 바꿨다 (사장님 지시
 * — "부품리스트가 너무 기니 검색 형식으로"). 기본 화면에는 재고가 있거나 기준을 정한
 * 부품만 나오고, 나머지는 검색해서 실사 수량·기준을 넣는 순간 목록에 올라온다.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDotQty } from "@/lib/stock";
import { searchPartStock, setMinQty, type PartStockRow } from "@/lib/part-stock";

const GROUP_ORDER = ["배터리", "필터", "브레이크", "오일·유류", "와이퍼", "기타"];

export function PartStockList({ parts }: { parts: PartStockRow[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PartStockRow[] | null>(null);
  const [searching, startSearch] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = (term: string) => {
    startSearch(async () => {
      setHits(term.trim() ? await searchPartStock(term) : null);
    });
  };

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setHits(null);
      return;
    }
    timer.current = setTimeout(() => runSearch(q), 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const groups = useMemo(() => {
    const m = new Map<string, PartStockRow[]>();
    for (const p of parts) {
      if (!m.has(p.group)) m.set(p.group, []);
      m.get(p.group)!.push(p);
    }
    return [...m.entries()].sort(
      (a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]),
    );
  }, [parts]);

  const lowCount = parts.filter((p) => p.minQty !== null && p.qty <= p.minQty).length;

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-bold">부품 재고</h2>
        <span className="text-sm text-slate-500">
          보유 {parts.length}종
          {lowCount > 0 && <strong className="ml-2 text-red-600">부족 {lowCount}종</strong>}
        </span>
      </div>

      {/* ⭐ 검색이 입구다 — 카탈로그 2,100여 종 중 필요한 것만 불러온다 */}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="부품 찾기 — 차종 · 품번 · 이름 (예: 아반떼 오일필터, DF80L)"
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-900"
      />
      <p className="mt-1 text-xs text-slate-400">
        {q.trim()
          ? "찾아서 수량(실사)이나 기준을 넣으면 아래 보유 목록에 올라옵니다."
          : "판매 등록의 「쓴 부품 담기」가 자동으로 뺍니다. 수량을 누르면 실사, 기준(재주문점)을 정하면 그 이하일 때 「부족」이 뜹니다."}
      </p>

      {/* ---- 검색 결과 ---- */}
      {q.trim() && (
        <ul className="mt-2 divide-y divide-slate-100">
          {(hits ?? []).map((p) => (
            <PartRow key={p.productId} p={p} onChanged={() => runSearch(q)} />
          ))}
          {hits !== null && hits.length === 0 && !searching && (
            <li className="py-3 text-sm text-slate-500">
              못 찾았습니다 — 다른 말로 검색해 보세요 (차종·품번). 없는 부품은 설정 → 상품에서
              등록할 수 있습니다.
            </li>
          )}
          {hits !== null && hits.length >= 30 && (
            <li className="py-2 text-xs text-slate-400">30건까지만 보여줍니다 — 더 좁혀 보세요.</li>
          )}
        </ul>
      )}

      {/* ---- 보유 목록 (검색 중에는 숨긴다) ---- */}
      {!q.trim() &&
        (parts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            아직 재고로 잡힌 부품이 없습니다. 위에서 검색해 실사 수량을 넣거나, 매입 입고·판매
            등록의 「쓴 부품 담기」로 움직이기 시작하면 여기 나타납니다.
          </p>
        ) : (
          groups.map(([g, rows]) => (
            <div key={g} className="mt-3">
              <h3 className="text-sm font-semibold text-slate-500">{g}</h3>
              <ul className="mt-1 divide-y divide-slate-100">
                {rows.map((p) => (
                  <PartRow key={p.productId} p={p} />
                ))}
              </ul>
            </div>
          ))
        ))}
    </section>
  );
}

function PartRow({ p, onChanged }: { p: PartStockRow; onChanged?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<string | null>(null);
  const [editMin, setEditMin] = useState<string | null>(null);

  const low = p.minQty !== null && p.qty <= p.minQty;

  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{p.name}</div>
          <div className="tabular text-xs text-slate-400">
            {p.partNo && <span className="mr-2">{p.partNo}</span>}
            {p.verified ? `확인 ${p.verifiedAt}` : "실사한 적 없음 — 수량을 못 믿습니다"}
          </div>
        </div>

        {/* 수량 — 누르면 실사 입력 */}
        {editQty === null ? (
          <button
            type="button"
            onClick={() => {
              setErr(null);
              setEditQty(String(p.qty));
            }}
            className={`tabular shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold ${
              low ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-800"
            }`}
          >
            {p.qty}개{low && " · 부족"}
          </button>
        ) : (
          <span className="flex shrink-0 items-center gap-1">
            <input
              value={editQty}
              onChange={(e) => setEditQty(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              autoFocus
              className="tabular h-9 w-16 rounded-lg border border-slate-300 px-2 text-right text-sm"
            />
            <button
              type="button"
              disabled={pending || editQty === ""}
              onClick={() =>
                start(async () => {
                  setErr(null);
                  const r = await setDotQty({
                    productId: p.productId,
                    dot: null,
                    qty: Number(editQty),
                    reason: "부품 실사",
                  });
                  if (!r.ok) return setErr(r.error);
                  setEditQty(null);
                  onChanged?.();
                  router.refresh();
                })
              }
              className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              확정
            </button>
            <button type="button" onClick={() => setEditQty(null)} className="px-1 text-slate-400">
              ✕
            </button>
          </span>
        )}

        {/* 재주문점 */}
        {editMin === null ? (
          <button
            type="button"
            onClick={() => {
              setErr(null);
              setEditMin(p.minQty === null ? "" : String(p.minQty));
            }}
            className="tabular shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500"
          >
            기준 {p.minQty ?? "—"}
          </button>
        ) : (
          <span className="flex shrink-0 items-center gap-1">
            <input
              value={editMin}
              onChange={(e) => setEditMin(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="없음"
              className="tabular h-9 w-14 rounded-lg border border-slate-300 px-2 text-right text-sm"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setErr(null);
                  const r = await setMinQty(p.productId, editMin === "" ? null : Number(editMin));
                  if (!r.ok) return setErr(r.error);
                  setEditMin(null);
                  onChanged?.();
                  router.refresh();
                })
              }
              className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              저장
            </button>
            <button type="button" onClick={() => setEditMin(null)} className="px-1 text-slate-400">
              ✕
            </button>
          </span>
        )}
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </li>
  );
}
