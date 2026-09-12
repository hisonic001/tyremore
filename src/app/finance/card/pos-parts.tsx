"use client";

/**
 * ⭐ 카드 일마감 조각 (돈관리 개편 4단계, 2026-09-12)
 *
 *   `pos-close-ui.tsx` 486줄 한 덩어리에서 **모양·동작 그대로** 떼어낸 부품들.
 *   첫 화면(`finance/today-card.tsx`)이 같은 줄·같은 단추를 그대로 쓰기 위해서다 —
 *   판정도 액션도 새로 만들지 않는다. 서버 액션은 전부 `pos-actions.ts` 정본.
 *
 * 🔴 상수는 pos-vocab 에서 — pos-close 는 DB 를 물고 있어 브라우저 묶음에 넣으면 안 된다.
 */
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { PosDayData } from "@/lib/pos-close";
import { POS_REASONS, PREPAID_REASON } from "@/lib/pos-vocab";
import { clearPosNote, closePosDay, fixSaleToPos, linkPos, linkPosMulti, moveSaleDate, reopenPosDay, setPosNote } from "@/lib/pos-actions";
import { won } from "@/components/fin/money";
import type { ConfirmOpts } from "@/components/ui/confirm";
import { W } from "@/lib/fin-words";

/** POS 에만 있을 때 고를 만한 사유 (「단말기 누락」은 앱 쪽 사유다) */
export const POS_ONLY_REASONS = POS_REASONS.filter((r) => r !== "단말기 누락");
/** 앱 쪽에서 못 채웠을 때 */
export const APP_ONLY_REASONS = ["취소", "다른 날", "개인통장 입금", "현금으로 받음", "아직 안 들어옴", "기타"] as const;

/** 카드 화면 한 날로 가는 주소 (원본 pos-close-ui.tsx:58) */
export const posDayHref = (d: string) => `/finance/card?ym=${d.slice(0, 7)}&d=${d}`;

/** 서버 액션 하나를 돌리고 성공 글자를 남기는 손잡이 */
export type PosAct = (
  fn: () => Promise<{ ok: boolean } & Record<string, unknown>>,
  okMsg: (r: never) => string,
) => void;

export type PosOpenItem = PosDayData["posOpen"][number];
export type AppOpenItem = PosDayData["appOpen"][number];

/**
 * 액션 손잡이 — pending · 성공/실패 글자 · act (원본 :45-70).
 * 화면 전용 초기화(체크 풀기 등)는 부르는 쪽이 `onDone` 으로 넘긴다.
 */
export function usePosAct(onDone?: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act: PosAct = (fn, okMsg) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(String((r as { error?: string }).error ?? "실패했습니다"));
      setMsg(okMsg(r as never));
      onDone?.();
      router.refresh();
    });

  return { pending, msg, error, act };
}

/** 올리기 성공 글자 — 카드 화면과 첫 화면이 같은 말을 하도록 한 곳에 */
export const posUploadOkMsg = (r: { source: string; newCount: number; dupCount: number }) =>
  `${r.source} 반영 — 새로 ${r.newCount}건 · 이미 있음 ${r.dupCount}건. 자동으로 ${W.recon}했습니다.`;

/**
 * ① 매출리포트 올리기 (원본 :72-82 + :116-127).
 *
 * 🔴 올리기 화면과 달리 **미리보기가 없다** — 카드 자료(토스포스 zip)는 계정 이름을 고를 일이
 *    없어 고르자마자 `applyFinUpload` 로 직행한다. 토스포스는 ingest 가 파일에 든 날마다
 *    자동 대조까지 이미 하므로 올린 뒤 따로 부를 것이 없다.
 */
export function PosUploadInput({
  pending,
  onFile,
  compact,
}: {
  pending: boolean;
  /** 고른 파일을 싼 FormData — 부르는 쪽이 `act(() => applyFinUpload(fd), posUploadOkMsg)` 로 돌린다 */
  onFile: (fd: FormData) => void;
  /** 첫 화면용 작은 모양 (안내 글자 없음) */
  compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = (f: File | null) => {
    if (!f) return;
    const fd = new FormData();
    fd.set("file", f);
    onFile(fd);
    if (fileRef.current) fileRef.current.value = "";
  };
  return (
    <label
      className={
        compact
          ? "mt-1 flex flex-wrap items-center gap-1.5 rounded-control border border-dashed border-slate-300 bg-slate-50 px-2 py-1.5 text-xs"
          : "mt-3 flex flex-wrap items-center gap-2 rounded-control border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm"
      }
    >
      <span className="font-medium">매출리포트 올리기</span>
      <input
        ref={fileRef}
        type="file"
        accept=".zip,.xlsx,.xls"
        disabled={pending}
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
        className="text-xs"
      />
      {!compact && (
        <span className="text-xs text-slate-400">zip 비밀번호는 설정에 저장돼 있어 그대로 올리면 됩니다</span>
      )}
    </label>
  );
}

/**
 * ③ POS 에만 있는 한 건 (원본 :236-333).
 *   `leading` = 묶어 붙이기 체크칸 · `trailing` = 앱 판매 골라서 대조하는 select — 둘 다
 *   카드 화면에서만 쓰는 슬롯이라 첫 화면은 비워 둔다.
 */
export function PosOnlyItem({
  p,
  day,
  pending,
  act,
  leading,
  trailing,
}: {
  p: PosOpenItem;
  day: string;
  pending: boolean;
  act: PosAct;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <li className={`rounded-control border p-2.5 text-sm ${p.note ? "border-slate-200 bg-slate-50" : "border-amber-300 bg-amber-50"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label className="flex min-w-0 items-baseline gap-1.5">
          {!p.note && leading}
          <span className="tabular truncate">
            {p.at.slice(0, 5)} · {p.cardCo ?? p.appMethod}
            {p.appMethod !== "카드" && <span className="ml-1 rounded bg-violet-100 px-1 text-[10px] text-violet-800">간편</span>}
          </span>
        </label>
        <strong className="tabular shrink-0">
          {won(p.remain)}원
          {p.linked > 0 && <span className="ml-1 text-xs font-normal text-slate-400">남음 ({W.recon}된 돈 {won(p.linked)})</span>}
        </strong>
      </div>
      {p.note ? (
        <p className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span>사유: {p.note.reason}{p.note.memo ? ` — ${p.note.memo}` : ""}</span>
          <button type="button" disabled={pending} onClick={() => act(() => clearPosNote(`pos:${p.id}`), () => "사유를 지웠습니다.")} className="shrink-0 underline">되돌리기</button>
        </p>
      ) : (
        <div className="mt-1.5 space-y-1 text-xs">
          {p.cands.map((c, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{c.label}</span>
              {c.kind === "fixMethod" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => fixSaleToPos(c.quoteId, day, c.toMethod), () => `${c.toMethod}로 고치고 ${W.recon}했습니다.`)}
                  className="shrink-0 rounded-control bg-brand-600 px-2.5 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
                >
                  {c.toMethod}로 고치기
                </button>
              ) : c.kind === "moveDate" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => moveSaleDate(c.quoteId, day), () => `이 날로 옮기고 ${W.recon}했습니다.`)}
                  className="shrink-0 rounded-control border border-slate-300 bg-white px-2.5 py-1.5 font-medium disabled:opacity-40"
                >
                  이 날로 옮기기
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => linkPos(p.id, c.appKey), (r: { amount: number }) => `${won(r.amount)}원을 ${W.recon}했습니다.`)}
                  className="shrink-0 rounded-control bg-brand-600 px-2.5 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
                >
                  {c.exact ? `그 판매에 ${W.recon}` : `${won(c.amount)}원 ${W.recon}`}
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Link href={`/sales?range=range&from=${day}&to=${day}`} className="rounded-control border border-slate-300 bg-white px-2.5 py-1.5 font-medium">
              정비내역에 등록하러 →
            </Link>
            <span className="text-slate-400">또는 사유:</span>
            {POS_ONLY_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                disabled={pending}
                onClick={() => act(() => setPosNote({ day, kind: "pos_only", ref: `pos:${p.id}`, reason: r }), () => `「${r}」로 남겼습니다.`)}
                className={`rounded-full border px-2 py-0.5 ${r === PREPAID_REASON ? "border-violet-300 bg-violet-50 font-medium text-violet-800" : "border-slate-300 bg-white text-slate-600"}`}
              >
                {r === PREPAID_REASON ? "미리 받은 돈" : r}
              </button>
            ))}
          </div>
          {trailing}
        </div>
      )}
    </li>
  );
}

/** ④ 앱에는 있는데 POS 로 못 채운 한 건 (원본 :343-426) */
export function AppOnlyItem({
  a,
  day,
  pending,
  act,
  ask,
}: {
  a: AppOpenItem;
  day: string;
  pending: boolean;
  act: PosAct;
  ask: (opts: ConfirmOpts) => Promise<boolean>;
}) {
  return (
    <li className={`rounded-control border p-2.5 text-sm ${a.note ? "border-slate-200 bg-slate-50" : "border-amber-300 bg-amber-50"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate">
          <span className="tabular text-xs text-slate-400">{a.at ?? ""}</span> {a.quoteNo} · {a.who}
          <span className="ml-1 text-xs text-slate-400">({a.pm})</span>
        </span>
        <strong className="tabular shrink-0">
          {won(a.remain)}원
          {a.linked > 0 && <span className="ml-1 text-xs font-normal text-slate-400">남음 ({W.recon}된 돈 {won(a.linked)})</span>}
        </strong>
      </div>
      {a.note ? (
        <p className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span>사유: {a.note.reason}{a.note.memo ? ` — ${a.note.memo}` : ""}</span>
          <button type="button" disabled={pending} onClick={() => act(() => clearPosNote(a.key), () => "사유를 지웠습니다.")} className="shrink-0 underline">되돌리기</button>
        </p>
      ) : (
        <div className="mt-1.5 space-y-1 text-xs">
          {a.cands.map((c, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className={`min-w-0 truncate ${c.kind === "fixSelfMethod" ? "font-medium text-violet-800" : ""}`}>
                {c.kind === "fixSelfMethod" ? c.label : c.kind === "linkPosMulti" ? `합치면 딱 맞음: ${c.label}` : `POS: ${c.label}`}
              </span>
              {c.kind === "fixSelfMethod" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => fixSaleToPos(c.quoteId, day, c.toMethod), (r: { matched: number }) => `${c.toMethod}로 고쳤습니다 — ${r.matched}건이 자동으로 ${W.recon}됐습니다.`)}
                  className="shrink-0 rounded-control bg-violet-700 px-2.5 py-1.5 font-semibold text-white disabled:opacity-40"
                >
                  {c.toMethod}로 고치기
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    c.kind === "linkPosMulti"
                      ? act(() => linkPosMulti(c.posIds, a.key), (r: { n: number; amount: number }) => `${r.n}건 ${won(r.amount)}원을 함께 ${W.recon}했습니다.`)
                      : act(() => linkPos(c.posId, a.key), (r: { amount: number }) => `${won(r.amount)}원을 ${W.recon}했습니다.`)
                  }
                  className="shrink-0 rounded-control bg-brand-600 px-2.5 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
                >
                  {c.kind === "linkPosMulti" ? `${c.posIds.length}건 함께 ${W.recon}` : c.exact ? `이 POS 건과 ${W.recon}` : `${won(c.amount)}원만 ${W.recon}`}
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <button
              type="button"
              disabled={pending}
              onClick={async () => {
                const yes = await ask({
                  title: "단말기 누락으로 표시할까요?",
                  body: `${a.quoteNo} ${won(a.remain)}원 — 단말기 문제로 POS에 안 잡힌 결제로 남깁니다.`,
                  confirmLabel: "표시",
                });
                if (!yes) return;
                act(() => setPosNote({ day, kind: "app_only", ref: a.key, reason: "단말기 누락" }), () => "「단말기 누락」으로 남겼습니다.");
              }}
              className="rounded-control bg-brand-600 px-2.5 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
            >
              단말기 누락으로 표시
            </button>
            <span className="text-slate-400">또는:</span>
            {APP_ONLY_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                disabled={pending}
                onClick={() => act(() => setPosNote({ day, kind: "app_only", ref: a.key, reason: r }), () => `「${r}」로 남겼습니다.`)}
                className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600"
              >
                {r}
              </button>
            ))}
            <Link href={`/sales?range=range&from=${day}&to=${day}`} className="underline">정비내역에서 수단 고치기 →</Link>
          </div>
        </div>
      )}
    </li>
  );
}

/** ⑥ [이 날 마감] / 마감됨 + 마감 풀기 (원본 :466-480) */
export function PosCloseButton({
  day,
  openN,
  closed,
  pending,
  act,
}: {
  day: string;
  openN: number;
  closed: { at: string } | null;
  pending: boolean;
  act: PosAct;
}) {
  return closed ? (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-600">✅ {day} 카드 마감됨 ({closed.at})</span>
      <button type="button" disabled={pending} onClick={() => act(() => reopenPosDay(day), () => "마감을 풀었습니다.")} className="text-xs text-slate-400 underline">마감 풀기</button>
    </div>
  ) : (
    <button
      type="button"
      disabled={pending || openN > 0}
      onClick={() => act(() => closePosDay(day), () => `${day} 카드 매출을 마감했습니다.`)}
      className="rounded-control bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
    >
      {openN > 0 ? `남은 ${openN}건을 정리하면 마감할 수 있어요` : "이 날 마감"}
    </button>
  );
}
