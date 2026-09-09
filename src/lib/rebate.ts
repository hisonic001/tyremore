"use server";

/**
 * ⭐ 뒷마진(제조사 장려금) 정본 (2026-09-09, 전문가 2인 자문 종합)
 *
 *   구조: 앞마진(건별 스냅샷, margin-def.ts) + 뒷마진(월별 층) = 진짜 마진.
 *   - 추정(미확정): 활성 프로모션의 실적 기반 자동 계산 — 문턱 미달·자격 미확인·
 *     달성 불확실(콘티 RSP)은 **0원 원칙** (기대치를 마진으로 착각하지 않게).
 *   - 확정: 크레딧 메모·매출할인 도착분을 rebate_entry 에 수기 등록 (실적월 귀속).
 *   - settle_type='에누리'(세금계산서 공급가액이 깎여 오는 형태)는 이미 매입
 *     원가에 반영 — 추정·확정 어느 층에도 넣지 않는다 (이중 계상 방지).
 *   기표가는 매입 줄의 unit_list_price(VAT 제외) — 역산이 아니라 전표 원본 값.
 */
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { PERM_DENIED } from "./perm-keys";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

export interface RebateCard {
  id: number;
  title: string;
  kind: string;
  estimate: number; // 추정액 (0 = 미달/자격 미확인/수기 전용)
  gaugePct: number | null; // 타겟 진행률 (없으면 null)
  statusLine: string; // 근거 한 줄
  actionLine: string | null; // 행동 유도 (전송하면 +X원 등)
  warnLine: string | null; // 데이터 경고 (기표가 미기재 등)
  memo: string | null;
}

interface PromoRow extends Record<string, unknown> {
  id: number;
  title: string;
  brand: string | null;
  kind: string;
  params: Record<string, unknown>;
  qualified: boolean | null;
  settle_type: string;
  memo: string | null;
  sell_from: string | null;
  sell_to: string | null;
}

/** 그 달(ym)에 활성인 프로모션의 추정 카드들 — 기간이 지나면 자연히 안 나온다 */
export async function estimateRebates(ym: string): Promise<RebateCard[]> {
  const start = `${ym}-01`;
  const promos = await db.execute<PromoRow>(sql`
    SELECT id, title, brand, kind, params, qualified, settle_type, memo,
           sell_from::text, sell_to::text
    FROM promo
    WHERE active
      AND ((buy_from IS NOT NULL AND to_char(buy_from,'YYYY-MM') <= ${ym} AND to_char(buy_to,'YYYY-MM') >= ${ym})
        OR (sell_from IS NOT NULL AND to_char(sell_from,'YYYY-MM') <= ${ym} AND to_char(sell_to,'YYYY-MM') >= ${ym}))
    ORDER BY id
  `);

  const cards: RebateCard[] = [];
  for (const p of promos) {
    const params = (typeof p.params === "string" ? JSON.parse(p.params) : p.params) as Record<string, number | string>;
    const card: RebateCard = {
      id: Number(p.id), title: p.title, kind: p.kind, estimate: 0,
      gaugePct: null, statusLine: "", actionLine: null, warnLine: null, memo: p.memo,
    };

    /* 판매 계열의 날짜 조건 — 그 달과 프로모션 기간의 **교집합**만 센다
       (금호 교환권이 8/12 시작인데 8월 전체를 세던 문제, 2026-09-09) */
    const sellD = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;
    const sellRange = sql`${sellD} >= GREATEST(COALESCE(${p.sell_from}::date, ${start}::date), ${start}::date)
      AND ${sellD} <= LEAST(COALESCE(${p.sell_to}::date, '9999-12-31'::date), (${start}::date + interval '1 month - 1 day')::date)`;

    if (p.settle_type === "에누리") {
      card.statusLine = "다음 세금계산서 금액이 깎여 오는 방식 — 이미 매입 원가에 반영되므로 여기 합산 안 함";
      cards.push(card);
      continue;
    }

    if (p.kind === "매입타겟") {
      const target = Number(params.monthlyTarget ?? 0);
      const rate = Number(params.rate ?? 0);
      const [r] = await db.execute<{ listed: string; missing_qty: number }>(sql`
        SELECT COALESCE(SUM(pii.unit_list_price * pii.qty) FILTER (WHERE pii.unit_list_price IS NOT NULL), 0)::bigint listed,
               COALESCE(SUM(pii.qty) FILTER (WHERE pii.unit_list_price IS NULL), 0)::int missing_qty
        FROM purchase_invoice pi
        JOIN purchase_invoice_item pii ON pii.invoice_id = pi.id
        JOIN product p2 ON p2.id = pii.product_id
        WHERE pi.status <> '취소' AND p2.brand_code = ${p.brand} AND substring(pi.issued_at, 1, 7) = ${ym}
      `);
      const listed = Number(r?.listed ?? 0);
      card.gaugePct = target > 0 ? Math.round((listed / target) * 100) : null;
      card.estimate = listed >= target ? Math.round(listed * rate) : 0;
      card.statusLine =
        `이 달 매입 기표가 ${won(listed)}원 / 타겟 ${won(target)}원 (${card.gaugePct}%)` +
        (listed >= target ? ` → ${(rate * 100).toFixed(0)}% 추정` : " — 미달, 달성 시에만 계산");
      if (listed < target && listed > 0) card.actionLine = `타겟까지 ${won(target - listed)}원 남음 — 월말 매입 판단 참고`;
      if (Number(r?.missing_qty ?? 0) > 0) card.warnLine = `기표가 미기재 ${r.missing_qty}본은 합산에서 빠짐 — 실제 진행률은 이보다 높음`;
    } else if (p.kind === "판매기표가율") {
      const rate = Number(params.rate ?? 0);
      /* 판매 줄의 기표가 = ①그 상품의 최근 매입 기표가(전표 원본) ②없으면 최근
         매입 단가에서 즉시 할인율 역산(17"이하 30%·18"이상 38% — 계약 별지2,
         8월 전표 실측과 정확히 일치) ③상품 매입가 역산 ④그래도 없으면(앱 도입
         전에 들어온 장기 재고) **같은 브랜드·같은 인치의 평균 기표가**로 근사 —
         8월 실측: 전송완료 27줄 중 20줄이 매입 기록이 없어 ④가 없으면 절반이
         0원으로 빠져 추정이 크게 낮아진다 */
      const listSql = sql`COALESCE(
        (SELECT pii.unit_list_price FROM purchase_invoice_item pii
          JOIN purchase_invoice pi2 ON pi2.id = pii.invoice_id
          WHERE pii.product_id = qi.product_id AND pi2.status <> '취소' AND pii.unit_list_price IS NOT NULL
          ORDER BY pii.id DESC LIMIT 1),
        (SELECT round(pii.unit_cost / CASE WHEN p2.rim_inch >= 18 THEN 0.62 ELSE 0.70 END)
          FROM purchase_invoice_item pii
          JOIN purchase_invoice pi2 ON pi2.id = pii.invoice_id
          WHERE pii.product_id = qi.product_id AND pi2.status <> '취소' AND pii.unit_cost IS NOT NULL
          ORDER BY pii.id DESC LIMIT 1),
        round(p2.purchase_price / CASE WHEN p2.rim_inch >= 18 THEN 0.62 ELSE 0.70 END),
        (SELECT round(avg(pii.unit_list_price)) FROM purchase_invoice_item pii
          JOIN purchase_invoice pi2 ON pi2.id = pii.invoice_id
          JOIN product px ON px.id = pii.product_id
          WHERE pi2.status <> '취소' AND pii.unit_list_price IS NOT NULL
            AND px.brand_code = p2.brand_code AND px.rim_inch = p2.rim_inch)
      )`;
      const [r] = await db.execute<{ done_list: string; done_n: number; hold_list: string; hold_n: number }>(sql`
        SELECT COALESCE(SUM(${listSql} * qi.qty) FILTER (WHERE q.mars_status = '전송완료'), 0)::bigint done_list,
               count(DISTINCT q.id) FILTER (WHERE q.mars_status = '전송완료')::int done_n,
               COALESCE(SUM(${listSql} * qi.qty) FILTER (WHERE q.mars_status IN ('보류','미전송')), 0)::bigint hold_list,
               count(DISTINCT q.id) FILTER (WHERE q.mars_status IN ('보류','미전송'))::int hold_n
        FROM quote_item qi JOIN quote q ON q.id = qi.quote_id JOIN product p2 ON p2.id = qi.product_id
        WHERE q.status = '성사' AND qi.line_type = 'tire' AND p2.brand_code = ${p.brand}
          AND ${sellRange}
      `);
      card.estimate = Math.round(Number(r?.done_list ?? 0) * rate);
      card.statusLine = `MARS 전송완료 ${r?.done_n ?? 0}건 · 기표가 ${won(Number(r?.done_list ?? 0))}원 × ${(rate * 100).toFixed(0)}%`;
      const holdWon = Math.round(Number(r?.hold_list ?? 0) * rate);
      if (holdWon > 0) card.actionLine = `⚠ 미전송·보류 ${r?.hold_n}건 — 전송 안 하면 사라지는 돈 ${won(holdWon)}원`;
    } else if (p.kind === "판매본당" && Array.isArray((params as Record<string, unknown>).groups)) {
      /* 그룹형 (금호 교환권 캠페인) — 패턴별 「N본당 정액」. 예: GT Pro·마제스티X
         2본당 3만원 교환권. 페어 미만 나머지 본은 계산에서 뺀다 */
      const groups = (params as unknown as { groups: { label: string; patterns: string[]; perQty: number; amount: number }[] }).groups;
      const parts: string[] = [];
      let total = 0;
      for (const g of groups) {
        const likes = sql.join(g.patterns.map((pat) => sql`qi.description ILIKE ${pat}`), sql` OR `);
        const [r] = await db.execute<{ qty: number }>(sql`
          SELECT COALESCE(SUM(qi.qty), 0)::int qty
          FROM quote_item qi JOIN quote q ON q.id = qi.quote_id JOIN product p2 ON p2.id = qi.product_id
          WHERE q.status = '성사' AND qi.line_type = 'tire' AND p2.brand_code = ${p.brand}
            AND (${likes}) AND ${sellRange}
        `);
        const qty = Number(r?.qty ?? 0);
        const units = Math.floor(qty / Math.max(1, g.perQty));
        total += units * g.amount;
        parts.push(`${g.label} ${qty}본→${units}장`);
      }
      card.estimate = p.qualified === false ? 0 : total;
      card.statusLine = `이 달 판매: ${parts.join(" · ")} → 교환권 ${won(total)}원`;
    } else if (p.kind === "판매본당") {
      const [r] = await db.execute<{ small: number; big: number; unknown: number }>(sql`
        SELECT COALESCE(SUM(qi.qty) FILTER (WHERE p2.rim_inch <= 19), 0)::int small,
               COALESCE(SUM(qi.qty) FILTER (WHERE p2.rim_inch >= 20), 0)::int big,
               COALESCE(SUM(qi.qty) FILTER (WHERE p2.rim_inch IS NULL), 0)::int unknown
        FROM quote_item qi JOIN quote q ON q.id = qi.quote_id JOIN product p2 ON p2.id = qi.product_id
        WHERE q.status = '성사' AND qi.line_type = 'tire' AND p2.brand_code = ${p.brand}
          AND ${sellRange}
      `);
      const raw = Number(r?.small ?? 0) * Number(params.le19 ?? 0) + Number(r?.big ?? 0) * Number(params.ge20 ?? 0);
      card.statusLine = `이 달 판매 19"이하 ${r?.small ?? 0}본 · 20"이상 ${r?.big ?? 0}본 → 본당 합 ${won(raw)}원`;
      /* ⭐ 자격 자동 판정 (실증 검증 2026-09-09) — 자격 = 자격월(qualifyYm) 매입
         기표가 ≥ 계약서 타겟(qualifyTarget). 사장님 확인: 캠페인의 매입 타겟은
         미쉐린 계약서 월 타겟(3,750만)과 같다. 수동 토글(qualified)이 있으면
         그것이 우선 — 미쉐린이 다르게 통보하면 손으로 덮을 수 있게. */
      let qualified = p.qualified;
      if (qualified === null && params.qualifyYm && Number(params.qualifyTarget ?? 0) > 0) {
        const [qr] = await db.execute<{ listed: string }>(sql`
          SELECT COALESCE(SUM(pii.unit_list_price * pii.qty), 0)::bigint listed
          FROM purchase_invoice pi
          JOIN purchase_invoice_item pii ON pii.invoice_id = pi.id
          JOIN product p3 ON p3.id = pii.product_id
          WHERE pi.status <> '취소' AND p3.brand_code = ${p.brand}
            AND substring(pi.issued_at, 1, 7) = ${String(params.qualifyYm)}
        `);
        const qListed = Number(qr?.listed ?? 0);
        const qTarget = Number(params.qualifyTarget);
        qualified = qListed >= qTarget;
        card.actionLine = `자격: ${String(params.qualifyYm).slice(5)}월 매입 기표가 ${won(qListed)}원 / 타겟 ${won(qTarget)}원 (${Math.round((qListed / qTarget) * 100)}%) — ${qualified ? "달성 ✓" : "아직 미달"}`;
      }
      if (qualified === true) card.estimate = raw;
      else if (p.qualified === false) card.statusLine += " — 자격 미달로 0원";
      if (Number(r?.unknown ?? 0) > 0) card.warnLine = `인치 미상 ${r.unknown}본 제외`;
    } else if (p.kind === "품목매입율") {
      const rate = Number(params.rate ?? 0);
      const cai = String(params.cai ?? "");
      const [r] = await db.execute<{ listed: string; qty: number }>(sql`
        SELECT COALESCE(SUM(COALESCE(pii.unit_list_price, ${Number(params.listPrice ?? 0)}) * pii.qty), 0)::bigint listed,
               COALESCE(SUM(pii.qty), 0)::int qty
        FROM purchase_invoice pi JOIN purchase_invoice_item pii ON pii.invoice_id = pi.id
        WHERE pi.status <> '취소' AND pii.cai = ${cai} AND substring(pi.issued_at, 1, 7) = ${ym}
      `);
      card.estimate = Math.round(Number(r?.listed ?? 0) * rate);
      card.statusLine = `대상 품목 이 달 매입 ${r?.qty ?? 0}본 · 기표가 ${won(Number(r?.listed ?? 0))}원 × ${(rate * 100).toFixed(0)}%`;
      if (Number(r?.qty ?? 0) === 0) card.statusLine = "대상 품목(CAI " + cai + ") 이 달 매입 없음";
    } else if (p.kind === "본수타겟") {
      const targetQty = Number(params.monthlyQty ?? 0);
      const bonus = Number(params.monthlyBonus ?? 0);
      const [r] = await db.execute<{ qty: number }>(sql`
        SELECT COALESCE(SUM(qi.qty), 0)::int qty
        FROM quote_item qi JOIN quote q ON q.id = qi.quote_id JOIN product p2 ON p2.id = qi.product_id
        WHERE q.status = '성사' AND qi.line_type = 'tire' AND p2.brand_code = ${p.brand}
          AND ${sellRange}
      `);
      const qty = Number(r?.qty ?? 0);
      card.gaugePct = targetQty > 0 ? Math.round((qty / targetQty) * 100) : null;
      card.estimate = qty >= targetQty ? bonus : 0;
      card.statusLine = `이 달 판매 ${qty}본 / 타겟 ${targetQty}본 (${card.gaugePct}%)` + (qty >= targetQty ? ` → ${won(bonus)}원` : " — 달성 확정 전 0원");
    } else {
      // 수기전용 — 추정 없음, 확정 등록만
      card.statusLine = "자동 추정 없음 — 통보·크레딧 메모가 오면 아래에 확정 등록";
    }
    cards.push(card);
  }
  return cards;
}

/* ---------------- 확정 금액 (도착분) ---------------- */

export interface RebateEntry extends Record<string, unknown> {
  id: number; ym: string; title: string; amount: number; status: string;
  received_on: string | null; memo: string | null;
}

export async function listRebateEntries(ym: string): Promise<RebateEntry[]> {
  const rows = await db.execute<RebateEntry>(sql`
    SELECT id, ym, title, amount, status, received_on::text, memo
    FROM rebate_entry WHERE ym = ${ym} ORDER BY id
  `);
  return rows.map((r) => ({ ...r, id: Number(r.id), amount: Number(r.amount) }));
}

export async function addRebateEntry(input: {
  ym: string; title: string; amount: number; receivedOn?: string | null; memo?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { hasPerm, getSession } = await import("./auth");
  if (!(await hasPerm("reports"))) return { ok: false, error: PERM_DENIED };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.ym)) return { ok: false, error: "귀속월이 올바르지 않습니다" };
  if (!input.title.trim()) return { ok: false, error: "이름을 넣어 주세요 (예: 미쉐린 8월 타겟 보너스)" };
  if (!Number.isInteger(input.amount) || input.amount === 0) return { ok: false, error: "금액을 확인해 주세요 (원 단위 정수)" };
  const session = await getSession();
  await db.execute(sql`
    INSERT INTO rebate_entry (ym, title, amount, received_on, memo, created_by)
    VALUES (${input.ym}, ${input.title.trim()}, ${input.amount},
            ${/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn ?? "") ? input.receivedOn : null},
            ${input.memo?.trim() || null}, ${session?.uid ?? null})
  `);
  try { revalidatePath("/reports/margin"); } catch { /* 요청 밖 */ }
  return { ok: true };
}

export async function deleteRebateEntry(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const { hasPerm } = await import("./auth");
  if (!(await hasPerm("reports"))) return { ok: false, error: PERM_DENIED };
  await db.execute(sql`DELETE FROM rebate_entry WHERE id = ${id}`);
  try { revalidatePath("/reports/margin"); } catch { /* 요청 밖 */ }
  return { ok: true };
}

/* ---------------- 엔진오일 원가 월 배부 ---------------- */

/**
 * 사장님 결정(2026-09-09): 오일 매입 전표를 앱에 넣고, 월 매입 총액 ÷ 오일교환
 * 건수로 배부. 매입 줄 품명에 「엔진오일」이 들어가야 잡힌다.
 * 전표가 아직 없는 달은 0 — 리포트가 「미입력」 각주를 보여준다.
 */
export async function oilAllocation(ym: string): Promise<{ total: number; jobs: number }> {
  const [buy] = await db.execute<{ total: string }>(sql`
    SELECT COALESCE(SUM(pii.unit_cost * pii.qty), 0)::bigint total
    FROM purchase_invoice pi JOIN purchase_invoice_item pii ON pii.invoice_id = pi.id
    WHERE pi.status <> '취소' AND pii.description LIKE '%엔진오일%' AND substring(pi.issued_at, 1, 7) = ${ym}
  `);
  const [job] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n
    FROM quote_item qi JOIN quote q ON q.id = qi.quote_id
    WHERE q.status = '성사' AND q.quote_no LIKE 'Q%' AND qi.line_type = 'service'
      AND (qi.description LIKE '%엔진오일%' OR qi.description LIKE '%오일교환%')
      AND to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM') = ${ym}
  `);
  return { total: Number(buy?.total ?? 0), jobs: Number(job?.n ?? 0) };
}
