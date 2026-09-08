"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, ExternalLink, X } from "lucide-react";
import Link from "@/lib/link";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/ui/confirm";
import { approveSpecs, rejectSpecs, type SpecGenRow, type SpecReview } from "@/lib/spec";
import { SpecSheetView } from "@/components/spec/sheet";
import { buildSpecSheet } from "@/lib/spec-sheet-core";
import type { FitPart } from "@/lib/parts-fit";

/**
 * 제원 검수 — 목록 → 한 차종 → 값과 원문을 나란히 (2026-09-03)
 *
 * 🔴 **검수 대기가 있으면 원문을 펼쳐 둔다.** 검수의 전부가 「이 값이 저 줄에서 나왔나」를
 *    보는 것이라, 원문을 눌러야 보이게 하면 아무도 안 누르고 검수가 찍기가 된다.
 *    2026-09-05 에 **자동확인만 있는 부분은 접도록** 바꿨다 — 값 602건 중 576건이 자동확인이라
 *    다 펼쳐 두면 화면이 원문으로 덮여 사장님이 「한눈에 안 들어온다」고 하셨다.
 *
 * 🔴 **주제 단위로 승인한다** (2026-09-05). 예전에는 「벌」 단위였는데,
 *    벌은 타이어 규격 단위라서 엔진오일·냉각수가 엉뚱한 벌 카드에 섞여 들어갔다.
 *    (`parseTireWheelTable` 과 `parseOilTable` 이 각자 1,2,3… 을 매겨 `group_no` 가 겹친다.)
 *    값을 하나씩 누르게 하면 24번을 눌러야 해서 결국 안 하시게 된다 — 묶는 것은 그대로다.
 */
export function SpecReviewer({
  rows,
  review,
  parts,
  engine,
}: {
  rows: SpecGenRow[];
  review: SpecReview | null;
  parts: FitPart[];
  engine: string | null;
}) {
  if (review) return <OneGeneration review={review} parts={parts} engine={engine} />;
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
      {/* 🔴 하루 한 차종 — 무엇부터 할지 고르시게 하면 사흘 만에 멈춘다 (2026-09-08) */}
      <Link
        href="/settings/spec/fill"
        className="mt-3 flex items-center gap-3 rounded-card border border-brand-200 bg-brand-50 px-4 py-3 active:bg-brand-100 lg:hover:bg-brand-100"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-brand-800">오늘 채울 차종</p>
          <p className="mt-0.5 text-[13px] text-brand-700">
            보신 대로 치시면 표기는 저희가 맞춥니다 — 하루 한 차종이면 됩니다
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-brand-600" />
      </Link>

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
                  {r.approved > 0 && ` · 사장님 확인 ${r.approved}개`}
                  {r.autoOk > 0 && ` · 자동 확인 ${r.autoOk}개`}
                </p>
              </div>
              {r.waiting > 0 ? (
                <StatusPill tone="accent">검수 {r.waiting}</StatusPill>
              ) : r.approved > 0 && r.autoOk === 0 ? (
                <StatusPill tone="success">사장님 확인</StatusPill>
              ) : (
                <StatusPill tone="neutral">자동 확인</StatusPill>
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

function OneGeneration({ review, parts, engine }: { review: SpecReview; parts: FitPart[]; engine: string | null }) {
  const router = useRouter();
  const [ask, confirmDialog] = useConfirm();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const waiting = useMemo(
    () => review.groups.flatMap((g) => g.rows).filter((r) => r.status === "검수대기"),
    [review],
  );

  /* 🔴 묶는 규칙은 순수 모듈 한 곳에만 둔다 — 화면 세 곳이 같은 묶음을 내야 한다 */
  const sheet = useMemo(
    () =>
      buildSpecSheet({
        label: review.label,
        variantKey: review.variantKey,
        manualUrl: review.manualUrl,
        cars: review.cars,
        rows: review.groups.flatMap((g) => g.rows),
        parts,
        engine,
      }),
    [review, parts, engine],
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

      <SpecSheetView
        sheet={sheet}
        onEngine={(e) =>
          `/settings/spec?gen=${encodeURIComponent(review.variantKey)}${e ? `&engine=${encodeURIComponent(e)}` : ""}`
        }
        actions={({ waitingIds, autoIds }) =>
          waitingIds.length > 0 ? (
            <div className="flex gap-2">
              <Button size="md" pending={pending} onClick={() => run(() => approveSpecs(waitingIds))}>
                <Check className="size-4" /> 이 부분 맞습니다
              </Button>
              <Button size="md" variant="secondary" pending={pending} onClick={() => run(() => rejectSpecs(waitingIds))}>
                <X className="size-4" /> 아닙니다
              </Button>
            </div>
          ) : autoIds.length > 0 ? (
            /*
              🔴 자동 확인도 **되돌릴 수 있어야 한다** (2026-09-05).
                 사장님이 「일하면서 검증하며 고쳐 나가겠다」고 하셨다. 틀린 것을 보셨을 때
                 그 자리에서 고칠 수 없으면 그 말이 지켜지지 않는다.
            */
            <div className="flex items-center gap-2">
              <Button size="md" variant="secondary" pending={pending} onClick={() => run(() => approveSpecs(autoIds))}>
                <Check className="size-4" /> 직접 확인했습니다
              </Button>
              <Button size="md" variant="ghost" pending={pending} onClick={() => run(() => rejectSpecs(autoIds))}>
                <X className="size-4" /> 틀렸습니다
              </Button>
            </div>
          ) : null
        }
      />
    </>
  );
}

