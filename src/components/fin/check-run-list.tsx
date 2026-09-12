"use client";

/**
 * ⭐ 「체크해서 한 번에」 목록 부품 (개편 3단계, 2026-09-12)
 *
 *   tax-book-ui.tsx 의 ConfirmLayer(체크 기본 ON · 순차 실행 · 결과 한 줄)를 일반화한 것.
 *   「이번 주 정리」 흐름의 ③입금·④지출·⑥준 돈 「확인해 주세요」·「짝 확실」 층이 같이 쓴다.
 *
 *   두 가지 실행 방식:
 *     - items[].run — 항목마다 액션 하나(순차, for-await). 같은 dedupeKey 는 한 번만 부른다
 *       (통장 한 줄 = 계산서 N장 묶음·같은 상계 쌍 — ConfirmLayer 의 seen 집합 그대로).
 *     - bulk — 체크한 열쇠를 모아 **한 번** 부른다(③ confirmSureDeposits(ym, ids) ·
 *       ⑥ confirmSureWithdrawals(ym, ids)). 기록은 서버 코어가 한 줄만 남긴다(계획서 §3).
 *
 * 🔴 판정은 여기 없다 — 무엇을 보여 줄지·무엇을 부를지는 부르는 쪽(정본)이 정한다.
 * 🔴 순차 — DB 풀 max 3. Promise.all 금지.
 */
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useConfirm, type ConfirmOpts } from "@/components/ui/confirm";
import { W } from "@/lib/fin-words";
import type { AutoLine } from "@/lib/weekly-types";
import { won } from "./money";

/* ───────────────────────── 3층 배치의 작은 부품 (③④⑥ 흐름 화면이 같이 쓴다) ───────────────────────── */

/** 층 머리 — 이름(W.tierX) + 건수 */
export function TierHead({ title, n, unit = "건" }: { title: string; n: number; unit?: string }) {
  return (
    <h3 className="mt-5 flex items-baseline gap-2 font-semibold">
      {title}
      <span className="tabular text-sm font-normal text-slate-500">
        {n}
        {unit}
      </span>
    </h3>
  );
}

/** 「앱이 자동 대조한 것」 접힘 — fin_activity 되읽기(AutoLine) 목록 + 「최근 한 일에서 되돌리기」 링크.
 *  되돌리기는 여기 없다(결정 14 — 「최근 한 일」 한 곳). tax-book-ui 의 AutoDoneList 와 같은 모양. */
export function AutoTier({ lines }: { lines: AutoLine[] }) {
  return (
    <details className="mt-3 rounded-card border border-slate-200 bg-white px-4 py-2 text-sm">
      <summary className="cursor-pointer select-none py-1 font-medium text-slate-700">
        {W.tierAuto} <span className="tabular">{lines.length}</span>건{" "}
        <span className="text-slate-400">— 펼쳐서 확인할 수 있어요</span>
      </summary>
      {lines.length === 0 ? (
        <p className="py-2 text-slate-500">이 달엔 아직 없습니다.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {lines.map((l) => (
            <li key={l.id} className="py-2">
              <span className="block min-w-0 truncate text-xs">
                <span className="text-slate-500">{l.at}</span> {l.label}
                <span className="tabular ml-1 text-slate-500">
                  · {l.n}건{l.amount !== null && ` · ${won(l.amount)}원`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="py-1.5 text-xs text-slate-400">
        잘못 {W.recon}됐으면{" "}
        <Link href="/finance/activity" className="underline underline-offset-4">{W.activityUndoHere}</Link>
      </p>
    </details>
  );
}

/* ───────────────────────── 체크해서 한 번에 ───────────────────────── */

export type RunResult = { ok: true; msg?: string } | { ok: false; error: string };

export interface CheckRunItem {
  key: string;
  /** 한 줄 본문 — 글자거나 조립한 노드(원본 ConfirmLayer 는 상대·날짜·금액 노드) */
  text: ReactNode;
  /** 아랫줄(작은 회색) — 「← 앱이 찾은 줄」 같은 것 */
  sub?: ReactNode;
  /** 항목 하나 실행 — bulk 를 쓰면 안 봐도 된다 */
  run?: () => Promise<RunResult>;
  /** 같은 열쇠는 한 번만 실행(묶음·상계 쌍) */
  dedupeKey?: string;
  /** 실패 목록에 적을 짧은 이름 — 없으면 text 가 글자일 때 그것, 아니면 key */
  errLabel?: string;
}

export function CheckRunList({
  title,
  hint,
  items,
  buttonLabel,
  confirm,
  onDone,
  bulk,
  unit = "건",
  verb = W.recon,
  tone = "check",
  pending: outerPending,
}: {
  title: ReactNode;
  hint?: ReactNode;
  items: CheckRunItem[];
  buttonLabel: (n: number) => string;
  /** 누르면 먼저 물어본다(useConfirm). 없으면 바로 실행 */
  confirm?: ConfirmOpts;
  onDone?: () => void;
  /** 체크한 열쇠를 모아 한 번에 — 있으면 items[].run 은 안 부른다 */
  bulk?: (keys: string[]) => Promise<RunResult>;
  /** 결과 문장의 단위 — 장·건·묶음 */
  unit?: string;
  /** 결과 문장의 동사 — 대조·분류 */
  verb?: string;
  /** check = 노랑(확인해 주세요) · sure = 초록 테두리(짝 확실) */
  tone?: "check" | "sure";
  /** 바깥(화면 전체)이 진행 중이면 같이 잠근다 */
  pending?: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [ask, confirmDialog] = useConfirm();
  const isOn = (key: string) => checked[key] !== false; // 기본 ON
  const n = items.filter((it) => isOn(it.key)).length;

  const runAll = async () => {
    if (confirm && !(await ask(confirm))) return;
    start(async () => {
      setResult(null);
      let done = 0;
      const errs: string[] = [];
      const picked = items.filter((it) => isOn(it.key));
      if (bulk) {
        const r = await bulk(picked.map((it) => it.key));
        if (r.ok) done = picked.length;
        else errs.push(r.error);
        setResult(
          r.ok
            ? { tone: "success", text: r.msg ?? `${done}${unit}을 ${verb}했습니다.` }
            : { tone: "error", text: r.error },
        );
      } else {
        const seen = new Set<string>();
        // 🔴 순차 — 풀 max 3. 같은 묶음·같은 상계 쌍은 한 번만 부른다.
        for (const it of picked) {
          if (!it.run) continue;
          if (it.dedupeKey) {
            if (seen.has(it.dedupeKey)) {
              done += 1;
              continue;
            }
            seen.add(it.dedupeKey);
          }
          const x = await it.run();
          if (x.ok) done += 1;
          else errs.push(`${it.errLabel ?? (typeof it.text === "string" ? it.text : it.key)} — ${x.error}`);
        }
        setResult(
          errs.length === 0
            ? { tone: "success", text: `${done}${unit}을 ${verb}했습니다.` }
            : { tone: "error", text: `${done}${unit}은 ${verb}했고 ${errs.length}${unit}은 못 했습니다: ${errs.join(" / ")}` },
        );
      }
      router.refresh();
      onDone?.();
    });
  };

  if (items.length === 0) return null;
  const box = tone === "sure" ? "border-brand-500 bg-brand-50/40" : "border-amber-300 bg-amber-50";
  const hintCls = tone === "sure" ? "text-brand-700" : "text-amber-900";
  const divide = tone === "sure" ? "divide-brand-100" : "divide-amber-200/70";
  return (
    <section className={`mt-4 rounded-card border p-4 ${box}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <span className="flex items-center gap-3 text-xs">
          <button type="button" onClick={() => setChecked({})} className="text-slate-500 underline underline-offset-4">
            모두 켜기
          </button>
          <button
            type="button"
            onClick={() => setChecked(Object.fromEntries(items.map((it) => [it.key, false])))}
            className="text-slate-500 underline underline-offset-4"
          >
            모두 끄기
          </button>
        </span>
      </div>
      {hint && <p className={`mt-1 text-xs ${hintCls}`}>{hint}</p>}
      <ul className={`mt-2 divide-y ${divide}`}>
        {items.map((it) => (
          <li key={it.key} className="py-2">
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={isOn(it.key)}
                onChange={(e) => setChecked((c) => ({ ...c, [it.key]: e.target.checked }))}
                className="mt-1 size-4 shrink-0 accent-brand-600"
              />
              <span className="min-w-0 flex-1">
                {it.text}
                {it.sub !== undefined && it.sub !== null && <span className="block text-xs text-slate-600">{it.sub}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <Button onClick={runAll} pending={busy || !!outerPending} disabled={n === 0} size="lg">
          {buttonLabel(n)}
        </Button>
      </div>
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
      {confirmDialog}
    </section>
  );
}
