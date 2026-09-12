/**
 * ⭐ 「자동 규칙」 계약 — 앱이 배운 것 다섯 갈래를 한 목록으로 (개편 4단계, 2026-09-12)
 *
 *   사장님 결정 7③ 「상대별 규칙 학습」과 결정 5 「보고 끄기만」.
 *   저장은 **기존 표 그대로** — 새 표는 입금 성격(deposit_rule) 하나뿐이다.
 *     alias    party_alias      통장 이름 짝 (S:거래처 · C:고객id · T:입금자@사업자번호)
 *     taxParty tax_party_rule   계산서 상대 유형 (경비·대행정산·무시·월정산)
 *     expense  expense_rule     지출 분류 (상대 → 분류)
 *     deposit  deposit_rule ⭐  입금 성격 (입금자 → 판매입금·이자·지원금·환불·기타입금)
 *     code     표 없음          앱에 박힌 DESC_RULES 13개 — 끈 이름만 app_setting 에 적는다
 *
 * 🔴 DB 를 건드리지 않는다 — 시험(npm test)이 DB 없이 돌아야 해서 순수 함수만.
 * 🔴 끄기 = 그 줄을 지우는 것이다(code 만 예외). enabled 칸을 두지 않는 이유는
 *    party_alias 를 읽는 자리가 17곳·tax_party_rule 이 8곳이라, 한 곳만 빠뜨려도
 *    「끈 규칙이 여전히 작동」하기 때문. 되살리기는 「최근 한 일」의 되돌리기(ruleOn)로 한다.
 */

export const RULE_KINDS = ["alias", "taxParty", "expense", "deposit", "code"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export interface RuleRow {
  kind: RuleKind;
  /** 지우거나 되살릴 때 쓰는 열쇠 — alias_key · biz_no · payerKeyOf · DESC_RULES.name */
  key: string;
  /** 사람이 읽는 왼쪽 — 통장에 찍히는 이름 · 상호 · 상대명 */
  label: string;
  /** 오른쪽 — 거래처/고객 · 유형 · 분류 · 성격 */
  value: string;
  /** YYYY-MM-DD (code 규칙은 null) */
  learnedAt: string | null;
  /** 줄 아래 작은 글씨 — 「거래처」 「고객」 「계산서 상대」 「왜 이 규칙인가」 */
  source: string;
  /** code 규칙만 true 가 될 수 있다(꺼 둔 기본 규칙) */
  off?: boolean;
  /** alias 되살리기에 필요한 원문·party_key */
  raw?: string;
  partyKey?: string;
}

export const RULE_KIND_LABEL: Record<RuleKind, string> = {
  alias: "이름 짝",
  taxParty: "계산서 상대",
  expense: "지출 분류",
  deposit: "입금 성격",
  code: "앱 기본 규칙",
};

/** party_alias.party_key 접두 → 사람 말 */
export function aliasSourceOf(partyKey: string): string {
  if (partyKey.startsWith("S:")) return "거래처";
  if (partyKey.startsWith("C:")) return "고객";
  if (partyKey.startsWith("T:")) return "계산서 상대";
  return "상대";
}

/**
 * 목록 합치기 — 갈래 순서(RULE_KINDS) → 배운 날 최신 순 → 이름 순.
 * 화면은 갈래 탭으로 나눠 보여 주지만, 합친 목록 하나로 검색·건수를 센다.
 */
export function mergeRuleRows(...groups: RuleRow[][]): RuleRow[] {
  const order = new Map<RuleKind, number>(RULE_KINDS.map((k, i) => [k, i]));
  return groups.flat().sort((a, b) => {
    const ka = order.get(a.kind) ?? 99;
    const kb = order.get(b.kind) ?? 99;
    if (ka !== kb) return ka - kb;
    if (a.learnedAt !== b.learnedAt) return (b.learnedAt ?? "").localeCompare(a.learnedAt ?? "");
    return a.label.localeCompare(b.label, "ko");
  });
}

/** 검색 — 띄어쓰기·㈜·(주) 를 무시하고 label·value·key 를 본다 */
export function filterRules(rows: RuleRow[], q: string): RuleRow[] {
  const norm = (s: string) => s.replace(/\s+/g, "").replace(/㈜|\(주\)|주식회사/g, "").toLowerCase();
  const needle = norm(q ?? "");
  if (!needle) return rows;
  return rows.filter((r) => norm(r.label).includes(needle) || norm(r.value).includes(needle) || norm(r.key).includes(needle));
}

/** 되돌리기 인자 — 「규칙 끄기」 줄에 실어 두면 그대로 되살릴 수 있다 */
export function ruleUndoArgs(row: RuleRow): Record<string, string> {
  const a: Record<string, string> = { ruleKind: row.kind, key: row.key, value: row.value, label: row.label };
  if (row.raw) a.raw = row.raw;
  if (row.partyKey) a.partyKey = row.partyKey;
  return a;
}

/** 갈래별 건수 — 탭 머리 */
export function countByKind(rows: RuleRow[]): Record<RuleKind, number> {
  const out = Object.fromEntries(RULE_KINDS.map((k) => [k, 0])) as Record<RuleKind, number>;
  for (const r of rows) out[r.kind]++;
  return out;
}
