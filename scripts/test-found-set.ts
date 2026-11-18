/**
 * ⭐ 「처음 보는 세트」 등록 시험 — 실제 DB 에서 돌리고 **끝에 전부 되돌린다**(ROLLBACK). 흔적 0.
 *   registerFoundSetTx(storage-found-db.ts) 정본을 그대로 부른다 — 화면 액션과 같은 코드.
 *
 * 실행: npx tsx --env-file=.env.local scripts/test-found-set.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { dropSetTx, registerFoundSetTx } from "@/lib/storage-found-db";
import { sanitizePlan } from "@/lib/storage-plan-pure";

const ROLLBACK = "__시험_되돌림__";
const drop = { kind: "일반" as const, brand: "미쉐린", size: "235/55R19", qty: 4, dot: "", memo: "" };
let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails++;
};

async function main() {
  try {
    await db.transaction(async (tx) => {
      // 시험용 번호판 — 없는 것이어야 한다
      const plates = ["99테9991", "99테9992", "99테9993"];
      const [hit] = await tx.execute<{ n: number }>(sql`SELECT count(*)::int n FROM vehicle WHERE plate_no_norm IN (${plates[0]}, ${plates[1]}, ${plates[2]})`);
      if (Number(hit.n) > 0) throw new Error("시험 번호판이 이미 있습니다 — 다른 번호로 바꾸세요");
      const [area] = await tx.execute<{ id: number; plan: unknown }>(sql`SELECT id, plan FROM storage_area WHERE is_active AND NOT is_site ORDER BY sort LIMIT 1`);
      const slot = sanitizePlan(area.plan)?.shapes.find((s) => s.kind === "block");
      if (!slot) throw new Error("자리가 있는 구역이 없습니다");
      const [{ m: maxNo }] = await tx.execute<{ m: number }>(sql`SELECT COALESCE(MAX(storage_no),0)::int m FROM tire_storage`);
      const loc = { areaId: Number(area.id), slotId: slot.id, stack: "new" as const };

      // A. 새 손님 + 새 차 + 실사 위치 + 맡긴 날 모름
      const a = await registerFoundSetTx(tx, { plate: "99테 9991", model: "쏘렌토", owner: { kind: "손님", name: "시험손님", phone: "" }, drop, storedOn: null, loc }, null);
      ok(a.no === Number(maxNo) + 1, `A 번호 = 지금 최대+1 (${a.no})`);
      ok(!a.reused && a.owner === "시험손님", "A 새 손님·새 차");
      const [ra] = await tx.execute<{ origin: string; status: string; source_text: string | null; area_id: number; slot_id: string; stack_no: number; plate_no: string }>(sql`
        SELECT s.origin, s.status, s.source_text, s.area_id, s.slot_id, s.stack_no, v.plate_no FROM tire_storage s JOIN vehicle v ON v.id = s.vehicle_id WHERE s.id = ${a.id}`);
      ok(ra.origin === "실사" && ra.status === "보관중", `A 실사·보관중 (${ra.origin}/${ra.status})`);
      ok((ra.source_text ?? "").startsWith("맡긴 날 모름"), `A 원문 「${ra.source_text}」`);
      ok(Number(ra.area_id) === loc.areaId && ra.slot_id === slot.id && Number(ra.stack_no) === a.stackNo, `A 위치 = 그 자리 더미 ${a.stackNo}`);

      // B. 같은 번호판(띄어쓰기 다름)에 다른 이름 → 새 차를 만들지 않고 A 의 차·주인
      const b = await registerFoundSetTx(tx, { plate: "99테9991", model: "카니발", owner: { kind: "손님", name: "다른이름" }, drop, storedOn: "2026-10-01", loc: { ...loc, stack: a.stackNo! } }, null);
      ok(b.reused && b.vehicleId === a.vehicleId && b.owner === "시험손님", "B 같은 번호판 → 기존 차 재사용(중복 차 없음)");
      ok(b.stackNo === a.stackNo, "B 같은 더미");
      const [mv] = await tx.execute<{ model: string | null }>(sql`SELECT model FROM vehicle WHERE id = ${a.vehicleId}`);
      ok(mv.model === "쏘렌토", `A 차종 적힘·B 가 덮지 않음 (${mv.model})`);
      const [rb] = await tx.execute<{ stored_on: string; source_text: string | null; origin: string }>(sql`SELECT stored_on::text, source_text, origin FROM tire_storage WHERE id = ${b.id}`);
      ok(rb.stored_on === "2026-10-01" && rb.source_text == null, "B 맡긴 날 고르면 그 날짜·원문 없음");

      // C. 거래처 차 → 그 거래처 차고 손님
      const [sup] = await tx.execute<{ name: string }>(sql`SELECT name FROM supplier WHERE is_active ORDER BY id LIMIT 1`);
      const c = await registerFoundSetTx(tx, { plate: "99테9992", owner: { kind: "거래처", supplier: sup.name }, drop, storedOn: null, loc: null }, null);
      const [rc] = await tx.execute<{ supplier_name: string | null; origin: string; area_id: number | null }>(sql`
        SELECT cu.supplier_name, s.origin, s.area_id FROM tire_storage s JOIN customer cu ON cu.id = s.customer_id WHERE s.id = ${c.id}`);
      ok(rc.supplier_name === sup.name, `C 거래처 차고(${sup.name})에 붙음`);
      ok(rc.origin === "등록" && rc.area_id == null, "C 위치 없이 등록(맡김 등록 화면)");

      // D. 자리표시 이름 · 빈 이름 · 없는 거래처 → 거절
      for (const [label, owner] of [
        ["자리표시 「고객」", { kind: "손님" as const, name: "고객" }],
        ["없는 거래처", { kind: "거래처" as const, supplier: "없는거래처시험" }],
      ] as const) {
        let err = "";
        await tx.execute(sql`SAVEPOINT t`);
        try {
          await registerFoundSetTx(tx, { plate: "99테9993", owner, drop, storedOn: null, loc: null }, null);
        } catch (e) {
          err = (e as Error).message;
        }
        await tx.execute(sql`ROLLBACK TO SAVEPOINT t`);
        ok(!!err, `D ${label} 거절 — ${err}`);
      }

      // D2. 이름 몰라도 됨 → 그 차 전용 이름 「이름 모름 99테9993」
      const d2 = await registerFoundSetTx(tx, { plate: "99테9993", owner: { kind: "손님", name: " ", phone: "" }, drop, storedOn: null, loc: null }, null);
      ok(d2.owner === "이름 모름 99테9993" && !d2.reused, `D2 이름 없이 등록 → 「${d2.owner}」`);

      // D3. 「10월쯤」 — 날짜 칸은 그 달 가운데, 원문에 「대략」
      const d3 = await registerFoundSetTx(tx, { plate: "", owner: { kind: "차량", vehicleId: a.vehicleId }, drop, storedOn: "2026-10-15", storedApprox: true, loc: null }, null);
      const [r3] = await tx.execute<{ stored_on: string; source_text: string | null }>(sql`SELECT stored_on::text, source_text FROM tire_storage WHERE id = ${d3.id}`);
      ok(r3.stored_on === "2026-10-15" && (r3.source_text ?? "").startsWith("맡긴 날 대략 2026-10"), `D3 달로 고르기 → ${r3.stored_on} 「${r3.source_text}」`);

      // E. 이미 있는 차 고르기
      const e = await registerFoundSetTx(tx, { plate: "", owner: { kind: "차량", vehicleId: a.vehicleId }, drop, storedOn: null, loc: null }, null);
      ok(e.reused && e.vehicleId === a.vehicleId, "E 이미 있는 차 고르기");

      // F. 더미 안 순서 (▲▼) — A·B 가 같은 더미. 지금 순서는 놓은 시각 순(A 아래, B 위) → 뒤집기
      const order = async () =>
        (await tx.execute<{ id: number }>(sql`SELECT id FROM tire_storage WHERE area_id = ${loc.areaId} AND slot_id = ${slot.id} AND stack_no = ${a.stackNo}
          AND status = '보관중' ORDER BY located_at NULLS FIRST, storage_no`)).map((r) => Number(r.id));
      const before = await order();
      const flipped = [...before].reverse();
      await dropSetTx(tx, { id: flipped[flipped.length - 1], areaId: loc.areaId, slotId: slot.id, stackNo: a.stackNo!, bottomToTop: flipped }, null);
      ok(JSON.stringify(await order()) === JSON.stringify(flipped), `F 끌어다 놓기 — 같은 더미 순서 뒤집기 (${before.length}세트)`);
      // 다른 더미 맨 아래로 끌어 놓기 (빈 더미 9)
      await dropSetTx(tx, { id: a.id, areaId: loc.areaId, slotId: slot.id, stackNo: 9, bottomToTop: [a.id] }, null);
      const [ma] = await tx.execute<{ stack_no: number }>(sql`SELECT stack_no FROM tire_storage WHERE id = ${a.id}`);
      ok(Number(ma.stack_no) === 9, "F 다른 더미로 끌어 놓기 → 더미 9");
      let ferr = "";
      await tx.execute(sql`SAVEPOINT f`);
      try {
        await dropSetTx(tx, { id: b.id, areaId: loc.areaId, slotId: slot.id, stackNo: a.stackNo!, bottomToTop: [b.id, 999999999] }, null);
      } catch (e) {
        ferr = (e as Error).message;
      }
      await tx.execute(sql`ROLLBACK TO SAVEPOINT f`);
      ok(!!ferr, `F 목록이 더미와 다르면 거절 — ${ferr}`);

      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if ((e as Error).message !== ROLLBACK) throw e;
  }
  const [left] = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM vehicle WHERE plate_no_norm IN ('99테9991','99테9992','99테9993')`);
  ok(Number(left.n) === 0, "되돌림 — 시험 차량이 남지 않음");
  console.log(fails ? `\n✗ ${fails}개 실패` : "\n모두 통과");
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
