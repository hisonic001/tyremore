/**
 * ⭐ 확인: 계산서 ↔ 통장 연결이 뒤틀리지 않았나 (1회차 Issue A 지킴이, 2026-08-28)
 *
 *   무엇을 지키나 — 같은 돈이 두 번 잡히는 일. 잇기가 두 번 눌리거나 통신 재전송이 겹치면
 *   절반만 들어온 돈으로 계산서가 「확인 완료」로 닫히는데 **화면에는 아무 표시가 안 난다.**
 *   `recon_match` 에 유니크 제약이 없어 DB 도 못 막는다. 그래서 자국을 여기서 센다.
 *
 *   🔴 읽기 전용. 자료를 바꾸지 않는다.
 *
 *   npx tsx scripts/check-money-links.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const won = (n: number) => n.toLocaleString("ko-KR");
let bad = 0;
const ok = (s: string) => console.log(`  ✓ ${s}`);
const warn = (s: string) => {
  bad++;
  console.log(`  ⚠ ${s}`);
};

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");

  console.log("\n── 계산서 ↔ 통장 연결 점검 ──\n");

  /* ① 같은 (계산서, 통장 줄) 짝이 두 번 들어갔나 — 경합의 자국.
        「조정」(이체 수수료 잔돈 흡수)은 일부러 두 행이므로 뺀다. */
  const dup = await db.execute<{ src_id: number; ref_id: number; n: number; s: string; methods: string }>(sql`
    SELECT src_id, ref_id, count(*)::int n, SUM(amount)::bigint s,
           string_agg(method || ':' || amount, ' + ' ORDER BY id) methods
    FROM recon_match
    WHERE src_table = 'tax_invoice' AND ref_table = 'cash_txn' AND status = '확정'
      AND method <> '조정'
    GROUP BY 1, 2 HAVING count(*) > 1
    ORDER BY 4 DESC LIMIT 30
  `);
  if (dup.length === 0) ok("같은 계산서·같은 통장 줄이 두 번 이어진 것: 없음");
  else {
    warn(`같은 계산서·같은 통장 줄이 두 번 이어진 것 ${dup.length}건 — 경합으로 같은 돈이 두 번 잡혔을 수 있다`);
    for (const d of dup) console.log(`      계산서#${d.src_id} ↔ 통장#${d.ref_id}: ${d.n}행 [${d.methods}] 합 ${won(Number(d.s))}원`);
  }

  /* ② 통장 줄이 제 금액보다 많이 쓰였나 — 돈이 두 곳에 배분된 결정적 증거 */
  const over = await db.execute<{ id: number; amt: string; used: string }>(sql`
    SELECT c.id, (c.in_amount + c.out_amount)::bigint amt, u.used
    FROM cash_txn c JOIN (
      SELECT cash_id, SUM(amount)::bigint used FROM (
        SELECT ref_id cash_id, amount FROM recon_match
         WHERE ref_table = 'cash_txn' AND kind IN ('매입계산서','매출계산서') AND status = '확정'
        UNION ALL
        SELECT src_id, amount FROM recon_match
         WHERE src_table = 'cash_txn' AND kind IN ('매입지급','이체입금') AND status = '확정'
      ) y GROUP BY 1
    ) u ON u.cash_id = c.id
    WHERE u.used > (c.in_amount + c.out_amount)
    ORDER BY (u.used - (c.in_amount + c.out_amount)) DESC LIMIT 30
  `);
  if (over.length === 0) ok("금액보다 많이 쓰인 통장 줄: 없음");
  else {
    warn(`금액보다 많이 쓰인 통장 줄 ${over.length}건 — 같은 돈이 두 번 배분됐다`);
    for (const o of over) console.log(`      통장#${o.id}: 금액 ${won(Number(o.amt))} < 소진 ${won(Number(o.used))}`);
  }

  /* ③ 계산서가 제 금액보다 많이 「확인」됐나.
        「조정」 잔돈 흡수는 일부러 그렇게 만든다(1회차 보고서 Finding 10) — 나눠서 센다. */
  const cov = await db.execute<{ id: number; total: number; cov: string; adj: number; name: string }>(sql`
    SELECT t.id, t.total, m.cov, m.adj, t.counterparty_name name
    FROM tax_invoice t JOIN (
      SELECT src_id, SUM(amount)::bigint cov,
             count(*) FILTER (WHERE method = '조정')::int adj
      FROM recon_match
      WHERE src_table = 'tax_invoice' AND status = '확정'
        AND kind IN ('매입계산서','매출계산서') AND ref_table IN ('cash_txn','adjust')
      GROUP BY 1
    ) m ON m.src_id = t.id
    WHERE t.is_active AND t.total > 0 AND m.cov > t.total
    ORDER BY (m.cov - t.total) DESC LIMIT 30
  `);
  const unexplained = cov.filter((c) => Number(c.adj) === 0);
  if (cov.length === 0) ok("금액보다 많이 확인된 계산서: 없음");
  else if (unexplained.length === 0)
    ok(`금액보다 많이 확인된 계산서 ${cov.length}건 — 전부 「조정」(이체 수수료 잔돈 흡수)로 설명된다`);
  else {
    warn(`설명 안 되는 초과 확인 ${unexplained.length}건 — 「조정」 자국이 없는데 금액을 넘었다`);
    for (const c of unexplained)
      console.log(`      계산서#${c.id} ${c.name}: 금액 ${won(Number(c.total))} < 확인 ${won(Number(c.cov))}`);
  }

  /* ④ 참고 — 1회차에 **일부러 놔둔** 것(Finding 2). 앱 기록에 지급 자국이 하나라도 있으면
        금액을 안 따지고 계산서 전액을 「확인 완료」로 친다. 그 수가 늘면 다시 볼 때다. */
  const [ind] = await db.execute<{ n: number; short_n: number; short_s: string }>(sql`
    SELECT count(*)::int n,
           count(*) FILTER (WHERE paid < t.total)::int short_n,
           COALESCE(SUM(t.total - paid) FILTER (WHERE paid < t.total), 0)::bigint short_s
    FROM tax_invoice t
    JOIN LATERAL (
      SELECT COALESCE(SUM(m2.amount), 0)::bigint paid
      FROM recon_match m1 JOIN recon_match m2
        ON m2.ref_table = m1.ref_table AND m2.ref_id = m1.ref_id
      WHERE m1.src_table = 'tax_invoice' AND m1.src_id = t.id AND m1.status = '확정'
        AND m1.ref_table IN ('purchase_invoice','quote') AND m1.kind IN ('매입계산서','매출계산서')
        AND m2.src_table = 'cash_txn' AND m2.kind IN ('매입지급','이체입금') AND m2.status = '확정'
    ) p ON true
    WHERE t.is_active AND t.total > 0 AND p.paid > 0
  `);
  console.log(
    `\n  · 참고(일부러 놔둠) 앱 기록으로 「간접 확인」된 계산서 ${ind.n}건 중, 실제 지급이 계산서보다 적은 것 ` +
      `${ind.short_n}건 · 모자란 합 ${won(Number(ind.short_s))}원`,
  );
  if (Number(ind.short_n) > 0)
    console.log("    → 이 건들은 화면에서 「돈 확인 완료」로 보이지만 돈은 일부만 오갔다 (1회차 Finding 2, 사장님 판단 대기)");

  console.log(bad === 0 ? "\n결과: 이상 없음 ✓\n" : `\n결과: 살펴볼 것 ${bad}가지 ⚠\n`);
  process.exit(bad === 0 ? 0 : 1);
}
main();
