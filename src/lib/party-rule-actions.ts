"use server";

/**
 * ⭐ 「자동 규칙」 화면의 액션 (개편 4단계, 2026-09-12)
 *   권한을 보고 정본(party-rule.ts)을 부른 뒤 화면을 새로 그린다. 판정·기록은 정본 안에서.
 *
 * 🔴 규칙을 끄면 다음 자료의 자동 분류·자동 대조가 달라진다 — 돈관리 화면 전부를
 *    다시 그린다(revalidateFinance). 규칙 화면 자신도 목록이 바뀌므로 따로 한 번 더.
 */
import { revalidatePath } from "next/cache";
import { getSession, hasPerm } from "@/lib/auth";
import { disableRuleCore, enableRuleCore } from "./party-rule";
import { revalidateFinance } from "./fin-revalidate";
import type { RuleKind } from "./party-rule-types";

async function guard(): Promise<{ ok: true; uid: number | null } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const s = await getSession();
  return { ok: true, uid: s?.uid ?? null };
}

function redraw() {
  revalidatePath("/settings/rules");
  revalidateFinance();
}

export async function disableRule(
  kind: RuleKind,
  key: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const r = await disableRuleCore(kind, key, g.uid); // 기록 한 줄은 코어가 남긴다
  if (!r.ok) return r;
  redraw();
  return { ok: true };
}

export async function enableRule(
  kind: RuleKind,
  key: string,
  value: string,
  label: string,
  extra?: { raw?: string; partyKey?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const r = await enableRuleCore(kind, key, value, label, g.uid, extra);
  if (!r.ok) return r;
  redraw();
  return { ok: true };
}
