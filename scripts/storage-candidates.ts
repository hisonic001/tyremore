/**
 * ⭐ 보관 실사 후보 만들기 (D-42 2단계, 2026-11-17)
 *
 *   앱 판매는 2026-08 부터 메모에 「… 일반 4개 보관[규격]」 처럼 맡긴 타이어를 적어 왔다(약 80건).
 *   그 메모를 읽어 tire_storage 에 「확인대기」(번호 없음) 줄을 만든다 → /storage?tab=실사 에서
 *   창고 실물을 보고 「있음」(번호·스티커) / 「없음」.
 *
 *   - 개인정보는 DB 안에만 둔다(파일로 안 뺀다). 콘솔엔 판매번호·번호판만.
 *   - 다시 돌려도 같은 판매에서 두 번 만들지 않는다(stored_quote_id 로 확인).
 *   - 자리표시 손님(고객·관광객)·차/손님 없는 판매는 건너뛰고 수만 알린다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/storage-candidates.ts --dry   (보기만)
 *       npx tsx --env-file=.env.local scripts/storage-candidates.ts --fix   (넣기 — 사장님 승인 후)
 *       [--from 2026-08-01]
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isPlaceholderCustomerName } from "@/lib/normalize";
import { parseStorageMemo, describeSet, type MemoSet } from "@/lib/tire-storage-pure";

async function main() {
  const argv = process.argv.slice(2);
  const fix = argv.includes("--fix");
  const fromAt = argv.indexOf("--from");
  const from = fromAt >= 0 ? argv[fromAt + 1] : "2026-08-01";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("--from YYYY-MM-DD");

  const sales = await db.execute<{
    id: number;
    quote_no: string;
    work_date: string;
    customer_id: number | null;
    vehicle_id: number | null;
    customer_name: string | null;
    plate_no: string | null;
    memos: string | null;
    has_row: boolean;
  }>(sql`
    SELECT q.id, q.quote_no, to_char(q.work_date, 'YYYY-MM-DD') work_date,
           COALESCE(q.customer_id, v.customer_id) customer_id, q.vehicle_id,
           c.name customer_name, v.plate_no,
           concat_ws(' / ', q.payment_memo, (SELECT string_agg(i.memo, ' / ' ORDER BY i.id) FROM quote_item i WHERE i.quote_id = q.id AND i.memo LIKE '%보관%')) memos,
           EXISTS (SELECT 1 FROM tire_storage t WHERE t.stored_quote_id = q.id) has_row
    FROM quote q
    LEFT JOIN vehicle v ON v.id = q.vehicle_id
    LEFT JOIN customer c ON c.id = COALESCE(q.customer_id, v.customer_id)
    WHERE q.status = '성사' AND q.work_date >= ${from}::date
      AND (q.payment_memo LIKE '%보관%' OR EXISTS (SELECT 1 FROM quote_item i WHERE i.quote_id = q.id AND i.memo LIKE '%보관%'))
    ORDER BY q.work_date, q.id
  `);

  type Cand = { saleId: number; quoteNo: string; workDate: string; customerId: number; vehicleId: number | null; plate: string; memo: string; set: MemoSet; note: string | null };
  const cands: Cand[] = [];
  let already = 0;
  let none = 0;
  let noDrop = 0;
  let skippedOwner = 0;

  // 같은 차가 나중 판매에서 보관분을 꺼내 갔으면 알려 준다(실사 때 참고)
  const pickupsByVehicle = new Map<number, { date: string; no: string }[]>();
  for (const s of sales) {
    if (s.vehicle_id == null) continue;
    const p = parseStorageMemo(s.memos, Number(s.work_date.slice(5, 7)));
    if (p.pickups.length) {
      const list = pickupsByVehicle.get(Number(s.vehicle_id)) ?? [];
      list.push({ date: s.work_date, no: s.quote_no });
      pickupsByVehicle.set(Number(s.vehicle_id), list);
    }
  }

  for (const s of sales) {
    if (s.has_row) {
      already++;
      continue;
    }
    const p = parseStorageMemo(s.memos, Number(s.work_date.slice(5, 7)));
    if (!p.drops.length) {
      if (p.none) none++;
      else noDrop++;
      continue;
    }
    if (s.customer_id == null || isPlaceholderCustomerName(s.customer_name)) {
      skippedOwner += p.drops.length;
      console.log(`  건너뜀 ${s.quote_no} ${s.plate_no ?? "차량없음"} — 손님 미등록/자리표시`);
      continue;
    }
    const later = (s.vehicle_id != null ? pickupsByVehicle.get(Number(s.vehicle_id)) ?? [] : []).filter((x) => x.date > s.work_date);
    for (const d of p.drops) {
      cands.push({
        saleId: Number(s.id),
        quoteNo: s.quote_no,
        workDate: s.work_date,
        customerId: Number(s.customer_id),
        vehicleId: s.vehicle_id == null ? null : Number(s.vehicle_id),
        plate: s.plate_no ?? "차량없음",
        memo: (s.memos ?? "").slice(0, 500),
        set: d,
        note: later.length ? `이후 ${later.map((x) => `${x.date} ${x.no}`).join(", ")} 에서 보관분을 꺼낸 기록 — 이미 찾아갔을 수 있음` : null,
      });
    }
  }

  console.log(`\n보관 메모가 있는 판매 ${sales.length}건 (${from}~)`);
  console.log(`  후보(맡김) ${cands.length}세트 · 이미 만든 판매 ${already} · 「보관 없음」 ${none} · 맡김 아님(찾아감·폐기 등) ${noDrop} · 손님 문제로 건너뜀 ${skippedOwner}`);
  const kinds = cands.reduce<Record<string, number>>((m, c) => ((m[c.set.kind ?? "?"] = (m[c.set.kind ?? "?"] ?? 0) + 1), m), {});
  console.log(`  종류: ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(" · ")} · 규격 모름 ${cands.filter((c) => !c.set.size).length}`);
  for (const c of cands.slice(0, 15)) console.log(`  ${c.workDate} ${c.quoteNo} ${c.plate} — ${describeSet(c.set)}${c.note ? " ⚠️" : ""}`);
  if (cands.length > 15) console.log(`  … 외 ${cands.length - 15}세트`);

  if (!fix) {
    console.log("\n(--dry) 넣지 않았습니다. 넣으려면 --fix");
    process.exit(0);
  }
  let made = 0;
  await db.transaction(async (tx) => {
    for (const c of cands) {
      await tx.execute(sql`
        INSERT INTO tire_storage (storage_no, status, customer_id, vehicle_id, kind, brand, size, qty, stored_on, stored_quote_id, source_text, release_note)
        VALUES (NULL, '확인대기', ${c.customerId}, ${c.vehicleId}, ${c.set.kind}, ${c.set.brand}, ${c.set.size}, ${c.set.qty},
                ${c.workDate}::date, ${c.saleId}, ${c.memo}, ${c.note})`);
      made++;
    }
  });
  console.log(`\n✅ 확인대기 ${made}세트를 넣었습니다 → 앱 「보관 → 실사」 탭에서 확인`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
