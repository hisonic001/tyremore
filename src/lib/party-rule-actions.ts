"use server";

/**
 * ⭐ 「자동 규칙」 화면의 액션 (개편 4단계, 2026-09-12)
 *   권한을 보고 정본(party-rule.ts)을 부른 뒤 화면을 새로 그린다. 판정·기록은 정본 안에서.
 *
 * ⚠️ 껍데기 (주 세션 0단계) — 갈래 A 가 채운다.
 */
import type { RuleKind } from "./party-rule-types";

export async function disableRule(
  _kind: RuleKind,
  _key: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  throw new Error("todo: 갈래 A — disableRule");
}

export async function enableRule(
  _kind: RuleKind,
  _key: string,
  _value: string,
  _label: string,
  _extra?: { raw?: string; partyKey?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  throw new Error("todo: 갈래 A — enableRule");
}
