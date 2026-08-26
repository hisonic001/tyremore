"use client";

/**
 * ⭐ 카드 일마감 화면 (사장님 요청 2026-08-26)
 *
 *   ① 매출리포트 올리기(zip 그대로) ② POS 카드 vs 앱 카드 요약 ③ POS에만 있음 / 앱에만 있음 카드
 *   (각각 버튼 하나) ④ 맞은 쌍(접힘, 풀기) ⑤ 손으로 잇기 ⑥ [이 날 마감] / 마감 풀기.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { PosDayData } from "@/lib/pos-close";
import {
  autoMatchPosDay,
  clearPosNote,
  closePosDay,
  fixSaleToCard,
  linkPos,
  moveSaleDate,
  reopenPosDay,
  setPosNote,
  unlinkPos,
} from "@/lib/pos-actions";
import { applyFinUpload } from "@/lib/fin-upload";
import { won } from "@/components/fin/money";
import { useConfirm } from "@/components/ui/confirm";

const REASONS = ["단말기 누락", "앱 미등록", "취소", "다른 날", "기타"] as const;

export function PosCloseUi({ data, ym }: { data: PosDayData; ym: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm();
  const [manualPos, setManualPos] = useState<Record<number, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const day = data.day;
  const prev = new Date(new Date(day + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  const next = new Date(new Date(day + "T00:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);
  const href = (d: string) => `/finance/card?ym=${d.slice(0, 7)}&d=${d}`;

  const act = (fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, okMsg: (r: never) => string) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(String((r as { error?: string }).error ?? "실패했습니다"));
      setMsg(okMsg(r as never));
      router.refresh();
    });

  const upload = (f: File | null) => {
    if (!f) return;
    const fd = new FormData();
    fd.set("file", f);
    act(
      () => applyFinUpload(fd),
      (r: { source: string; newCount: number; dupCount: number }) =>
        `${r.source} 반영 — 새로 ${r.newCount}건 · 이미 있음 ${r.dupCount}건. 자동으로 짝을 맞췄습니다.`,
    );
    if (fileRef.current) fileRef.current.value = "";
  };

  const diff = data.posCardTotal - data.appCardTotal;

  return (
    <section className="mt-3 rounded-card border-2 border-brand-500 bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">카드 일마감</h2>
        <nav className="tabular flex items-center gap-1 text-sm">
          <Link href={href(prev)} className="rounded-control px-2 py-1.5 text-slate-500 lg:hover:bg-slate-100">◀ 어제</Link>
          <strong>{day}</strong>
          <Link href={href(next)} className="rounded-control px-2 py-1.5 text-slate-500 lg:hover:bg-slate-100">다음 ▶</Link>
        </nav>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        토스 포스에서 내려받은 매출리포트(zip 그대로)를 올리면 그 날 카드 결제를 앱 판매와 자동으로 맞춥니다. 남은 것만
        아래 카드에서 버튼 하나로 정리하고 [이 날 마감].
      </p>

      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠ {error}</p>}
      {msg && <p className="mt-2 rounded-lg bg-brand-50 p-2 text-sm text-brand-700">✓ {msg}</p>}

      {/* ① 올리기 */}
      <label className="mt-3 flex flex-wrap items-center gap-2 rounded-control border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <span className="font-medium">매출리포트 올리기</span>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.xlsx,.xls"
          disabled={pending}
          onChange={(e) => upload(e.target.files?.[0] ?? null)}
          className="text-xs"
        />
        <span className="text-xs text-slate-400">zip 비밀번호는 설정에 저장돼 있어 그대로 올리면 됩니다</span>
      </label>

      {/* ② 요약 */}
      {data.hasPos ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-center lg:grid-cols-4">
          <div className="rounded-control border border-slate-200 p-2">
            <p className="text-xs text-slate-500">POS 카드 {data.posCard.length}건</p>
            <p className="tabular font-bold">{won(data.posCardTotal)}원</p>
          </div>
          <div className="rounded-control border border-slate-200 p-2">
            <p className="text-xs text-slate-500">앱 카드 {data.pairs.length + data.appOnly.length}건</p>
            <p className="tabular font-bold">{won(data.appCardTotal)}원</p>
          </div>
          <div className={`rounded-control border p-2 ${diff === 0 ? "border-brand-500 bg-brand-50" : "border-amber-300 bg-amber-50"}`}>
            <p className="text-xs text-slate-500">차이</p>
            <p className="tabular font-bold">{diff === 0 ? "없음 ✓" : `${diff > 0 ? "+" : ""}${won(diff)}원`}</p>
          </div>
          <div className={`rounded-control border p-2 ${data.closed ? "border-slate-800 bg-slate-800 text-white" : data.openN === 0 ? "border-brand-500 bg-brand-50" : "border-amber-300 bg-amber-50"}`}>
            <p className={`text-xs ${data.closed ? "text-slate-300" : "text-slate-500"}`}>상태</p>
            <p className="tabular font-bold">{data.closed ? `마감됨 ${data.closed.at}` : data.openN === 0 ? "마감 가능" : `남은 ${data.openN}건`}</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 rounded-control bg-slate-50 p-3 text-center text-sm text-slate-500">
          {day} POS 자료가 아직 없습니다 — 위에서 매출리포트를 올려 주세요.
          {data.appOnly.length > 0 && ` (앱에는 카드 판매 ${data.appOnly.length}건 · ${won(data.appCardTotal)}원)`}
        </p>
      )}
      {data.posOther.length > 0 && (
        <p className="tabular mt-1.5 text-xs text-slate-400">
          카드 외 POS 결제: {data.posOther.map((o) => `${o.method} ${o.n}건 ${won(o.sum)}원`).join(" · ")}
          {data.posCancelled.length > 0 && ` · 취소로 상쇄 ${data.posCancelled.length / 2 | 0}건`}
        </p>
      )}

      {/* ③ POS에만 있음 */}
      {data.posOnly.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">POS에는 있는데 앱에 없음 — {data.posOnly.length}건</h3>
          <ul className="mt-1.5 space-y-2">
            {data.posOnly.map((p) => (
              <li key={p.id} className={`rounded-control border p-2.5 text-sm ${p.note ? "border-slate-200 bg-slate-50" : "border-amber-300 bg-amber-50"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="tabular">{p.at.slice(0, 5)} · {p.cardCo ?? "카드"}</span>
                  <strong className="tabular">{won(p.amount)}원</strong>
                </div>
                {p.note ? (
                  <p className="mt-1 flex items-center justify-between text-xs text-slate-500">
                    <span>사유: {p.note.reason}{p.note.memo ? ` — ${p.note.memo}` : ""}</span>
                    <button type="button" disabled={pending} onClick={() => act(() => clearPosNote(`pos:${p.id}`), () => "사유를 지웠습니다.")} className="underline">되돌리기</button>
                  </p>
                ) : (
                  <div className="mt-1.5 space-y-1 text-xs">
                    {p.cands.map((c) => (
                      <div key={`${c.kind}${c.quoteId}`} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">{c.label}</span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            c.kind === "fixMethod"
                              ? act(() => fixSaleToCard(c.quoteId, day), () => "카드로 고치고 짝을 맞췄습니다.")
                              : act(() => moveSaleDate(c.quoteId, day), () => "이 날로 옮기고 짝을 맞췄습니다.")
                          }
                          className="shrink-0 rounded-control bg-brand-600 px-2.5 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
                        >
                          {c.kind === "fixMethod" ? "카드로 고치기" : "이 날로 옮기기"}
                        </button>
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <Link href={`/sales?range=range&from=${day}&to=${day}`} className="rounded-control border border-slate-300 bg-white px-2.5 py-1.5 font-medium">
                        정비내역에 등록하러 →
                      </Link>
                      <span className="text-slate-400">또는 사유:</span>
                      {REASONS.filter((r) => r !== "단말기 누락").map((r) => (
                        <button key={r} type="button" disabled={pending}
                          onClick={() => act(() => setPosNote({ day, kind: "pos_only", ref: `pos:${p.id}`, reason: r }), () => `「${r}」로 남겼습니다.`)}
                          className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600">
                          {r}
                        </button>
                      ))}
                    </div>
                    {data.appOnly.length > 0 && (
                      <div className="flex items-center gap-1.5 pt-1">
                        <select value={manualPos[p.id] ?? ""} onChange={(e) => setManualPos((m) => ({ ...m, [p.id]: e.target.value }))} className="rounded-control border border-slate-300 bg-white px-2 py-1">
                          <option value="">앱 판매 골라서 잇기…</option>
                          {data.appOnly.map((a) => (
                            <option key={a.key} value={a.key}>{a.quoteNo} · {a.who} · {won(a.amount)}원</option>
                          ))}
                        </select>
                        <button type="button" disabled={pending || !manualPos[p.id]}
                          onClick={() => act(() => linkPos(p.id, manualPos[p.id]), () => "이었습니다.")}
                          className="rounded-control border border-slate-300 bg-white px-2.5 py-1 font-medium disabled:opacity-40">잇기</button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ④ 앱에만 있음 */}
      {data.hasPos && data.appOnly.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">앱에는 있는데 POS에 없음 — {data.appOnly.length}건</h3>
          <ul className="mt-1.5 space-y-2">
            {data.appOnly.map((a) => (
              <li key={a.key} className={`rounded-control border p-2.5 text-sm ${a.note ? "border-slate-200 bg-slate-50" : "border-amber-300 bg-amber-50"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="tabular text-xs text-slate-400">{a.at ?? ""}</span> {a.quoteNo} · {a.who}
                    <span className="ml-1 text-xs text-slate-400">({a.pm})</span>
                  </span>
                  <strong className="tabular shrink-0">{won(a.amount)}원</strong>
                </div>
                {a.note ? (
                  <p className="mt-1 flex items-center justify-between text-xs text-slate-500">
                    <span>사유: {a.note.reason}{a.note.memo ? ` — ${a.note.memo}` : ""}</span>
                    <button type="button" disabled={pending} onClick={() => act(() => clearPosNote(a.key), () => "사유를 지웠습니다.")} className="underline">되돌리기</button>
                  </p>
                ) : (
                  <div className="mt-1.5 space-y-1 text-xs">
                    {a.cands.map((c) => (
                      <div key={c.posId} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">{c.day.slice(5)} POS에 같은 금액: {c.label}</span>
                        <button type="button" disabled={pending} onClick={() => act(() => linkPos(c.posId, a.key), () => "그 POS 건과 이었습니다.")}
                          className="shrink-0 rounded-control bg-brand-600 px-2.5 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40">이 POS 건과 잇기</button>
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button type="button" disabled={pending}
                        onClick={async () => {
                          const memo = await ask({ title: "단말기 누락으로 표시할까요?", body: `${a.quoteNo} ${won(a.amount)}원 — 단말기 문제로 POS에 안 잡힌 카드 결제로 남깁니다.`, confirmLabel: "표시" });
                          if (!memo) return;
                          act(() => setPosNote({ day, kind: "app_only", ref: a.key, reason: "단말기 누락" }), () => "「단말기 누락」으로 남겼습니다.");
                        }}
                        className="rounded-control bg-brand-600 px-2.5 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40">단말기 누락으로 표시</button>
                      <span className="text-slate-400">또는:</span>
                      {(["취소", "다른 날", "기타"] as const).map((r) => (
                        <button key={r} type="button" disabled={pending}
                          onClick={() => act(() => setPosNote({ day, kind: "app_only", ref: a.key, reason: r }), () => `「${r}」로 남겼습니다.`)}
                          className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600">{r}</button>
                      ))}
                      <Link href={`/sales?range=range&from=${day}&to=${day}`} className="underline">정비내역에서 수단 고치기 →</Link>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ⑤ 맞은 쌍 */}
      {data.pairs.length > 0 && (
        <details className="mt-4 rounded-control border border-slate-200 p-2.5">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">맞은 쌍 {data.pairs.length}건 — 잘못 맞았으면 풀기</summary>
          <ul className="tabular mt-1.5 divide-y divide-slate-100 text-xs">
            {data.pairs.map((pr) => (
              <li key={pr.pos.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate">
                  {pr.pos.at.slice(0, 5)} {pr.pos.cardCo ?? "카드"} {won(pr.pos.amount)}원 ↔ {pr.app.quoteNo} · {pr.app.who}
                  {pr.app.at && ` (${pr.app.at})`}{pr.method === "자동" ? "" : " · 손으로"}
                </span>
                <button type="button" disabled={pending} onClick={() => act(() => unlinkPos(pr.pos.id), () => "풀었습니다.")} className="shrink-0 text-slate-400 underline">풀기</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ⑥ 마감 */}
      {data.hasPos && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" disabled={pending} onClick={() => act(() => autoMatchPosDay(day), (r: { matched: number }) => `${r.matched}건을 새로 맞췄습니다.`)} className="text-xs text-slate-500 underline">
            다시 맞추기
          </button>
          {data.closed ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-600">✅ {day} 카드 마감됨 ({data.closed.at})</span>
              <button type="button" disabled={pending} onClick={() => act(() => reopenPosDay(day), () => "마감을 풀었습니다.")} className="text-xs text-slate-400 underline">마감 풀기</button>
            </div>
          ) : (
            <button type="button" disabled={pending || data.openN > 0}
              onClick={() => act(() => closePosDay(day), () => `${day} 카드 매출을 마감했습니다.`)}
              className="rounded-control bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {data.openN > 0 ? `남은 ${data.openN}건을 정리하면 마감할 수 있어요` : "이 날 마감"}
            </button>
          )}
        </div>
      )}
      {confirmDialog}
    </section>
  );
}
