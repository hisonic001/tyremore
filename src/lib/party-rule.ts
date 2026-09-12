/**
 * ⭐ 「자동 규칙」 정본 — 앱이 배운 것을 한 곳에서 읽고·끄고·되살린다 (개편 4단계, 2026-09-12)
 *
 *   사장님 결정 5 「보고 끄기만」 · 결정 6 「앱 기본 규칙도 보여 주고 끌 수 있게」.
 *   저장은 기존 표 그대로(계약은 party-rule-types.ts). 끄기 = 그 줄 지우기,
 *   되살리기 = 「최근 한 일」의 되돌리기(ruleOn) — 기록에 되살릴 값을 실어 둔다.
 *
 * 🔴 "use server" 아님 — 액션은 party-rule-actions.ts 가 권한을 본 뒤 이걸 부른다.
 * 🔴 질의 순차(풀 3). fin_activity SQL 은 fin-activity.ts 에만.
 * 🔴 끄기·켜기의 **쓰기 본문을 새로 만들지 않는다** — 계산서 상대는 recon-core 의 코어,
 *    별명은 deposit-core.learnAlias 를 그대로 부른다. 규칙이 두 벌로 갈라지면
 *    「끈 규칙이 여전히 작동」하는 사고가 난다(party-rule-types.ts 머리말).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { DESC_RULES } from "./expense-cats";
import { descRulesOff, setDescRulesOff } from "./app-setting";
import { DEPOSIT_KINDS, learnAlias } from "./deposit-core";
import { removeTaxPartyRuleCore, setTaxPartyRuleCore, type TaxPartyKind } from "./recon-core";
import { logActivity } from "./fin-activity";
import { W } from "./fin-words";
import {
  aliasSourceOf,
  mergeRuleRows,
  RULE_KIND_LABEL,
  ruleUndoArgs,
  type RuleKind,
  type RuleRow,
} from "./party-rule-types";

/** 표가 한없이 늘 수는 없다 — 화면은 탭+검색이라 이 이상은 못 읽는다 */
const LIMIT = 2000;
const TAX_PARTY_KINDS: readonly string[] = ["경비", "대행정산", "무시", "월정산"];

/**
 * 다섯 갈래를 한 목록으로. 🔴 질의는 **하나씩** — Promise.all 로 묶으면 풀(max 3)이 만석이 된다.
 * code 갈래만 `off: true` 가 있을 수 있다(나머지는 끄면 줄이 지워져 목록에 없다).
 */
export async function listRules(): Promise<RuleRow[]> {
  const aliases = await db.execute<{ alias_key: string; alias_raw: string; party_key: string; party_label: string; d: string }>(sql`
    SELECT alias_key, alias_raw, party_key, party_label,
           to_char(updated_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d
    FROM party_alias ORDER BY updated_at DESC LIMIT ${LIMIT}
  `);
  const taxParties = await db.execute<{ biz_no: string; name_raw: string; kind: string; d: string }>(sql`
    SELECT biz_no, name_raw, kind,
           to_char(updated_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d
    FROM tax_party_rule ORDER BY updated_at DESC LIMIT ${LIMIT}
  `);
  const expenses = await db.execute<{ key: string; category: string; d: string }>(sql`
    SELECT key, category, to_char(updated_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d
    FROM expense_rule ORDER BY updated_at DESC LIMIT ${LIMIT}
  `);
  const deposits = await db.execute<{ key: string; kind: string; d: string }>(sql`
    SELECT key, kind, to_char(updated_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d
    FROM deposit_rule ORDER BY updated_at DESC LIMIT ${LIMIT}
  `);
  /* 앱 기본 규칙은 코드 상수(DESC_RULES) — 「끈 이름」만 app_setting 에 적혀 있다 */
  const off = new Set(await descRulesOff());

  const aliasRows: RuleRow[] = aliases.map((a) => ({
    kind: "alias",
    key: a.alias_key,
    label: a.alias_raw,
    value: a.party_label,
    learnedAt: a.d,
    source: aliasSourceOf(a.party_key),
    raw: a.alias_raw,
    partyKey: a.party_key,
  }));
  const taxRows: RuleRow[] = taxParties.map((t) => ({
    kind: "taxParty",
    key: t.biz_no,
    label: t.name_raw,
    value: t.kind,
    learnedAt: t.d,
    source: RULE_KIND_LABEL.taxParty,
  }));
  const expenseRows: RuleRow[] = expenses.map((e) => ({
    kind: "expense",
    key: e.key,
    label: e.key,
    value: e.category,
    learnedAt: e.d,
    source: RULE_KIND_LABEL.expense,
  }));
  const depositRows: RuleRow[] = deposits.map((d) => ({
    kind: "deposit",
    key: d.key,
    label: d.key,
    value: d.kind,
    learnedAt: d.d,
    source: RULE_KIND_LABEL.deposit,
  }));
  /* 배운 날이 없다(앱에 박혀 있다) — 대신 작은 글씨에 「왜 이 규칙인가」(실데이터 근거)를 보여 준다 */
  const codeRows: RuleRow[] = DESC_RULES.map((r) => ({
    kind: "code",
    key: r.name,
    label: r.name,
    value: r.category,
    learnedAt: null,
    source: r.why,
    off: off.has(r.name),
  }));

  return mergeRuleRows(aliasRows, taxRows, expenseRows, depositRows, codeRows);
}

/**
 * ⭐ 규칙 끄기 — 그 줄을 지운다(code 만 「끈 이름」 목록에 넣는다).
 *
 *   지운 값을 RETURNING 으로 받아 「최근 한 일」에 실어 둔다 — 되돌리기(ruleOn)가 그 값으로
 *   되살린다. 이미 붙은 분류·연결은 건드리지 않는다(「끄면 다음 자료부터」).
 * 🔴 기록은 **한 줄**. 계산서 상대는 코어를 quiet 로 불러 코어의 「규칙 취소」 줄을 막는다 —
 *    두 줄이 남으면 사장님이 「뭐가 두 번 된 거지」 하신다.
 */
export async function disableRuleCore(
  kind: RuleKind,
  key: string,
  uid: number | null,
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const k = (key ?? "").trim();
  if (!k) return { ok: false, error: "규칙 열쇠가 없습니다" };

  let row: RuleRow | null = null;
  let extra = "";

  if (kind === "alias") {
    const [gone] = await db.execute<{ alias_key: string; alias_raw: string; party_key: string; party_label: string }>(sql`
      DELETE FROM party_alias WHERE alias_key = ${k}
      RETURNING alias_key, alias_raw, party_key, party_label
    `);
    if (!gone) return { ok: false, error: "그 규칙이 없습니다 — 새로 고쳐 보세요" };
    row = {
      kind, key: gone.alias_key, label: gone.alias_raw, value: gone.party_label,
      learnedAt: null, source: aliasSourceOf(gone.party_key),
      raw: gone.alias_raw, partyKey: gone.party_key,
    };
  } else if (kind === "expense") {
    const [gone] = await db.execute<{ key: string; category: string }>(sql`
      DELETE FROM expense_rule WHERE key = ${k} RETURNING key, category
    `);
    if (!gone) return { ok: false, error: "그 규칙이 없습니다 — 새로 고쳐 보세요" };
    row = { kind, key: gone.key, label: gone.key, value: gone.category, learnedAt: null, source: RULE_KIND_LABEL.expense };
  } else if (kind === "deposit") {
    const [gone] = await db.execute<{ key: string; kind: string }>(sql`
      DELETE FROM deposit_rule WHERE key = ${k} RETURNING key, kind
    `);
    if (!gone) return { ok: false, error: "그 규칙이 없습니다 — 새로 고쳐 보세요" };
    row = { kind, key: gone.key, label: gone.key, value: gone.kind, learnedAt: null, source: RULE_KIND_LABEL.deposit };
  } else if (kind === "taxParty") {
    /* 🔴 본문은 recon-core 의 코어 그대로 — 「경비·무시」로 자동 정리했던 계산서를 **모든 달**
       되살리는 논리(2025 감사 F7)가 거기 있다. quiet 로 코어 기록을 막고 아래 한 줄만 남긴다 */
    const r = await removeTaxPartyRuleCore(k, uid, { quiet: true });
    if (!r.ok) return r;
    row = { kind, key: k, label: r.nameRaw, value: r.kind, learnedAt: null, source: RULE_KIND_LABEL.taxParty };
    if (r.revived > 0) extra = ` (계산서 ${r.revived}장 되살림)`;
  } else {
    /* code — 앱에 박힌 DESC_RULES 는 지울 수 없다. 「끈 이름」 목록에 넣으면 자동 분류가 건너뛴다 */
    const def = DESC_RULES.find((r) => r.name === k);
    if (!def) return { ok: false, error: "그 기본 규칙이 없습니다" };
    const off = await descRulesOff();
    if (off.includes(k)) return { ok: false, error: "이미 꺼 둔 규칙입니다" };
    await setDescRulesOff([...off, k]);
    row = { kind, key: k, label: def.name, value: def.category, learnedAt: null, source: def.why, off: true };
  }

  /* ⭐ 최근 한 일 — 규칙 끄기는 「사람」. 되돌리기 = enableRuleCore(그대로 되살리기) */
  await logActivity({
    actor: uid,
    how: "사람",
    verb: "규칙",
    label: `${W.ruleRemoved}: ${RULE_KIND_LABEL[kind]} 「${row.label}」 = ${row.value}${extra}`,
    undo: { kind: "ruleOn", args: ruleUndoArgs(row) },
  });
  return { ok: true, label: row.label };
}

/**
 * ⭐ 규칙 되살리기·다시 켜기 — 끄기의 거울상.
 *
 *   「최근 한 일」의 되돌리기(ruleOn)와 「자동 규칙」 화면의 [켜기](기본 규칙만)가 같이 쓴다.
 * 🔴 별명은 learnAlias 정본을 부른다(quiet — 아래서 한 줄만 남긴다). 계산서 상대에 붙은
 *    「경비·무시면 열린 계산서를 자동 정리」까지 setTaxPartyRuleCore 가 그대로 한다.
 * 🔴 과거분 일괄 적용은 여기서도 안 한다 — 지출·입금 규칙은 **다음 자료부터** 붙는다.
 */
export async function enableRuleCore(
  kind: RuleKind,
  key: string,
  value: string,
  label: string,
  uid: number | null,
  extra?: { raw?: string; partyKey?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const k = (key ?? "").trim();
  const v = (value ?? "").trim();
  if (!k) return { ok: false, error: "규칙 열쇠가 없습니다" };
  const shown = (label ?? "").trim() || k;

  if (kind === "alias") {
    const partyKey = (extra?.partyKey ?? "").trim();
    if (!partyKey) return { ok: false, error: "되살릴 상대 정보가 없습니다 — 규칙을 다시 맞춰 주세요" };
    /* 🔴 keyOverride 로 **끌 때와 같은 열쇠**를 쓴다 — 계산서 상대(T:)의 열쇠는
       normName(이름) 이 아니라 「이름@사업자번호」라서, 안 주면 다른 줄이 생긴다 */
    await learnAlias(extra?.raw ?? shown, partyKey, v || shown, { uid, quiet: true, keyOverride: k });
  } else if (kind === "expense") {
    if (!v) return { ok: false, error: "되살릴 분류가 없습니다" };
    await db.execute(sql`
      INSERT INTO expense_rule (key, category) VALUES (${k}, ${v})
      ON CONFLICT (key) DO UPDATE SET category = EXCLUDED.category, updated_at = now()
    `);
  } else if (kind === "deposit") {
    if (!(DEPOSIT_KINDS as readonly string[]).includes(v)) return { ok: false, error: "입금 성격이 올바르지 않습니다" };
    await db.execute(sql`
      INSERT INTO deposit_rule (key, kind) VALUES (${k}, ${v})
      ON CONFLICT (key) DO UPDATE SET kind = EXCLUDED.kind, updated_at = now()
    `);
  } else if (kind === "taxParty") {
    if (!TAX_PARTY_KINDS.includes(v)) return { ok: false, error: "상대 유형이 올바르지 않습니다" };
    const r = await setTaxPartyRuleCore(k, shown, v as TaxPartyKind, uid, { quiet: true });
    if (!r.ok) return r;
  } else {
    const def = DESC_RULES.find((r) => r.name === k);
    if (!def) return { ok: false, error: "그 기본 규칙이 없습니다" };
    const off = await descRulesOff();
    if (!off.includes(k)) return { ok: false, error: "꺼 둔 규칙이 아닙니다" };
    await setDescRulesOff(off.filter((n) => n !== k));
  }

  /* ⭐ 최근 한 일 — 되살리기도 「규칙」 한 줄(새 verb 없음). 되돌리기 = 다시 끄기 */
  await logActivity({
    actor: uid,
    how: "사람",
    verb: "규칙",
    label: `${W.ruleSaved}: ${RULE_KIND_LABEL[kind]} 「${shown}」 = ${v}`,
    undo: { kind: "ruleOff", args: { ruleKind: kind, key: k } },
  });
  return { ok: true };
}
