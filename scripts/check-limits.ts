/**
 * ⭐ 확인: 목록이 조용히 잘리고 있지 않나 (1회차 Issue B 지킴이, 2026-08-28)
 *
 *   무엇을 지키나 — LIMIT 은 넘어도 **오류가 안 난다.** 화면은 그냥 틀린 답을 보여줄 뿐이다.
 *   특히 통장 소진량이 잘리면 「이미 다 쓴 통장 줄」이 「전액 남음」으로 되살아나
 *   **같은 돈이 두 계산서에 이어진다.** 1회차에 그 한도들을 없앴지만,
 *   아직 남아 있는 한도와 새로 생길 한도를 여기서 눈에 보이게 센다.
 *
 *   🔴 읽기 전용. 자료를 바꾸지 않는다.
 *
 *   npx tsx scripts/check-limits.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

let bad = 0;
const num = (n: number) => n.toLocaleString("ko-KR");

/** 한도가 있는 곳 — 몇 %까지 찼나. 80% 넘으면 경고 */
function gauge(name: string, n: number, cap: number | null, note: string) {
  if (cap === null) {
    console.log(`  ✓ ${name.padEnd(34)} ${String(num(n)).padStart(8)}행  (한도 없음 — ${note})`);
    return;
  }
  const pct = (n / cap) * 100;
  const mark = pct >= 80 ? "⚠" : pct >= 50 ? "·" : "✓";
  if (pct >= 80) bad++;
  console.log(`  ${mark} ${name.padEnd(34)} ${String(num(n)).padStart(8)} / ${num(cap)}  (${pct.toFixed(1)}%)  ${note}`);
}

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { monthRange, kstToday } = await import("../src/lib/ym");

  console.log("\n── 목록 잘림 점검 ──\n");
  console.log("  [1회차에 한도를 없앤 곳] — 다시 생기면 안 되는 자리\n");

  const [used] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM (
      SELECT cash_id FROM (
        SELECT ref_id cash_id FROM recon_match
         WHERE ref_table = 'cash_txn' AND kind IN ('매입계산서','매출계산서') AND status = '확정'
        UNION ALL
        SELECT src_id FROM recon_match
         WHERE src_table = 'cash_txn' AND kind IN ('매입지급','이체입금') AND status = '확정'
      ) x GROUP BY cash_id
    ) z
  `);
  gauge("통장 소진량 (cashUsedMap)", Number(used.n), null, "잘리면 쓴 돈이 되살아난다");

  const [alias] = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM party_alias`);
  gauge("상대 별명 (party_alias)", Number(alias.n), null, "잘리면 ★가 조용히 꺼진다");

  const [negs] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM tax_invoice
    WHERE is_active AND total < 0 AND recon_status IN ('미대조','제안')
  `);
  gauge("열린 마이너스 계산서 (negs)", Number(negs.n), null, "잘리면 상쇄할 원본을 못 찾는다");

  console.log("\n  [아직 한도가 남아 있는 곳] — 80% 넘으면 손볼 때\n");

  const [rm] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM recon_match WHERE kind IN ('매입계산서','매출계산서')
      AND ref_table IN ('purchase_invoice','quote')
  `);
  gauge("앱 기록 연결 (taxReconV2 linked)", Number(rm.n), 5000, "이 달 풀의 id 만 조회라 실제로 닿기 어렵다");

  const [q] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM recon_match WHERE kind = '이체입금' AND ref_table = 'quote'
  `);
  gauge("이체입금 연결 (depositReconData)", Number(q.n), 10000, "이을 때마다 한 줄씩 늘어난다");

  const [pi] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM purchase_invoice WHERE status <> '취소' AND total IS NOT NULL AND total > 0
  `);
  gauge("미지급 목록 (payablesData)", Number(pi.n), 400, "🔴 오래된 것부터 400건 — 넘으면 최근 미지급이 빠진다");
  if (Number(pi.n) >= 400)
    console.log("      → 1회차 보고서 Finding 4. 목록은 잘리는데 첫 화면 「줄 돈」 총액은 안 잘려 두 숫자가 어긋난다");

  const [sup] = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM supplier WHERE is_active`);
  gauge("거래처 (taxReconV2 suppliers)", Number(sup.n), 500, "매입 계산서 상대 찾기에 쓴다");

  /* ⭐ 매입 쪽 두 목록 (2026-08-29) — 전엔 이 감시 목록에 없었다.
     purchaseHistory 는 LIMIT 이 아예 없어 전 기간이면 전부 끌어왔다 (그래서 화면이 길었다).
     이제 장부 120건에서 자르고 「N건 더 있음」을 화면이 말한다 — 잘리는 걸 아는 것이 핵심이다. */
  const [ph] = await db.execute<{ n: number }>(sql`
    SELECT count(DISTINCT i.id)::int n FROM purchase_invoice i
    JOIN purchase_invoice_item x ON x.invoice_id = i.id AND x.received_qty > 0
    WHERE i.status <> '취소'
  `);
  gauge("매입 내역 장부 (purchaseHistory · 전체 기간)", Number(ph.n), 200,
    "기본이 「오늘」이라 평소엔 안 닿는다. 「전체」를 누르면 여기서 잘리고 화면이 알려 준다");

  const [pl] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM purchase_invoice_item x JOIN purchase_invoice i ON i.id = x.invoice_id
    WHERE i.status <> '취소' AND x.received_qty < x.qty
  `);
  gauge("입고 예정 줄 (pendingLines)", Number(pl.n), null,
    "🔴 한도가 없다 — 대기가 쌓이면 /receiving 이 통째로 길어진다 (카드에 접기가 없다)");

  console.log("\n  [달마다 달라지는 것] — 이 달 기준\n");
  const ym = kstToday().slice(0, 7);
  const { start, nextStart } = monthRange(ym);

  const [wait] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM tax_invoice
    WHERE is_active AND recon_status = '대기'
      AND write_date >= ${start}::date AND write_date < ${nextStart}::date
  `);
  gauge(`「아직 안 들어온 돈」 ${ym}`, Number(wait.n), 50, "🔴 건수는 50에서 잘리는데 금액은 전체다");
  if (Number(wait.n) > 50)
    console.log("      → 1회차 보고서 Finding 5. 화면의 「N건」이 실제보다 적게 보인다");

  const [dep] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM cash_txn
    WHERE source = '통장' AND is_active AND in_amount > 0
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
  `);
  gauge(`이 달 통장 입금 줄 ${ym}`, Number(dep.n), 800, "계산서 후보 풀(taxReconV2 deposits)");

  const [inv] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM tax_invoice
    WHERE is_active AND recon_status IN ('미대조','제안')
      AND write_date >= ${start}::date AND write_date < ${nextStart}::date
  `);
  gauge(`이 달 열린 계산서 ${ym}`, Number(inv.n), 150, "정리 뷰 목록 (화면이 「더 있음」을 알려주긴 한다)");

  console.log(
    bad === 0
      ? "\n결과: 이상 없음 ✓  (한도에 가까운 곳 없음)\n"
      : `\n결과: 한도의 80%를 넘긴 곳 ${bad}군데 ⚠  — 넘기 전에 손보는 것이 좋다\n`,
  );
  process.exit(bad === 0 ? 0 : 1);
}
main();
