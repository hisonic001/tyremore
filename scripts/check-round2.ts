/**
 * ⭐ 확인: 2회차 수리가 실제로 먹었나 (2026-08-28)
 *
 *   1회차의 check-limits.ts 와 같은 자리 — 고친 것이 다시 무너지면 여기서 잡힌다.
 *   🔴 읽기 전용. 자료를 바꾸지 않는다.
 *
 *   npx tsx scripts/check-round2.ts
 */
import fs from "node:fs";
import { config } from "dotenv";
config({ path: ".env.local" });

const NL = "\n";
let bad = 0;
const num = (n: number) => n.toLocaleString("ko-KR");
function ok(name: string, pass: boolean, detail: string) {
  if (!pass) bad++;
  console.log(`  ${pass ? "✓" : "✗"} ${name.padEnd(38)} ${detail}`);
}
const head = (s: string) => console.log(NL + "  " + s + NL);

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { receivableBook } = await import("../src/lib/receivable-book");
  const { partyLedgerData } = await import("../src/lib/party-ledger");

  console.log(NL + "── 2회차 수리 확인 ──");

  /* ══ D1: 외상 나이가 한국 날짜인가 ══ */
  head("[D1] 외상 나이 = 한국 날짜");
  const [d1] = await db.execute<{ utc: string; kst: string; same: boolean }>(sql`
    SELECT CURRENT_DATE::text utc, (now() AT TIME ZONE 'Asia/Seoul')::date::text kst,
           (CURRENT_DATE = (now() AT TIME ZONE 'Asia/Seoul')::date) same
  `);
  console.log(
    `      지금 UTC ${d1.utc} · KST ${d1.kst}` +
      (d1.same ? "  (같은 날 — 차이가 안 보이는 시간대)" : "  ⚠ 다른 날 — 지금이 바로 그 시간대다"),
  );
  const bookSrc = fs.readFileSync("src/lib/receivable-book.ts", "utf8");
  ok("CURRENT_DATE 사용처 없음", !bookSrc.includes("(CURRENT_DATE -"), "KST_TODAY 로 대체됨");

  const book = await receivableBook();
  const [expect] = await db.execute<{ n: number }>(sql`
    SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date
            - min(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)))::int n
    FROM quote q LEFT JOIN (SELECT quote_id, SUM(amount) paid FROM receivable_payment GROUP BY 1) rp
      ON rp.quote_id = q.id
    WHERE q.status = '성사' AND q.payment_method = '외상' AND q.total_amount > COALESCE(rp.paid, 0)
  `);
  const maxAge = Math.max(...book.targets.map((t) => t.oldestDays));
  ok("가장 오래된 외상 나이 = KST 기준", maxAge === Number(expect.n), `${maxAge}일 (KST 계산 ${expect.n}일)`);

  /* ══ A4: 한 상대 = 카드 한 장 ══ */
  head("[A4] 외상 장부 — 한 상대 = 카드 한 장");
  const keys = book.targets.map((t) => t.key);
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  ok("겹치는 열쇠 없음", dupes.length === 0, dupes.length ? `겹침: ${dupes.join(", ")}` : "겹침 0건");

  const [truth] = await db.execute<{ k: number; n: number; remain: string }>(sql`
    SELECT count(DISTINCT CASE WHEN q.supplier_name IS NOT NULL THEN 'S:' || q.supplier_name
                               WHEN q.customer_id IS NOT NULL THEN 'C:' || q.customer_id
                               ELSE 'W:' || q.id END)::int k,
           count(*)::int n,
           COALESCE(SUM(q.total_amount - COALESCE(rp.paid, 0)), 0)::bigint remain
    FROM quote q LEFT JOIN (SELECT quote_id, SUM(amount) paid FROM receivable_payment GROUP BY 1) rp
      ON rp.quote_id = q.id
    WHERE q.status = '성사' AND q.payment_method = '외상' AND q.total_amount > COALESCE(rp.paid, 0)
  `);
  ok("곳 수", book.targets.length === Number(truth.k), `화면 ${book.targets.length}곳 = 실제 ${truth.k}곳`);
  ok("건수", book.totalCount === Number(truth.n), `화면 ${book.totalCount}건 = 실제 ${truth.n}건`);
  ok("총 잔액", book.totalRemain === Number(truth.remain), `화면 ${num(book.totalRemain)}원 = 실제 ${num(Number(truth.remain))}원`);

  const mismatch = book.targets.filter(
    (t) => t.sales.length > 0 && t.sales.reduce((s, x) => s + x.remain, 0) !== t.remain,
  );
  ok(
    "카드 머리 잔액 = 그 안 상세 합",
    mismatch.length === 0,
    mismatch.length
      ? mismatch.map((t) => `${t.label}: 머리 ${num(t.remain)} vs 상세 ${num(t.sales.reduce((s, x) => s + x.remain, 0))}`).join(" | ")
      : `${book.targets.filter((t) => t.sales.length > 0).length}곳 전부 일치`,
  );

  const [banner] = await db.execute<{ n: number; remain: string }>(sql`
    SELECT count(*) FILTER (WHERE q.total_amount > COALESCE(rp.paid, 0))::int n,
           COALESCE(SUM(q.total_amount - COALESCE(rp.paid, 0)), 0)::bigint remain
    FROM quote q LEFT JOIN (SELECT quote_id, SUM(amount) paid FROM receivable_payment GROUP BY 1) rp
      ON rp.quote_id = q.id
    WHERE q.status = '성사' AND q.payment_method = '외상'
  `);
  ok(
    "/sales 미수금 배너와 일치",
    book.totalRemain === Number(banner.remain) && book.totalCount === Number(banner.n),
    `배너 ${banner.n}건 ${num(Number(banner.remain))}원`,
  );

  /* ══ A1: 원장에 섞어 더하는 세로 합계가 없다 ══ */
  head("[A1] 거래처 원장 — 섞어 더하는 세로 합계 없음");
  const pageSrc = fs.readFileSync("src/app/finance/party/[key]/page.tsx", "utf8");
  /* 🔴 주석 문구가 아니라 **실제 코드**를 본다 — 위 SUBTOTALS 주석에도 옛 라벨이 인용돼 있다 */
  ok(
    "rows 전부를 더하는 코드 없음",
    !/rowss*.reduce/.test(pageSrc),
    "섞어 더하던 tfoot 합계 사라짐",
  );
  ok("원천별 소계 있음", pageSrc.includes("SUBTOTALS"), "계산서 / 통장 / 앱 기록");

  /* ══ A2: 원장 통장 목록 = 월별 지급 ══ */
  head("[A2] 거래처 원장 — 통장 목록과 월별 지급이 같은 이름 규칙");
  const supRows = await db.execute<{ name: string }>(sql`
    SELECT name FROM supplier WHERE biz_no IS NOT NULL AND is_active ORDER BY name LIMIT 20
  `);
  const thisYm = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7);
  let checked = 0;
  for (const sup of supRows) {
    const led = await partyLedgerData("S:" + sup.name, thisYm);
    if (!led) continue;
    const bankRows = led.rows.filter((r) => r.kind === "입금" || r.kind === "출금");
    if (bankRows.length === 0) continue;
    checked++;
    const listNet = bankRows.reduce((acc, r) => acc + r.amount, 0); // 받음−줌
    const m = led.months.find((x) => x.ym === thisYm);
    const monthPay = m ? m.paySum : 0; // 출금−입금
    ok(`${sup.name} ${thisYm} 목록 = 월별 지급`, -listNet === monthPay, `목록 ${num(-listNet)}원 · 월별 지급 ${num(monthPay)}원`);
  }
  if (checked === 0) console.log("      (이 달 통장 줄이 있는 거래처가 없어 건너뜀)");

  /* ══ A3: 짧은 이름은 부분일치를 안 한다 ══ */
  head("[A3] 짧은 거래처 이름이 남의 출금을 안 끌어오나");
  const { partyMatchSql } = await import("../src/lib/recon-data");
  for (const nm of ["한국", "유일", "제로"]) {
    const cond = partyMatchSql([nm]);
    const [r] = await db.execute<{ n: number; s: string; ex: string | null }>(sql`
      SELECT count(*)::int n, COALESCE(SUM(out_amount), 0)::bigint s,
             string_agg(DISTINCT left(description, 24), ' | ') ex
      FROM cash_txn WHERE source = '통장' AND is_active AND (${cond})
    `);
    console.log(`      「${nm}」 → ${r.n}줄 ${num(Number(r.s))}원  ${r.ex ?? ""}`);
  }
  const [elec] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM cash_txn
    WHERE source = '통장' AND is_active AND description LIKE '%한국전력%' AND (${partyMatchSql(["한국"])})
  `);
  ok("「한국」이 한국전력공사를 안 끌어옴", Number(elec.n) === 0, `${elec.n}줄`);

  /* ══ A5: 해제가 두 갈래인가 ══ */
  head("[A5] 지출 분류 해제 — 「이 줄만 / 전부」");
  const feSrc = fs.readFileSync("src/lib/fin-expense.ts", "utf8");
  const uiSrc = fs.readFileSync("src/app/finance/expenses/expenses-ui.tsx", "utf8");
  ok("previewUnset 있음", feSrc.includes("export async function previewUnset"), "해제 전에 건수를 센다");
  ok("scope: one | all 받음", feSrc.includes('scope?: "one" | "all"'), "두 갈래");
  ok("해제가 트랜잭션 안", feSrc.includes("await db.transaction"), "줄 UPDATE 와 규칙 DELETE 가 같이 성공/실패");
  ok("화면이 물어봄", uiSrc.includes("건 전부") && uiSrc.includes("이 줄만"), "버튼 두 개");

  /* ══ E1: 외상 쓰기가 사장님 전용인가 ══ */
  head("[E1] 외상 수금 = 사장님 전용 (매입 지급과 같은 기준)");
  const rSrc = fs.readFileSync("src/lib/receivable.ts", "utf8");
  ok("getSession 문지기 사라짐", !/if (!(await getSession()))/.test(rSrc), "isOwner 로 바뀜");
  ok("isOwner 세 곳", (rSrc.match(/await isOwner()/g) ?? []).length === 3, "addCollection · settleReceivables · removeCollection");
  ok("없는 수금을 지우면 오류", rSrc.includes("이미 없습니다"), "0건 조용히 성공하지 않음");

  /* ══ C1: 카드사 수수료 환급이 한 분류인가 ══ */
  head("[C1] 카드사 수수료 환급 = 카드정산 한 덩어리");
  const { CARD_SETTLE_PATTERN_SQL } = await import("../src/lib/expense-cats");
  const split = await db.execute<{ category: string | null; n: number; s: string }>(sql`
    SELECT category, count(*)::int n, COALESCE(SUM(in_amount), 0)::bigint s FROM cash_txn
    WHERE is_active AND source = '통장' AND in_amount > 0 AND ${sql.raw(CARD_SETTLE_PATTERN_SQL)}
    GROUP BY 1 ORDER BY 2 DESC
  `);
  for (const r of split) console.log(`      ${(r.category ?? "분류 없음").padEnd(10)} ${r.n}건 ${num(Number(r.s))}원`);
  const notCard = split.filter((r) => r.category !== "카드정산" && r.category !== null);
  ok("카드정산 패턴에 걸린 입금이 다른 분류로 안 샘", notCard.length === 0, notCard.map((r) => r.category).join(", ") || "샌 것 없음");
  const [taxRefund] = await db.execute<{ category: string | null }>(sql`
    SELECT category FROM cash_txn WHERE is_active AND description LIKE '%세무서%' AND in_amount > 0 LIMIT 1
  `);
  ok("세무서 환급은 그대로 기타입금", taxRefund?.category === "기타입금", `지금 「${taxRefund?.category}」`);

  console.log(bad === 0 ? NL + "  전부 통과 ✅" + NL : NL + `  ⚠ ${bad}개 어긋남` + NL);
  process.exit(bad === 0 ? 0 : 1);
}
main();
