/**
 * ⭐ 앱에 붙일 매입이 없는 출금 접기 — 일회성 (2026-09-16 사장님 지시 "제외 누를 것은 알아서 처리")
 *
 *   전부 **세금계산서 쪽에서는 이미 확인된** 송금이다. 앱 매입(입고)이 없어 지급으로 이을
 *   상대가 없을 뿐이라, 화면의 [제외]와 똑같이 접는다(recon_status='무시').
 *   🔴 돈 셈은 그대로다 — 손익·세무 자료·선급금 계산 모두 불변. 「접어둔 출금」에서 되살릴 수 있다.
 *
 *   npx tsx --env-file=.env.local scripts/payable-skip-20260916.ts        (미리보기)
 *   npx tsx --env-file=.env.local scripts/payable-skip-20260916.ts --go   (반영)
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { logActivity } from "../src/lib/fin-activity";

const GO = process.argv.includes("--go");
const won = (n: number) => n.toLocaleString("ko-KR");

/** 접을 출금 — 왜 접는지 한 줄씩 (화면 메모에 남는다) */
const TARGETS: { id: number; why: string }[] = [
  { id: 6936, why: "나이스 미지급을 덮고 남은 조각 (앱 매입 없음)" },
  { id: 6937, why: "유일이엔티 — 8/31 계산서와 짝, 앱 매입 없음" },
  { id: 5128, why: "스칼릿 — 7/31 배터리 계산서와 짝, 앱 매입 없음" },
  { id: 5108, why: "엠에프티 — 8/12 계산서와 짝, 앱 매입 등록(8/19) 이전" },
  { id: 5098, why: "엠에프티 — 8/18 계산서와 짝, 앱 매입 등록 이전" },
  { id: 5094, why: "쌍성트레이딩 — 8/18 계산서와 짝, 앱 매입 없음" },
  { id: 5097, why: "양양 티스테이션 — 8/17 계산서와 짝, 앱 매입 없음" },
  { id: 5103, why: "블랙서클(딜러타이어) — 남은 258,440은 선급금" },
  /* 2026-09-16 2차 — 사장님 확인: 145R13 DU05 4본. 「재고에 반영하지 말아주세요」 → 매입 등록 없이 접는다 */
  { id: 5126, why: "강남세차장 145R13 DU05 4본 — 재고 반영 안 함(사장님 지시)" },
];

async function main() {
  console.log(GO ? "▶ 반영합니다" : "▶ 미리보기 (--go 를 붙이면 반영)");
  const payUsed = (a: string) => sql`
    COALESCE((SELECT SUM(m.amount)::bigint FROM recon_match m
      WHERE m.status = '확정' AND m.kind = '매입지급'
        AND m.src_table = 'cash_txn' AND m.src_id = ${sql.raw(a)}.id), 0)`;

  for (const t of TARGETS) {
    const [c] = await db.execute<{ id: number; d: string; description: string; out_amount: number; st: string; left: string }>(sql`
      SELECT c.id, to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d, c.description,
             c.out_amount, c.recon_status st, (c.out_amount - ${payUsed("c")})::bigint left
      FROM cash_txn c WHERE c.id = ${t.id} AND c.is_active AND c.source = '통장'
    `);
    if (!c) { console.log(`  ⚠ ${t.id} — 출금 줄 없음`); continue; }
    if (c.st === "무시") { console.log(`  · ${c.d} ${won(Number(c.out_amount))} — 이미 접힘`); continue; }
    const left = Number(c.left);
    if (left <= 0) { console.log(`  ⚠ ${c.d} ${won(Number(c.out_amount))} — 지급으로 다 쓴 줄이라 건너뜀`); continue; }
    console.log(`  · ${c.d} ${won(left)}원 접기 — ${t.why}`);
    if (!GO) continue;
    await db.execute(sql`
      UPDATE cash_txn SET recon_status = '무시',
        memo = COALESCE(memo || ' · ', '') || ${`지급 잡기에서 접음 (${t.why})`}
      WHERE id = ${t.id}
    `);
    await logActivity({
      ym: c.d.slice(0, 7), actor: null, how: "사람", verb: "제외",
      target: { table: "cash_txn", id: t.id }, amount: left,
      label: `제외: 출금 ${c.d.slice(5)} ${won(left)} ${c.description.replace(/^\[[^\]]*\]\s*/, "")} 접음`,
      undo: { kind: "skip", args: { cashTxnId: t.id } },
    });
  }
  process.exit(0);
}
main();
