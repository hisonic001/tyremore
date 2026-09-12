"use client";

/**
 * ⭐ 카드 일마감 화면 (사장님 요청 2026-08-26)
 *
 *   ① 매출리포트 올리기(zip 그대로) ② POS vs 앱 요약 ③ POS에만 있음 / 앱에서 못 채운 것
 *   (각각 버튼 하나) ④ 대조 내역(접힘 — 풀기는 「최근 한 일」에서, 2026-09-12) ⑤ [이 날 마감] / 마감 풀기.
 *
 * ⭐ 2026-08-29 (사장님 제보 "카드 일마감시 예외사항들이 많음")
 *   · 카드 옆에 **간편결제**가 나란히 선다 (토스 포스의 QR결제).
 *   · 양쪽 다 「대조된 돈 / 남은 금액」을 보여준다 — 미리 받은 돈·나중에 받은 돈이 눈에 보인다.
 *   · POS 여러 건에 체크해서 **한 판매에 함께 붙이기** (카드 두 장으로 나눠 긁기).
 *   · 다른 날 후보를 앞뒤 7일까지, 며칠 차이인지 적어서 보여준다.
 *   · 「선결제」로 남긴 건은 판매가 생길 때까지 맨 위에 따라다닌다.
 *
 * ⭐ 2026-09-12 (개편 4단계) — 모양·동작은 그대로 두고 **조각으로 잘라 재조립**했다.
 *   올리기·POS 줄·앱 줄·마감 단추는 `pos-parts.tsx` 로 옮겨 첫 화면(「오늘」 카드 줄)이
 *   같은 부품을 쓴다. 이 화면에만 있는 것(묶어 붙이기 체크·지난 선결제·대조 내역·다시 대조)은
 *   여기 그대로 남는다. 날짜 nav 옆에 「다음 안 된 날 →」이 붙었다.
 */
import { useState } from "react";
import Link from "@/lib/link";
import type { PosDayData } from "@/lib/pos-close";
import { autoMatchPosDay, linkPos, linkPosMulti } from "@/lib/pos-actions";
import { applyFinUpload } from "@/lib/fin-upload";
import { won } from "@/components/fin/money";
import { useConfirm } from "@/components/ui/confirm";
// ⭐ 화면 글자는 fin-words 정본 (ERP 용어, 2026-09-12): 붙이기→대조, 붙은 자국→대조 내역
import { W } from "@/lib/fin-words";
import {
  AppOnlyItem,
  PosCloseButton,
  PosOnlyItem,
  PosUploadInput,
  posDayHref,
  posUploadOkMsg,
  usePosAct,
} from "./pos-parts";

export function PosCloseUi({ data, nextOpenDay }: { data: PosDayData; nextOpenDay?: string | null }) {
  const [ask, confirmDialog] = useConfirm();
  /** 묶어 붙이기 — 체크한 POS 건 */
  const [picked, setPicked] = useState<number[]>([]);
  const [pickTarget, setPickTarget] = useState("");
  const [manualPos, setManualPos] = useState<Record<number, string>>({});
  /* 액션이 성공하면 이 화면 전용 고른 것들을 푼다 (원본 act 안의 setPicked·setPickTarget) */
  const { pending, msg, error, act } = usePosAct(() => {
    setPicked([]);
    setPickTarget("");
  });
  const day = data.day;
  const prev = new Date(new Date(day + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  const next = new Date(new Date(day + "T00:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);
  const href = posDayHref;

  const diff = data.posTotal - data.appTotal;
  /** 대조할 수 있는 대상 — 그 날 남은 금액이 있는 앱 항목 */
  const targets = data.appOpen.filter((a) => a.remain > 0);
  const pickedSum = data.posOpen.filter((p) => picked.includes(p.id)).reduce((s, p) => s + p.remain, 0);
  const toggle = (id: number) => setPicked((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  /** 카드 · 간편결제 갈래 (간편이 없으면 안 적는다) */
  const split = (card: number, easy: number) =>
    easy === 0 ? null : (
      <p className="text-[11px] text-slate-400">
        카드 {won(card)} + 간편 {won(easy)}
      </p>
    );

  return (
    <section className="mt-3 rounded-card border-2 border-brand-500 bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">카드 일마감</h2>
        <nav className="tabular flex items-center gap-1 text-sm">
          <Link href={href(prev)} className="rounded-control px-2 py-1.5 text-slate-500 lg:hover:bg-slate-100">◀ 어제</Link>
          <strong>{day}</strong>
          <Link href={href(next)} className="rounded-control px-2 py-1.5 text-slate-500 lg:hover:bg-slate-100">다음 ▶</Link>
          {/* ⭐ 4단계(2026-09-12): 이 날 말고 아직 안 된 날이 있으면 바로 건너뛴다 */}
          {nextOpenDay && (
            <Link href={href(nextOpenDay)} className="rounded-control px-2 py-1.5 font-medium text-brand-600 lg:hover:bg-brand-50">
              {W.nextOpenDay} {Number(nextOpenDay.slice(5, 7))}/{Number(nextOpenDay.slice(8, 10))} →
            </Link>
          )}
        </nav>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        토스 포스에서 내려받은 매출리포트(zip 그대로)를 올리면 그 날 <strong>카드·간편결제</strong>를 앱 판매와 자동으로
        {W.recon}합니다. 남은 것만 아래 카드에서 버튼 하나로 정리하고 [이 날 마감].
      </p>

      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠ {error}</p>}
      {msg && <p className="mt-2 rounded-lg bg-brand-50 p-2 text-sm text-brand-700">✓ {msg}</p>}

      {/* ① 올리기 */}
      <PosUploadInput pending={pending} onFile={(fd) => act(() => applyFinUpload(fd), posUploadOkMsg)} />

      {/* ② 요약 */}
      {data.hasPos ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-center lg:grid-cols-4">
          <div className="rounded-control border border-slate-200 p-2">
            <p className="text-xs text-slate-500">POS {data.posLive.length}건</p>
            <p className="tabular font-bold">{won(data.posTotal)}원</p>
            {split(data.posCardTotal, data.posEasyTotal)}
          </div>
          <div className="rounded-control border border-slate-200 p-2">
            <p className="text-xs text-slate-500">앱 판매</p>
            <p className="tabular font-bold">{won(data.appTotal)}원</p>
            {split(data.appCardTotal, data.appEasyTotal)}
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
          {data.appOpen.length > 0 && ` (앱에는 카드·간편결제 판매 ${data.appOpen.length}건 · ${won(data.appTotal)}원)`}
        </p>
      )}
      {(data.posOther.length > 0 || data.posCancelled.length > 0) && (
        <p className="tabular mt-1.5 text-xs text-slate-400">
          {data.posOther.length > 0 && `대조 안 하는 POS 결제: ${data.posOther.map((o) => `${o.method} ${o.n}건 ${won(o.sum)}원`).join(" · ")}`}
          {data.posCancelled.length > 0 && ` · 취소로 ${W.offset} ${Math.floor(data.posCancelled.length / 2)}건`}
        </p>
      )}

      {/* ⓪ 아직 판매에 안 붙은 지난 선결제 */}
      {data.prepaid.length > 0 && (
        <div className="mt-4 rounded-control border border-violet-300 bg-violet-50 p-2.5">
          <h3 className="text-sm font-semibold text-violet-900">
            미리 받아 둔 돈 {data.prepaid.length}건 — 아직 판매에 {W.recon} 안 됐습니다
          </h3>
          <ul className="tabular mt-1 space-y-1 text-xs text-violet-900">
            {data.prepaid.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {p.day.slice(5)} {p.at.slice(0, 5)} · {p.cardCo ?? p.appMethod} · 남은 {won(p.remain)}원
                </span>
                {targets.length > 0 && (
                  <span className="flex items-center gap-1">
                    <select
                      value={manualPos[p.id] ?? ""}
                      onChange={(e) => setManualPos((m) => ({ ...m, [p.id]: e.target.value }))}
                      className="rounded-control border border-violet-300 bg-white px-2 py-1"
                    >
                      <option value="">오늘 판매에 {W.recon}…</option>
                      {targets.map((a) => (
                        <option key={a.key} value={a.key}>
                          {a.quoteNo} · {a.who} · 남은 {won(a.remain)}원
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={pending || !manualPos[p.id]}
                      onClick={() => act(() => linkPos(p.id, manualPos[p.id]), (r: { amount: number }) => `${won(r.amount)}원을 ${W.recon}했습니다.`)}
                      className="rounded-control bg-violet-700 px-2.5 py-1 font-semibold text-white disabled:opacity-40"
                    >
                      {W.recon}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ③ POS에만 있음 */}
      {data.posOpen.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">POS에는 있는데 앱에 없음 — {data.posOpen.length}건</h3>
            {picked.length > 0 && targets.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <span className="tabular font-semibold text-brand-700">
                  고른 {picked.length}건 {won(pickedSum)}원
                </span>
                <select value={pickTarget} onChange={(e) => setPickTarget(e.target.value)} className="rounded-control border border-slate-300 bg-white px-2 py-1">
                  <option value="">함께 {W.recon}할 판매…</option>
                  {targets.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.quoteNo} · {a.who} · 남은 {won(a.remain)}원
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={pending || !pickTarget}
                  onClick={() => act(() => linkPosMulti(picked, pickTarget), (r: { n: number; amount: number }) => `${r.n}건 ${won(r.amount)}원을 함께 ${W.recon}했습니다.`)}
                  className="rounded-control bg-brand-600 px-2.5 py-1 font-semibold text-white disabled:opacity-40"
                >
                  함께 {W.recon}
                </button>
              </div>
            )}
          </div>
          <ul className="mt-1.5 space-y-2">
            {data.posOpen.map((p) => (
              <PosOnlyItem
                key={p.id}
                p={p}
                day={day}
                pending={pending}
                act={act}
                leading={
                  targets.length > 0 ? (
                    <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} disabled={pending} className="size-4" />
                  ) : null
                }
                trailing={
                  targets.length > 0 ? (
                    <div className="flex items-center gap-1.5 pt-1">
                      <select value={manualPos[p.id] ?? ""} onChange={(e) => setManualPos((m) => ({ ...m, [p.id]: e.target.value }))} className="rounded-control border border-slate-300 bg-white px-2 py-1">
                        <option value="">앱 판매 골라서 {W.recon}…</option>
                        {targets.map((a) => (
                          <option key={a.key} value={a.key}>
                            {a.quoteNo} · {a.who} · 남은 {won(a.remain)}원
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={pending || !manualPos[p.id]}
                        onClick={() => act(() => linkPos(p.id, manualPos[p.id]), (r: { amount: number }) => `${won(r.amount)}원을 ${W.recon}했습니다.`)}
                        className="rounded-control border border-slate-300 bg-white px-2.5 py-1 font-medium disabled:opacity-40"
                      >
                        {W.recon}
                      </button>
                    </div>
                  ) : null
                }
              />
            ))}
          </ul>
        </div>
      )}

      {/* ④ 앱에서 못 채운 것 */}
      {data.appOpen.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">앱에는 있는데 POS로 못 채운 것 — {data.appOpen.length}건</h3>
          <ul className="mt-1.5 space-y-2">
            {data.appOpen.map((a) => (
              <AppOnlyItem key={a.key} a={a} day={day} pending={pending} act={act} ask={ask} />
            ))}
          </ul>
        </div>
      )}

      {/* ⑤ 대조 내역 — 목록은 이 화면의 일부라 남기고, 줄마다 있던 「풀기」(unlinkMatch)는
          2단계(2026-09-12)부터 「최근 한 일」 한 곳에서 되돌린다(결정 f). */}
      {data.matches.length > 0 && (
        <details className="mt-4 rounded-control border border-slate-200 p-2.5">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">{W.reconLog} {data.matches.length}건</summary>
          <ul className="tabular mt-1.5 divide-y divide-slate-100 text-xs">
            {data.matches.map((m) => (
              <li key={m.id} className="py-1.5">
                <span className="block min-w-0 truncate">
                  {m.pos.day !== day && <span className="text-slate-400">{m.pos.day.slice(5)} </span>}
                  {m.pos.at.slice(0, 5)} {m.pos.cardCo ?? m.pos.appMethod} {won(m.amount)}원 ↔ {m.app.quoteNo} · {m.app.who}
                  {m.app.day !== day && <span className="text-slate-400"> ({m.app.day.slice(5)} 판매)</span>}
                  {m.method === "자동" ? "" : " · 손으로"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-slate-400">
            잘못 {W.recon}됐으면{" "}
            <Link href="/finance/activity" className="underline underline-offset-2">{W.activityUndoHere}</Link>
          </p>
        </details>
      )}

      {/* ⑥ 마감 */}
      {data.hasPos && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => autoMatchPosDay(day), (r: { matched: number }) => `${r.matched}건을 새로 ${W.recon}했습니다.`)}
            className="text-xs text-slate-500 underline"
          >
            다시 {W.recon}
          </button>
          <PosCloseButton day={day} openN={data.openN} closed={data.closed} pending={pending} act={act} />
        </div>
      )}
      {confirmDialog}
    </section>
  );
}
