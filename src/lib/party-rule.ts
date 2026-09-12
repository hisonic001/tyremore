/**
 * ⭐ 「자동 규칙」 정본 — 앱이 배운 것을 한 곳에서 읽고·끄고·되살린다 (개편 4단계, 2026-09-12)
 *
 *   사장님 결정 5 「보고 끄기만」 · 결정 6 「앱 기본 규칙도 보여 주고 끌 수 있게」.
 *   저장은 기존 표 그대로(계약은 party-rule-types.ts). 끄기 = 그 줄 지우기,
 *   되살리기 = 「최근 한 일」의 되돌리기(ruleOn) — 기록에 되살릴 값을 실어 둔다.
 *
 * 🔴 "use server" 아님 — 액션은 party-rule-actions.ts 가 권한을 본 뒤 이걸 부른다.
 * 🔴 질의 순차(풀 3). fin_activity SQL 은 fin-activity.ts 에만.
 *
 * ⚠️ 껍데기 (주 세션 0단계) — 갈래 A 가 채운다.
 */
import type { RuleKind, RuleRow } from "./party-rule-types";

export async function listRules(): Promise<RuleRow[]> {
  throw new Error("todo: 갈래 A — listRules");
}

export async function disableRuleCore(
  _kind: RuleKind,
  _key: string,
  _uid: number | null,
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  throw new Error("todo: 갈래 A — disableRuleCore");
}

export async function enableRuleCore(
  _kind: RuleKind,
  _key: string,
  _value: string,
  _label: string,
  _uid: number | null,
  _extra?: { raw?: string; partyKey?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  throw new Error("todo: 갈래 A — enableRuleCore");
}
