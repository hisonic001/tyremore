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

/**
 * ⭐ 「오늘」 정본 — 한국 날짜 (2회차 수리 D1, 2026-08-28)
 *
 * 🔴 전에는 `CURRENT_DATE` 였다. 이 DB 의 TimeZone 은 **UTC** 라
 *    한국 시간 00:00~09:00 사이에는 `CURRENT_DATE` 가 **어제**를 가리킨다.
 *    그 아홉 시간 동안 외상 나이가 하루 적게 나오고, 화면의 「90일 이상만」 버튼이
 *    딱 90일째 된 건을 건너뛰었다.
 *    같은 질의가 작업일 쪽은 이미 `AT TIME ZONE 'Asia/Seoul'` 로 읽고 있어
 *    **한 줄 안에서 기준이 두 벌**이었다 — 「오늘」만 UTC, 「작업일」은 한국.
 *    (lib/ym.kstToday() 의 SQL 판이다. 화면·서버가 같은 「오늘」을 쓴다)
 */
const KST_TODAY = sql`(now() AT TIME ZONE 'Asia/Seoul')::date`;

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
           /* 🔴 2회차 수리 A4(2026-08-28): 이름 짓기도 **집계**로 바꿨다.
              전에는 맨 컬럼이라 GROUP BY 에 c.name·mars_memo 를 끌고 들어가야 했고,
              그 바람에 한 거래처가 여러 줄로 쪼개졌다 (아래 GROUP BY 주석 참고).
              열쇠 안에 들어 있는 값만 대표로 뽑으므로 max() 로 안전하다:
                · S: 묶음 → supplier_name 이 열쇠의 일부라 전부 같은 값
                · C: 묶음 → customer_id 가 열쇠라 c.name 이 전부 같은 값
                · W: 묶음 → 견적 한 건이 한 묶음이라 애초에 한 줄 */
           COALESCE(max(q.supplier_name), max(c.name),
                    NULLIF(max(split_part(q.mars_memo, '·', 1)), ''), '이름 없음') label,
           max(q.supplier_name) supplier_name,
           max(q.customer_id)::int customer_id,
           count(*)::int n,
           SUM(q.total_amount)::bigint total,
           SUM(COALESCE(rp.paid, 0))::bigint paid,
           SUM(q.total_amount - COALESCE(rp.paid, 0))::bigint remain,
           min(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date))::text oldest,
           (${KST_TODAY} - min(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)))::int oldest_days
    FROM quote q
    LEFT JOIN customer c ON c.id = q.customer_id
    LEFT JOIN (SELECT quote_id, SUM(amount) paid FROM receivable_payment GROUP BY 1) rp
      ON rp.quote_id = q.id
    WHERE q.status = '성사' AND q.payment_method = '외상' ${kindCond} ${openOnly}
    /* 🔴 2회차 수리 A4(2026-08-28): **열쇠 하나로만 묶는다.**

         전에는 GROUP BY 에 KEY 말고 q.supplier_name, c.name, q.mars_memo 가 더 있었다.
         상세 목록(아래 detail 질의)은 열쇠 하나로만 묶는데 집계만 네 컬럼으로 묶으니
         **같은 열쇠가 여러 줄로 쪼개졌다.**

         실제로 터진 모습 (2026-08-28 실측) — 거래처 「한성공업사」:
           · c.name='고객'  → 1건   44,000원
           · c.name=NULL    → 2건  508,400원
         화면엔 똑같은 이름의 카드가 **두 장** 뜨고, 두 장 모두 상세는
         byKey.get('S:한성공업사') = **3건 552,400원** 전부를 보여줬다.
         머리글의 「N곳」도 13곳이 아니라 14곳으로 셌고,
         client.tsx 의 key={t.key} 는 React 키가 중복됐다.

         🔴 총액·건수는 전에도 맞았다 — 쪼개진 줄의 합은 같다.
            틀렸던 것은 **곳 수와 카드 겹침**이다. */
    GROUP BY ${KEY}
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
           (${KST_TODAY} - COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date))::int age_days
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
