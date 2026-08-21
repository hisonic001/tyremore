"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyStockUpload, previewStockUpload } from "@/lib/stock-excel";
import type { DiffLine, StockDiff } from "@/lib/stock-sheet";

const KIND_STYLE: Record<DiffLine["kind"], string> = {
  오류: "bg-red-100 text-red-800",
  없어짐: "bg-red-50 text-red-700",
  줄어듦: "bg-amber-100 text-amber-800",
  늘어남: "bg-emerald-100 text-emerald-800",
  새로: "bg-sky-100 text-sky-800",
  같음: "bg-slate-100 text-slate-500",
};

/**
 * 내려받기 → 엑셀에서 수정 → 올리기 → **미리보기** → 확정.
 *
 * 🔴 미리보기를 건너뛸 수 없게 만들었다. 「엑셀이 정답」이라 파일에 없는 재고는
 *    0본이 된다 — 잘못된 파일을 올리면 재고가 통째로 사라진다.
 *    무엇이 없어지는지 눈으로 보고 나서 확정하시게 한다.
 */
export function StockExcel() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [diff, setDiff] = useState<StockDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [showSame, setShowSame] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setDiff(null);
    setError(null);
    if (input.current) input.current.value = "";
  }

  function onPick(f: File | null) {
    setError(null);
    setDoneMsg(null);
    setDiff(null);
    setFile(f);
    if (!f) return;
    const fd = new FormData();
    fd.set("file", f);
    start(async () => {
      const r = await previewStockUpload(fd);
      if (!r.ok) return setError(r.error);
      setDiff(r.diff);
    });
  }

  function onApply() {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const r = await applyStockUpload(fd);
      if (!r.ok) return setError(r.error);
      setDoneMsg(`${r.changed}줄을 반영했습니다`);
      reset();
      router.refresh();
    });
  }

  const lines = diff?.lines ?? [];
  const visible = showSame ? lines : lines.filter((l) => l.kind !== "같음");
  const gone = lines.filter((l) => l.kind === "없어짐");

  return (
    <>
      {/* ── 1. 내려받기 ── */}
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">1. 엑셀로 내려받기</h2>
        <p className="mt-1 text-sm text-slate-500">
          지금 재고가 그대로 들어 있습니다. <strong>수량 칸만 고쳐서</strong> 다시 올리시면 됩니다.
        </p>
        {/* ⭐ 2026-08-21 — 거르기용 칸을 붙였다. 늘어난 칸은 올릴 때 무시되니 지우실 필요 없다 */}
        <p className="mt-1 text-xs text-slate-400">
          제조사 · 폭 · 편평비 · 인치 · 런플랫 · 연식 · 기표가 칸이 함께 들어갑니다 (엑셀 자동
          필터가 켜져 있습니다). 이 칸들은 올릴 때 읽지 않으니 그대로 두셔도, 지우셔도 됩니다.
        </p>
        <a
          href="/stock/export"
          className="mt-3 block w-full rounded-xl bg-slate-900 py-3.5 text-center font-semibold text-white active:bg-slate-700"
        >
          재고 엑셀 받기
        </a>
      </section>

      {/* ── 2. 올리기 ── */}
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">2. 고친 엑셀 올리기</h2>
        <p className="mt-1 text-sm text-slate-500">
          올린 파일이 <strong>정답</strong>이 됩니다 — 파일에 없는 재고는 0본이 됩니다. 올리면 먼저 무엇이
          바뀌는지 보여 드립니다.
        </p>

        <label className="mt-3 block">
          <input
            ref={input}
            type="file"
            accept=".xlsx,.xls"
            disabled={pending}
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            className="block w-full rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2.5 file:font-semibold file:text-white"
          />
        </label>

        {pending && !diff && <p className="mt-2 text-sm text-slate-500">읽는 중…</p>}
        {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {doneMsg && (
          <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
            ✅ {doneMsg}
          </p>
        )}
      </section>

      {/* ── 3. 미리보기 ── */}
      {diff && (
        <section className="mt-4 rounded-2xl border-2 border-slate-900 bg-white p-4">
          <h2 className="font-semibold">3. 이렇게 바뀝니다 — 확인해 주세요</h2>

          <div className="tabular mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-slate-500">{diff.beforeTotal}본</span>
            <span className="text-slate-400">→</span>
            <span className="text-2xl font-bold">{diff.afterTotal}본</span>
            <span
              className={`text-sm font-medium ${
                diff.afterTotal >= diff.beforeTotal ? "text-emerald-700" : "text-amber-700"
              }`}
            >
              {diff.afterTotal - diff.beforeTotal >= 0 ? "+" : ""}
              {diff.afterTotal - diff.beforeTotal}
            </span>
            <span className="ml-auto text-sm text-slate-500">바뀌는 줄 {diff.changed}개</span>
          </div>

          {diff.errors > 0 && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              읽지 못한 줄이 <strong>{diff.errors}개</strong> 있습니다. 그 줄은{" "}
              <strong>건너뜁니다</strong> — 재고는 그대로 둡니다.
            </p>
          )}
          {gone.length > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              엑셀에 없어서 <strong>0본이 되는 줄이 {gone.length}개</strong>입니다 (
              {gone.reduce((s, l) => s + l.before, 0)}본). 실수로 지운 줄이 없는지 봐 주세요.
            </p>
          )}
          {diff.merged > 0 && (
            <p className="mt-2 text-sm text-slate-500">
              같은 품번·DOT 가 여러 줄이라 {diff.merged}번 합쳤습니다.
            </p>
          )}

          <div className="mt-3 max-h-[26rem] overflow-y-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-2 py-2 font-medium">규격 · 모델</th>
                  <th className="px-2 py-2 font-medium">DOT</th>
                  <th className="px-2 py-2 text-right font-medium">전</th>
                  <th className="px-2 py-2 text-right font-medium">후</th>
                  <th className="px-2 py-2 font-medium"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((l, i) => (
                  <tr key={`${l.itemNo}|${l.dot}|${i}`} className={l.kind === "오류" ? "bg-red-50/60" : ""}>
                    <td className="px-2 py-2">
                      <div className="tabular font-medium">{l.spec || l.itemNo}</div>
                      <div className="truncate text-xs text-slate-500">{l.model || l.itemNo}</div>
                      {l.error && <div className="text-xs text-red-600">{l.error}</div>}
                    </td>
                    <td className="tabular px-2 py-2 text-xs text-slate-500">{l.dot ?? "—"}</td>
                    <td className="tabular px-2 py-2 text-right text-slate-500">{l.before}</td>
                    <td className="tabular px-2 py-2 text-right font-bold">{l.after}</td>
                    <td className="px-2 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${KIND_STYLE[l.kind]}`}>
                        {l.kind}
                      </span>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-slate-500">
                      바뀌는 것이 없습니다
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={() => setShowSame((v) => !v)}
            className="mt-2 text-xs text-slate-500 underline underline-offset-4"
          >
            {showSame ? "바뀌는 것만 보기" : `안 바뀌는 줄도 보기 (${lines.length - visible.length}개)`}
          </button>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="rounded-xl border border-slate-300 px-5 py-3 font-medium text-slate-600"
            >
              취소
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={pending || diff.changed === 0}
              className="flex-1 rounded-xl bg-slate-900 py-3 font-semibold text-white active:bg-slate-700 disabled:opacity-40"
            >
              {pending ? "반영 중…" : diff.changed === 0 ? "바뀌는 것이 없습니다" : `${diff.changed}줄 반영하기`}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
