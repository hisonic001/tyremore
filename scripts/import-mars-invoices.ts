/**
 * ⭐ MARS 완료된 매출 송장 → 정비 이력 이관 (사장님 요청 2026-08-05)
 *
 *   "지금까지 mars에 등록했던 모든 완료된 매출 송장 목록이 들어있음.
 *    이를 바탕으로 정비내역, 고객 및 차량 정보, 정비 이력 등을 업데이트 해줘."
 *
 * 1주차 이관 때 고객·차량·상품은 가져왔지만 **판매 이력은 안 가져왔다.**
 * 그래서 정비 내역 화면이 8월부터 시작이었다. 이 스크립트가 2025-01 부터의
 * 송장 3,100여 건을 quote 로 채워, 차량 카드의 「정비 이력」이 과거까지 이어진다.
 *
 * ⚠️ 단방향 출구(D-08)와 어긋나지 않는다 — 카탈로그처럼 **계속 받겠다**는 것이
 *    아니라, 이관 때 빠뜨린 과거 이력의 1회 백필이다 (사장님 지시).
 *
 * 안전장치:
 *   · 취소됨·시정 송장은 건너뛴다 (반품 짝까지 끌고 오면 이중 계산)
 *   · 이미 있는 기록은 두 겹으로 거른다 — ① mars_ref_no 같음 ② 같은 차량·작업일·금액
 *   · 몇 번을 다시 돌려도 안전하다 (멱등)
 *   · 재고는 손대지 않는다 — 과거 판매의 재고는 이관 재고에 이미 반영돼 있다
 *   · 품목 줄 정보가 없어서 「MARS 정비 이관」 한 줄로 넣는다 (금액은 정확)
 *
 *   npx tsx scripts/import-mars-invoices.ts --dry     무엇이 될지만
 *   npx tsx scripts/import-mars-invoices.ts           실제 이관
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import postgres from "postgres";

const FILE =
  process.argv.find((a) => a.endsWith(".xlsx")) ??
  "C:/dev/tyremore-data/mars-수출본/완료된 매출 송장 MARS_6116858301 2026-08-05T08_37_20.xlsx";
const DRY = process.argv.includes("--dry");

const PAY: Record<string, string> = {
  CREDITCARD: "카드",
  CASH: "현금",
  WEB_CASH: "현금",
  BANK: "계좌이체",
  ACCOUNT: "계좌이체",
};

const iso = (n: number) => new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  const wb = XLSX.read(readFileSync(FILE), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  console.log(`읽음 ${rows.length}건 — ${FILE.split("/").pop()}`);

  // 우리 쪽 현황
  const vehicles = await sql`SELECT id, customer_id, plate_no_norm, last_visit_at FROM vehicle`;
  const byPlate = new Map<string, { id: number; customerId: number }>();
  for (const v of vehicles) byPlate.set(v.plate_no_norm as string, { id: Number(v.id), customerId: Number(v.customer_id) });

  const refRows = await sql`SELECT mars_ref_no FROM quote WHERE mars_ref_no IS NOT NULL`;
  const refSet = new Set(refRows.map((r) => r.mars_ref_no as string));

  const existing = await sql`
    SELECT vehicle_id, to_char(COALESCE(work_date, created_at::date), 'YYYY-MM-DD') d, total_amount
    FROM quote WHERE status <> '취소' AND vehicle_id IS NOT NULL`;
  const dupKey = new Set(existing.map((e) => `${e.vehicle_id}|${e.d}|${e.total_amount}`));

  // 이름이 하나뿐인 고객 — 차량 매칭이 안 될 때만 쓴다 (동명이인이면 안 잇는다)
  const nameRows = await sql`SELECT min(id) id, name, count(*) n FROM customer GROUP BY name`;
  const byName = new Map<string, number>();
  for (const r of nameRows) if (Number(r.n) === 1) byName.set((r.name as string).trim(), Number(r.id));

  type Out = {
    quoteNo: string;
    customerId: number | null;
    vehicleId: number | null;
    workDate: string;
    total: number;
    pay: string | null;
    ref: string;
    checkDone: boolean;
    rawName: string;
  };
  const out: Out[] = [];
  let skipCancel = 0, skipRef = 0, skipDup = 0, noVehicle = 0, noCustomer = 0;
  const lastVisit = new Map<number, string>();

  for (const r of rows) {
    const ref = String(r["번호"]).trim();
    if (!/SI\+\d+/.test(ref)) continue;
    if (Number(r["취소됨"]) || Number(r["시정"])) { skipCancel++; continue; }
    if (refSet.has(ref)) { skipRef++; continue; }

    const workDate = iso(Number(r["완료 일자"]) || Number(r["문서 날짜"]));
    const total = Math.round(Number(r["금액(*VAT 포함)"]) || 0);
    const plate = String(r["번호판 번호"]).replace(/[\s-]/g, "");
    const rawName = String(r["고객"]).trim();

    const v = plate ? byPlate.get(plate) : undefined;
    let customerId = v?.customerId ?? null;
    const vehicleId = v?.id ?? null;
    if (!v) {
      noVehicle++;
      // 차량이 없으면 이름으로 — 동명이인 없는 경우만
      const cleaned = rawName.replace(/\[.*?\]$/, "").trim();
      customerId = byName.get(rawName) ?? byName.get(cleaned) ?? null;
      if (!customerId) noCustomer++;
    }
    if (vehicleId && dupKey.has(`${vehicleId}|${workDate}|${total}`)) { skipDup++; continue; }

    const m = /SI\+(\d+)/.exec(ref)!;
    out.push({
      quoteNo: `MARS-${m[1]}`,
      customerId,
      vehicleId,
      workDate,
      total,
      pay: PAY[String(r["결제 수단 코드"]).trim()] ?? null,
      ref,
      checkDone: String(r["Vehicle Check Status"]).trim() === "Done",
      rawName,
    });
    if (vehicleId) {
      const cur = lastVisit.get(vehicleId);
      if (!cur || workDate > cur) lastVisit.set(vehicleId, workDate);
    }
  }

  console.log(`이관 대상 ${out.length}건`);
  console.log(`  건너뜀 — 취소·시정 ${skipCancel} · 이미 연결(ref) ${skipRef} · 같은 차량·날짜·금액 ${skipDup}`);
  console.log(`  차량 못 찾음 ${noVehicle}건 (그중 고객 이름으로도 못 찾음 ${noCustomer}건 → 이름만 메모로 남김)`);
  console.log(`  차량 마지막 방문일 갱신 대상 ${lastVisit.size}대`);

  if (DRY) {
    console.log("\n--dry 라 아무것도 저장하지 않았습니다");
    await sql.end();
    return;
  }

  // 혹시 전에 돌리다 만 것이 있으면 그 quote_no 는 건너뛴다 (멱등)
  const prev = await sql`SELECT quote_no FROM quote WHERE quote_no LIKE 'MARS-%'`;
  const prevSet = new Set(prev.map((p) => p.quote_no as string));
  const fresh = out.filter((o) => !prevSet.has(o.quoteNo));
  if (fresh.length !== out.length) console.log(`이미 들어간 ${out.length - fresh.length}건은 건너뜁니다`);

  let done = 0;
  for (let i = 0; i < fresh.length; i += 200) {
    const chunk = fresh.slice(i, i + 200);
    const inserted = await sql`
      INSERT INTO quote (quote_no, customer_id, vehicle_id, status, confirmed_at, work_date,
                         total_amount, paid_amount, payment_method, mars_status, mars_synced_at,
                         mars_ref_no, mars_memo, vehicle_check_at)
      SELECT * FROM UNNEST (
        ${sql.array(chunk.map((o) => o.quoteNo))}::text[],
        ${sql.array(chunk.map((o) => o.customerId))}::bigint[],
        ${sql.array(chunk.map((o) => o.vehicleId))}::bigint[],
        ${sql.array(chunk.map(() => "성사"))}::text[],
        ${sql.array(chunk.map((o) => o.workDate))}::timestamptz[],
        ${sql.array(chunk.map((o) => o.workDate))}::date[],
        ${sql.array(chunk.map((o) => o.total))}::int[],
        ${sql.array(chunk.map((o) => o.total))}::int[],
        ${sql.array(chunk.map((o) => o.pay))}::text[],
        ${sql.array(chunk.map(() => "전송완료"))}::text[],
        ${sql.array(chunk.map((o) => o.workDate))}::timestamptz[],
        ${sql.array(chunk.map((o) => o.ref))}::text[],
        ${sql.array(chunk.map((o) => (o.customerId || o.vehicleId ? `MARS 이관 (${o.rawName})` : `비회원 ${o.rawName} · MARS 이관`)))}::text[],
        ${sql.array(chunk.map((o) => (o.checkDone ? o.workDate : null)))}::timestamptz[]
      ) ON CONFLICT (quote_no) DO NOTHING
      RETURNING id, quote_no`;
    const idOf = new Map(inserted.map((r) => [r.quote_no as string, Number(r.id)]));
    const items = chunk.filter((o) => idOf.has(o.quoteNo));
    if (items.length) {
      await sql`
        INSERT INTO quote_item (quote_id, line_type, description, qty, final_price)
        SELECT * FROM UNNEST (
          ${sql.array(items.map((o) => idOf.get(o.quoteNo)!))}::bigint[],
          ${sql.array(items.map(() => "custom"))}::text[],
          ${sql.array(items.map(() => "MARS 정비 이관 (품목 내역 없음)"))}::text[],
          ${sql.array(items.map(() => 1))}::int[],
          ${sql.array(items.map((o) => o.total))}::int[]
        )`;
    }
    done += inserted.length;
    process.stdout.write(`\r넣는 중 ${done}/${fresh.length}`);
  }
  console.log("");

  // 차량 마지막 방문일 — 더 최근일 때만 갱신
  let visits = 0;
  const lv = [...lastVisit.entries()];
  for (let i = 0; i < lv.length; i += 300) {
    const chunk = lv.slice(i, i + 300);
    const r = await sql`
      UPDATE vehicle v SET last_visit_at = x.d::timestamptz
      FROM UNNEST(${sql.array(chunk.map(([id]) => id))}::bigint[], ${sql.array(chunk.map(([, d]) => d))}::text[]) AS x(id, d)
      WHERE v.id = x.id AND (v.last_visit_at IS NULL OR v.last_visit_at < x.d::timestamptz)
      RETURNING v.id`;
    visits += r.length;
  }
  console.log(`✅ 정비 이력 ${done}건 이관 · 차량 마지막 방문일 ${visits}대 갱신`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
