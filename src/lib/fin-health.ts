/**
 * ⭐ 자료 건강 검사 (감사 P3, 2026-08-25) — 2026-08-25 전면 감사에서 쓴 검증식을
 *   시스템이 상시 수행한다: "자료가 맞는지"를 사장님이 아니라 화면이 증명한다.
 *
 *   ① 통장 잔액 사슬(최근 60일) — 파싱·누락·중복이 있으면 반드시 걸린다
 *   ② 카드 일별 합계 = 건별 합계 (건별 자료가 있는 달)
 *   ③ 통장 카드정산 분류합 ≈ 여신협회 입금예정 (정산 자료 있는 최근 달, ±3%)
 *   ④ 원천별 커버리지(마지막 날짜)
 *
 * 🔴 읽기 전용, 질의 순차. 화면(page)이 권한 확인 후 부른다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface HealthLine {
  ok: boolean;
  text: string;
}

export async function finHealth(): Promise<{ allOk: boolean; lines: HealthLine[] }> {
  const lines: HealthLine[] = [];

  // ① 잔액 사슬 — 계좌별 최근 60일
  const labels = await db.execute<{ l: string }>(sql`
    SELECT DISTINCT account_label l FROM cash_txn WHERE source = '통장' AND is_active LIMIT 10
  `);
  let chainBad = 0;
  for (const { l } of labels) {
    const rows = await db.execute<{ i: number; o: number; b: string | null }>(sql`
      SELECT in_amount i, out_amount o, balance b FROM cash_txn
      WHERE source = '통장' AND account_label = ${l} AND is_active
        AND occurred_at > now() - interval '60 days'
      ORDER BY occurred_at ASC, id DESC LIMIT 1500
    `);
    for (let k = 1; k < rows.length; k++) {
      if (rows[k].b === null || rows[k - 1].b === null) continue;
      if (Number(rows[k - 1].b) + Number(rows[k].i) - Number(rows[k].o) !== Number(rows[k].b)) chainBad++;
    }
  }
  lines.push({
    ok: chainBad === 0,
    text: chainBad === 0 ? "통장 잔액사슬 ✓" : `통장 잔액사슬 어긋남 ${chainBad}건`,
  });

  // ② 카드 일별 = 건별 (건별 자료가 있는 달만)
  const cd = await db.execute<{ m: string; a: string; b: string }>(sql`
    SELECT m, SUM(a)::bigint a, SUM(b)::bigint b FROM (
      SELECT to_char(day, 'YYYY-MM') m, total_amount a, 0 b FROM card_day WHERE is_active
      UNION ALL
      SELECT to_char(approved_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM'), 0, amount FROM card_txn WHERE is_active
    ) x GROUP BY m HAVING SUM(b) <> 0 ORDER BY m DESC LIMIT 3
  `);
  const cardBad = cd.filter((r) => Number(r.a) !== Number(r.b));
  lines.push({
    ok: cardBad.length === 0,
    text: cardBad.length === 0 ? "카드 원천 일치 ✓" : `카드 합계 불일치 ${cardBad.map((r) => r.m).join(",")}`,
  });

  // ③ 카드정산 ≈ 여신 입금예정 (정산 자료 있는 최근 달)
  const [dep] = await db.execute<{ m: string | null; s: string }>(sql`
    SELECT month m, SUM(deposit_amount)::bigint s FROM card_deposit WHERE is_active
    GROUP BY month ORDER BY month DESC LIMIT 1
  `);
  if (dep?.m) {
    const [bank] = await db.execute<{ s: string }>(sql`
      SELECT COALESCE(SUM(in_amount), 0)::bigint s FROM cash_txn
      WHERE source = '통장' AND is_active AND category = '카드정산'
        AND to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = ${dep.m}
    `);
    const a = Number(dep.s);
    const b = Number(bank.s);
    const ok3 = a > 0 && Math.abs(a - b) <= a * 0.03;
    lines.push({
      ok: ok3,
      text: ok3
        ? `카드정산 ${dep.m} 여신협회 일치 ✓`
        : `카드정산 ${dep.m}: 여신 ${a.toLocaleString()} vs 통장 ${b.toLocaleString()}`,
    });
  }

  // ④ 커버리지
  const [cov] = await db.execute<{ bank: string | null; card: string | null; assoc: string | null }>(sql`
    SELECT (SELECT max((occurred_at AT TIME ZONE 'Asia/Seoul')::date)::text FROM cash_txn WHERE source = '통장' AND is_active) bank,
           (SELECT max((occurred_at AT TIME ZONE 'Asia/Seoul')::date)::text FROM cash_txn WHERE source = '법인카드' AND is_active) card,
           (SELECT max(day)::text FROM card_day WHERE is_active) assoc
  `);
  lines.push({
    ok: true,
    text: `자료: 통장 ~${cov.bank?.slice(5) ?? "없음"} · 카드 ~${cov.card?.slice(5) ?? "없음"} · 여신 ~${cov.assoc?.slice(5) ?? "없음"}`,
  });

  return { allOk: lines.every((l) => l.ok), lines };
}
