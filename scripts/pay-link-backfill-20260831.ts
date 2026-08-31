/**
 * ⭐ 미지급 정리 ③ — 스크립트로 넣은 지급 20건에 「연결 자국」 백필 (2026-08-31)
 *
 *   사고: pay-match·pay-kumho 스크립트가 purchase_payment 만 넣고 recon_match
 *   ('매입지급')를 안 남겼다 — 「출금에서 지급 잡기」 화면이 그 자국으로
 *   「이미 이은 출금」을 가리기 때문에, 이미 처리된 출금이 그대로 남아
 *   잘못 누르면 **이중 지급**이 되는 상태였다 (사장님이 화면을 붙여 주셔서 발견).
 *
 *   하는 일:
 *   ① 지급 20건 ↔ 통장 출금 9건에 recon_match('매입지급') 백필 + 출금 확정
 *      메모도 「통장 출금 연결 …」 꼴로 맞춘다 — 화면의 「되돌리기」가 그 꼴을 찾는다
 *   ② 금호 출금 4건: 분류 「주주거래」→「매입대금」 (이체 메모의 「조준호」 때문에
 *      자동분류가 오인했다 — 사장님 확인: 금호 대금이다)
 *   ③ 금호 8/24 세 건(합 35,000,000 — 7월분 대금, 사장님 확인 "금호는 잔금이 없음")은
 *      앱에 인보이스가 없어 이을 데가 없다 → 「무시」로 접는다 (되돌리기 가능)
 *
 *   실행: npx tsx --env-file=.env.local scripts/pay-link-backfill-20260831.ts [--apply]
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const APPLY = process.argv.includes("--apply");

/** 출금(날짜·금액·이름조각) ↔ 그 돈으로 갚은 인보이스들 */
const LINKS: { day: string; amount: number; like: string; invoices: [string, number][] }[] = [
  { day: "2026-08-13", amount: 2390300, like: "%콘티%", invoices: [["CO-8154274236", 963050], ["CO-8154274237", 1427250]] },
  { day: "2026-08-21", amount: 1267750, like: "%콘티%", invoices: [["CO-8154275216", 1267750]] },
  { day: "2026-08-26", amount: 2233000, like: "%콘티%", invoices: [["CO-8154275887", 1056000], ["CO-8154275888", 1177000]] },
  { day: "2026-08-28", amount: 2132460, like: "%콘티%", invoices: [["CO-8154276266", 960300], ["CO-8154276267", 1023660], ["CO-8154276268", 148500]] },
  { day: "2026-08-05", amount: 1203048, like: "%미쉐린%", invoices: [["KR_4520270364", 1203048]] },
  { day: "2026-08-12", amount: 16045568, like: "%미쉐린%", invoices: [["KR_SI26+096341", 16045568]] },
  { day: "2026-08-21", amount: 591294, like: "%미쉐린%", invoices: [["KR_4520276463", 591294]] },
  { day: "2026-08-25", amount: 3311792, like: "%미쉐린%", invoices: [["KR_4520277548", 3311792]] },
  {
    day: "2026-08-31", amount: 5952138, like: "%금호타%",
    invoices: [
      ["KM-0202913871", 387200], ["KM-0202913931", 292248], ["직접-20260808-01", 285657],
      ["직접-20260808-02", 285657], ["KM-0202944588", 601392], ["KM-0202957766", 1705836],
      ["KM-0202968506", 900768], ["KM-0202982438", 1493380],
    ],
  },
];

/** 금호 7월분 대금 — 이을 인보이스가 앱에 없다 → 접기 */
const KUMHO_JULY = [
  { day: "2026-08-24", amount: 5000000 },
  { day: "2026-08-24", amount: 25000000 },
  { day: "2026-08-24", amount: 5000000 },
];

async function main() {
  console.log(APPLY ? "🔴 실행 모드 (--apply)\n" : "👀 보기만 합니다 (--apply 로 실행)\n");

  /* ② 금호 분류 바로잡기 (연결 전에 — 목록 질의가 '매입대금'만 본다) */
  const kum = await db.execute<{ id: number; d: string; out: number; cat: string }>(sql`
    SELECT id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') d, out_amount out, category cat
    FROM cash_txn WHERE source = '통장' AND is_active AND description LIKE '%금호타%'
      AND out_amount > 0 AND occurred_at >= '2026-08-01'
  `);
  for (const k of kum) {
    if (k.cat !== "매입대금") {
      console.log(`② 금호 ${k.d} ${Number(k.out).toLocaleString()}원 — 분류 「${k.cat}」 → 「매입대금」`);
      if (APPLY) await db.execute(sql`UPDATE cash_txn SET category = '매입대금' WHERE id = ${Number(k.id)}`);
    }
  }

  /* ① 연결 자국 백필 */
  console.log("\n① 지급 ↔ 출금 연결 자국");
  for (const L of LINKS) {
    const [c] = await db.execute<{ id: number; l: string; linked: number }>(sql`
      SELECT c.id, c.account_label l,
             (SELECT count(*)::int FROM recon_match m
               WHERE m.kind = '매입지급' AND m.src_table = 'cash_txn' AND m.src_id = c.id) linked
      FROM cash_txn c
      WHERE c.source = '통장' AND c.is_active AND c.out_amount = ${L.amount}
        AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date = ${L.day}::date
        AND c.description LIKE ${L.like}
      LIMIT 1
    `);
    if (!c) {
      console.log(`  ⚠️ ${L.day} ${L.amount.toLocaleString()} 출금을 못 찾음 — 건너뜀`);
      continue;
    }
    if (Number(c.linked) > 0) {
      console.log(`  · ${L.day} ${L.amount.toLocaleString()} — 이미 이어짐 (건너뜀)`);
      continue;
    }
    console.log(`  · ${L.day} ${L.amount.toLocaleString()}원 → 인보이스 ${L.invoices.length}장`);
    for (const [invNo, amt] of L.invoices) {
      const [p] = await db.execute<{ pid: number; iid: number }>(sql`
        SELECT pp.id pid, pi.id iid FROM purchase_payment pp
        JOIN purchase_invoice pi ON pi.id = pp.invoice_id
        WHERE pi.invoice_no = ${invNo} AND pp.amount = ${amt}
          AND pp.memo NOT LIKE '통장 출금 연결%'
        ORDER BY pp.id DESC LIMIT 1
      `);
      if (!p) {
        console.log(`    ⚠️ ${invNo} ${amt.toLocaleString()}원 지급 기록을 못 찾음`);
        continue;
      }
      if (APPLY) {
        await db.execute(sql`
          INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_at)
          VALUES ('매입지급', 'cash_txn', ${Number(c.id)}, 'purchase_invoice', ${Number(p.iid)}, ${amt}, '확정', '수동', now())
        `);
        /* 화면의 「되돌리기」(undoPayFromWithdrawal)가 이 꼴의 메모를 찾는다 */
        await db.execute(sql`
          UPDATE purchase_payment SET memo = ${"통장 출금 연결 (" + (c.l ?? "신한") + " " + L.day + ") — 원단위 자동 대조"}
          WHERE id = ${Number(p.pid)}
        `);
      }
    }
    if (APPLY) await db.execute(sql`UPDATE cash_txn SET recon_status = '확정' WHERE id = ${Number(c.id)}`);
  }

  /* ③ 금호 7월분 접기 */
  console.log("\n③ 금호 7월분(이을 인보이스 없음) 접기");
  for (const K of KUMHO_JULY) {
    const [c] = await db.execute<{ id: number; st: string }>(sql`
      SELECT c.id, c.recon_status st FROM cash_txn c
      WHERE c.source = '통장' AND c.is_active AND c.out_amount = ${K.amount}
        AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date = ${K.day}::date
        AND c.description LIKE '%금호타%'
        AND NOT EXISTS (SELECT 1 FROM recon_match m WHERE m.kind = '매입지급' AND m.src_table = 'cash_txn' AND m.src_id = c.id)
      ORDER BY c.id LIMIT 1
    `);
    if (!c || c.st === "무시") {
      console.log(`  · ${K.day} ${K.amount.toLocaleString()} — ${c ? "이미 접힘" : "못 찾음/이미 이어짐"}`);
      continue;
    }
    console.log(`  · ${K.day} ${K.amount.toLocaleString()}원 → 접기 (7월분 대금 — 사장님 확인)`);
    if (APPLY) {
      await db.execute(sql`
        UPDATE cash_txn SET recon_status = '무시',
          memo = COALESCE(memo || ' · ', '') || '지난달(7월분) 대금 — 이을 인보이스 없음 (사장님 확인 2026-08-31)'
        WHERE id = ${Number(c.id)}
      `);
    }
  }

  /* 검산 — 지급 잡기 후보에 남는 것 */
  const rest = await db.execute<{ d: string; desc: string; remain: string }>(sql`
    SELECT to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') d, c.description "desc",
           (c.out_amount - COALESCE((SELECT SUM(m.amount) FROM recon_match m
             WHERE m.status = '확정' AND ((m.ref_table = 'cash_txn' AND m.ref_id = c.id AND m.kind IN ('매출계산서','매입계산서'))
               OR (m.src_table = 'cash_txn' AND m.src_id = c.id AND m.kind IN ('매입지급','이체입금')))), 0))::bigint remain
    FROM cash_txn c
    WHERE c.source = '통장' AND c.is_active AND c.category = '매입대금' AND c.recon_status <> '무시'
      AND c.occurred_at >= '2026-08-01'
    ORDER BY c.occurred_at DESC
  `);
  const open = rest.filter((r) => Number(r.remain) > 0);
  console.log(`\n남을 후보: ${open.length}건`);
  for (const r of open) console.log(`  · ${r.d} ${r.desc} ${Number(r.remain).toLocaleString()}원`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(0), 500));
