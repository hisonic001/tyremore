/**
 * ⭐ 확인: 화면 하나가 질의를 몇 개나 던지나 (1회차 Issue D 지킴이, 2026-08-28)
 *
 *   무엇을 지키나 — 이 앱의 DB 접속 자리는 **3개뿐**이다 (src/db `max: 3`).
 *   화면 하나가 질의를 수십·수백 개 던지면 자리를 오래 붙들어 **앱 전체가 멎는다.**
 *   2026-08-05 「max clients reached」, 08-11 무한로딩이 실제로 그 길이었다.
 *
 *   🔴 **보는 것은 「몇 개냐」가 아니라 「자료가 늘면 같이 늘어나느냐」다.**
 *      질의 18개가 늘 18개면 괜찮다. 6개였다가 자료가 늘어 60개가 되면 그게 사고다.
 *      그래서 자료량이 크게 다른 여러 달을 돌려 보고 **질의 수가 그대로인지**를 본다.
 *      (1회차에 입금 화면을 「판매 한 건마다 한 번」 → 「한 번」 으로 고쳤다.
 *       그때 20회였던 것이 지금은 달이 바뀌어도 고정이다.)
 *
 *   🔴 읽기 전용. 자료를 바꾸지 않는다.
 *
 *   npx tsx scripts/check-query-load.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

let bad = 0;

/** 자료량이 달라도 질의 수가 이만큼 넘게 흔들리면 「자료에 비례해 는다」고 본다 */
const DRIFT = 3;
/** 어떤 화면도 이 이상은 위험 — 접속 자리 3개를 오래 붙든다 */
const HARD_CAP = 80;

async function main() {
  const { db } = await import("../src/db");
  const orig = db.execute.bind(db);
  let n = 0;
  (db as unknown as { execute: typeof orig }).execute = ((q: Parameters<typeof orig>[0]) => {
    n++;
    return orig(q);
  }) as typeof orig;

  const { taxCashData, taxReconV2 } = await import("../src/lib/tax-recon");
  const { depositReconData, expenseData, payablesData } = await import("../src/lib/recon-data");
  const { depositTaxCandidates, transferSalesMissing } = await import("../src/lib/deposit-tax");
  const { cashUsedSql, samePartyName, similarPartyName } = await import("../src/lib/recon-data");
  const { payerKeyOf } = await import("../src/lib/expense-cats");
  const { monthRange, kstToday } = await import("../src/lib/ym");
  const { customerReportData } = await import("../src/lib/report-customers");
  const { vehicleReportData } = await import("../src/lib/report-vehicles");
  const { sql } = await import("drizzle-orm");

  /* 자료량이 일부러 크게 다른 달들 — 한산한 달과 바쁜 달 */
  const MONTHS = ["2026-08", "2026-06", "2026-01", "2025-06"];

  const screens: { name: string; note: string; known?: boolean; run: (ym: string) => Promise<void> }[] = [
    {
      name: "입금 화면",
      note: "1회차에 고친 곳 — 고정이어야 한다",
      run: async (ym) => {
        const d = await depositReconData(ym);
        await depositTaxCandidates(ym, d.open.map((s) => ({ id: s.dep.id, date: s.dep.date, amount: s.dep.amount, payerName: s.dep.payerName })));
        await transferSalesMissing(ym);
      },
    },
    { name: "계산서 돈 확인 (매입)", note: "🔴 월정산 상대 1곳당 4질의 — 1회차에 알고도 놔둔 곳", known: true, run: async (ym) => void (await taxCashData("매입", ym)) },
    { name: "계산서 돈 확인 (매출)", note: "", run: async (ym) => void (await taxCashData("매출", ym)) },
    { name: "계산서 정리", note: "마이너스 계산서 1장당 1질의", run: async (ym) => void (await taxReconV2(ym)) },
    { name: "지출 분류", note: "", run: async (ym) => void (await expenseData(ym)) },
    { name: "미지급", note: "달과 무관", run: async () => void (await payablesData()) },
    { name: "손님 리포트", note: "고정 5질의 (2026-09-14)", run: async (ym) => void (await customerReportData(ym, "person")) },
    { name: "차량 리포트", note: "5질의 · 2026-08 전 달은 규격 2질의를 건너뛰어 3 (2026-09-14)", run: async (ym) => void (await vehicleReportData(ym, "person")) },
  ];

  console.log("\n── 화면별 질의 수 — 달이 바뀌어도 그대로여야 한다 ──\n");
  console.log(`  ${"화면".padEnd(24)}${MONTHS.map((m) => m.slice(2).padStart(8)).join("")}     판정`);
  console.log(`  ${"─".repeat(24 + MONTHS.length * 8 + 12)}`);

  for (const s of screens) {
    const counts: number[] = [];
    for (const ym of MONTHS) {
      n = 0;
      await s.run(ym);
      counts.push(n);
    }
    const lo = Math.min(...counts);
    const hi = Math.max(...counts);
    const drift = hi - lo;
    const grows = drift > DRIFT;
    const tooMany = hi > HARD_CAP;
    if ((grows || tooMany) && !s.known) bad++;
    const tag = s.known ? " · 아는 것" : " · 새것";
    const verdict = tooMany ? `⚠ 너무 많다 (${hi})${tag}` : grows ? `⚠ 자료 따라 늚 (+${drift})${tag}` : "✓ 고정";
    console.log(`  ${s.name.padEnd(24)}${counts.map((c) => String(c).padStart(8)).join("")}     ${verdict}`);
    if (s.note) console.log(`  ${" ".repeat(24)}${s.note}`);
  }

  /* 늦게 들어오는 입금을 찾는 창(±90일)이 아직 충분한가.
     창을 두 배로 넓혔을 때 후보가 늘면 90일이 좁아졌다는 뜻이다 (1회차에 ±10 → ±90 으로 넓혔다). */
  console.log("\n── 늦게 들어온 입금 창(±90일)이 아직 충분한가 ──\n");
  const gap = (a: string, b: string) => Math.abs((+new Date(a) - +new Date(b)) / 86400000);
  for (const ym of [kstToday().slice(0, 7), ...MONTHS.slice(1)]) {
    const { start, nextStart } = monthRange(ym);
    const sales = await transferSalesMissing(ym);
    if (sales.length === 0) {
      console.log(`  ✓ ${ym}: 아직 못 맞춘 계좌이체 판매 없음`);
      continue;
    }
    const lines = await db.execute<{ dt: string; description: string; remain: string }>(sql`
      SELECT to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') AS dt, c.description,
             (c.in_amount - ${cashUsedSql("c")})::bigint remain
      FROM cash_txn c
      WHERE c.source = '통장' AND c.is_active AND c.in_amount > 0
        AND (c.category IS NULL OR c.category = '판매입금') AND c.in_amount > ${cashUsedSql("c")}
        AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date - 200
        AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date <= ${nextStart}::date + 200
    `);
    const hit = (win: number) =>
      sales.filter((s) => {
        const rq = s.amount - s.linked;
        return lines.some((c) => {
          if (gap(c.dt, s.day) > win) return false;
          const payer = payerKeyOf("통장", c.description);
          return Number(c.remain) === rq || samePartyName(payer, s.who) || similarPartyName(payer, s.who);
        });
      }).length;
    const w90 = hit(90);
    const more = hit(200) - w90;
    if (more >= 5) bad++; // 몇 건 더 나오는 건 정상 — 사장님 말씀대로 몇 달 뒤 입금이 실제로 있다
    console.log(
      `  ${more >= 5 ? "⚠" : more > 0 ? "·" : "✓"} ${ym}: 못 맞춘 판매 ${String(sales.length).padStart(3)}건 · 후보 뜨는 것 ±90일 ${w90}건` +
        (more >= 5 ? ` · 더 넓히면 ${more}건 더  ← WIN(90) 이 좁아졌다` : more > 0 ? ` · 더 넓히면 ${more}건 더 (이 정도는 정상)` : "  ← 90일로 충분"),
    );
  }

  console.log("");
  console.log(
    bad === 0
      ? "결과: 새로 생긴 문제 없음 ✓  (⚠ 로 뜬 것은 1회차에 알고도 놔둔 것)"
      : `결과: 새로 생긴 문제 ${bad}가지 ⚠`,
  );
  console.log("");
  process.exit(bad === 0 ? 0 : 1);
}
main();
