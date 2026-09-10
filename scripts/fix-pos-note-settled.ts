/**
 * ⭐ 사장님이 이미 정리해 둔 계좌이체 판매에 자국 심기 (돈관리 고장 ①, 2026-09-10)
 *
 *   입금 정리 화면의 [개인 통장으로 받음]·[아직 안 들어옴]은 그동안 `pos_note` 에만 적혔다.
 *   그런데 `pos_note` 를 읽는 곳은 입금 화면 하나뿐(deposit-tax.ts)이라, 사장님이 정리한
 *   건이 감사 A1·홈 인박스·돈 추적 화면엔 **영원히** 남았다
 *   (실측 2026-09-10: 최근 45일 미확인 31건 중 14건 383만원이 그것).
 *
 *   이제 판정은 자국 하나다 — trace-actions.markSaleSettledAside 가 남기는
 *   recon_match(kind='이체입금', src_table='별도수령'). 이 스크립트는 **옛 사유 행**에도
 *   같은 자국을 심어 화면들의 말이 갈리지 않게 한다. 사유(pos_note)는 그대로 둔다 —
 *   사람이 읽는 말이고, 화면들이 그 사유를 함께 보여준다.
 *
 * 🔴 안 심는 것 (왜)
 *   · 이미 자국이 있는 판매        — 멱등. 두 번 돌려도 늘지 않는다.
 *   · 이미 통장 입금과 다 이어진 것 — 남은 돈이 없다. (일부만 이어졌으면 **남은 돈만** 심는다)
 *   · 사유가 「취소」인 것          — 「받았다/찾을 일 없다」가 아니라 없던 일이다. 사람이 판단할 몫.
 *   · 성사 아님·계좌이체 아님       — A1·입금 화면이 애초에 안 보는 판매.
 *
 *   되돌리기: 입금 정리 화면 「통장 밖에서 정리한 판매」 또는 돈 추적 화면의 같은 목록에서
 *   한 건씩. (자국을 지우면 사유도 함께 지워진다 — markSaleSettledAside undo 정본)
 *
 * 실행: npx tsx --env-file=.env.local scripts/fix-pos-note-settled.ts        (보기만)
 *       npx tsx --env-file=.env.local scripts/fix-pos-note-settled.ts --fix  (자국 심기)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const won = (n: number) => n.toLocaleString("ko-KR");

/** db.execute 의 행 타입은 Record<string, unknown> 를 만족해야 한다 (drizzle) */
type Row = {
  quote_id: number;
  quote_no: string;
  d: string;
  who: string;
  reason: string;
  memo: string | null;
  total: number;
  linked: string;
  marked: number;
  method: string;
  status: string;
};

async function main() {
  const doFix = process.argv.includes("--fix");

  const rows = await db.execute<Row>(sql`
    SELECT q.id quote_id, q.quote_no,
           to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') d,
           COALESCE(q.supplier_name, c.name, '?') who,
           n.reason, n.memo, q.total_amount total, q.payment_method method, q.status,
           COALESCE((SELECT SUM(m.amount) FROM recon_match m
             WHERE m.kind = '이체입금' AND m.ref_table = 'quote' AND m.ref_id = q.id
               AND m.status = '확정'), 0)::bigint linked,
           (SELECT count(*)::int FROM recon_match m
             WHERE m.kind = '이체입금' AND m.src_table = '별도수령'
               AND m.ref_table = 'quote' AND m.ref_id = q.id) marked
    FROM pos_note n
    JOIN quote q ON q.id = NULLIF(split_part(n.ref, ':', 2), '')::bigint
    LEFT JOIN customer c ON c.id = q.customer_id
    WHERE n.kind = 'transfer' AND n.ref LIKE 'quote:%'
    ORDER BY 3, q.id
  `);

  if (rows.length === 0) {
    console.log("사유(pos_note kind='transfer') 행이 없습니다 — 심을 것 없음");
    process.exit(0);
  }

  const plan: Row[] = [];
  const skips = new Map<string, number>();
  const skip = (why: string) => skips.set(why, (skips.get(why) ?? 0) + 1);

  for (const r of rows) {
    if (Number(r.marked) > 0) {
      skip("이미 자국 있음 (전에 심었거나 화면에서 정리)");
      continue;
    }
    if (r.status !== "성사") {
      skip(`판매 상태가 「${r.status}」`);
      continue;
    }
    if (r.method !== "계좌이체" && r.method !== "혼합") {
      skip(`결제수단이 「${r.method}」 (수단을 이미 고치셨음)`);
      continue;
    }
    if (r.reason === "취소") {
      skip("사유가 「취소」 — 사람이 판단할 몫");
      continue;
    }
    if (Number(r.total) - Number(r.linked) <= 0) {
      skip("통장 입금과 이미 다 이어짐");
      continue;
    }
    plan.push(r);
  }

  const byReason = new Map<string, { n: number; sum: number }>();
  for (const r of plan) {
    const cur = byReason.get(r.reason) ?? { n: 0, sum: 0 };
    cur.n++;
    cur.sum += Number(r.total) - Number(r.linked);
    byReason.set(r.reason, cur);
  }

  console.log(`── 사유 행 ${rows.length}건 중 자국을 심을 것 ${plan.length}건 ──`);
  for (const [reason, v] of byReason) console.log(`· 「${reason}」 ${v.n}건 · ${won(v.sum)}원`);
  for (const [why, n] of skips) console.log(`  (건너뜀) ${why} — ${n}건`);
  console.log("");
  for (const r of plan) {
    const remain = Number(r.total) - Number(r.linked);
    console.log(
      `${r.d} ${r.who} ${won(remain)}원 (${r.quote_no}) — 「${r.reason}」${r.memo ? ` · ${r.memo}` : ""}` +
        (Number(r.linked) > 0 ? ` · 통장으로 ${won(Number(r.linked))}원은 이미 이어짐` : ""),
    );
  }

  if (!doFix) {
    const sum = plan.reduce((a, r) => a + Number(r.total) - Number(r.linked), 0);
    console.log(`\n(보기만 했음 — 심을 자국 ${plan.length}건 · ${won(sum)}원. 실행하려면 --fix)`);
    process.exit(0);
  }

  let made = 0;
  for (const r of plan) {
    const remain = Number(r.total) - Number(r.linked);
    /* 조건을 INSERT 안에 다시 적는다 — 스크립트를 도는 동안 사장님이 화면에서 같은 건을
       정리해도 두 번 심기지 않게 (멱등의 마지막 자물쇠) */
    const ins = await db.execute<{ id: number }>(sql`
      INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_at)
      SELECT '이체입금', '별도수령', 0, 'quote', ${r.quote_id}, ${remain}, '확정', '수동', now()
      WHERE NOT EXISTS (SELECT 1 FROM recon_match m
        WHERE m.kind = '이체입금' AND m.src_table = '별도수령'
          AND m.ref_table = 'quote' AND m.ref_id = ${r.quote_id})
      RETURNING id
    `);
    made += ins.length;
  }
  console.log(`\n✅ 자국 ${made}건을 심었습니다 — 감사 A1·홈 인박스·돈 추적에서 함께 빠집니다`);
  console.log("   되돌리기: 입금 정리 화면 「통장 밖에서 정리한 판매」에서 한 건씩");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
