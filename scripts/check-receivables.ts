/**
 * ⭐ 확인: 외상 장부가 다시 뒤틀리지 않았나 (2회차 A4·D1·E1 지킴이, 2026-08-28)
 *
 *   무엇을 지키나 —
 *     A4 한 상대가 카드 여러 장으로 쪼개지는 것. 집계와 상세가 **다른 열쇠로 묶이면**
 *        생긴다. 총액은 맞는데 「곳 수」와 카드 안 내용이 어긋나 사장님이 두 번 센다.
 *     D1 나이(며칠 됐나)를 UTC 로 세는 것. 이 DB 는 TimeZone 이 UTC 라
 *        한국 00:00~09:00 에는 하루가 덜 간 것으로 나온다.
 *     E1 돈 만지는 함수에 문지기가 느슨한 것. 매입 지급은 사장님 전용인데
 *        외상만 로그인만으로 열려 있었다.
 *
 *   🔴 읽기 전용. 자료를 바꾸지 않는다.
 *
 *   npx tsx scripts/check-receivables.ts
 */
import fs from "node:fs";
import { config } from "dotenv";
config({ path: ".env.local" });

const NL = "\n";
let bad = 0;
const num = (n: number) => n.toLocaleString("ko-KR");
function ok(name: string, pass: boolean, detail: string) {
  if (!pass) bad++;
  console.log("  " + (pass ? "✓" : "⚠") + " " + name.padEnd(36) + " " + detail);
}
const head = (s: string) => console.log(NL + "  " + s + NL);

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { receivableBook } = await import("../src/lib/receivable-book");

  console.log(NL + "── 외상 장부 지킴이 ──");
  const book = await receivableBook();

  /* ══════ A4: 한 상대 = 카드 한 장 ══════ */
  head("[A4] 한 상대가 카드 한 장인가");
  const keys = book.targets.map((t) => t.key);
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  ok("겹치는 열쇠 없음", dupes.length === 0, dupes.length ? "겹침: " + dupes.join(", ") : "겹침 0건");

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
  ok("곳 수", book.targets.length === Number(truth.k), "화면 " + book.targets.length + "곳 = 실제 " + truth.k + "곳");
  ok("건수", book.totalCount === Number(truth.n), "화면 " + book.totalCount + "건 = 실제 " + truth.n + "건");
  ok("총 잔액", book.totalRemain === Number(truth.remain), "화면 " + num(book.totalRemain) + "원 = 실제 " + num(Number(truth.remain)) + "원");

  /* 쪼개지면 카드 머리 숫자와 그 안 상세 합이 갈린다 — 가장 눈에 띄는 증상 */
  const shown = book.targets.filter((t) => t.sales.length > 0);
  const mismatch = shown.filter((t) => t.sales.reduce((s, x) => s + x.remain, 0) !== t.remain);
  /* 🔴 상세를 못 실은 카드(600건 한도 초과)는 이 검사에서 **빠진다** — 몇 곳인지 밝힌다 */
  const noDetail = book.targets.length - shown.length;
  if (noDetail > 0) console.log("      (상세를 못 실은 카드 " + noDetail + "곳은 이 검사에서 빠짐 · 못 실은 건수 " + book.detailCapped + ")");
  ok(
    "카드 머리 잔액 = 그 안 상세 합",
    mismatch.length === 0,
    mismatch.length
      ? mismatch.map((t) => t.label + ": 머리 " + num(t.remain) + " vs 상세 " + num(t.sales.reduce((s, x) => s + x.remain, 0))).join(" | ")
      : shown.length + "곳 전부 일치",
  );

  /* receivable-book.ts 머리 주석의 약속 — /sales 미수금 배너와 글자 그대로 같아야 한다 */
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
    "배너 " + banner.n + "건 " + num(Number(banner.remain)) + "원",
  );

  /* ══════ D1: 나이를 한국 날짜로 세는가 ══════ */
  head("[D1] 외상 나이 = 한국 날짜");
  const src = fs.readFileSync("src/lib/receivable-book.ts", "utf8");
  ok("CURRENT_DATE 사용처 없음", !src.includes("(CURRENT_DATE -"), "KST_TODAY 로 대체됨");

  const [days] = await db.execute<{ utc: string; kst: string; same: boolean }>(sql`
    SELECT CURRENT_DATE::text utc, (now() AT TIME ZONE 'Asia/Seoul')::date::text kst,
           (CURRENT_DATE = (now() AT TIME ZONE 'Asia/Seoul')::date) same
  `);
  console.log("      지금 UTC " + days.utc + " · KST " + days.kst +
    (days.same ? "  (같은 날 — 차이가 안 보이는 시간대)" : "  ← 지금이 바로 갈리는 시간대다"));
  const [expect] = await db.execute<{ n: number }>(sql`
    SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date
            - min(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)))::int n
    FROM quote q LEFT JOIN (SELECT quote_id, SUM(amount) paid FROM receivable_payment GROUP BY 1) rp
      ON rp.quote_id = q.id
    WHERE q.status = '성사' AND q.payment_method = '외상' AND q.total_amount > COALESCE(rp.paid, 0)
  `);
  const maxAge = book.targets.length ? Math.max(...book.targets.map((t) => t.oldestDays)) : 0;
  ok("가장 오래된 외상 나이", maxAge === Number(expect.n), maxAge + "일 (KST 계산 " + expect.n + "일)");

  /* ══════ E1: 돈 만지는 문지기 ══════ */
  head("[E1] 외상 수금 = 사장님 전용 (매입 지급과 같은 기준)");
  const rSrc = fs.readFileSync("src/lib/receivable.ts", "utf8");
  ok("로그인만 확인하는 문지기 없음", !/if \(!\(await getSession\(\)\)\)/.test(rSrc), "isOwner 로 올림");
  ok(
    "isOwner 가 세 곳 다 있음",
    (rSrc.match(/await isOwner\(\)/g) ?? []).length === 3,
    "addCollection · settleReceivables · removeCollection",
  );
  ok("없는 수금을 지우면 오류를 돌려줌", rSrc.includes("이미 없습니다"), "0건 지우고 성공이라 하지 않음");
  const pSrc = fs.readFileSync("src/lib/purchase-pay.ts", "utf8");
  ok(
    "매입 지급 쪽도 그대로 사장님 전용",
    (pSrc.match(/await isOwner\(\)/g) ?? []).length === 4,
    "payToSupplier · removePurchasePayment · undoPayFromWithdrawal · payFromWithdrawal",
  );

  console.log(bad === 0 ? NL + "  결과: 외상 장부 이상 없음 ✓" + NL : NL + "  결과: ⚠ " + bad + "곳 확인 필요" + NL);
  process.exit(bad === 0 ? 0 : 1);
}
main();
