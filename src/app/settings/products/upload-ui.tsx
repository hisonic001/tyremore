"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyProductList, previewProductList } from "@/lib/product-list";
import type { CatalogPlan, LinkKind, PlanLine } from "@/lib/kumho-sheet";

const KIND_STYLE: Record<LinkKind, string> = {
  신규: "bg-sky-100 text-sky-800",
  품번: "bg-emerald-100 text-emerald-800",
  "규격+패턴": "bg-emerald-50 text-emerald-700",
  // 금호가 같은 타이어에 새 코드를 매긴 것 — 코드만 하나 더 붙인다 (2026-08-27)
  재코드: "bg-emerald-50 text-emerald-700",
  이미연결: "bg-slate-100 text-slate-500",
  애매: "bg-amber-100 text-amber-800",
  규격없음: "bg-red-100 text-red-800",
};

const won = (n: number) => n.toLocaleString("ko-KR");

export interface Reader {
  supplier: string;
  where: string;
  columns: string;
}

/**
 * 거래처 상품목록 올리기 — ① 거래처 고르기 → ② 파일 → ③ 확인 → 반영.
 *
 * 🔴 재고 엑셀과 달리 **이 파일은 정답이 아니다.** 없는 줄을 지우지 않는다.
 *    목록에 있는 것만 이어 주고, 없는 것만 만든다. 그래서 여러 번 나눠 올려도 된다.
 * 🔴 기표가 갱신은 **끄고 시작한다.** 손님에게 말하는 금액이 바뀌는 일이라
 *    사장님이 숫자를 보고 직접 켜셔야 한다.
 */
export function ProductListUpload({ readers }: { readers: Reader[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // 읽을 줄 아는 거래처가 하나뿐이면 고를 것이 없다 — 미리 골라 둔다
  const [supplier, setSupplier] = useState(readers.length === 1 ? readers[0].supplier : "");
  const [files, setFiles] = useState<File[]>([]);
  const [plan, setPlan] = useState<CatalogPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [updatePrices, setUpdatePrices] = useState(false);
  const [createMissing, setCreateMissing] = useState(true);
  const [filter, setFilter] = useState<LinkKind | "전체">("전체");
  const input = useRef<HTMLInputElement>(null);

  function reset() {
    setFiles([]);
    setPlan(null);
    setError(null);
    setFilter("전체");
    if (input.current) input.current.value = "";
  }

  function onPick(list: FileList | null) {
    setError(null);
    setDone(null);
    setPlan(null);
    const fs = list ? [...list] : [];
    setFiles(fs);
    if (fs.length === 0) return;
    const fd = new FormData();
    fd.set("supplier", supplier);
    for (const f of fs) fd.append("file", f);
    start(async () => {
      const r = await previewProductList(fd);
      if (!r.ok) return setError(r.error);
      setPlan(r.plan);
    });
  }

  function onApply() {
    if (files.length === 0) return;
    const fd = new FormData();
    fd.set("supplier", supplier);
    for (const f of files) fd.append("file", f);
    if (updatePrices) fd.set("updatePrices", "on");
    if (createMissing) fd.set("createMissing", "on");
    start(async () => {
      const r = await applyProductList(fd);
      if (!r.ok) return setError(r.error);
      setDone(
        `상품 ${r.created}개를 새로 만들고, 품번 ${r.linked}개를 이었습니다` +
          (r.priceUpdated ? ` · 기표가 ${r.priceUpdated}개 갱신` : ""),
      );
      reset();
      router.refresh();
    });
  }

  const lines: PlanLine[] = plan?.lines ?? [];
  const visible = filter === "전체" ? lines : lines.filter((l) => l.kind === filter);
  const willLink = plan ? plan.counts["품번"] + plan.counts["규격+패턴"] : 0;
  const willCreate = plan?.counts["신규"] ?? 0;
  const nothingToDo = plan !== null && willLink === 0 && (!createMissing || willCreate === 0) && (!updatePrices || plan.priceDiffCount === 0);

  return (
    <>
      {/* ── 1. 거래처 고르기 ── */}
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">1. 어느 거래처 목록인가요</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {readers.map((r) => (
            <button
              key={r.supplier}
              type="button"
              onClick={() => {
                setSupplier(r.supplier);
                reset();
                setDone(null);
              }}
              className={`rounded-xl border px-4 py-2.5 font-semibold ${
                supplier === r.supplier
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-600"
              }`}
            >
              {r.supplier}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {readers.find((r) => r.supplier === supplier)?.where ?? "거래처를 골라 주세요"}
        </p>
        <p className="mt-2 text-xs text-slate-400">
          다른 거래처는 아직 목록 양식을 모릅니다. 파일을 주시면 넣어 두겠습니다 — 화면은 그대로 쓰시면 됩니다.
        </p>
      </section>

      {/* ── 2. 올리기 ── */}
      <section className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">2. 파일 올리기</h2>
        <p className="mt-1 text-sm text-slate-500">
          여러 번 나눠 받으셨다면 <strong>한꺼번에 고르셔도</strong> 됩니다. 이미 들어간 것은 건너뜁니다.
        </p>
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          이 목록은 <strong>재고를 건드리지 않습니다.</strong> 목록에 없는 상품도 그대로 둡니다 — 지워지는 것은
          없습니다.
        </p>

        <label className="mt-3 block">
          <input
            ref={input}
            type="file"
            accept=".xlsx,.xls"
            multiple
            disabled={pending || !supplier}
            onChange={(e) => onPick(e.target.files)}
            className="block w-full rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2.5 file:font-semibold file:text-white"
          />
        </label>

        {pending && !plan && <p className="mt-2 text-sm text-slate-500">읽고 맞춰 보는 중…</p>}
        {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {done && (
          <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">✅ {done}</p>
        )}
      </section>

      {/* ── 3. 미리보기 ── */}
      {plan && (
        <section className="mt-3 rounded-2xl border-2 border-slate-900 bg-white p-4">
          <h2 className="font-semibold">3. 이렇게 됩니다 — 확인해 주세요</h2>
          <p className="mt-1 text-sm text-slate-500">
            {plan.read}개를 읽었습니다{plan.skipped > 0 && ` (합계·빈 줄 ${plan.skipped}개 제외)`}
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {(["품번", "규격+패턴", "신규", "이미연결", "애매", "규격없음"] as LinkKind[]).map((k) =>
              plan.counts[k] > 0 ? (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(filter === k ? "전체" : k)}
                  className={`rounded-lg px-2.5 py-1.5 text-sm font-medium ${KIND_STYLE[k]} ${
                    filter === k ? "ring-2 ring-slate-900" : ""
                  }`}
                >
                  {k} {plan.counts[k]}
                </button>
              ) : null,
            )}
          </div>

          {plan.counts["애매"] > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              후보가 여럿이라 <strong>{plan.counts["애매"]}개는 잇지 않았습니다.</strong> 잘못 이으면 매입원가가
              엉뚱한 상품에 붙습니다 — 그냥 두고 넘어갑니다.
            </p>
          )}

          {/* ── 만들기 ── */}
          <label className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 p-3">
            <input
              type="checkbox"
              checked={createMissing}
              onChange={(e) => setCreateMissing(e.target.checked)}
              className="mt-0.5 size-5 accent-slate-900"
            />
            <span className="text-sm">
              <strong>우리에게 없는 {willCreate}개를 새로 만든다</strong>
              <span className="mt-0.5 block text-slate-500">
                규격 · 하중/속도 · 기표가까지 갖춰서 만듭니다. 인보이스 보고 급히 만드는 것보다 정확합니다.
              </span>
            </span>
          </label>

          {/* ── 기표가 ── */}
          <label
            className={`mt-2 flex items-start gap-3 rounded-xl border p-3 ${
              updatePrices ? "border-amber-400 bg-amber-50" : "border-slate-200"
            }`}
          >
            <input
              type="checkbox"
              checked={updatePrices}
              disabled={plan.priceDiffCount === 0}
              onChange={(e) => setUpdatePrices(e.target.checked)}
              className="mt-0.5 size-5 accent-amber-600"
            />
            <span className="text-sm">
              <strong>기표가를 금호 공장도가로 맞춘다 ({plan.priceDiffCount}개)</strong>
              <span className="mt-0.5 block text-slate-500">
                {plan.priceDiffCount === 0 ? (
                  "다른 것이 없습니다."
                ) : (
                  <>
                    <strong className="text-red-700">{plan.priceUpCount}개는 올라가고</strong>{" "}
                    <strong className="text-emerald-700">{plan.priceDownCount}개는 내려갑니다</strong>
                    {" "}(가장 큰 것 {plan.priceBiggestPct > 0 ? "+" : ""}
                    {plan.priceBiggestPct.toFixed(0)}%).{" "}
                    <strong className="text-amber-900">손님께 말씀하시는 금액이 바뀝니다.</strong> 아래 표에서
                    바뀌는 값을 먼저 봐 주세요.
                  </>
                )}
              </span>
            </span>
          </label>

          {/* ── 표 ── */}
          <div className="mt-3 max-h-[26rem] overflow-y-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-2 py-2 font-medium">금호 자재</th>
                  <th className="px-2 py-2 font-medium">우리 상품</th>
                  <th className="px-2 py-2 text-right font-medium">기표가</th>
                  <th className="px-2 py-2 font-medium"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.slice(0, 400).map((l) => (
                  <tr key={l.row.code}>
                    <td className="px-2 py-2">
                      <div className="tabular font-medium">
                        {l.row.width}
                        {l.row.aspectRatio ? `/${l.row.aspectRatio}` : ""}R{l.row.rimInch?.replace(/\.0$/, "")}{" "}
                        <span className="text-slate-400">{l.row.loadIndex}{l.row.speedRating}</span>
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {l.row.model} · {l.row.code}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      {l.kind === "신규" ? (
                        <span className="text-xs text-sky-700">새로 만듭니다</span>
                      ) : l.kind === "애매" ? (
                        <span className="text-xs text-amber-800">
                          후보 {l.candidates.length}개 — 안 이었습니다
                        </span>
                      ) : (
                        <>
                          <div className="truncate text-xs">{l.productName ?? "—"}</div>
                          <div className="tabular text-xs text-slate-400">{l.ourItemNo}</div>
                        </>
                      )}
                    </td>
                    <td className="tabular px-2 py-2 text-right text-xs">
                      {l.priceChanges && l.ourPrice ? (
                        <>
                          <span className="text-slate-400 line-through">{won(l.ourPrice)}</span>
                          <span className={`ml-1 font-semibold ${updatePrices ? "text-amber-800" : "text-slate-400"}`}>
                            {won(l.row.listPrice ?? 0)}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">{l.row.listPrice ? won(l.row.listPrice) : "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${KIND_STYLE[l.kind]}`}>
                        {l.kind}
                      </span>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-6 text-center text-slate-500">
                      해당하는 줄이 없습니다
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {visible.length > 400 && (
            <p className="mt-1 text-xs text-slate-400">앞 400줄만 보여 드립니다 (반영은 전부 됩니다)</p>
          )}

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
              disabled={pending || nothingToDo}
              className="flex-1 rounded-xl bg-slate-900 py-3 font-semibold text-white active:bg-slate-700 disabled:opacity-40"
            >
              {pending ? "반영 중…" : nothingToDo ? "반영할 것이 없습니다" : "반영하기"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
