/**
 * ⭐ 매일 자동 감사 — 불변식을 기계가 지킨다 (돈관리 근본책 1단계-B, 사장님 승인 2026-08-31)
 *
 *   "하나 고치면 또 하나 망가지는듯" — 어긋남을 사람 눈이 아니라 기계가 매일 잡는다.
 *   2026-08-31 하루 동안 실제로 터진 사고 유형을 그대로 검사로 만들었다:
 *
 *   ① 계좌이체 판매인데 입금과 안 이어짐 (미광전력 유형 — 실측 25건은 동액 입금 자체가
 *      없었다 = 숨은 미수금 신호)
 *   ② 「확정」인데 근거 없음 — 계산서/통장 줄이 확정인데 연결 자국도 사유도 없다
 *      (강남세차장 월정산 도장 유형)
 *   ③ 지급 기록과 연결 자국이 어긋남 — 자국 합이 지급 합보다 크다 (되돌리기 반쪽 실패·
 *      스크립트 사고 유형. 지급>자국은 정상 — 도장·손 지급은 자국이 없다)
 *   ④ 총액 불변식 — 판매 총액 ≠ 품목 줄 합 · 매입 과지급
 *
 *   결과는 audit_run 표에 쌓인다. 보여 주는 곳(5단계 2026-09-13 — 첫 화면 배너·추적 화면은 없앴다):
 *   A1 은 첫 화면 「오늘」 칸(today-brief → a1OpenTransfers, 실시간), A2~A4 는 장부 마감 체크리스트
 *   한 줄(month-close.auditCheck — latestAuditRun + auditFingerprint 로 낡았는지 본다).
 *   실행: 매일 07:30 KST Vercel Cron + 장부 마감 목록 「지금 다시 검사」(trace-actions.runAuditNow).
 *
 * 🔴 "use server" 아님 — 조회·기록만. 부르는 쪽(cron 라우트·서버 액션)이 권한을 진다.
 *    검사마다 질의 1~2개, LIMIT — 서버리스 60초 안에 넉넉히 끝난다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { taxChainCoveredSql } from "./deposit-core";
import { kstToday } from "./ym";

export interface AuditItem {
  /** 'A1'~'A4' — 검사 번호 */
  code: string;
  title: string;
  /** 걸린 건수 */
  n: number;
  /** 표본 설명 (최대 6줄) */
  samples: string[];
  /** 고치러 갈 화면 — 그릴 때는 저장본 대신 AUDIT_HREF[code] 를 쓴다(아래 참조) */
  href: string;
}

/**
 * ⭐ 검사 번호 → 고치러 갈 화면 (5단계, 2026-09-13)
 *
 *   저장된 audit_run.items JSON 에는 없앤 추적 화면·옛 계산서 보기(?view=money) 주소가
 *   href 로 그대로 남아 있다. 저장본을 고쳐 쓰지 않고 화면(장부 #audit, 갈래 C)이 이 표로 그린다 —
 *   화면이 또 바뀌어도 표 한 곳만 고치면 된다. runSelfAudit 의 각 항목도 이 표를 참조한다.
 *   A1 → 첫 화면 오늘 칸, A2 → 계산서, A3 → 미지급, A4 → 자료 수리라 첫 화면.
 */
export const AUDIT_HREF: Record<string, string> = {
  A1: "/finance",
  A2: "/finance/tax",
  A3: "/finance/payables",
  A4: "/finance",
};

export interface AuditRun {
  id: number;
  at: string;
  /** 검사한 지 몇 분 지났나 — 배너가 「○○ 기준(스냅샷)」임을 눈에 보이게 (2026-09-10) */
  ageMin: number;
  itemCount: number;
  items: AuditItem[];
}

/* ============================================================
 * ⭐ A1 정본 — 계좌이체 판매인데 이체입금 자국이 없는 것 + 이을 만한 입금 후보.
 *    감사(A1)·첫 화면 「오늘」 칸(today-brief)이 **같은 함수**를 쓴다 (판정 재작성 금지 원칙).
 *    인박스·추적 화면도 같은 함수를 썼는데 5단계(2026-09-13)에 없앴다.
 *    후보 규칙: 금액 정확·미사용·−3~+5일.
 * ========================================================== */
export interface A1Row {
  quoteId: number;
  quoteNo: string;
  /** YYYY-MM-DD */
  d: string;
  total: number;
  who: string;
  candCount: number;
  /** 후보가 정확히 1건일 때만 — 그 자리 ⚡잇기용 */
  cand: { cashTxnId: number; label: string } | null;
}

export async function a1OpenTransfers(range: { from: string; to?: string }): Promise<A1Row[]> {
  /* 🔴 혼합은 **계좌이체 몫만** (사장님 제보 2026-09-11 — 김명현 카드 88만 + 현금 8만이 「안 들어온 이체 96만」으로
     떴다). 전에는 혼합 판매를 통째로 이체 대기로 세어, 이체가 한 푼도 없는 판매까지 올라왔다. */
  const rows = await db.execute<{ id: number; quote_no: string; d: string; total: number; who: string }>(sql`
    SELECT q.id, q.quote_no,
           to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') d,
           x.expected total, COALESCE(q.supplier_name, c.name, '?') who
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN q.payment_method = '계좌이체' THEN q.total_amount
                  ELSE COALESCE((SELECT SUM(p.amount)::int FROM quote_payment p WHERE p.quote_id = q.id AND p.method = '계좌이체'), 0)
             END AS expected
    ) x
    WHERE q.status = '성사' AND q.payment_method IN ('계좌이체', '혼합') AND q.total_amount > 0 AND x.expected > 0
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${range.from}::date
      ${range.to ? sql`AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${range.to}::date` : sql``}
      AND NOT EXISTS (SELECT 1 FROM recon_match m
        WHERE m.kind = '이체입금' AND m.ref_table = 'quote' AND m.ref_id = q.id)
      /* ⭐ 계산서 경유로 돈이 이미 확인된 판매는 미연결이 아니다 (2026-09-04, 정본 조각) */
      AND NOT ${taxChainCoveredSql}
    ORDER BY 3 DESC LIMIT 60
  `);
  const out: A1Row[] = [];
  for (const r of rows) {
    /* ⭐ 「기타입금」으로 정리된 줄도 후보 (사장님 제보 2026-09-11 — 예약금이 판매보다 먼저 들어오면 그때는 짝이 없어
       기타입금으로 넘기게 되고, 판매를 등록한 뒤엔 후보에서 빠져 영영 「안 들어온 이체」로 남았다). 이으면 분류가 풀린다
       (deposit-core.linkDepositToQuoteCore). 연결 자국이 이미 있는 줄은 제외 */
    const cand = await db.execute<{ id: number; d: string; description: string; category: string | null }>(sql`
      SELECT x.id, to_char(x.occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') d, x.description, x.category
      FROM cash_txn x
      WHERE x.source = '통장' AND x.is_active AND x.in_amount = ${Number(r.total)}
        AND ((x.recon_status IN ('미대조', '제안') AND x.category IS NULL)
             OR (x.category IN ('기타입금', '판매입금')
                 AND NOT EXISTS (SELECT 1 FROM recon_match m WHERE m.src_table = 'cash_txn' AND m.src_id = x.id)))
        AND (x.occurred_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN ${r.d}::date - 3 AND ${r.d}::date + 5
      LIMIT 2
    `);
    out.push({
      quoteId: Number(r.id),
      quoteNo: r.quote_no,
      d: r.d,
      total: Number(r.total),
      who: r.who,
      candCount: cand.length,
      cand:
        cand.length === 1
          ? {
              cashTxnId: Number(cand[0].id),
              label: `${cand[0].d} 입금 「${cand[0].description.slice(0, 24)}」${cand[0].category ? ` (${cand[0].category}으로 정리돼 있음 — 이으면 풀림)` : ""}`,
            }
          : null,
    });
  }
  return out;
}

export async function runSelfAudit(): Promise<AuditItem[]> {
  const items: AuditItem[] = [];
  /* 🔴 A1 은 「이번 달」이 아니라 최근 45일 — 달이 바뀌어도 못 받은 돈은 못 받은 돈이다
     (2026-09-01 실측: 9/1 이 되자 8월 미수 26건이 감사에서 사라졌다) */
  const start = new Date(Date.parse(kstToday()) - 45 * 86400000).toISOString().slice(0, 10);

  /* ① 계좌이체 판매인데 이체입금 자국 없음 (미광전력 유형) — 정본 a1OpenTransfers */
  const a1 = await a1OpenTransfers({ from: start });
  if (a1.length > 0) {
    items.push({
      code: "A1",
      title: "계좌이체 판매인데 통장 입금과 안 이어진 것 (최근 45일)",
      n: a1.length,
      samples: a1.slice(0, 6).map((r) =>
        `${r.d.slice(5)} ${r.who} ${r.total.toLocaleString()}원 (${r.quoteNo})${r.candCount > 0 ? " — 이을 만한 입금 있음 ⚡" : " — 동액 입금 없음(미수금·다르게 받았을 수 있음)"}`,
      ),
      // 첫 화면 「오늘 · 안 들어온 이체」가 이 목록이다 — 눌러서 그 자리에서 처리 (5단계, 2026-09-13)
      href: AUDIT_HREF.A1,
    });
  }

  /* ② 「확정」인데 근거 없음 */
  const a2t = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM tax_invoice t
    WHERE t.is_active AND t.recon_status = '확정' AND COALESCE(t.recon_reason, '') = ''
      AND NOT EXISTS (SELECT 1 FROM recon_match m
        WHERE (m.src_table = 'tax_invoice' AND m.src_id = t.id) OR (m.ref_table = 'tax_invoice' AND m.ref_id = t.id))
  `);
  const a2c = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM cash_txn c
    WHERE c.source = '통장' AND c.is_active AND c.recon_status = '확정' AND c.category IS NULL
      AND NOT EXISTS (SELECT 1 FROM recon_match m
        WHERE (m.src_table = 'cash_txn' AND m.src_id = c.id) OR (m.ref_table = 'cash_txn' AND m.ref_id = c.id))
  `);
  const a2n = Number(a2t[0].n) + Number(a2c[0].n);
  if (a2n > 0) {
    items.push({
      code: "A2",
      title: "「대조 완료」인데 대조 내역도 사유도 없는 줄",
      n: a2n,
      samples: [`계산서 ${a2t[0].n}장 · 통장 줄 ${a2c[0].n}건 — 무엇으로 확정됐는지 알 수 없습니다`],
      href: AUDIT_HREF.A2,
    });
  }

  /* ③ 연결 자국 합 > 지급 기록 합 (거래처별) — 되돌리기 반쪽·스크립트 사고 유형 */
  const a3 = await db.execute<{ supplier: string; marks: string; pays: string }>(sql`
    SELECT pi.supplier,
           COALESCE(SUM(m.amount), 0)::bigint marks,
           (SELECT COALESCE(SUM(pp.amount), 0)::bigint FROM purchase_payment pp
             JOIN purchase_invoice x ON x.id = pp.invoice_id WHERE x.supplier = pi.supplier) pays
    FROM recon_match m JOIN purchase_invoice pi ON pi.id = m.ref_id
    WHERE m.kind = '매입지급' AND m.ref_table = 'purchase_invoice' AND m.status = '확정'
    GROUP BY pi.supplier LIMIT 50
  `);
  const a3bad = a3.filter((r) => Number(r.marks) > Number(r.pays));
  if (a3bad.length > 0) {
    items.push({
      code: "A3",
      title: "지급 대조 내역이 지급 기록보다 큰 거래처 (기록이 어긋남)",
      n: a3bad.length,
      samples: a3bad.slice(0, 6).map((r) => `${r.supplier} — 대조 내역 ${Number(r.marks).toLocaleString()} > 지급 ${Number(r.pays).toLocaleString()}`),
      href: AUDIT_HREF.A3,
    });
  }

  /* ④ 총액 불변식 */
  const a4a = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM quote q
    LEFT JOIN (SELECT quote_id, SUM(final_price * qty) s FROM quote_item GROUP BY 1) x ON x.quote_id = q.id
    WHERE q.status = '성사' AND q.total_amount <> COALESCE(x.s, 0)
  `);
  const a4b = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM purchase_invoice pi
    WHERE pi.status <> '취소' AND pi.total IS NOT NULL
      AND COALESCE((SELECT SUM(amount) FROM purchase_payment pp WHERE pp.invoice_id = pi.id), 0) > pi.total
  `);
  const a4n = Number(a4a[0].n) + Number(a4b[0].n);
  if (a4n > 0) {
    items.push({
      code: "A4",
      title: "총액 불변식 어긋남 (판매 총액≠줄 합 · 매입 과지급)",
      n: a4n,
      samples: [`판매 ${a4a[0].n}건 · 매입 과지급 ${a4b[0].n}건 — Claude 에게 알려 주세요 (자료 수리 필요)`],
      href: AUDIT_HREF.A4,
    });
  }

  return items;
}

/**
 * ⭐ 자료의 지문 (2026-09-10) — 검사 결과가 「어떤 자료 상태」에서 찍혔는지.
 *
 *   사진(audit_run)은 아침에 찍히고, 오후에 14건을 정리해도 옛 배너는 아침 숫자를 보여 줬다.
 *   첫 화면 「오늘」 칸은 실시간이라 **같은 건을 두고 화면마다 말이 달랐다.**
 *   자료를 바꾸는 서버 액션이 6개 파일 40개가 넘어 하나하나 갱신을 붙이면 빠뜨린다 —
 *   대신 A1~A4 가 보는 표들의 개수·상태 수·합을 한 줄로 묶어 저장한다. 5단계(2026-09-13)부터는
 *   장부 마감 체크리스트(month-close.auditCheck)가 저장본 지문과 지금 지문을 견줘 「자료가 바뀜 —
 *   다시 검사」로만 알리고, 다시 찍는 건 사람이 「지금 다시 검사」를 눌렀을 때와 아침 cron 뿐이다
 *   (첫 화면을 열 때마다 몰래 다시 찍어 저장하던 함수는 없앴다 — GET 중 쓰기 금지).
 *   삭제·되돌리기·올리기·상태 바꿈이 전부 개수나 합에 잡힌다. 날짜가 들어 있어 아침 cron 이
 *   죽어도 하루 한 번은 낡은 것으로 표시된다. 질의 하나, 수 ms — 매 화면마다 불러도 된다.
 */
export async function auditFingerprint(): Promise<string> {
  const [r] = await db.execute<{ fp: string }>(sql`
    SELECT concat_ws('|',
      (SELECT count(*) || '/' || count(*) FILTER (WHERE status = '확정') || '/' || COALESCE(max(id), 0) FROM recon_match),
      (SELECT count(*) || '/' || count(*) FILTER (WHERE recon_status = '확정') || '/' || count(*) FILTER (WHERE category IS NOT NULL)
              || '/' || count(*) FILTER (WHERE is_active) FROM cash_txn),
      (SELECT count(*) || '/' || count(*) FILTER (WHERE recon_status = '확정') || '/' || count(*) FILTER (WHERE COALESCE(recon_reason, '') <> '')
              || '/' || count(*) FILTER (WHERE is_active) FROM tax_invoice),
      (SELECT count(*) FROM pos_note),
      (SELECT count(*) || '/' || COALESCE(sum(amount), 0) FROM purchase_payment),
      (SELECT count(*) || '/' || COALESCE(sum(total_amount), 0) FROM quote WHERE status = '성사'),
      to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
    ) fp
  `);
  return r?.fp ?? "";
}

/** 검사를 돌리고 결과를 남긴다 — cron 과 장부 마감 목록 「지금 다시 검사」(trace-actions.runAuditNow)가 같이 쓴다 */
export async function runAndSaveAudit(): Promise<{ items: AuditItem[] }> {
  const fp = await auditFingerprint();
  const items = await runSelfAudit();
  await db.execute(sql`
    INSERT INTO audit_run (item_count, items, fingerprint)
    VALUES (${items.length}, ${JSON.stringify(items)}::jsonb, ${fp})
  `);
  return { items };
}

/** 최신 결과 — 저장된 그대로 (지문 포함). 장부 마감 체크리스트(month-close)가 auditFingerprint 와 견줘 낡았는지 본다 */
export async function latestAuditRun(): Promise<(AuditRun & { fingerprint: string | null }) | null> {
  const [r] = await db.execute<{
    id: number; at: string; age_min: number; item_count: number; items: unknown; fingerprint: string | null;
  }>(sql`
    SELECT id, to_char(at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at,
           (EXTRACT(EPOCH FROM (now() - at)) / 60)::int age_min, item_count, items, fingerprint
    FROM audit_run ORDER BY id DESC LIMIT 1
  `);
  if (!r) return null;
  return {
    id: Number(r.id),
    at: r.at,
    ageMin: Math.max(0, Number(r.age_min)),
    itemCount: Number(r.item_count),
    items: (typeof r.items === "string" ? JSON.parse(r.items) : r.items) as AuditItem[],
    fingerprint: r.fingerprint ?? null,
  };
}
