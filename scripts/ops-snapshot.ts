/**
 * ⭐ 자료 사진 — 운영 점검 갈래들이 볼 요약을 한 번에 떠 둔다 (2026-09-10)
 *
 *   사장님 결정: 운영 점검을 「운영·고객 / 마진·가격 / 재고·발주 / 세무·계산서」
 *   네 갈래로 **동시에** 돌리되, **DB 는 한 번에 하나만** 쓴다.
 *
 * 🔴 왜 사진인가: 실DB 는 하나뿐이고 연결 풀이 3이다. 네 갈래가 동시에 조회하면
 *    풀이 만석이 되어 **매장 앱이 멈춘다**(좀비 질의 3개로 전면 마비된 전례).
 *    시작할 때 여기서 한 번만 읽어 파일로 떠 두면, 갈래들은 파일만 보므로
 *    DB 접근이 0 이 된다 — 안전하고 더 빠르다.
 *
 * 🔴 판정은 **기존 정본을 그대로 호출**한다 (margin-def · rebate · receivable-book ·
 *    stock-integrity · settle-tax). 사진이 화면과 다른 숫자를 말하면 안 된다.
 * 🔴 질의는 하나씩 차례로 — Promise.all 금지 (2026-08-11 마비 사고).
 * 🔴 개인정보는 넣지 않는다 — 이름·전화·번호판 없이 집계만. 거래처명은 넣는다
 *    (영업 정보라 보고서에 필요하고, .snapshot 은 .gitignore 로 막혀 있다).
 *
 * 실행: npx tsx --env-file=.env.local scripts/ops-snapshot.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { marginSql, marginBaseSql } from "@/lib/margin-def";
import { stockIntegrity } from "@/lib/stock-integrity";
import { receivableBook } from "@/lib/receivable-book";
import { estimateRebates, listRebateEntries, oilAllocation } from "@/lib/rebate";
import { kstToday, ymAdd } from "@/lib/ym";

const ROOT = "C:/dev/tyremore/.snapshot";
/** 판매 날짜 정본 — 화면들과 같은 식 */
const D = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;

async function main() {
  const now = new Date();
  const stamp = now.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(/[: ]/g, "-").slice(0, 16);
  const dir = join(ROOT, stamp);
  mkdirSync(dir, { recursive: true });
  const put = (name: string, data: unknown) => {
    writeFileSync(join(dir, name), JSON.stringify(data, null, 2), "utf8");
    console.log(`  · ${name}`);
  };

  const thisYm = kstToday().slice(0, 7);
  const from12 = `${ymAdd(thisYm, -11)}-01`;
  console.log(`자료 사진 뜨는 중 — ${dir}`);

  /* ── ① 판매 (운영·고객 / 마진 공용) ── */
  const salesByMonth = await db.execute(sql`
    SELECT to_char(${D}, 'YYYY-MM') ym, count(DISTINCT q.id)::int sales,
           COALESCE(SUM(q.total_amount), 0)::bigint amount,
           count(DISTINCT q.id) FILTER (WHERE q.supplier_name IS NOT NULL)::int supplier_sales,
           count(DISTINCT q.id) FILTER (WHERE q.payment_method = '외상')::int credit_sales,
           /* 🔴 MARS 상태를 **갈라서** 담는다 (2026-09-10 — 첫 점검에서 갈래가
              「보류 110건 = 거래처 110건」으로 오해했다. 우연히 숫자가 같았을 뿐,
              거래처 판매는 '해당없음'이라 보류에 안 들어간다).
                전송완료 = 올라감 · 보류 = 아직 안 올림(자동으로 안 올라감) ·
                미전송 = 올리기로 체크했는데 아직 안 감 · 해당없음 = 대상 아님
                (거래처 판매·무상 서비스) */
           count(DISTINCT q.id) FILTER (WHERE q.mars_status = '전송완료')::int mars_done,
           count(DISTINCT q.id) FILTER (WHERE q.mars_status = '보류')::int mars_hold,
           count(DISTINCT q.id) FILTER (WHERE q.mars_status = '미전송')::int mars_pending,
           count(DISTINCT q.id) FILTER (WHERE q.mars_status = '해당없음')::int mars_none,
           COALESCE(SUM(q.total_amount) FILTER (WHERE q.mars_status = '보류'), 0)::bigint mars_hold_amt,
           COALESCE(SUM(q.total_amount) FILTER (WHERE q.mars_status = '미전송'), 0)::bigint mars_pending_amt
    FROM quote q WHERE q.status = '성사' AND ${D} >= ${from12}::date
    GROUP BY 1 ORDER BY 1`);

  const tiresByBrand = await db.execute(sql`
    SELECT to_char(${D}, 'YYYY-MM') ym, COALESCE(b.name_ko, '기타') brand,
           SUM(qi.qty)::int qty, COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint amount
    FROM quote_item qi JOIN quote q ON q.id = qi.quote_id
    LEFT JOIN product p ON p.id = qi.product_id LEFT JOIN brand b ON b.code = p.brand_code
    WHERE q.status = '성사' AND qi.line_type = 'tire' AND ${D} >= ${from12}::date
    GROUP BY 1, 2 ORDER BY 1, 3 DESC`);

  const topItems = await db.execute(sql`
    SELECT qi.description name, SUM(qi.qty)::int qty,
           COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint amount
    FROM quote_item qi JOIN quote q ON q.id = qi.quote_id
    WHERE q.status = '성사' AND ${D} >= ${from12}::date
      AND NOT (qi.line_type = 'use' AND qi.final_price = 0)
    GROUP BY 1 ORDER BY 3 DESC LIMIT 40`);
  put("sales.json", { byMonth: salesByMonth, tiresByBrand, topItems });

  /* ── ② 마진 (정본 margin-def + rebate) ── */
  const marginByMonth = await db.execute(sql`
    SELECT to_char(${D}, 'YYYY-MM') ym,
           COALESCE(SUM(${marginSql}), 0)::bigint margin,
           COALESCE(SUM(${marginBaseSql}), 0)::bigint base,
           COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint total
    FROM quote_item qi JOIN quote q ON q.id = qi.quote_id
    WHERE q.status = '성사' AND q.quote_no LIKE 'Q%' AND ${D} >= ${from12}::date
    GROUP BY 1 ORDER BY 1`);

  const marginByItem = await db.execute(sql`
    SELECT qi.description name, SUM(qi.qty)::int qty,
           COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint sales,
           COALESCE(SUM(qi.margin), 0)::bigint margin
    FROM quote_item qi JOIN quote q ON q.id = qi.quote_id
    WHERE q.status = '성사' AND q.quote_no LIKE 'Q%' AND qi.purchase_cost IS NOT NULL
      AND qi.line_type <> 'use' AND ${D} >= ${from12}::date
    GROUP BY 1 ORDER BY 4 ASC LIMIT 60`);

  const uncovered = await db.execute(sql`
    SELECT qi.description name, SUM(qi.qty)::int qty,
           COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint sales,
           bool_or(qi.product_id IS NOT NULL) is_product
    FROM quote_item qi JOIN quote q ON q.id = qi.quote_id
    WHERE q.status = '성사' AND q.quote_no LIKE 'Q%' AND qi.purchase_cost IS NULL
      AND qi.final_price > 0 AND qi.line_type <> 'service' AND ${D} >= ${from12}::date
    GROUP BY 1 ORDER BY 3 DESC LIMIT 30`);

  const rebates: Record<string, unknown> = {};
  for (const ym of [thisYm, ymAdd(thisYm, -1)]) {
    rebates[ym] = {
      estimates: await estimateRebates(ym),
      fixed: await listRebateEntries(ym),
      oil: await oilAllocation(ym),
    };
  }
  put("margin.json", { byMonth: marginByMonth, byItem: marginByItem, uncovered, rebates });

  /* ── ③ 재고 (정본 stock-integrity) ── */
  const stockNow = await db.execute(sql`
    SELECT p.id product_id, p.raw_name name, COALESCE(b.name_ko, p.brand_code) brand,
           p.rim_inch, SUM(s.qty)::int qty,
           COALESCE(SUM(s.qty * COALESCE(s.purchase_price, p.purchase_price, 0)), 0)::bigint value,
           min(s.received_at)::date::text oldest_in
    FROM stock_item s JOIN product p ON p.id = s.product_id
    LEFT JOIN brand b ON b.code = p.brand_code
    WHERE s.status = '재고' AND s.qty > 0
    GROUP BY 1, 2, 3, 4 ORDER BY 6 DESC LIMIT 300`);

  const soldPerProduct = await db.execute(sql`
    SELECT qi.product_id, SUM(qi.qty)::int qty_90d
    FROM quote_item qi JOIN quote q ON q.id = qi.quote_id
    WHERE q.status = '성사' AND qi.product_id IS NOT NULL
      AND ${D} >= (now() AT TIME ZONE 'Asia/Seoul')::date - 90
    GROUP BY 1`);

  const stockTotals = await db.execute(sql`
    SELECT status, count(*)::int rows, COALESCE(SUM(qty), 0)::int qty FROM stock_item GROUP BY 1`);
  put("stock.json", {
    totals: stockTotals,
    byProduct: stockNow,
    sold90d: soldPerProduct,
    integrity: await stockIntegrity(),
  });

  /* ── ④ 매입·세무 ── */
  const purchaseByMonth = await db.execute(sql`
    SELECT substring(pi.issued_at, 1, 7) ym, pi.supplier,
           count(*)::int invoices, COALESCE(SUM(pi.subtotal), 0)::bigint subtotal,
           COALESCE(SUM(pi.total), 0)::bigint total
    FROM purchase_invoice pi WHERE pi.status <> '취소' AND pi.issued_at >= ${from12}
    GROUP BY 1, 2 ORDER BY 1, 4 DESC`);

  const taxByMonth = await db.execute(sql`
    SELECT to_char(issue_date, 'YYYY-MM') ym, direction, counterparty_name,
           count(*)::int n, COALESCE(SUM(supply_amount), 0)::bigint supply,
           COALESCE(SUM(total), 0)::bigint total,
           count(*) FILTER (WHERE recon_status NOT IN ('확정','무시'))::int open
    FROM tax_invoice WHERE is_active AND issue_date >= ${from12}::date
    GROUP BY 1, 2, 3 ORDER BY 1, 6 DESC`);

  const partyRules = await db.execute(sql`SELECT biz_no, name_raw, kind FROM tax_party_rule ORDER BY name_raw`);
  const agencyMap = await db.execute(sql`SELECT counterparty_name, keyword, supplier_name, memo FROM agency_map`);
  put("tax.json", { purchaseByMonth, taxByMonth, partyRules, agencyMap });

  /* ── ⑤ 돈 (통장) ── */
  const bankByMonth = await db.execute(sql`
    SELECT to_char(occurred_at, 'YYYY-MM') ym,
           COALESCE(SUM(in_amount), 0)::bigint in_amt, COALESCE(SUM(out_amount), 0)::bigint out_amt,
           count(*) FILTER (WHERE in_amount > 0 AND recon_status NOT IN ('확정','무시') AND category IS NULL)::int open_in,
           /* 금액도 담는다 — 첫 점검에서 「짝 못 찾은 입금이 몇 건인지는 알겠는데
              얼마인지 못 봤다」는 지적이 나왔다 (2026-09-10) */
           COALESCE(SUM(in_amount) FILTER (WHERE in_amount > 0 AND recon_status NOT IN ('확정','무시') AND category IS NULL), 0)::bigint open_in_amt
    FROM cash_txn WHERE is_active AND occurred_at >= ${from12}::date
    GROUP BY 1 ORDER BY 1`);
  put("bank.json", { byMonth: bankByMonth });

  /* ── ⑥ 외상 (정본 receivable-book) ── */
  const book = await receivableBook();
  put("receivable.json", {
    totalRemain: book.totalRemain,
    totalCount: book.totalCount,
    /* 🔴 개인 고객은 이름 대신 「개인」 — 거래처만 실명 (개인정보 규칙) */
    targets: book.targets.map((t) => ({
      kind: t.kind,
      label: t.kind === "supplier" ? t.label : "개인 고객",
      count: t.count,
      remain: t.remain,
      oldestDays: t.oldestDays,
    })),
  });

  /* ── ⑦ 고객·재방문 (익명 집계) ── */
  const visits = await db.execute(sql`
    WITH v AS (
      SELECT q.customer_id, count(*)::int n,
             max(${D})::text last_visit,
             ((now() AT TIME ZONE 'Asia/Seoul')::date - max(${D}))::int days_since
      FROM quote q WHERE q.status = '성사' AND q.customer_id IS NOT NULL AND q.supplier_name IS NULL
      GROUP BY 1
    )
    SELECT
      count(*)::int customers,
      count(*) FILTER (WHERE n = 1)::int once_only,
      count(*) FILTER (WHERE n >= 2)::int repeat_customers,
      count(*) FILTER (WHERE days_since > 180)::int lapsed_180d,
      count(*) FILTER (WHERE days_since <= 30)::int active_30d
    FROM v`);

  /* 예약은 **건별로** 담는다 — 첫 점검에서 「예약중 7건이 오래된 것인지 이번 주
     것인지 못 봤다」는 지적이 나왔다 (2026-09-10) */
  const reservations = await db.execute(sql`
    SELECT q.quote_no, q.reservation_status, ${D}::text work_date, q.fulfilled_on::text,
           q.total_amount, ((now() AT TIME ZONE 'Asia/Seoul')::date - ${D})::int age_days
    FROM quote q WHERE q.reservation_status IS NOT NULL AND q.status = '성사'
    ORDER BY ${D}`);
  put("customer.json", { visits: visits[0] ?? null, reservations });

  put("meta.json", {
    takenAt: now.toISOString(),
    takenAtKst: now.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
    thisYm,
    windowFrom: from12,
    note: "운영 점검 갈래는 이 파일들만 본다. DB 직접 조회 금지 (매장 앱이 멈출 수 있음).",
  });

  console.log(`\n사진 완료 — ${dir}`);
  console.log(`갈래에게 이 경로를 알려 주면 된다.`);
  process.exit(0);
}
main();
