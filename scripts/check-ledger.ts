/**
 * ⭐ 확인: 거래처 원장이 다시 뒤틀리지 않았나 (2회차 A1·A2·A3 지킴이, 2026-08-28)
 *
 *   무엇을 지키나 — 원장은 **한 거래를 네 각도에서 본 기록**(계산서·통장·앱 매입·지급)을
 *   한 표에 놓는다. 그래서 두 가지가 늘 새로 생긴다:
 *     ① 그것들을 **더해 버리는 것** (같은 돈이 두세 번 빠진다 — A1)
 *     ② 상대를 **이름으로 찾다가 남의 돈을 끌어오거나 제 것을 못 찾는 것** (A2·A3)
 *   ②는 이미 세 번 재발했다 — 감사 F16(「타이어」) · G8(「제로」) · 2회차 A3(「한국」).
 *   그래서 낱말을 막는 대신 **결과를 여기서 센다.**
 *
 *   🔴 이름 규칙은 반드시 **원장이 실제로 쓴 이름(led.cashNames)** 으로 검사한다.
 *      검사가 이름을 따로 만들면 원장보다 좁거나 넓어져 **틀린 안심**을 준다
 *      (2026-08-28 실제로 그랬다 — 사장님 지적).
 *
 *   🔴 읽기 전용. 자료를 바꾸지 않는다.
 *
 *   npx tsx scripts/check-ledger.ts
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

/** 경비 분류 — 이런 것이 거래처 원장의 통장 줄로 잡히면 이름 매칭이 샌 것이다 */
const EXPENSE_LEAK = ["공과금", "세금·보험", "수수료", "인건비", "임차료", "식대·접대", "기타경비"];

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { normDescSql, partyMatchSql } = await import("../src/lib/recon-data");
  const { partyLedgerData } = await import("../src/lib/party-ledger");

  console.log(NL + "── 거래처 원장 지킴이 ──");

  /* ══════ A1: 이질적인 원천을 섞어 더하지 않는가 ══════ */
  head("[A1] 원장이 계산서·통장·앱 기록을 섞어 더하지 않는가");
  const pageSrc = fs.readFileSync("src/app/finance/party/[key]/page.tsx", "utf8");
  ok(
    "rows 전부를 더하는 코드 없음",
    !/rows\s*\.reduce/.test(pageSrc),
    "섞어 더하면 미쉐린 8월이 −49,844,760원으로 보였다 (실제 −26,483,202)",
  );
  ok("원천별 소계로 나눠 놓음", pageSrc.includes("SUBTOTALS"), "계산서 / 통장 / 앱 기록");

  /* 거래처를 한 번씩만 읽어 아래 검사 셋이 **같은 원장**을 본다 */
  const sups = await db.execute<{ name: string; biz_no: string | null }>(sql`
    SELECT name, biz_no FROM supplier WHERE is_active ORDER BY name LIMIT 200
  `);
  const thisYm = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7);
  const leds: { name: string; biz: string | null; led: Awaited<ReturnType<typeof partyLedgerData>> }[] = [];
  for (const s of sups) leds.push({ name: s.name, biz: s.biz_no, led: await partyLedgerData("S:" + s.name, thisYm) });

  /* ══════ A2: 원장 안에서 통장 목록 = 월별 지급 ══════ */
  head("[A2] 같은 원장 안에서 통장 목록 합 = 월별 「지급」");
  let compared = 0;
  let skipped = 0;
  for (const x of leds) {
    if (!x.led) continue;
    const bank = x.led.rows.filter((r) => r.kind === "입금" || r.kind === "출금");
    if (bank.length === 0) {
      skipped++;
      continue;
    }
    compared++;
    const listNet = -bank.reduce((a, r) => a + r.amount, 0); // 줌−받음
    const m = x.led.months.find((y) => y.ym === thisYm);
    ok(
      (x.name + " " + thisYm).padEnd(26),
      listNet === (m ? m.paySum : 0),
      "목록 " + num(listNet) + "원 · 월별 지급 " + num(m ? m.paySum : 0) + "원",
    );
  }
  /* 🔴 통과 범위를 밝힌다 — 이 달에 통장 줄이 없는 거래처는 **검사하지 않았다.**
        지난 달이 어긋나 있어도 여기서는 안 잡힌다. 달을 바꿔 다시 돌려 볼 것. */
  console.log("      → " + compared + "곳 검사 · " + skipped + "곳은 이 달 통장 줄이 없어 건너뜀 (" + thisYm + "만 본다)");

  /* ══════ A3-a: 원장이 남의 돈을 끌어오는가 ══════ */
  head("[A3] 원장에 경비로 분류된 출금이 섞이지 않는가");
  const catList = sql.join(EXPENSE_LEAK.map((c) => sql`${c}`), sql`, `);
  let leaks = 0;
  let checked = 0;
  for (const x of leds) {
    if (!x.led) continue;
    /* 🔴 원장이 실제로 쓴 이름 그대로 (cashNames) — 검사가 따로 만들면 틀린 안심을 준다 */
    const cond = partyMatchSql(x.led.cashNames.slice(0, 15));
    checked++;
    const [r] = await db.execute<{ n: number; sum: string; ex: string | null }>(sql`
      SELECT count(*)::int n, COALESCE(SUM(out_amount), 0)::bigint sum,
             string_agg(DISTINCT left(description, 22), ' / ') ex
      FROM cash_txn
      WHERE source = '통장' AND is_active AND category IN (${catList}) AND (${cond})
    `);
    if (Number(r.n) > 0) {
      leaks++;
      ok("「" + x.name + "」 원장에 경비 출금이 섞임", false, r.n + "줄 " + num(Number(r.sum)) + "원 — " + (r.ex ?? ""));
    }
  }
  ok("경비 출금이 원장에 안 섞임", leaks === 0, leaks === 0 ? checked + "곳 전부 깨끗" : leaks + "곳에서 샘");

  /* ══════ A3-b: 원장이 제 계산서를 못 찾는가 ══════ */
  head("[A3] 원장이 자기 매입 계산서를 다 찾고 있나");
  /**
   * 🔴 2026-08-28 사장님 지적으로 바로잡음. 처음엔 잔액이 마이너스인 것을
   *    「계산서를 안 받는 상대」라고 적었는데 **틀렸다.** 계산서는 멀쩡히 있고
   *    **원장이 그걸 못 찾고 있었다** — supplier.biz_no 가 비어 있으면 원장은
   *    counterparty_name **완전 일치**로만 찾는데 '스칼릿' ≠ '스칼릿 주식회사' 라 0장이 된다.
   *      · 스칼릿 → 「스칼릿 주식회사」 14장 76,888,746원 (사업자 3778601859)
   *      · 제로   → 「(주)제로」 4장 5,508,000원 (사업자 1058715599)
   *    실제 잔액은 −76,894,246 이 아니라 약 −5,500원이다.
   */
  let unseen = 0;
  for (const x of leds) {
    if (!x.led) continue;
    const seenCond = x.biz
      ? sql`(t.counterparty_biz_no = ${x.biz} OR t.counterparty_name = ${x.name})`
      : sql`t.counterparty_name = ${x.name}`;
    const [seen] = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int n FROM tax_invoice t
      WHERE t.is_active AND t.direction = '매입' AND ${seenCond}
    `);
    const key = x.name.replace(/㈜|\(주\)|주식회사|\s/g, "").toLowerCase();
    if (key.length < 2) continue;
    /**
     * 🔴 정규화 정규식을 **손으로 다시 쓰지 않는다** — 앱의 정본(normDescSql)을 그대로 쓴다.
     *    2026-08-28: 여기에 정규식을 복제했다가 sql 태그드 템플릿 안에서 백슬래시가 벗겨져
     *    '(주)' 가 「글자 주 하나」를 지우는 그룹이 됐고, 그래서 「(주)제로」를 놓쳤다.
     *    이 파일이 지키려는 함정에 이 파일이 빠진 것이다.
     */
    const [loose] = await db.execute<{ n: number; s: string; nm: string | null }>(sql`
      SELECT count(*)::int n, COALESCE(SUM(t.total), 0)::bigint s,
             string_agg(DISTINCT t.counterparty_name, ' / ') nm
      FROM tax_invoice t
      WHERE t.is_active AND t.direction = '매입'
        AND ${normDescSql("t.counterparty_name")} = ${key}
    `);
    if (Number(seen.n) === 0 && Number(loose.n) > 0) {
      unseen++;
      ok(
        "「" + x.name + "」 계산서를 원장이 못 찾음",
        false,
        loose.n + "장 " + num(Number(loose.s)) + "원이 「" + (loose.nm ?? "") + "」 이름으로 있다 — supplier.biz_no 를 채울 것",
      );
    }
  }
  ok("계산서를 못 찾는 거래처 없음", unseen === 0, unseen === 0 ? "전부 잡힌다" : unseen + "곳 — 월별 잔액이 통째로 틀린다");

  /* 참고 — 계산서도 찾고 있는데 지급이 앞선 곳 (선지급·발행 시차. 정상) */
  console.log(NL + "      [참고] 계산서는 찾고 있는데 지급이 앞선 거래처:");
  let ahead = 0;
  for (const x of leds) {
    if (!x.led || x.led.months.length === 0) continue;
    const last = x.led.months[x.led.months.length - 1];
    if (last.running >= -1_000_000) continue;
    if (last.invSum === 0 && x.led.months.every((m) => m.invSum === 0)) continue; // 위에서 이미 ⚠
    ahead++;
    console.log("        · " + x.name.padEnd(14) + num(last.running).padStart(14) + "원");
  }
  if (ahead === 0) console.log("        (없음)");

  console.log(bad === 0 ? NL + "  결과: 원장 이상 없음 ✓" + NL : NL + "  결과: ⚠ " + bad + "곳 확인 필요" + NL);
  process.exit(bad === 0 ? 0 : 1);
}
main();
