import {hasPerm } from "@/lib/auth";
import { traceMoney, type TraceRow } from "@/lib/money-trace";
import { FinShell } from "@/components/fin/shell";
import { Notice } from "@/components/ui/notice";
import { TraceSearch, TraceLinkButton } from "./client";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * ⭐ 돈 추적 — "이 돈 어디 갔어?" (돈관리 근본책 1단계-A, 사장님 승인 2026-08-31)
 *
 *   이름 한 조각·금액 하나로 세 장부(판매 · 세금계산서 · 통장/카드)를 한 번에 뒤져
 *   시간순으로 보여준다. 조각마다 연결 상태와 「왜」, 이을 수 있으면 그 자리에서 잇는다.
 *   조회는 lib/money-trace 정본, 잇기는 입금 정리와 같은 정본(trace-actions).
 */
export default async function TracePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const owner = await hasPerm("finance");
  const r = owner && q ? await traceMoney(q) : null;

  return (
    <FinShell tab="trace">
      <p className="mt-2 text-sm text-slate-500">
        이름 한 조각(「미광」·「정미선」)이나 금액(「280000」)만 넣으면 판매·계산서·통장을
        한 번에 찾아 <strong>어디까지 이어졌는지</strong> 보여 드립니다.
      </p>
      {!owner ? (
        <Notice tone="warn">돈 추적은 사장님 계정 전용입니다.</Notice>
      ) : (
        <>
          <TraceSearch initial={q} />
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
