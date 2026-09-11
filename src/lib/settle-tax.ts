import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monthRange, ymAdd } from "./ym";

/**
 * ⭐ 「이 청구의 계산서 짝」 찾기 (사장님 요청 2026-09-10)
 *
 *   사장님 흐름: **월초에 전월 말일자로 계산서를 끊고, 당월 말경 입금**받는다.
 *   그런데 앱에는 「계산서 ↔ 그 달 외상 판매들」 연결이 전체 2건뿐이라, 계산서를
 *   끊고 돈까지 받아도 외상 장부에 그대로 쌓여 있었다 (쏘카 265만·AJ 265만 실측).
 *
 *   계산서↔통장은 이미 115건 이어져 있으므로, **이 고리만 채우면**
 *   `taxChainCoveredSql`(deposit-core.ts) 이 완성돼 「계산서로 받음」이 저절로
 *   인식된다 — 하류는 이미 만들어져 있다.
 *
 * 🔴 상호가 다른 게 정상이다: 쏘카→㈜카랑, AJ렌트카→오픈링크㈜ 처럼 대행사가
 *    끊는다. 그래서 이름이 아니라 **금액과 시기**로 찾는다 — 쏘카 8월 외상
 *    2,132,898원 = 9/7 계산서 2,132,898원(원단위 일치)이 실측 근거다.
 * 🔴 자동으로 잇지 않는다 (사장님 선택 「짝 찾아 보여주기」) — 후보만 내고
 *    확인은 사람이 누른다.
 */

export interface SettleTaxHint {
  invoiceId: number;
  counterparty: string;
  issueDate: string;
  total: number;
  summary: string | null;
  /** 그 달 외상 합계와의 차이 (0이면 원단위 일치) */
  diff: number;
  /** 이미 판매와 이어졌나 */
  linked: boolean;
  /** 왜 후보인지 한 줄 */
  why: string;
}

/** 그 달 그 거래처 외상 합계·건수 — 청구할 금액 (외상 장부 정본과 같은 모집단). 앞뒤 두 함수가 같이 쓴다 */
async function settleMonthTotal(supplier: string, ym: string): Promise<{ total: number; n: number }> {
  const { start, nextStart } = monthRange(ym);
  const [month] = await db.execute<{ total: string; n: number }>(sql`
    SELECT COALESCE(SUM(q.total_amount), 0)::bigint total, count(*)::int n
    FROM quote q
    WHERE q.status = '성사' AND q.payment_method = '외상'
      AND COALESCE(q.supplier_name, q.claim_party) = ${supplier}
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}::date
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
  `);
  return { total: Number(month?.total ?? 0), n: Number(month?.n ?? 0) };
}

/** 짝 허용 폭 — 반려·조정으로 청구가 깎이는 일이 흔하다 (AJ렌트카 8월 177.3만 vs 오픈링크 148.4만 실측) */
const chainTolerance = (monthTotal: number) => Math.max(300_000, monthTotal * 0.35);

export async function settleTaxCandidates(supplier: string, ym: string): Promise<SettleTaxHint[]> {
  const { start, nextStart } = monthRange(ym);

  const { total: monthTotal } = await settleMonthTotal(supplier, ym);
  if (monthTotal === 0) return [];

  /* 창: 그 달 말일 ~ 익월 말 (사장님 흐름 「월초에 전월 말일자로 발행」).
     넉넉히 익익월 10일까지 본다 — 늦게 끊는 달이 있다. */
  const winFrom = start;
  const winTo = new Date(Date.parse(`${nextStart}T00:00:00Z`) + 40 * 86400000).toISOString().slice(0, 10);

  const rows = await db.execute<{
    id: number; counterparty_name: string; issue_date: string; total: number;
    item_summary: string | null; mapped: boolean; linked: boolean;
  }>(sql`
    SELECT t.id, t.counterparty_name, t.issue_date::date::text issue_date, t.total,
           t.item_summary,
           /* 이 상호가 이 거래처를 대신 끊는 곳인가 (정본 agency_map, 사장님 확인) */
           EXISTS (SELECT 1 FROM agency_map a
                    WHERE a.supplier_name = ${supplier}
                      AND t.counterparty_name ILIKE '%' || a.counterparty_name || '%'
                      AND (a.keyword IS NULL OR COALESCE(t.item_summary, '') ILIKE '%' || a.keyword || '%')) mapped,
           EXISTS (SELECT 1 FROM recon_match m
                    WHERE m.kind = '매출계산서' AND m.src_table = 'tax_invoice' AND m.src_id = t.id
                      AND m.ref_table = 'quote' AND m.status = '확정') linked
    FROM tax_invoice t
    WHERE t.is_active AND t.direction = '매출' AND t.total > 0
      AND t.issue_date >= ${winFrom}::date AND t.issue_date <= ${winTo}::date
    ORDER BY t.issue_date
  `);

  const myMonth = Number(ym.slice(5)); // 8
  const hints: SettleTaxHint[] = [];
  for (const r of rows) {
    const total = Number(r.total);
    const diff = total - monthTotal;
    const exact = diff === 0;
    const summary = r.item_summary ?? "";

    /* 🔴 품목 요약이 「07월 쏘카 수리비」처럼 **다른 달**을 말하면 뺀다.
       창이 넉넉해 지난달 청구서가 같이 걸려 든다 (실측: 8월 청구에 7월분
       카랑 계산서 두 장이 후보로 올라왔다). */
    const saidMonth = summary.match(/(\d{1,2})\s*월/);
    if (saidMonth && Number(saidMonth[1]) !== myMonth) continue;

    /* 짝의 근거는 둘 중 하나여야 한다:
         ① 금액이 원단위까지 같다 (가장 강한 신호 — 쏘카 8월 실측)
         ② 이 거래처를 대신 끊는 상호다 (agency_map) 또는 품목에 이름이 있다
       ②만으로는 금액이 꽤 달라도 후보로 올리고 차이를 적어 준다 — 반려·조정으로
       청구가 깎이는 일이 흔하다 (AJ렌트카 8월 177.3만 vs 오픈링크 148.4만 실측).
       매핑 없는 상호는 아예 안 올린다 — 전에는 개인택시지부 청구에 무관한 카랑
       계산서가 후보로 떴다. */
    const named = summary.includes(supplier);
    const related = r.mapped === true || named;
    if (!related && !exact) continue;
    if (!exact && Math.abs(diff) > chainTolerance(monthTotal)) continue;

    hints.push({
      invoiceId: Number(r.id),
      counterparty: r.counterparty_name,
      issueDate: r.issue_date,
      total,
      summary: r.item_summary,
      diff,
      linked: r.linked === true,
      why: exact
        ? `금액이 원단위까지 같습니다${related ? "" : " (상호 짝은 등록 안 됨)"}`
        : named
          ? `품목에 「${supplier}」가 있고 금액이 ${Math.abs(diff).toLocaleString()}원 다릅니다`
          : `${supplier} 를 대신 끊는 곳 · 금액이 ${Math.abs(diff).toLocaleString()}원 다릅니다`,
    });
  }
  // 정확 일치 먼저, 그다음 차이가 적은 순
  hints.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
  return hints.slice(0, 5);
}

/**
 * ⭐ 위를 **거꾸로** — 「이 계산서는 어느 거래처의 몇 월 청구인가」 (계산서 화면 개편 결정 5, 2026-09-11)
 *
 *   사장님: 대행사(카랑·오픈링크·레드캡) 매출 계산서는 장 단위 그대로 앱이 자동 — 단 카드에
 *   「카랑 → 쏘카 대신 끊음 · 쏘카 8월 청구 2,132,898 ✅ 원단위 일치」 사슬을 보여 준다
 *   ("이 모양이면 알아보겠음").
 *
 *   규칙은 settleTaxCandidates 와 같은 것을 쓴다:
 *     · 상대 → 거래처는 agency_map (keyword 가 있으면 품목 요약에 그 말이 있어야 — 카랑은 쏘카·현대캐피탈 둘 다)
 *     · 달은 품목 요약의 「N월」이 우선, 없으면 전월 → 당월 (사장님 흐름 「월초에 전월 말일자로 발행」)
 *     · 금액은 원단위 일치가 최선, 아니면 ±35%(최소 30만) 안이면 차이를 적어 준다
 *   href 는 청구 화면(/receivables/settle/{거래처}?ym=) — 거기서 「이 청구의 계산서 짝」으로 잇는다.
 */
export interface AgencyChain {
  supplier: string;
  ym: string;
  monthTotal: number;
  /** 그 달 외상 건수 */
  n: number;
  /** 계산서 − 그 달 외상 합 (0이면 원단위 일치) */
  diff: number;
  href: string;
}

export async function agencyChainOf(invoiceId: number): Promise<AgencyChain | null> {
  const [inv] = await db.execute<{
    counterparty_name: string; item_summary: string | null; total: number; direction: string; d: string;
  }>(sql`
    SELECT counterparty_name, item_summary, total, direction,
           to_char(COALESCE(issue_date, write_date), 'YYYY-MM-DD') d
    FROM tax_invoice WHERE id = ${invoiceId} AND is_active
  `);
  if (!inv || inv.direction !== "매출" || Number(inv.total) <= 0) return null;
  const summary = inv.item_summary ?? "";
  // 이 상호가 대신 끊는 거래처들 (agency_map 정본 — settleTaxCandidates 의 EXISTS 와 같은 식)
  const maps = await db.execute<{ supplier_name: string }>(sql`
    SELECT DISTINCT a.supplier_name FROM agency_map a
    WHERE ${inv.counterparty_name} ILIKE '%' || a.counterparty_name || '%'
      AND (a.keyword IS NULL OR ${summary} ILIKE '%' || a.keyword || '%')
    LIMIT 5
  `);
  if (maps.length === 0) return null;

  const thisYm = inv.d.slice(0, 7);
  let yms = [ymAdd(thisYm, -1), thisYm];
  const said = summary.match(/(\d{1,2})\s*월/);
  if (said) {
    const m = Number(said[1]);
    const hit = yms.filter((y) => Number(y.slice(5)) === m);
    // 품목이 말한 달이 전월·당월이 아니면(늦게 끊은 청구) 그 달을 같은 해로 본다
    yms = hit.length > 0 ? hit : m >= 1 && m <= 12 ? [`${thisYm.slice(0, 4)}-${String(m).padStart(2, "0")}`] : yms;
  }

  const total = Number(inv.total);
  let best: AgencyChain | null = null;
  for (const s of maps) {
    for (const y of yms) {
      const mt = await settleMonthTotal(s.supplier_name, y);
      if (mt.total === 0) continue;
      const diff = total - mt.total;
      if (diff !== 0 && Math.abs(diff) > chainTolerance(mt.total)) continue;
      if (!best || Math.abs(diff) < Math.abs(best.diff)) {
        best = {
          supplier: s.supplier_name,
          ym: y,
          monthTotal: mt.total,
          n: mt.n,
          diff,
          href: `/receivables/settle/${encodeURIComponent(s.supplier_name)}?ym=${y}`,
        };
      }
      if (best.diff === 0) return best; // 원단위 일치면 더 볼 것 없다
    }
  }
  return best;
}

/** 그 달 외상 판매 id 들 — 계산서에 이을 대상 */
export async function settleQuoteIds(supplier: string, ym: string): Promise<{ id: number; amount: number }[]> {
  const { start, nextStart } = monthRange(ym);
  const rows = await db.execute<{ id: number; total_amount: number }>(sql`
    SELECT q.id, q.total_amount
    FROM quote q
    WHERE q.status = '성사' AND q.payment_method = '외상'
      AND COALESCE(q.supplier_name, q.claim_party) = ${supplier}
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}::date
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
    ORDER BY q.id
  `);
  return rows.map((r) => ({ id: Number(r.id), amount: Number(r.total_amount) }));
}
