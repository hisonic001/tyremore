import {hasPerm } from "@/lib/auth";
import { traceMoney, type TraceRow } from "@/lib/money-trace";
import { a1OpenTransfers, asideMarkedSales, type A1Row, type AsideRow } from "@/lib/self-audit";
import { kstToday } from "@/lib/ym";
import Link from "@/lib/link";
import { FinShell } from "@/components/fin/shell";
import { Notice } from "@/components/ui/notice";
import { W } from "@/lib/fin-words";
import { TraceSearch, TraceLinkButton, TraceAsideButton, TraceAsideUndoButton } from "./client";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * ⭐ 돈 추적 — "이 돈 어디 갔어?" (돈관리 근본책 1단계-A, 사장님 승인 2026-08-31)
 *
 *   이름 한 조각·금액 하나로 세 장부(판매 · 세금계산서 · 통장/카드)를 한 번에 뒤져
 *   시간순으로 보여준다. 조각마다 대조 상태와 「왜」, 대조할 수 있으면 그 자리에서 대조한다.
 *   조회는 lib/money-trace 정본, 대조는 입금 대조와 같은 정본(trace-actions). 글자는 fin-words 정본.
 */
export default async function TracePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const owner = await hasPerm("finance");
  const r = owner && q ? await traceMoney(q) : null;
  /* ⭐ 검색어가 없으면 = 정합성 검사에서 눌러 들어온 것 — 「확인할 것」 목록을 바로 보여주고
     그 자리에서 처리한다 (사장님 제보 2026-09-02: "링크를 누르면 검색창 하나만 달랑").
     목록은 감사 A1 과 같은 정본(a1OpenTransfers, 45일). */
  const from45 = new Date(Date.parse(kstToday()) - 45 * 86400000).toISOString().slice(0, 10);
  const open = owner && !q ? await a1OpenTransfers({ from: from45 }) : null;
  /* ⭐ 되돌릴 자리 (2026-09-10) — 「통장 밖에서 정리한 판매」. 인박스·이 화면의 안내문이
     "추적 화면에서 되돌릴 수 있습니다"라고 하는데 정작 부르는 곳이 0곳이었다. */
  const asides = owner && !q ? await asideMarkedSales({ from: from45 }) : null;

  return (
    <FinShell tab="trace">
      <p className="mt-2 text-sm text-slate-500">
        이름 한 조각(「미광」·「정미선」)이나 금액(「280000」)만 넣으면 판매·계산서·통장을
        한 번에 찾아 <strong>어디까지 {W.recon}됐는지</strong> 보여 드립니다.
      </p>
      {!owner ? (
        <Notice tone="warn">돈 추적은 사장님 계정 전용입니다.</Notice>
      ) : (
        <>
          <TraceSearch initial={q} />
          {open && <OpenList rows={open} />}
          {asides && asides.length > 0 && <AsideList rows={asides} />}
          {r?.hint && <Notice tone="info">{r.hint}</Notice>}
          {r && r.rows.length > 0 && (
            <ul className="mt-3 space-y-2">
              {r.rows.map((row) => (
                <Row key={row.key} row={row} />
              ))}
            </ul>
          )}
        </>
      )}
    </FinShell>
  );
}

const KIND_BADGE: Record<TraceRow["kind"], string> = {
  판매: "bg-brand-50 text-brand-700",
  매출계산서: "bg-violet-50 text-violet-700",
  매입계산서: "bg-violet-50 text-violet-700",
  입금: "bg-sky-50 text-sky-700",
  출금: "bg-amber-50 text-amber-800",
  카드: "bg-slate-100 text-slate-600",
};

function Row({ row }: { row: TraceRow }) {
  const tone =
    row.status.tone === "ok" ? "text-emerald-700" : row.status.tone === "warn" ? "text-amber-700" : "text-slate-500";
  return (
    <li className="rounded-card border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="tabular text-xs text-slate-400">{row.d}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_BADGE[row.kind]}`}>{row.kind}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.title}</span>
        <span className="tabular shrink-0 text-sm font-bold">{won(row.amount)}원</span>
      </div>
      <p className={`mt-1 text-xs font-medium ${tone}`}>
        {row.status.tone === "ok" ? "✓ " : row.status.tone === "warn" ? "⚠️ " : ""}
        {row.status.text}
      </p>
      {row.notes.map((n, i) => (
        <p key={i} className="mt-0.5 pl-3 text-xs text-slate-500">
          └ {n}
        </p>
      ))}
      {row.action && <TraceLinkButton action={row.action} title={row.title} amount={row.amount} />}
    </li>
  );
}

/* ============================================================
 * ⭐ 확인할 것 목록 (2026-09-02) — 감사 A1 과 같은 정본. 그 자리에서 처리:
 *   후보가 하나면 ⚡대조, 통장에 안 찍히는 돈이면 「개인계좌·현금으로 받음」.
 * ========================================================== */
function OpenList({ rows }: { rows: A1Row[] }) {
  if (rows.length === 0) {
    return <Notice tone="info">확인할 계좌이체 판매가 없습니다 — 최근 45일 전부 입금과 {W.recon}돼 있습니다 ✅</Notice>;
  }
  return (
    <section className="mt-4">
      <h2 className="text-sm font-bold text-slate-700">
        확인할 것 — 계좌이체 판매인데 통장 입금과 {W.open} {rows.length}건 (최근 45일)
      </h2>
      <p className="mt-0.5 text-xs text-slate-400">
        진짜 {W.receivable}(아직 못 받음)이거나, 개인계좌·현금으로 받았거나, 입금자명이 달라 {W.recon} 못 한 것입니다.
      </p>
      <ul className="mt-2 space-y-2">
        {rows.map((a) => (
          <li key={a.quoteId} className="rounded-xl border border-amber-200 bg-white p-3">
            <div className="tabular flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                <strong>{a.who}</strong>
                <span className="ml-1.5 text-slate-500">{a.d.slice(5)} · {a.quoteNo}</span>
              </span>
              <span className="shrink-0 font-bold text-amber-800">{won(a.total)}원</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {a.cand ? (
                <TraceLinkButton
                  action={{ cashTxnId: a.cand.cashTxnId, quoteId: a.quoteId, label: `${a.cand.label}와 ${W.recon}` }}
                  title={a.who}
                  amount={a.total}
                />
              ) : (
                <span className="text-xs text-slate-400">동액 입금 없음</span>
              )}
              <TraceAsideButton quoteId={a.quoteId} title={a.who} amount={a.total} />
              <Link
                href={`/finance/trace?q=${encodeURIComponent(a.who)}`}
                className="text-xs text-slate-500 underline underline-offset-4"
              >
                이 상대 추적 →
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-400">
        진짜 {W.receivable}(아직 안 받은 돈)은 그대로 두시면 됩니다 — 입금이 올라오면 ⚡{W.recon}가 나타납니다.
      </p>
    </section>
  );
}

/* ============================================================
 * ⭐ 통장 밖에서 정리한 판매 (2026-09-10) — 되돌리기가 사는 곳.
 *   입금 정리 화면의 [개인 통장으로 받음]·[아직 안 들어옴]과 이 화면의 [개인계좌·현금으로 받음]이
 *   남긴 대조 내역은 모두 여기 모인다 (정본 self-audit.asideMarkedSales).
 *   🔴 2단계(2026-09-12): 입금 화면의 같은 표는 「최근 한 일」 링크로 바꿨고, 여기는 추적 화면의
 *      「확인할 것」과 짝이라 남겼다(없앨 10곳 목록에 없음).
 * ========================================================== */
function AsideList({ rows }: { rows: AsideRow[] }) {
  return (
    <details className="mt-4 rounded-card border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-600">
        통장 밖에서 정리한 판매 {rows.length}건 (최근 45일) — 잘못 눌렀거나 돈이 들어왔으면 되돌리기
      </summary>
      <ul className="mt-2 divide-y divide-slate-100">
        {rows.map((a) => (
          <li key={a.quoteId} className="flex items-center justify-between gap-2 py-1.5">
            <span className="tabular min-w-0 truncate text-xs text-slate-600">
              {a.d.slice(5)} · {a.who} · {won(a.amount)}원 · {a.reason ?? "개인계좌·현금"}
              {a.markedAt && <span className="text-slate-400"> ({a.markedAt} 표시)</span>}
            </span>
            <TraceAsideUndoButton quoteId={a.quoteId} title={a.who} amount={a.amount} />
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-slate-400">
        되돌리면 위 「확인할 것」으로 다시 올라옵니다 — 통장 셈(들어온 돈)은 처음부터 안 건드립니다.
      </p>
    </details>
  );
}

