/**
 * ⭐ 개편 5단계 — 옛 「통장 밖 수령」 자국을 「최근 한 일」에 옮겨 적는다 (2026-09-13)
 *
 *   2단계(09-12) 전에 남긴 별도수령 자국(recon_match src_table='별도수령')은 fin_activity 줄이 없어서
 *   되돌리기 자리가 추적 화면(AsideList)뿐이었다. 추적 화면을 없애므로(사장님 결정 4) 그 자국마다
 *   fin_activity 한 줄을 만들어 「최근 한 일」의 aside 되돌리기(fin-activity-actions)가 잡게 한다.
 *   실측 09-13: 자국 36건 중 35건이 고아.
 *
 *   규칙은 trace-actions.markSaleSettledAside 와 같다 — 사유가 「아직 안 들어옴」이면 verb '보류', 아니면 '제외'
 *   (기존 verb 만 쓴다). at 은 자국의 confirmed_at, after_close 는 false 로 고정(마감 뒤 고침 집계 오염 방지),
 *   label 끝에 「(옮겨 적음)」. 멱등 — 이미 줄이 있는 자국은 건너뛴다.
 *
 * 🔴 undo_args 는 반드시 sql.json(...) 으로 — 문자열을 `::jsonb` 로 넘기면 postgres.js 가 JSON **문자열**로
 *    한 번 더 감싸서(`"{\"quoteId\":13}"`) `undo_args->>'quoteId'` 가 못 읽는다(첫 실행 09-13 에 그렇게 들어가
 *    ① 수리 단계를 두었다 — 멱등).
 *
 *   실행: npx tsx scripts/add-aside-activity.ts --dry   (건수만 보기)
 *         npx tsx scripts/add-aside-activity.ts         (실제, 멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

const DRY = process.argv.includes("--dry");
const won = (n: number) => n.toLocaleString("ko-KR");

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    /* ① 수리 — jsonb 가 객체가 아니라 문자열로 들어간 줄(첫 실행의 실수) */
    const bad = await sql<{ n: number }[]>`
      SELECT count(*)::int n FROM fin_activity
      WHERE undo_kind = 'aside' AND jsonb_typeof(undo_args) = 'string'`;
    console.log(`① 문자열로 감싸진 undo_args: ${bad[0].n}건`);
    if (!DRY && bad[0].n > 0) {
      const r = await sql`
        UPDATE fin_activity SET undo_args = (undo_args #>> '{}')::jsonb
        WHERE undo_kind = 'aside' AND jsonb_typeof(undo_args) = 'string'
        RETURNING id`;
      console.log(`   → ${r.length}건 객체로 수리`);
    }

    /* ② 옮겨 적기 */
    const rows = await sql<
      { match_id: number; quote_id: number; amount: string; at: Date; uid: number | null; quote_no: string; who: string; d: string; reason: string | null }[]
    >`
      SELECT m.id match_id, m.ref_id quote_id, m.amount, m.confirmed_at at, m.confirmed_by uid,
             q.quote_no, COALESCE(q.supplier_name, c.name, '손님') who,
             to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') d,
             n.reason
      FROM recon_match m
      JOIN quote q ON q.id = m.ref_id
      LEFT JOIN customer c ON c.id = q.customer_id
      LEFT JOIN pos_note n ON n.kind = 'transfer' AND n.ref = 'quote:' || m.ref_id
      LEFT JOIN fin_activity a
        ON a.undo_kind = 'aside' AND jsonb_typeof(a.undo_args) = 'object'
       AND (a.undo_args->>'quoteId')::bigint = m.ref_id
      WHERE m.kind = '이체입금' AND m.src_table = '별도수령' AND m.ref_table = 'quote' AND m.status = '확정'
        AND a.id IS NULL
      ORDER BY m.confirmed_at`;
    console.log(`② 옮겨 적을 옛 자국: ${rows.length}건`);
    for (const r of rows) {
      const hold = r.reason === "아직 안 들어옴";
      console.log(`  ${r.d} ${hold ? "보류" : "제외"} 판매 ${r.quote_no} ${r.who} ${won(Number(r.amount))} — ${r.reason ?? "통장 밖 수령"}`);
    }
    if (DRY || rows.length === 0) {
      console.log(DRY ? "\n(--dry 였습니다 — 아무것도 안 고쳤습니다)" : "\n✅ 옮겨 적을 것 없음");
      return;
    }
    let n = 0;
    for (const r of rows) {
      const hold = r.reason === "아직 안 들어옴";
      const label = `${hold ? "보류" : "제외"}: 판매 ${r.quote_no} ${r.who} ${won(Number(r.amount))} — ${r.reason ?? "통장 밖 수령"} (옮겨 적음)`;
      await sql`
        INSERT INTO fin_activity
          (at, ym, actor, how, verb, target_table, target_id, n, amount, label, undo_kind, undo_args, after_close)
        VALUES (${r.at}, ${r.d.slice(0, 7)}, ${r.uid}, '사람', ${hold ? "보류" : "제외"}, 'quote', ${r.quote_id},
                1, ${Math.round(Number(r.amount))}, ${label.slice(0, 300)}, 'aside',
                ${sql.json({ quoteId: Number(r.quote_id) })}, false)`;
      n++;
    }
    console.log(`\n✅ ${n}건 옮겨 적음 — 「최근 한 일」에서 되돌릴 수 있습니다`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
