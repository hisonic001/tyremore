/**
 * ⭐ 외상 장부 — 대상별로 모아 본다 (사장님 지시 2026-08-17)
 *
 *   "거래처의 경우는 외상이 많은데 거래처별로 내역을 확인하고 한번에 외상을
 *    떨어버릴 수 있는 방법(한꺼번에 입금하는 경우도 있음)도 필요함"
 *
 * 지금까지 외상은 정비 내역에서 **건별로만** 볼 수 있었다. 거래처가 여러 건을
 * 묶어 한 번에 보내면 카드를 하나씩 펼쳐 수금을 나눠 넣어야 했다.
 *
 * 🔴 이 파일은 `"use server"` 가 아니다 (sale-history 와 같은 이유) —
 *    읽기 전용이고, 쓰기(수금)는 `receivable.ts` 가 한다.
 *
 * 🔴 대상 범위는 /sales 의 미수금 배너와 **글자 그대로 같아야 한다**:
 *    `status='성사' AND payment_method='외상'`. 두 숫자가 다르면 사장님은 둘 다 못 믿는다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface ReceivableSale {
  quoteId: number;
  quoteNo: string;
  workDate: string;
  total: number;
  paid: number;
  remain: number;
  plateNo: string | null;
  summary: string;
  /** 작업일로부터 며칠 지났나 — 묵은 것을 붉게 표시한다 */
  ageDays: number;
}

export interface ReceivableTarget {
  kind: "supplier" | "customer" | "walkin";
  /** 'S:금호' · 'C:123' · 'W:456' */
  key: string;
  label: string;
  supplierName: string | null;
  customerId: number | null;
  count: number;
  total: number;
  paid: number;
  remain: number;
  oldestDate: string;
  oldestDays: number;
  sales: ReceivableSale[];
}

export interface ReceivableBook {
  targets: ReceivableTarget[];
  totalRemain: number;
  totalCount: number;
  /** 상세를 못 실은 건 수 (너무 많으면 자른다) */
  detailCapped: number;
}

/**
 * 🔴 비회원은 **건별로 하나의 대상**('W:'||q.id)이다.
 *    이름으로 묶으면 동명이인의 외상이 한 덩어리가 되어 남의 것을 대신 털게 된다.
 *    같아 보이는 두 줄이 나오는 쪽이 훨씬 안전하다.
 */
const KEY = sql`CASE
  WHEN q.supplier_name IS NOT NULL THEN 'S:' || q.supplier_name
  WHEN q.customer_id   IS NOT NULL THEN 'C:' || q.customer_id
  ELSE 'W:' || q.id END`;

export async function receivableBook(opts?: {
  kind?: "supplier" | "customer";
  /** 완납된 건도 볼까 (기본은 안 본다) */
  includeSettled?: boolean;
}): Promise<ReceivableBook> {
  const openOnly = opts?.includeSettled ? sql`` : sql`AND q.total_amount > COALESCE(rp.paid, 0)`;
  const kindCond =
    opts?.kind === "supplier"
      ? sql`AND q.supplier_name IS NOT NULL`
      : opts?.kind === "customer"
        ? sql`AND q.supplier_name IS NULL`
        : sql``;

  /**
   * 🔴 질의는 하나씩 차례로 (2026-08-11 마비 사고) — Promise.all 금지.
   *    집계는 전체 기준으로 정확해야 하고, 상세만 캡을 씌운다.
   */
  const rows = await db.execute<{
    k: string;
    label: string;
    supplier_name: string | null;
    customer_id: number | null;
    n: number;
    total: string;
    paid: string;
    remain: string;
    oldest: string;
    oldest_days: number;
  }>(sql`
    SELECT ${KEY} k,
           COALESCE(q.supplier_name, c.name,
                    NULLIF(split_part(q.mars_memo, '·', 1), ''), '이름 없음') label,
           max(q.supplier_name) supplier_name,
           max(q.customer_id)::int customer_id,
           count(*)::int n,
           SUM(q.total_amount)::bigint total,
           SUM(COALESCE(rp.paid, 0))::bigint paid,
           SUM(q.total_amount - COALESCE(rp.paid, 0))::bigint remain,
           min(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date))::text oldest,
           (CURRENT_DATE - min(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)))::int oldest_days
    FROM quote q
    LEFT JOIN customer c ON c.id = q.customer_id
    LEFT JOIN (SELECT quote_id, SUM(amount) paid FROM receivable_payment GROUP BY 1) rp
      ON rp.quote_id = q.id
    WHERE q.status = '성사' AND q.payment_method = '외상' ${kindCond} ${openOnly}
    GROUP BY ${KEY}, q.supplier_name, c.name, q.mars_memo
    ORDER BY remain DESC, oldest ASC
    LIMIT 200
  `);

  const DETAIL_CAP = 600;
  const detail = await db.execute<{
    k: string;
    id: number;
    quote_no: string;
    work_date: string;
    total: number;
    paid: number;
    plate_no: string | null;
    summary: string | null;
    age_days: number;
  }>(sql`
    SELECT ${KEY} k, q.id, q.quote_no,
           COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)::text work_date,
           q.total_amount total,
           COALESCE((SELECT SUM(amount)::int FROM receivable_payment rp WHERE rp.quote_id = q.id), 0) paid,
           v.plate_no,
           (SELECT string_agg(x.description, ' · ')
              FROM (SELECT qi.description FROM quote_item qi
                     WHERE qi.quote_id = q.id ORDER BY qi.id LIMIT 3) x) summary,
           (CURRENT_DATE - COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date))::int age_days
    FROM quote q
    LEFT JOIN vehicle v ON v.id = q.vehicle_id
    LEFT JOIN (SELECT quote_id, SUM(amount) paid FROM receivable_payment GROUP BY 1) rp
      ON rp.quote_id = q.id
    WHERE q.status = '성사' AND q.payment_method = '외상' ${kindCond} ${openOnly}
    ORDER BY COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) ASC, q.id ASC
    LIMIT ${DETAIL_CAP}
  `);

  const byKey = new Map<string, ReceivableSale[]>();
  for (const d of detail) {
    const total = Number(d.total);
    const paid = Number(d.paid);
    const list = byKey.get(d.k) ?? [];
    list.push({
      quoteId: Number(d.id),
      quoteNo: d.quote_no,
      workDate: d.work_date,
      total,
      paid,
      remain: total - paid,
      plateNo: d.plate_no,
      summary: d.summary ?? "품목 없음",
      ageDays: Number(d.age_days),
    });
    byKey.set(d.k, list);
  }

  const targets: ReceivableTarget[] = rows.map((r) => ({
    kind: r.supplier_name ? "supplier" : r.customer_id ? "customer" : "walkin",
    key: r.k,
    label: r.label,
    supplierName: r.supplier_name,
    customerId: r.customer_id === null ? null : Number(r.customer_id),
    count: Number(r.n),
    total: Number(r.total),
    paid: Number(r.paid),
    remain: Number(r.remain),
    oldestDate: r.oldest,
    oldestDays: Number(r.oldest_days),
    sales: byKey.get(r.k) ?? [],
  }));

  return {
    targets,
    totalRemain: targets.reduce((s, t) => s + t.remain, 0),
    totalCount: targets.reduce((s, t) => s + t.count, 0),
    detailCapped: Math.max(0, targets.reduce((s, t) => s + t.count, 0) - detail.length),
  };
}
