"use client";

/**
 * ⭐ 「자동 규칙」 화면 — 갈래 탭 + 검색 + 줄마다 [끄기] (돈관리 개편 4단계, 2026-09-12)
 *
 *   사장님 결정 5 「보고 끄기만」 — **추가·수정 입력은 여기 없다**(계획서 §6·§11).
 *   결정 6 「앱 기본 규칙(DESC_RULES)도 보여 주고 끌 수 있게」 — 그 탭의 꺼진 줄만
 *   회색으로 남아 [켜기] 가 붙는다(나머지 갈래는 끄면 줄이 지워져 목록에서 사라진다).
 *
 * 🔴 판정·목록은 정본(party-rule.ts)이 만든 것 그대로 — 여기서 새로 거르거나 합치지 않는다
 *    (검색·탭 나눔은 순수 함수 filterRules·countByKind 를 쓴다).
 * 🔴 되살리기는 「최근 한 일」 한 곳(결정 14) — 맨 아래 링크.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/ui/confirm";
import { W } from "@/lib/fin-words";
import {
  RULE_KINDS,
  RULE_KIND_LABEL,
  countByKind,
  filterRules,
  type RuleKind,
  type RuleRow,
} from "@/lib/party-rule-types";
import { disableRule, enableRule } from "@/lib/party-rule-actions";

/** 「최근 끈 규칙」 한 줄 — fin_activity 되읽기(recentRuleOffs). 표시만 한다 */
export interface RuleOffLine {
  id: number;
  /** 사람이 읽는 시각 */
  at: string;
  label: string;
}

export function RulesClient({ rows, offs }: { rows: RuleRow[]; offs: RuleOffLine[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [tab, setTab] = useState<RuleKind>("alias");
  const [q, setQ] = useState("");
  const [note, setNote] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [ask, confirmDialog] = useConfirm();

  /* 검색은 갈래를 가리지 않는다 — 건수도 검색 결과 기준이라 「어느 탭에 있나」가 바로 보인다 */
  const found = filterRules(rows, q);
  const counts = countByKind(found);
  const list = found.filter((r) => r.kind === tab);

  const off = async (row: RuleRow) => {
    if (
      !(await ask({
        title: `이 규칙을 끌까요?`,
        body: `${row.label} → ${row.value}\n\n다음 자료부터 앱이 이 짝을 자동으로 붙이지 않습니다. 이미 붙인 것은 그대로 있고, 「${W.activity}」에서 되살릴 수 있습니다.`,
        confirmLabel: W.ruleOff,
        tone: "danger",
      }))
    )
      return;
    start(async () => {
      setNote(null);
      const r = await disableRule(row.kind, row.key);
      if (!r.ok) return setNote({ tone: "error", text: r.error });
      setNote({ tone: "success", text: `「${row.label}」 규칙을 껐습니다.` });
      router.refresh();
    });
  };

  const on = (row: RuleRow) =>
    start(async () => {
      setNote(null);
      const r = await enableRule(row.kind, row.key, row.value, row.label, {
        raw: row.raw,
        partyKey: row.partyKey,
      });
      if (!r.ok) return setNote({ tone: "error", text: r.error });
      setNote({ tone: "success", text: `「${row.label}」 규칙을 다시 켰습니다.` });
      router.refresh();
    });

  return (
    <div className="mt-3">
      {/* ── 갈래 탭 (건수) ── */}
      <div className="flex flex-wrap gap-1.5">
        {RULE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            aria-pressed={tab === k}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              tab === k ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"
            }`}
          >
            {RULE_KIND_LABEL[k]} <span className="tabular">{counts[k]}</span>
          </button>
        ))}
      </div>

      {/* ── 검색 ── */}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="이름·분류로 찾기"
        aria-label="규칙 찾기"
        className="mt-3 w-full rounded-control border border-slate-300 px-3 py-2 text-sm"
      />

      {note && <Notice tone={note.tone}>{note.text}</Notice>}

      {/* ── 줄 목록 ── */}
      <ul className="mt-3 divide-y divide-slate-100 rounded-card border border-slate-200 bg-white">
        {list.length === 0 && (
          <li className="p-6 text-center text-sm text-slate-500">
            {q ? "찾는 규칙이 없습니다." : "이 갈래에는 아직 배운 규칙이 없습니다."}
          </li>
        )}
        {list.map((r) => (
          <li key={`${r.kind}:${r.key}`} className="flex items-start gap-2 px-3 py-2.5">
            <span className={`min-w-0 flex-1 ${r.off ? "text-slate-400" : ""}`}>
              <span className="block text-sm">
                <span className="font-medium">{r.label}</span>
                <span className="mx-1 text-slate-400">→</span>
                <span className={r.off ? "" : "font-semibold text-brand-700"}>{r.value}</span>
              </span>
              <span className="mt-0.5 block text-xs text-slate-400">
                {r.source}
                {r.learnedAt && ` · ${r.learnedAt} 배움`}
                {r.off && " · 꺼 둠"}
              </span>
            </span>
            {r.off ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => on(r)}
                className="shrink-0 rounded-control border border-brand-500 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 active:bg-brand-100 disabled:opacity-40"
              >
                {W.ruleOn}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => off(r)}
                className="shrink-0 rounded-control border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 active:bg-slate-100 disabled:opacity-40"
              >
                {W.ruleOff}
              </button>
            )}
          </li>
        ))}
      </ul>

      {tab === "code" && (
        <p className="mt-2 text-xs text-slate-400">
          {W.codeRules}은 앱에 박혀 있어 지워지지 않습니다 — 끄면 회색으로 남고 <strong>다음 자료부터</strong> 그
          분류를 안 붙입니다. 이미 붙은 것은 그대로입니다.
        </p>
      )}

      {/* ── 최근 끈 규칙 (되살리기는 「최근 한 일」 한 곳) ── */}
      <section className="mt-5">
        <h2 className="text-sm font-semibold text-slate-600">최근 끈 규칙</h2>
        {offs.length === 0 ? (
          <p className="mt-1 text-xs text-slate-400">최근 30일에 끈 규칙이 없습니다.</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
            {offs.map((o) => (
              <li key={o.id} className="min-w-0 truncate">
                <span className="text-slate-400">{o.at}</span> {o.label}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-xs text-slate-400">
          잘못 껐으면{" "}
          <Link href="/finance/activity" className="underline underline-offset-4">
            {W.activityUndoHere}
          </Link>
        </p>
      </section>

      {confirmDialog}
    </div>
  );
}
