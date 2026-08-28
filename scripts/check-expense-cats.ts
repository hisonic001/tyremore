/**
 * ⭐ 확인: 지출 분류 규칙이 조용히 어긋나지 않았나 (2회차 A5·C1 + 함정 지킴이, 2026-08-28)
 *
 *   무엇을 지키나 —
 *     A5 「분류 해제」가 다시 말없이 한 줄만 푸는 것.
 *     C1 같은 성격의 입금이 적요 머리표에 따라 두 분류로 갈리는 것.
 *     ⚠ **백슬래시 함정** — 이 프로젝트의 SQL 정규식은 JS 문자열 안에 산다.
 *        `\]` 를 `\]` 로 한 글자 잘못 쓰면 런타임에 백슬래시가 사라지는데
 *        **오류가 안 난다.** 감사 G6 이 이걸로 「상대별 묶어 붙이기 N건」을 거짓말하게 만들었고,
 *        2회차 수리 중에도 같은 실수가 한 번 났다. 그래서 값 자체를 여기서 본다.
 *     ⚠ **JS ↔ SQL 상대명 규칙** — payerKeyOf(화면·서버)와 PAYER_KEY_SQL(질의)이
 *        같은 답을 내야 expense_rule 이 붙는다. 두 벌이라 언제든 갈라질 수 있다.
 *
 *   🔴 읽기 전용. 자료를 바꾸지 않는다.
 *
 *   npx tsx scripts/check-expense-cats.ts
 */
import fs from "node:fs";
import { config } from "dotenv";
config({ path: ".env.local" });

const NL = "\n";
let bad = 0;
const num = (n: number) => n.toLocaleString("ko-KR");
function ok(name: string, pass: boolean, detail: string) {
  if (!pass) bad++;
  console.log("  " + (pass ? "✓" : "⚠") + " " + name.padEnd(38) + " " + detail);
}
const head = (s: string) => console.log(NL + "  " + s + NL);
const BS = String.fromCharCode(92);

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { CARD_SETTLE_PATTERN_SQL, PAYER_KEY_SQL, payerKeyOf } = await import("../src/lib/expense-cats");

  console.log(NL + "── 지출 분류 지킴이 ──");

  /* ══════ 함정 ①: 정규식 백슬래시가 살아 있는가 ══════ */
  head("[함정] SQL 정규식의 백슬래시가 런타임까지 살아 있나");
  ok(
    "CARD_SETTLE_PATTERN_SQL 의 " + BS + "] 보존",
    CARD_SETTLE_PATTERN_SQL.includes(BS + "]"),
    CARD_SETTLE_PATTERN_SQL.includes(BS + "]")
      ? "정규식 두 개 다 정상"
      : "백슬래시가 벗겨졌다 — TS 소스에 " + BS + BS + "] 로 써야 한다",
  );
  /**
   * 🔴 **알고도 놔둔 것 (2회차 3순위 C3)** — 실패로 세지 않고 알려만 준다.
   *    expense-core.ts 의 이자 규칙은 sql 템플릿 문자열 안에 있어 백슬래시가 벗겨진다.
   *    다만 POSIX 정규식에서 대괄호 밖 ']' 는 그냥 ']' 이고 '.' 는 아무 글자라
   *    **지금 자료에서는 두 형태가 똑같이 6건 35,237원을 잡는다** (2026-08-28 실측).
   *    늘 켜져 있는 경고로 만들면 아무도 안 보게 되므로 참고로만 남긴다.
   */
  const coreSrc = fs.readFileSync("src/lib/expense-core.ts", "utf8");
  const inTemplate = coreSrc.includes("c.description ~ " + "'" + BS + "]");
  console.log(
    "  · sql 템플릿 안 백슬래시 정규식".padEnd(38) +
      (inTemplate
        ? " 아직 있다 (expense-core 이자 규칙) — 알고 놔둔 것, 3순위 C3"
        : " 없음 — C3 까지 정리됨"),
  );

  /* ══════ 함정 ②: 상대명 규칙이 JS ↔ SQL 같은가 (감사 G6) ══════ */
  head("[함정] 상대명 규칙 — 화면(JS)과 질의(SQL)가 같은 답을 내나");
  const rows = await db.execute<{ id: number; source: string; description: string; k: string }>(sql`
    SELECT id, source, description, (${sql.raw(PAYER_KEY_SQL)}) k FROM cash_txn WHERE is_active
  `);
  const diff = rows.filter((r) => payerKeyOf(r.source, r.description) !== r.k);
  ok(
    "payerKeyOf(JS) = PAYER_KEY_SQL",
    diff.length === 0,
    diff.length === 0
      ? rows.length + "줄 전부 같음"
      : diff.length + "줄 다름 — 예: " + diff.slice(0, 2).map((r) => r.description).join(" / "),
  );

  /* ══════ A5: 해제가 두 갈래인가 ══════ */
  head("[A5] 「분류 해제」가 몇 건 풀리는지 물어보나");
  const feSrc = fs.readFileSync("src/lib/fin-expense.ts", "utf8");
  const uiSrc = fs.readFileSync("src/app/finance/expenses/expenses-ui.tsx", "utf8");
  ok("previewUnset 있음", feSrc.includes("export async function previewUnset"), "누르기 전에 건수를 센다");
  ok("scope 두 갈래를 받음", feSrc.includes('scope?: "one" | "all"'), "이 줄만 / 같은 상대 전부");
  ok("해제가 트랜잭션 안", feSrc.includes("await db.transaction"), "줄 UPDATE 와 규칙 DELETE 가 같이 성공·실패");
  ok("화면이 두 버튼을 보여줌", uiSrc.includes("건 전부") && uiSrc.includes("이 줄만"), "말없이 한 줄만 풀지 않음");

  /* 지금 해제하면 몇 건이 걸리나 — 숫자로 보여준다 (많을수록 「말없이 1줄」이 위험했다) */
  const heavy = await db.execute<{ key: string; category: string; n: number; s: string }>(sql`
    SELECT (${sql.raw(PAYER_KEY_SQL)}) key, category, count(*)::int n, SUM(out_amount)::bigint s
    FROM cash_txn WHERE is_active AND out_amount > 0 AND category IS NOT NULL
    GROUP BY 1, 2 HAVING count(*) >= 10 ORDER BY 3 DESC LIMIT 6
  `);
  console.log(NL + "      한 번 해제할 때 「전부」를 고르면 풀리는 건수 (상위 6):");
  for (const h of heavy) {
    console.log("        " + h.key.padEnd(16) + " " + String(h.category).padEnd(8) + " " + String(h.n).padStart(4) + "건  " + num(Number(h.s)) + "원");
  }

  /* ══════ C1: 카드사 환급이 한 덩어리인가 ══════ */
  head("[C1] 카드사 수수료 환급 = 카드정산 한 덩어리");
  const split = await db.execute<{ category: string | null; n: number; s: string }>(sql`
    SELECT category, count(*)::int n, COALESCE(SUM(in_amount), 0)::bigint s FROM cash_txn
    WHERE is_active AND source = '통장' AND in_amount > 0 AND ${sql.raw(CARD_SETTLE_PATTERN_SQL)}
    GROUP BY 1 ORDER BY 2 DESC
  `);
  for (const r of split) {
    console.log("      " + (r.category ?? "분류 없음").padEnd(10) + " " + String(r.n).padStart(5) + "건  " + num(Number(r.s)) + "원");
  }
  const leaked = split.filter((r) => r.category !== null && r.category !== "카드정산");
  ok(
    "카드정산 패턴에 걸린 입금이 다른 분류로 안 샘",
    leaked.length === 0,
    leaked.length ? leaked.map((r) => r.category + " " + r.n + "건").join(", ") : "샌 것 없음",
  );
  /**
   * 🔴 반대 방향도 본다 (2026-08-28 검증에서 빠져 있던 것) —
   *    「카드정산으로 분류돼 있는데 패턴은 못 잡는 입금」이 있으면
   *    **새 카드사가 생겼거나 적요 모양이 바뀐 것**이다. 그대로 두면 다음 달 자동 분류가 놓친다.
   */
  const [missed] = await db.execute<{ n: number; s: string; ex: string | null }>(sql`
    SELECT count(*)::int n, COALESCE(SUM(in_amount), 0)::bigint s,
           string_agg(DISTINCT left(description, 24), ' | ') ex
    FROM cash_txn
    WHERE is_active AND source = '통장' AND in_amount > 0 AND category = '카드정산'
      AND NOT ${sql.raw(CARD_SETTLE_PATTERN_SQL)}
  `);
  ok(
    "카드정산인데 패턴이 못 잡는 입금 없음",
    Number(missed.n) === 0,
    Number(missed.n) === 0 ? "0건" : missed.n + "건 " + num(Number(missed.s)) + "원 — " + (missed.ex ?? "") + " (패턴에 더할 것)",
  );

  const taxRefund = await db.execute<{ category: string | null; n: number }>(sql`
    SELECT category, count(*)::int n FROM cash_txn
    WHERE is_active AND in_amount > 0 AND description LIKE '%세무서%' GROUP BY 1
  `);
  ok(
    "세무서 환급은 카드정산으로 안 끌려감",
    taxRefund.every((r) => r.category !== "카드정산"),
    taxRefund.map((r) => (r.category ?? "분류 없음") + " " + r.n + "건").join(", ") || "해당 없음",
  );

  console.log(bad === 0 ? NL + "  결과: 지출 분류 이상 없음 ✓" + NL : NL + "  결과: ⚠ " + bad + "곳 확인 필요" + NL);
  process.exit(bad === 0 ? 0 : 1);
}
main();
