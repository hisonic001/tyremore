"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { queueForMars } from "@/lib/mars-queue";
import { cancelMarsRun, requestMarsRun, type MarsRunRow } from "@/lib/mars-run";
import type { SaleDay, SaleRow } from "@/lib/sale-history";
import { SaleCard } from "./client";
import { removeCollection } from "@/lib/receivable";
import { useConfirm } from "@/components/ui/confirm";

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * ⭐ MARS 올리기 — 정비 내역에서 골라서 (사장님 지시 2026-08-09)
 *
 *   "MARS 입력 대기열 페이지 자체를 삭제. 정비 내역에 MARS 자동 올리기 버튼을 만들고
 *    클릭시 정비카드들을 체크할 수 있도록 되며 … mars올리기 버튼을 누르면 체크한
 *    카드들이 자동으로 현재처럼 mars에 올라가고 mars에 등록되었다는 표식이 생김."
 *
 * 판매 등록은 '보류' 로 저장되고, 여기서 체크한 것만 '미전송' 이 되어
 * 매장 PC 의 mars-agent 가 집어 간다. 실행 진행 로그(옛 /mars 의 패널)도 여기서 보인다.
 *
 * 체크할 수 있는 카드 = 성사 + '보류'·'수동처리'.
 * '해당없음'(거래처·서비스)과 이미 올라간 '전송완료', 올라가는 중인 '미전송'은 체크 불가.
 */
export function SalesList({
  days,
  run,
  hiddenCount,
  shown,
  owner = false,
  canCollect = false,
  canReassign = false,
}: {
  days: SaleDay[];
  run: MarsRunRow | null;
  hiddenCount: number;
  shown: number;
  /** ⭐ 손님·거래처 바꾸기는 사장님만 보인다 (2026-08-17) */
  owner?: boolean;
  canCollect?: boolean;
  canReassign?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  /**
   * ⭐ MARS 필수 정보가 하나라도 없으면 체크 자체를 막는다 (사장님 지시 2026-08-17) —
   *    "차대번호를 제외한 고객과 차량 정보가 없으면 입력이 안될것임".
   *    앱 등록은 자유롭게 두고 문턱은 여기다. 규칙은 mars-ready.ts 한 곳
   *    (서버 queueForMars·매장 PC 와 같은 규칙 — 주행거리 뒷걸음은 서버가 걸러 알려준다).
   */
  /** 외상·서비스는 MARS 에 안 올린다 — 체크했다가 로봇이 되돌리는 헛걸음을 없앤다 (2026-08-17) */
  const payBlocked = (s: SaleRow) => s.paymentMethod === "외상" || s.paymentMethod === "서비스";
  const eligible = (s: SaleRow) =>
    s.status === "성사" &&
    (s.marsStatus === "보류" || s.marsStatus === "수동처리") &&
    !payBlocked(s) &&
    s.totalAmount > 0 && // 0원·마이너스(환불)는 MARS 대상 아님 (2026-08-21)
    s.marsMissing.length === 0;
  /** 체크만 못 하게 흐려진 카드에 **왜**를 보여준다 — 이유 없이 안 눌리면 답답하다 */
  const blockedReason = (s: SaleRow) => {
    if (s.status !== "성사" || (s.marsStatus !== "보류" && s.marsStatus !== "수동처리")) return null;
    if (s.paymentMethod === "외상") return "외상 — 수금 뒤 「날짜·결제 고치기」로 실제 수단으로 바꾸면 올릴 수 있습니다";
    if (s.paymentMethod === "서비스") return "서비스(무상) — MARS 에 올리지 않습니다";
    if (s.totalAmount <= 0) return "0원·마이너스(환불) 판매 — MARS 에 올리지 않습니다 (반품은 MARS 에서 직접)";
    if (s.marsMissing.length > 0) return `MARS 필수 정보 없음: ${s.marsMissing.join(" · ")}`;
    return null;
  };
  const all = days.flatMap((d) => d.sales);
  const eligibleCount = all.filter(eligible).length;
  /** 체크해서 '미전송' 이 됐지만 매장 PC 가 아직 안 집어 간 것 */
  const waitingCount = all.filter((s) => s.status === "성사" && s.marsStatus === "미전송").length;
  const selected = Object.entries(sel)
    .filter(([, v]) => v)
    .map(([k]) => Number(k));

  const busy = run !== null && (run.status === "대기" || run.status === "실행중");

  /**
   * 🔴 실행 중에는 5초마다 다시 불러 로그를 보여준다 — 단, 앞선 새로고침이
   *    끝나기 전에는 다음 것을 쏘지 않는다 (2026-08-07 마비 사건. 겹쳐 쏘면
   *    렌더가 중단되고 그 DB 질의가 좀비로 남아 풀러를 채운다). 탭이 안 보일 때도 쉰다.
   */
  const [refreshing, startRefresh] = useTransition();
  const refreshingRef = useRef(false);
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      if (document.hidden || refreshingRef.current) return;
      startRefresh(() => router.refresh());
    }, 5000);
    return () => clearInterval(t);
  }, [busy, router]);

  function upload() {
    start(async () => {
      setError(null);
      setMsg(null);
      const r = await queueForMars(selected);
      if (!r.ok) return setError(r.error);
      setSelecting(false);
      setSel({});
      // 주행거리 문제로 빠진 건이 있으면 같이 보여준다 (2026-08-17)
      if (r.warning) setError(r.warning);
      setMsg(
        `${r.queued}건을 MARS 올리기로 보냈습니다.` +
          (r.runExisting ? " 앞선 실행이 끝나면 「다시 실행 요청」을 눌러 주세요." : " 매장 PC 가 곧 처리합니다."),
      );
    });
  }

  /** 매장 PC 가 꺼져 있었거나 실행이 실패해 '미전송' 이 남았을 때 다시 부른다 */
  function rerun() {
    start(async () => {
      setError(null);
      setMsg(null);
      const r = await requestMarsRun("입력");
      if (!r.ok) return setError(r.error);
      setMsg(r.existing ? "이미 실행이 잡혀 있습니다 — 곧 처리됩니다." : "실행을 요청했습니다.");
    });
  }

  /**
   * ⭐ 상단 정리 (사장님 선택 2026-09-04) — 보라 판이 항상 크게 떠 있어 본문보다
   *    먼저 눈에 들어왔다. 할 일(올릴 것·대기·실행 중·실패·선택 중)이 있을 때만
   *    큰 판, 없으면 조용한 한 줄.
   */
  const hasWork =
    busy || selecting || eligibleCount > 0 || waitingCount > 0 || run?.status === "실패" || !!error || !!msg;

  return (
    <>
      {!hasWork && (
        <p className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400">
          MARS 자동 올리기 — 지금 올릴 것이 없습니다
        </p>
      )}
      {/* ── MARS 올리기 판 — 옛 /mars 페이지가 이 안으로 들어왔다 ── */}
      {hasWork && (
      <div className="sticky top-0 z-10 mt-4 rounded-xl border border-indigo-300 bg-indigo-50 p-3 shadow-sm">
        {busy ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-indigo-900">MARS 자동 입력</span>
              <span className="flex items-center gap-1.5 text-xs font-medium text-indigo-700">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-600" />
                {run.status === "대기" ? "매장 PC 를 기다리는 중" : "실행 중"}
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between text-xs text-indigo-700">
              <span>{run.status === "대기" ? `${run.requestedAt} 요청됨` : `${run.startedAt} 시작`}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await cancelMarsRun(run.id);
                    if (!r.ok) setError(r.error);
                  })
                }
                className="underline underline-offset-2"
              >
                중단 처리
              </button>
            </div>
            {/* 로그는 안 보여준다 (사장님 지시 2026-08-09) — 매장 PC 터미널에서 보면 된다 */}
            {run.status === "대기" && (
              <p className="mt-1.5 text-xs text-indigo-700">
                1분이 지나도 시작하지 않으면 매장 PC 의 <code className="rounded bg-white px-1">mars-agent</code>{" "}
                창이 꺼진 것입니다.
              </p>
            )}
          </>
        ) : selecting ? (
          <>
            <p className="text-sm font-semibold text-indigo-900">
              MARS 에 올릴 카드를 체크하세요 — <span className="tabular">{selected.length}건</span> 선택됨
            </p>
            <p className="mt-0.5 text-xs text-indigo-700">
              이미 올라간 것(✓)과 거래처·서비스 판매, <strong>MARS 필수 정보가 빈 판매</strong>는 체크할
              수 없습니다 — 흐린 카드에 무엇이 없는지 나옵니다. 주행거리는 「날짜·결제 고치기」에서,
              나머지는 고객·차량 카드에서 채우면 됩니다.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={pending || selected.length === 0}
                onClick={upload}
                className="flex-1 rounded-xl bg-indigo-700 py-3 font-semibold text-white active:bg-indigo-800 disabled:opacity-40"
              >
                {pending ? "처리 중…" : `체크한 ${selected.length}건 MARS 올리기`}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setSelecting(false);
                  setSel({});
                }}
                className="rounded-xl border border-indigo-300 bg-white px-4 text-sm font-medium text-indigo-700"
              >
                취소
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending || eligibleCount === 0}
              onClick={() => {
                setError(null);
                setMsg(null);
                setSelecting(true);
              }}
              className="flex-1 rounded-xl bg-indigo-700 py-3 font-semibold text-white active:bg-indigo-800 disabled:opacity-40"
            >
              {eligibleCount === 0 ? "MARS 에 올릴 것이 없습니다" : `MARS 자동 올리기 (올릴 수 있는 ${eligibleCount}건)`}
            </button>
            {waitingCount > 0 && (
              <button
                type="button"
                disabled={pending}
                onClick={rerun}
                className="rounded-xl border border-indigo-400 bg-white px-3 py-3 text-sm font-semibold text-indigo-800"
              >
                대기 {waitingCount}건 다시 실행 요청
              </button>
            )}
          </div>
        )}

        {!busy && run?.status === "실패" && (
          <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">
            ⚠️ 지난 실행이 실패했습니다 ({run.finishedAt ?? ""}). 올라가지 못한 건은 「다시 실행 요청」으로 다시 부를 수 있습니다.
          </p>
        )}
        {error && (
          <p className="mt-2 whitespace-pre-line rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        {msg && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}
      </div>
      )}

      {days.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          정비 내역이 없습니다
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {/*
            ⭐ 영수증형 개별 카드 (사장님 재피드백 2026-09-04 — "정비마다 카드별로
               나뉘는 것이 더 나았던 듯"). 날짜는 배경 위 헤더, 아래 단일 열 카드.
          */}
          {days.map((d) => (
            <section key={d.date}>
              <div className="flex items-baseline justify-between px-1">
                <h2 className="tabular font-semibold">{d.date}</h2>
                <span className="tabular text-sm text-slate-500">
                  {d.qty > 0 && `타이어 ${d.qty}본 · `}
                  {won(d.amount)}원
                  {/* ⭐ 외상 수금 (2026-09-03) — 매출과 색으로 구분, 합계(d.amount)에 안 섞임 */}
                  {d.collectedSum > 0 && (
                    <span className="ml-1.5 font-medium text-emerald-700">· 외상 수금 +{won(d.collectedSum)}원</span>
                  )}
                </span>
              </div>
              <ul className="mt-1.5 space-y-2">
                {d.sales.map((s) => (
                  <SaleCard
                    owner={owner}
                    canCollect={canCollect}
                    canReassign={canReassign}
                    key={s.quoteId}
                    sale={s}
                    select={
                      selecting
                        ? {
                            eligible: eligible(s),
                            checked: !!sel[s.quoteId],
                            toggle: () => setSel((v) => ({ ...v, [s.quoteId]: !v[s.quoteId] })),
                            reason: blockedReason(s),
                          }
                        : undefined
                    }
                  />
                ))}
              </ul>
              {/* ⭐ 그날 받은 외상 수금 (사장님 요청 2026-09-03 — 정산한 날에도 정비내역에).
                  카드 복제가 아니라 줄 — MARS 선택·건수·매출 합계에 안 섞인다 */}
              {d.collections.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {groupCollections(d.collections).map((g) => (
                    <CollectionGroup key={g[0].id} items={g} canCollect={canCollect} />
                  ))}
                </ul>
              )}
            </section>
          ))}
          {hiddenCount > 0 && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-center text-sm text-amber-900">
              화면이 얼지 않도록 <strong>최근 {shown}건까지만</strong> 보여드렸습니다.
              <br />
              나머지 {hiddenCount.toLocaleString()}건은 위에서 <strong>달이나 기간을 좁히면</strong> 다 보입니다.
            </p>
          )}
        </div>
      )}
    </>
  );
}

/**
 * ⭐ 외상 수금 줄 + 되돌리기 (사장님 제보 2026-09-03 — "테스트로 1000원을 넣었는데
 *    되돌리는게 불가함"). 지우기는 수금과 같은 정본(removeCollection, 외상 권한) —
 *    지우면 그 판매의 잔액이 다시 살아나고 이 줄도 사라진다.
 *
 * ⭐ 같은 거래처를 한꺼번에 정산하면 **한 줄로 묶는다** (사장님 제보 2026-09-04 —
 *    "그날 수금 받은 것만 뜨면 되는데 과거 내역까지 전부 뜸"). 실은 전부 그날 받은
 *    수금인데, 건별 줄마다 과거 정비 날짜가 붙어 과거 내역이 뜨는 것처럼 보였다.
 *    이제 받은 돈이 한 줄, 어느 정비 값인지는 눌러야 나온다.
 */
type DayColl = SaleDay["collections"][number];

/** 되돌리기 한 건 — 묶음 안 줄과 단독 줄이 같이 쓴다 */
function useUndoCollection(c: DayColl) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  const [err, setErr] = useState<string | null>(null);

  const undo = async () => {
    const ok = await ask({
      title: "이 수금을 되돌릴까요?",
      body: `${c.who} · ${c.quoteNo} · ${c.method} ${c.amount.toLocaleString()}원\n수금 기록이 지워지고 그만큼 외상 잔액이 다시 살아납니다.`,
      confirmLabel: "되돌리기",
      tone: "danger",
    });
    if (!ok) return;
    start(async () => {
      setErr(null);
      const r = await removeCollection(c.id);
      if (!r.ok) return setErr(r.error);
      router.refresh();
    });
  };
  return { undo, pending, err, confirmDialog };
}

function UndoButton({ pending, undo }: { pending: boolean; undo: () => void }) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={undo}
      title="수금 되돌리기 — 외상 잔액이 다시 살아납니다"
      className="shrink-0 rounded-lg px-1.5 text-xs text-emerald-600 underline underline-offset-2 active:text-red-600 disabled:opacity-40"
    >
      되돌리기
    </button>
  );
}

/** 묶음 안의 건별 줄 — 어느 정비 값인지 + 되돌리기 */
function CollectionItemRow({ c, canCollect }: { c: DayColl; canCollect: boolean }) {
  const { undo, pending, err, confirmDialog } = useUndoCollection(c);
  return (
    <li>
      {confirmDialog}
      <div className="tabular flex items-baseline gap-2 text-xs text-emerald-800">
        <span className="min-w-0 flex-1 truncate">
          {c.quoteNo} · {c.workDate.slice(5)} 정비
          {c.plateNo && <span className="ml-1 text-emerald-600">{c.plateNo}</span>}
          {c.memo && <span className="ml-1.5 text-emerald-600">— {c.memo}</span>}
        </span>
        <span className="shrink-0 font-semibold">+{won(c.amount)}원</span>
        {canCollect && <UndoButton pending={pending} undo={undo} />}
      </div>
      {err && <p className="mt-0.5 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{err}</p>}
    </li>
  );
}

/** 한 명(거래처·손님)의 그날 수금 — 1건이면 한 줄, 여러 건이면 묶음 한 줄 + 펼침 */
function CollectionGroup({ items, canCollect }: { items: DayColl[]; canCollect: boolean }) {
  const first = items[0];
  const total = items.reduce((s, c) => s + c.amount, 0);
  const single = useUndoCollection(first);

  if (items.length === 1) {
    const c = first;
    return (
      <li>
        {single.confirmDialog}
        <div className="tabular flex items-baseline gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <span className="shrink-0 font-semibold text-emerald-800">💰 외상 수금</span>
          <span className="min-w-0 flex-1 truncate text-emerald-900">
            {c.who}
            {c.plateNo && <span className="ml-1 text-emerald-700">{c.plateNo}</span>}
            <span className="ml-1.5 text-xs text-emerald-600">
              {c.quoteNo} · {c.workDate.slice(5)} 정비 · {c.method}
            </span>
            {c.memo && <span className="ml-1.5 text-xs text-emerald-600">— {c.memo}</span>}
          </span>
          <span className="shrink-0 font-bold text-emerald-800">+{won(c.amount)}원</span>
          {canCollect && <UndoButton pending={single.pending} undo={single.undo} />}
        </div>
        {single.err && <p className="mt-0.5 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{single.err}</p>}
      </li>
    );
  }

  return (
    <li>
      <details className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
        <summary className="tabular flex cursor-pointer list-none items-baseline gap-2">
          <span className="shrink-0 font-semibold text-emerald-800">💰 외상 수금</span>
          <span className="min-w-0 flex-1 truncate text-emerald-900">
            {first.who}
            <span className="ml-1.5 text-xs text-emerald-600">
              {first.method} · 정비 {items.length}건 값 — 눌러서 내역
            </span>
          </span>
          <span className="shrink-0 font-bold text-emerald-800">+{won(total)}원</span>
        </summary>
        <ul className="mt-1.5 space-y-1 border-t border-emerald-200 pt-1.5">
          {items.map((c) => (
            <CollectionItemRow key={c.id} c={c} canCollect={canCollect} />
          ))}
        </ul>
      </details>
    </li>
  );
}

/** 같은 사람·같은 수단끼리 순서 보존하며 묶는다 */
function groupCollections(colls: DayColl[]): DayColl[][] {
  const groups = new Map<string, DayColl[]>();
  for (const c of colls) {
    const k = `${c.who}|${c.method}`;
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  return [...groups.values()];
}
