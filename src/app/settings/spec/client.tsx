"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, ExternalLink, ShieldAlert, X } from "lucide-react";
import Link from "@/lib/link";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/ui/confirm";
import { approveSpecs, rejectSpecs, type SpecGenRow, type SpecReview, type SpecValueRow } from "@/lib/spec";

/**
 * 제원 검수 — 목록 → 한 차종 → 값과 원문을 나란히 (2026-09-03)
 *
 * 🔴 **원문을 접어 두지 않는다.** 검수의 전부가 「이 값이 저 줄에서 나왔나」를 보는 것이다.
 *    원문을 눌러야 보이게 하면 아무도 안 누르고, 그러면 검수가 찍기가 된다.
 *
 * 🔴 **한 벌씩 승인한다.** 18인치 한 벌·20인치 한 벌이 각각 원문의 한 줄에서 나왔으므로,
 *    그 줄을 보고 그 벌을 통째로 누르는 것이 실제로 사장님이 하시는 판단과 같다.
 *    값을 하나씩 누르게 하면 24번을 눌러야 해서 결국 안 하시게 된다.
 */
export function SpecReviewer({ rows, review }: { rows: SpecGenRow[]; review: SpecReview | null }) {
  if (review) return <OneGeneration review={review} />;
  return <GenerationList rows={rows} />;
}

/* ------------------------------------------------------------------ */

function GenerationList({ rows }: { rows: SpecGenRow[] }) {
  const waiting = rows.reduce((s, r) => s + r.waiting, 0);
  if (!rows.length) {
    return (
      <EmptyState
        emoji="📘"
        title="아직 받아 온 제원이 없습니다"
        hint="매장 PC 에서 차종을 골라 취급설명서를 받아 오면 여기에 쌓입니다."
      />
    );
  }
  return (
    <>
      {waiting > 0 && (
        <p className="mt-3 text-sm text-slate-600">
          검수를 기다리는 값 <strong className="text-slate-900">{waiting}개</strong>
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.variantKey}>
            <Link
              href={`/settings/spec?gen=${encodeURIComponent(r.variantKey)}`}
              className="flex items-center gap-3 rounded-card border border-slate-200 bg-white px-4 py-3 active:bg-slate-50 lg:hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-slate-900">{r.label}</p>
                <p className="mt-0.5 text-[13px] text-slate-500">
                  우리 손님 차 {r.cars}대
                  {r.approved > 0 && ` · 확인된 값 ${r.approved}개`}
                </p>
              </div>
              {r.waiting > 0 ? (
                <StatusPill tone="accent">검수 {r.waiting}</StatusPill>
              ) : (
                <StatusPill tone="success">확인 끝</StatusPill>
              )}
              <ChevronRight className="size-4 shrink-0 text-slate-400" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */

function OneGeneration({ review }: { review: SpecReview }) {
  const router = useRouter();
  const [ask, confirmDialog] = useConfirm();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const waiting = useMemo(
    () => review.groups.flatMap((g) => g.rows).filter((r) => r.status === "검수대기"),
    [review],
  );

  const run = (fn: () => Promise<{ ok: true; n: number } | { ok: false; error: string }>) =>
    start(async () => {
      setErr(null);
      const r = await fn();
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setMsg(`${r.n}개를 처리했습니다`);
      router.refresh();
    });

  const approveAll = async () => {
    const ok = await ask({
      title: `${review.label} 값 ${waiting.length}개를 확인 처리할까요?`,
      body: "확인하면 앱 화면과 블로그 글에서 이 값을 쓰기 시작합니다. 휠너트 토크처럼 위험한 값도 그때부터 숫자가 보입니다.",
      confirmLabel: "전부 맞습니다",
    });
    if (ok) run(() => approveSpecs(waiting.map((r) => r.id)));
  };

  return (
    <>
      {confirmDialog}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href="/settings/spec" className="text-sm text-slate-500 underline underline-offset-4">
          ← 차종 목록
        </Link>
        <h2 className="text-lg font-bold text-slate-900">{review.label}</h2>
        <span className="text-[13px] text-slate-500">우리 손님 차 {review.cars}대</span>
      </div>

      {review.manualUrl && (
        <a
          href={review.manualUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-flex items-center gap-1 text-[13px] text-sky-700 underline underline-offset-4"
        >
          제조사 취급설명서 열기 <ExternalLink className="size-3.5" />
        </a>
      )}

      {err && <Notice tone="error">{err}</Notice>}
      {msg && !err && <Notice tone="success">{msg}</Notice>}

      {waiting.length > 0 ? (
        <div className="mt-3 rounded-card border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">
            <strong>{waiting.length}개</strong>가 사장님 확인을 기다립니다. 아래 값과 <strong>회색 원문 줄</strong>이
            같은지만 봐 주세요.
          </p>
          <div className="mt-2 flex gap-2">
            <Button onClick={approveAll} pending={pending}>
              <Check className="size-4" /> 전부 맞습니다
            </Button>
          </div>
        </div>
      ) : (
        <Notice tone="success">이 차종은 확인이 끝났습니다.</Notice>
      )}

      {review.groups.map((g) => (
        <GroupCard
          key={g.groupNo}
          label={g.groupLabel}
          rows={g.rows}
          pending={pending}
          onApprove={(ids) => run(() => approveSpecs(ids))}
          onReject={(ids) => run(() => rejectSpecs(ids))}
        />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */

function GroupCard({
  label,
  rows,
  pending,
  onApprove,
  onReject,
}: {
  label: string | null;
  rows: SpecValueRow[];
  pending: boolean;
  onApprove: (ids: number[]) => void;
  onReject: (ids: number[]) => void;
}) {
  const waiting = rows.filter((r) => r.status === "검수대기");
  /* 한 벌은 원문의 같은 줄에서 나온다 — 줄을 한 번만 보여 준다 */
  const quotes = [...new Set(rows.map((r) => r.quote).filter(Boolean))];
  const src = rows.find((r) => r.sourceUrl);

  return (
    <section className="mt-4 rounded-card border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold text-slate-900">{label ?? "제원"}</h3>
        {waiting.length === 0 && <StatusPill tone="success">확인됨</StatusPill>}
      </div>

      <dl className="mt-2 divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.id} className="flex items-baseline justify-between gap-3 py-2">
            <dt className="shrink-0 text-[13px] text-slate-500">
              {r.label}
              {r.qualifier && <span className="ml-1 text-slate-400">{r.qualifier}</span>}
            </dt>
            <dd className="min-w-0 text-right">
              {r.hidden ? (
                <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-amber-700">
                  <ShieldAlert className="size-3.5" /> 확인 전에는 숫자를 보여드리지 않습니다
                </span>
              ) : (
                <span
                  className={`text-[15px] font-semibold ${r.status === "승인" ? "text-slate-900" : "text-slate-500"}`}
                >
                  {r.shown ?? "—"}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {/* 🔴 원문 — 검수의 전부다. 접지 않는다 */}
      {quotes.map((q) => (
        <p
          key={q}
          className="mt-2 overflow-x-auto whitespace-pre rounded-xl bg-slate-50 px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-600"
        >
          {q}
        </p>
      ))}
      {src?.sourceUrl && (
        <p className="mt-1 text-[11px] text-slate-400">
          <a href={src.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
            {src.sourceTitle || src.sourceUrl}
          </a>
          {src.fetchedOn && ` · ${src.fetchedOn} 에 읽음`}
        </p>
      )}

      {waiting.length > 0 && (
        <div className="mt-3 flex gap-2">
          <Button size="md" pending={pending} onClick={() => onApprove(waiting.map((r) => r.id))}>
            <Check className="size-4" /> 이 한 벌 맞습니다
          </Button>
          <Button size="md" variant="secondary" pending={pending} onClick={() => onReject(waiting.map((r) => r.id))}>
            <X className="size-4" /> 아닙니다
          </Button>
        </div>
      )}
    </section>
  );
}
