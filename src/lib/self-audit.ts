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
 *   결과는 audit_run 표에 쌓이고 /finance 상단 배너가 최신 결과를 보여준다.
 *   실행: 매일 07:30 KST Vercel Cron + /finance 「지금 검사」 단추.
 *
 * 🔴 "use server" 아님 — 조회·기록만. 부르는 쪽(cron 라우트·서버 액션)이 권한을 진다.
 *    검사마다 질의 1~2개, LIMIT — 서버리스 60초 안에 넉넉히 끝난다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { kstToday } from "./ym";

export interface AuditItem {
  /** 'A1'~'A4' — 검사 번호 */
  code: string;
  title: string;
  /** 걸린 건수 */
  n: number;
  /** 표본 설명 (최대 6줄) */
  samples: string[];
  /** 고치러 갈 화면 */
  href: string;
}

export interface AuditRun {
  id: number;
  at: string;
  itemCount: number;
  items: AuditItem[];
}

/* ============================================================
 * ⭐ A1 정본 — 계좌이체 판매인데 이체입금 자국이 없는 것 + 이을 만한 입금 후보.
 *    감사(A1)·홈 인박스·돈 추적 화면이 **같은 함수**를 쓴다 (판정 재작성 금지 원칙).
 *    후보 규칙: 금액 정확·미사용·−3~+5일 (money-trace 와 동일).
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
  const rows = await db.execute<{ id: number; quote_no: string; d: string; total: number; who: string }>(sql`
    SELECT q.id, q.quote_no,
           to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') d,
           q.total_amount total, COALESCE(q.supplier_name, c.name, '?') who
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND q.payment_method IN ('계좌이체', '혼합') AND q.total_amount > 0
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${range.from}::date
      ${range.to ? sql`AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${range.to}::date` : sql``}
      AND NOT EXISTS (SELECT 1 FROM recon_match m
        WHERE m.kind = '이체입금' AND m.ref_table = 'quote' AND m.ref_id = q.id)
      /* ⭐ 계산서 경유로 돈이 이미 확인된 판매는 미연결이 아니다 (사장님 제보 2026-09-04
         — 신형호 Q26-0903-015: 돈은 신아건설(주) 이름으로 왔고 그 입금은 매출 계산서와
         확정으로 이어져 있는데, A1 이 「이체입금」 직결만 보고 계속 띄웠다.
         판매 ↔ 매출계산서 ↔ 통장입금 사슬이 recon_match 에 완성돼 있으면 확인 끝. */
      AND NOT EXISTS (SELECT 1 FROM recon_match mq
        JOIN recon_match mc ON mc.kind = '매출계산서' AND mc.src_table = 'tax_invoice'
          AND mc.src_id = mq.src_id AND mc.ref_table = 'cash_txn' AND mc.status = '확정'
        WHERE mq.kind = '매출계산서' AND mq.src_table = 'tax_invoice'
          AND mq.ref_table = 'quote' AND mq.ref_id = q.id AND mq.status = '확정')
    ORDER BY 3 DESC LIMIT 60
  `);
  const out: A1Row[] = [];
  for (const r of rows) {
    const cand = await db.execute<{ id: number; d: string; description: string }>(sql`
      SELECT x.id, to_char(x.occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') d, x.description
      FROM cash_txn x
      WHERE x.source = '통장' AND x.is_active AND x.in_amount = ${Number(r.total)}
        AND x.recon_status IN ('미대조', '제안') AND x.category IS NULL
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
      cand: cand.length === 1 ? { cashTxnId: Number(cand[0].id), label: `${cand[0].d} 입금 「${cand[0].description.slice(0, 24)}」` } : null,
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
      // 추적 화면 기본이 이 목록이다 — 눌러서 그 자리에서 처리 (2026-09-02)
      href: "/finance/trace",
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
      title: "「확정」인데 연결 자국도 사유도 없는 줄",
      n: a2n,
      samples: [`계산서 ${a2t[0].n}장 · 통장 줄 ${a2c[0].n}건 — 무엇으로 확정됐는지 알 수 없습니다`],
      href: "/finance/tax?view=money",
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
      title: "지급 연결 자국이 지급 기록보다 큰 거래처 (기록이 어긋남)",
      n: a3bad.length,
      samples: a3bad.slice(0, 6).map((r) => `${r.supplier} — 자국 ${Number(r.marks).toLocaleString()} > 지급 ${Number(r.pays).toLocaleString()}`),
      href: "/finance/payables",
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
      href: "/finance",
    });
  }

  return items;
}

/** 검사를 돌리고 결과를 남긴다 — cron 과 「지금 검사」 단추가 같이 쓴다 */
export async function runAndSaveAudit(): Promise<{ items: AuditItem[] }> {
  const items = await runSelfAudit();
  await db.execute(sql`
    INSERT INTO audit_run (item_count, items) VALUES (${items.length}, ${JSON.stringify(items)}::jsonb)
  `);
  return { items };
}

/** 최신 결과 — /finance 배너 */
export async function latestAuditRun(): Promise<AuditRun | null> {
  const [r] = await db.execute<{ id: number; at: string; item_count: number; items: unknown }>(sql`
    SELECT id, to_char(at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at, item_count, items
    FROM audit_run ORDER BY id DESC LIMIT 1
  `);
  if (!r) return null;
  return {
    id: Number(r.id),
    at: r.at,
    itemCount: Number(r.item_count),
    items: (typeof r.items === "string" ? JSON.parse(r.items) : r.items) as AuditItem[],
  };
}
