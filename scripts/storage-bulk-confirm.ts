/**
 * ⭐ 실사 후보 일괄 확정 (사장님 2026-11-18 — 「실사 리스트에서 거의 확실시 되는 것들은 전부 보관중으로」)
 *
 *   사장님 고른 범위: A 경리 명단에 있음(37) + B 11/13 이후 판매 메모(명단 뒤 — 지난 며칠이라 아직 안 찾아감) − B 중 메모에 다른
 *   번호판이 적힌 것(「84고0717 차주임」 — 주인 확인 필요, 실사에 남김). A 는 경리가 번호판으로 맞춘 것이라 남기지 않는다. 나머지(8~10월 메모 · 명단 기간인데 명단에 없음)는 실사로.
 *   번호는 **맡긴 날짜 순**(사장님 결정) — 한 트랜잭션, 번호 잠금 아래. origin = 실사(판매 취소와 무관).
 *
 * 실행: npx tsx --env-file=.env.local scripts/storage-bulk-confirm.ts --dry   (보기만)
 *       … --fix
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { otherPlatesIn, describeSet, formatStorageNo } from "@/lib/tire-storage-pure";
import { storageOwnerProblem } from "@/lib/tire-storage-db";

const LIST_END = "2026-11-12"; // 경리 명단 마지막 날

async function main() {
  const fix = process.argv.includes("--fix");
  const rows = await db.execute<{
    id: number;
    customer_id: number;
    stored_on: string;
    kind: string | null;
    brand: string | null;
    size: string | null;
    qty: number;
    plate: string | null;
    source_text: string | null;
    grp: string;
  }>(sql`
    SELECT t.id, t.customer_id, to_char(t.stored_on, 'YYYY-MM-DD') AS stored_on, t.kind, t.brand, t.size, t.qty,
           v.plate_no AS plate, t.source_text,
           CASE WHEN t.release_note LIKE '%명단(11/12)에 있음%' THEN 'A' ELSE 'B' END AS grp
    FROM tire_storage t LEFT JOIN vehicle v ON v.id = t.vehicle_id
    WHERE t.status = '확인대기' AND t.kind IS NOT NULL
      AND (t.release_note LIKE '%명단(11/12)에 있음%'
           OR (t.stored_on > ${LIST_END}::date AND (t.release_note IS NULL OR t.release_note NOT LIKE '%명단%')))
    ORDER BY t.stored_on, t.id`);

  // 남김은 B(판매 메모)만 — A(경리 명단)는 번호판으로 이미 맞춘 것. 거래처(KT&G 등) 메모엔 같은 회사 다른 차 번호가 섞여 있다
  const hold = (r: (typeof rows)[number]) => r.grp === "B" && otherPlatesIn(r.source_text, r.plate).length > 0;
  const pick = rows.filter((r) => !hold(r));
  const held = rows.filter(hold);
  const [mx] = await db.execute<{ m: number }>(sql`SELECT COALESCE(MAX(storage_no), 0)::int AS m FROM tire_storage`);
  const first = Number(mx.m) + 1;
  console.log(`넘길 세트 ${pick.length} (A 경리 명단 ${pick.filter((r) => r.grp === "A").length} · B 11/13~ ${pick.filter((r) => r.grp === "B").length})`);
  console.log(`  번호 ${formatStorageNo(first)} ~ ${formatStorageNo(first + pick.length - 1)} (맡긴 날짜 순) · 규격 빈칸 ${pick.filter((r) => !r.size).length}`);
  console.log(`  실사에 남김(메모에 다른 번호판) ${held.length}: ${held.map((h) => "…" + (h.plate ?? "").slice(-4)).join(", ")}`);
  for (const [i, r] of pick.slice(0, 6).entries()) console.log(`    ${formatStorageNo(first + i)} ${r.stored_on} …${(r.plate ?? "").slice(-4)} ${describeSet(r)}`);
  if (!fix) {
    console.log("\n(--dry) 바꾸지 않았습니다. 넘기려면 --fix");
    process.exit(0);
  }

  const done = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tire_storage_no'))`);
    const [m2] = await tx.execute<{ m: number }>(sql`SELECT COALESCE(MAX(storage_no), 0)::int AS m FROM tire_storage`);
    let no = Number(m2.m);
    const out: { id: number; no: number }[] = [];
    for (const r of pick) {
      if (await storageOwnerProblem(tx, Number(r.customer_id))) continue; // 자리표시 손님 — 남김
      no += 1;
      const u = await tx.execute(sql`
        UPDATE tire_storage SET storage_no = ${no}, status = '보관중', origin = '실사', release_note = NULL, updated_at = now()
        WHERE id = ${r.id} AND status = '확인대기' RETURNING id`);
      if (u.length) out.push({ id: Number(r.id), no });
      else no -= 1;
    }
    return out;
  });
  console.log(`\n✅ 보관중으로 넘겼습니다 ${done.length}세트 — 번호 ${formatStorageNo(done[0]?.no)} ~ ${formatStorageNo(done.at(-1)?.no)}`);
  console.log(`   스티커: 보관 화면 「스티커 모아 인쇄」에 ${done[0]?.no} ~ ${done.at(-1)?.no}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
