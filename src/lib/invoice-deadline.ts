/**
 * ⭐ 전월 계산서 발행 마감(10일) 경고 정본 (사장님 선택 2026-09-11 — 이번 개편의 유일한 새 기능)
 *
 *   사장님 흐름: 월초에 전월 말일자로 거래처 매출 계산서를 끊는다. 10일을 넘기면 가산세.
 *   대상은 **전월에 외상 판매가 있는 모든 거래처**(사장님 결정). 매달 1~10일에만 뜬다.
 *
 *   「끊었나」 판정은 월정산의 정본 `settleTaxCandidates`(settle-tax.ts) 를 **그대로** 쓴다 —
 *   거기가 이미 「그 달 외상 합 ↔ 전월 말일자 매출 계산서」를 금액·대행사(agency_map)·품목명으로
 *   맞춘다(쏘카→㈜카랑, AJ→오픈링크 같은 상호 차이 포함). 후보가 하나도 없으면 「아직 안 끊음」.
 *
 *   본사청구(claim_party)는 뺀다 — 제조사에 청구하는 것이지 계산서를 끊는 거래처 외상이 아니다.
 *   「이 거래처는 계산서 안 끊음」은 app_setting `invoice_deadline_skip`(JSON 배열)로 끈다.
 *
 * 🔴 "use server" 아님 — 조회 전용. 거래처마다 settleTaxCandidates 가 질의 2개 — 순차.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { kstToday, ymAdd } from "./ym";
import { settleTaxCandidates } from "./settle-tax";

export const SKIP_KEY = "invoice_deadline_skip";

export interface InvoiceDeadlineRow {
  supplier: string;
  /** 전월 외상 판매 합 */
  sold: number;
  count: number;
}

export interface InvoiceDeadline {
  /** 매달 1~10일이 아니면 false — 화면은 아무것도 안 그린다 */
  active: boolean;
  prevYm: string;
  /** 아직 계산서 짝이 안 보이는 거래처 */
  missing: InvoiceDeadlineRow[];
  /** 짝이 보이는 거래처 수 (안심용) */
  okCount: number;
  /** 이 달 들어 홈택스 매출 파일을 아직 안 올렸다 — 끊었어도 앱은 모른다 */
  needUpload: boolean;
}

export async function skipList(): Promise<string[]> {
  const [r] = await db.execute<{ value: string }>(sql`SELECT value FROM app_setting WHERE key = ${SKIP_KEY}`);
  try {
    const v = r?.value ? (JSON.parse(r.value) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function invoiceDeadline(today = kstToday()): Promise<InvoiceDeadline> {
  const thisYm = today.slice(0, 7);
  const prevYm = ymAdd(thisYm, -1);
  const day = Number(today.slice(8, 10));
  const base: InvoiceDeadline = { active: false, prevYm, missing: [], okCount: 0, needUpload: false };
  if (day < 1 || day > 10) return base;

  const suppliers = await db.execute<{ supplier: string; sold: string; n: number }>(sql`
    SELECT q.supplier_name supplier, SUM(q.total_amount)::bigint sold, count(*)::int n
    FROM quote q
    WHERE q.status = '성사' AND q.payment_method = '외상' AND q.claim_party IS NULL
      AND q.supplier_name IS NOT NULL AND q.total_amount > 0
      AND to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM') = ${prevYm}
    GROUP BY 1 ORDER BY 2 DESC LIMIT 30
  `);
  const skip = new Set(await skipList());
  const [up] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM fin_upload
    WHERE source = '홈택스매출' AND status = '반영'
      AND to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = ${thisYm}
  `);

  const missing: InvoiceDeadlineRow[] = [];
  let okCount = 0;
  for (const s of suppliers) {
    if (skip.has(s.supplier)) continue;
    const hints = await settleTaxCandidates(s.supplier, prevYm);
    if (hints.length > 0) okCount++;
    else missing.push({ supplier: s.supplier, sold: Number(s.sold), count: Number(s.n) });
  }
  return { active: true, prevYm, missing, okCount, needUpload: Number(up?.n ?? 0) === 0 };
}
