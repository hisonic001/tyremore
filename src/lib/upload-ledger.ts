/**
 * ⭐ 「올린 자료」 정본 (사장님 요청 2026-09-10)
 *
 *   사장님: "내가 올린 자료들의 내역도 보기가 힘듦" → 원한 것 넷:
 *     ① 언제 무엇을 올렸나      → uploadLedger()  (fin_upload 목록 + 배치별 반영 상태)
 *     ② 어느 기간이 비었나      → 기존 upload-coverage.ts 그대로 (여기서 다시 만들지 않는다)
 *     ③ 올렸는데 안 반영된 것   → 배치 줄마다 「정리 안 된 N줄」 — 그 파일이 넣은 줄(upload_id)
 *                                  중 아직 미대조·미분류인 것. 취소된 배치·새 줄 0(전부 중복)도 표시
 *     ④ 검색 (「내역이나 금액으로」) → findUploadOfLine() — 통장 적요·계산서 상대·금액으로
 *                                  줄을 찾아 **어느 파일에서 왔는지** 거꾸로 알려 준다
 *
 *   전에는 현황·올리기 화면이 각자 인라인 SQL 로 최근 10·8건만 보여 줬고(두 벌),
 *   fin_upload 를 검색하는 코드가 0곳이었다.
 *
 * 🔴 "use server" 아님 — 조회 전용. 질의 순차 · LIMIT.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface UploadRow {
  id: number;
  source: string;
  accountLabel: string | null;
  fileName: string;
  rowCount: number;
  newCount: number;
  dupCount: number;
  /** YYYY-MM-DD — 없을 수 있다 (홈택스는 조회기간이 파일에 없다) */
  periodFrom: string | null;
  periodTo: string | null;
  /** '반영' | '취소' */
  status: string;
  /** MM-DD HH:MI */
  at: string;
  by: string | null;
  /** 이 파일이 넣은 줄 중 아직 정리 안 된 것 — 없는 원천(카드 승인·정산·포스)은 null */
  open: number | null;
  /** 정리하러 갈 화면 */
  openHref: string;
  /** 사람이 읽는 상태 한 마디 */
  note: "취소됨" | "전부 중복" | "정리 안 됨" | "정리 끝" | "반영됨";
}

function hrefOf(source: string, ym: string | null): string {
  const q = ym ? `?ym=${ym}` : "";
  switch (source) {
    case "통장":
      return `/finance/deposits${q}`;
    case "법인카드":
      return `/finance/expenses${q}`;
    case "홈택스매출":
      return `/finance/tax?view=money&direction=매출${ym ? `&ym=${ym}` : ""}`;
    case "홈택스매입":
      return `/finance/tax?view=money&direction=매입${ym ? `&ym=${ym}` : ""}`;
    default:
      return `/finance/card${q}`;
  }
}

export async function uploadLedger(opts: {
  /** 파일명·계좌·원천·기간(YYYY-MM) 검색 */
  q?: string | null;
  limit?: number;
}): Promise<UploadRow[]> {
  const q = opts.q?.trim() || null;
  const like = q ? "%" + q.replace(/\s+/g, "%") + "%" : null;
  const ym = q && /^\d{4}-\d{2}$/.test(q) ? q : null;
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200);
  const rows = await db.execute<{
    id: number; source: string; account_label: string | null; file_name: string; row_count: number; new_count: number;
    dup_count: number; pf: string | null; pt: string | null; status: string; at: string; by: string | null; open: number | null;
  }>(sql`
    SELECT u.id, u.source, u.account_label, u.file_name, u.row_count, u.new_count, u.dup_count,
           u.period_from::text pf, u.period_to::text pt, u.status,
           to_char(u.created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at, a.name "by",
           CASE u.source
             WHEN '통장' THEN (SELECT count(*)::int FROM cash_txn x WHERE x.upload_id = u.id AND x.is_active
                                 AND x.recon_status IN ('미대조', '제안') AND x.category IS NULL)
             WHEN '법인카드' THEN (SELECT count(*)::int FROM cash_txn x WHERE x.upload_id = u.id AND x.is_active
                                 AND x.category IS NULL)
             WHEN '홈택스매출' THEN (SELECT count(*)::int FROM tax_invoice t WHERE t.upload_id = u.id AND t.is_active
                                 AND t.recon_status IN ('미대조', '제안'))
             WHEN '홈택스매입' THEN (SELECT count(*)::int FROM tax_invoice t WHERE t.upload_id = u.id AND t.is_active
                                 AND t.recon_status IN ('미대조', '제안'))
             ELSE NULL
           END AS open
    FROM fin_upload u LEFT JOIN app_user a ON a.id = u.created_by
    WHERE 1=1
      ${like ? sql`AND (u.file_name ILIKE ${like} OR COALESCE(u.account_label, '') ILIKE ${like} OR u.source ILIKE ${like}
                        ${ym ? sql`OR to_char(u.period_from, 'YYYY-MM') <= ${ym} AND to_char(u.period_to, 'YYYY-MM') >= ${ym}` : sql``})` : sql``}
    ORDER BY u.id DESC LIMIT ${limit}
  `);
  return rows.map((r) => {
    const open = r.open === null ? null : Number(r.open);
    const note: UploadRow["note"] =
      r.status === "취소" ? "취소됨" : Number(r.new_count) === 0 && Number(r.row_count) > 0 ? "전부 중복" : open === null ? "반영됨" : open > 0 ? "정리 안 됨" : "정리 끝";
    return {
      id: Number(r.id),
      source: r.source,
      accountLabel: r.account_label,
      fileName: r.file_name,
      rowCount: Number(r.row_count),
      newCount: Number(r.new_count),
      dupCount: Number(r.dup_count),
      periodFrom: r.pf,
      periodTo: r.pt,
      status: r.status,
      at: r.at,
      by: r.by,
      open,
      openHref: hrefOf(r.source, r.pt ? r.pt.slice(0, 7) : null),
      note,
    };
  });
}

/* ============================================================
 * ④ 줄로 파일 찾기 — 「이 입금이 어느 파일에서 왔지?」
 * ========================================================== */
export interface LineHit {
  kind: "통장" | "법인카드" | "계산서" | "카드승인" | "포스";
  /** YYYY-MM-DD */
  d: string;
  text: string;
  amount: number;
  /** 정리 상태 — 표가 상태를 가진 것만 */
  status: string | null;
  upload: { id: number; source: string; fileName: string; at: string; status: string } | null;
}

export async function findUploadOfLine(qRaw: string): Promise<{ hits: LineHit[]; hint: string | null }> {
  const q = qRaw.trim();
  if (q.length < 2) return { hits: [], hint: "적요 두 글자나 금액을 넣어 주세요" };
  const amt = /^[\d,]+$/.test(q) ? Number(q.replace(/,/g, "")) : null;
  const like = "%" + q.replace(/\s+/g, "%") + "%";
  const up = sql`u.id up_id, u.source up_source, u.file_name up_file, to_char(u.created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') up_at, u.status up_status`;
  type Raw = {
    d: string; text: string; amount: number; status: string | null;
    up_id: number | null; up_source: string | null; up_file: string | null; up_at: string | null; up_status: string | null;
  };
  const toHit = (kind: LineHit["kind"]) => (r: Raw): LineHit => ({
    kind,
    d: r.d,
    text: r.text,
    amount: Number(r.amount),
    status: r.status,
    upload: r.up_id ? { id: Number(r.up_id), source: r.up_source!, fileName: r.up_file!, at: r.up_at!, status: r.up_status! } : null,
  });
  const hits: LineHit[] = [];

  /* 🔴 질의는 하나씩 차례로 (풀 max 3) · LIMIT 각 20 */
  const cash = await db.execute<Raw & { source: string }>(sql`
    SELECT x.source, to_char(x.occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d,
           x.description text, GREATEST(x.in_amount, x.out_amount) amount,
           CASE WHEN x.category IS NOT NULL THEN '분류됨' ELSE x.recon_status END status, ${up}
    FROM cash_txn x LEFT JOIN fin_upload u ON u.id = x.upload_id
    WHERE x.is_active AND (x.description ILIKE ${like}
      ${amt !== null ? sql`OR x.in_amount = ${amt} OR x.out_amount = ${amt}` : sql``})
    ORDER BY x.occurred_at DESC LIMIT 20
  `);
  for (const r of cash) hits.push(toHit(r.source === "법인카드" ? "법인카드" : "통장")(r));

  const tax = await db.execute<Raw & { direction: string }>(sql`
    SELECT t.direction, t.write_date::text d, t.counterparty_name || ' (' || t.direction || ')' text, t.total amount,
           t.recon_status status, ${up}
    FROM tax_invoice t LEFT JOIN fin_upload u ON u.id = t.upload_id
    WHERE t.is_active AND (t.counterparty_name ILIKE ${like} OR COALESCE(t.item_summary, '') ILIKE ${like}
      ${amt !== null ? sql`OR t.total = ${amt} OR t.supply_amount = ${amt}` : sql``})
    ORDER BY t.write_date DESC LIMIT 20
  `);
  for (const r of tax) hits.push(toHit("계산서")(r));

  if (amt !== null) {
    const card = await db.execute<Raw>(sql`
      SELECT to_char(c.approved_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d,
             COALESCE(c.card_co, '') || ' ' || COALESCE(c.card_no_masked, '') || (CASE WHEN c.is_cancel THEN ' (취소)' ELSE '' END) text,
             c.amount, NULL::text status, ${up}
      FROM card_txn c LEFT JOIN fin_upload u ON u.id = c.upload_id
      WHERE c.is_active AND c.amount = ${amt} ORDER BY c.approved_at DESC LIMIT 20
    `);
    for (const r of card) hits.push(toHit("카드승인")(r));
    const pos = await db.execute<Raw>(sql`
      SELECT p.day::text d, COALESCE(p.method, '') || ' ' || COALESCE(p.card_co, '') || (CASE WHEN p.is_cancel THEN ' (취소)' ELSE '' END) text,
             p.amount, NULL::text status, ${up}
      FROM pos_txn p LEFT JOIN fin_upload u ON u.id = p.upload_id
      WHERE p.is_active AND p.amount = ${amt} ORDER BY p.day DESC LIMIT 20
    `);
    for (const r of pos) hits.push(toHit("포스")(r));
  }

  hits.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  return { hits, hint: hits.length === 0 ? "걸리는 줄이 없습니다 — 아직 안 올린 자료일 수 있습니다" : null };
}
