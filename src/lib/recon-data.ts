/**
 * ⭐ 세금계산서 대조 — 후보 계산 (ERP 2단계, 2026-08-24)
 *
 *   미대조 세금계산서마다 「어느 매입/판매와 같은 건인가」 후보를 만든다.
 *   원칙(계획서): 자동확정 = ①상대 식별 확실 ②금액 정확 일치 ③후보 유일 — 셋 다일 때만.
 *   그 외는 전부 '제안'으로 사람이 확정한다 (MARS 에서 배운 「확실하지 않으면 사람에게」).
 *
 * 🔴 "use server" 아님 — 화면(페이지)이 권한 확인 후 부르고, 확정은 recon.ts 가 한다.
 * 🔴 질의 순차 · LIMIT — 자료가 작아(월 수십 건) JS 에서 맞춘다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const norm = (s: string | null | undefined): string =>
  String(s ?? "")
    .replace(/㈜|\(주\)|주식회사|\s/g, "")
    .toLowerCase();

export interface TaxRow {
  id: number;
  direction: "매출" | "매입";
  approvalNo: string;
  writeDate: string;
  counterBizNo: string;
  counterName: string;
  supplyAmount: number;
  vat: number;
  total: number;
  itemSummary: string | null;
  reconStatus: string;
}

export interface CandidateRef {
  table: "purchase_invoice" | "quote";
  id: number;
  /** 화면에 보일 한 줄 — 「INV123 · 미쉐린 · 5,261,454원 (08-12)」 */
  label: string;
  date: string | null;
  amount: number;
}

export interface TaxSuggestion {
  inv: TaxRow;
  /** 자동확정 가능 — 정확 일치 + 후보 유일 */
  auto: CandidateRef | null;
  /** 같은 달 묶음 — 합계가 계산서와 정확히 일치 */
  bundle: CandidateRef[] | null;
  /** 그 외 후보 (사람이 골라 확정) */
  candidates: CandidateRef[];
  /** biz_no 로 이어졌거나 이름으로 짐작한 거래처 */
  supplierId: number | null;
  supplierName: string | null;
  /** 확정할 때 이 거래처에 사업자번호를 기억시킬 수 있다 */
  learnable: boolean;
}

export interface TaxReconData {
  open: TaxSuggestion[];
  autoCount: number;
  doneCount: number;
  ignoredCount: number;
}

const won = (n: number) => n.toLocaleString("ko-KR");
const sameMonth = (a: string | null, b: string) => !!a && a.slice(0, 7) === b.slice(0, 7);
const dayDiff = (a: string | null, b: string): number =>
  a ? Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000) : 999;

export async function taxReconData(): Promise<TaxReconData> {
  // ① 열린 세금계산서 (순차)
  const invs = await db.execute<{
    id: number; direction: "매출" | "매입"; approval_no: string; write_date: string;
    counterparty_biz_no: string; counterparty_name: string;
    supply_amount: number; vat: number; total: number; item_summary: string | null; recon_status: string;
  }>(sql`
    SELECT id, direction, approval_no, to_char(write_date, 'YYYY-MM-DD') write_date,
           counterparty_biz_no, counterparty_name, supply_amount, vat, total, item_summary, recon_status
    FROM tax_invoice
    WHERE is_active AND recon_status IN ('미대조', '제안')
    ORDER BY write_date DESC, id DESC LIMIT 120
  `);

  const counts = await db.execute<{ s: string; n: number }>(sql`
    SELECT recon_status s, count(*)::int n FROM tax_invoice WHERE is_active GROUP BY 1 LIMIT 5
  `);
  const doneCount = counts.find((c) => c.s === "확정")?.n ?? 0;
  const ignoredCount = counts.find((c) => c.s === "무시")?.n ?? 0;

  // ② 거래처 (biz_no 학습 사전)
  const suppliers = await db.execute<{ id: number; name: string; biz_no: string | null }>(sql`
    SELECT id, name, biz_no FROM supplier WHERE is_active ORDER BY id LIMIT 200
  `);

  // ③ 매입 인보이스 (앱의 매입 기록)
  const purchases = await db.execute<{
    id: number; supplier: string; invoice_no: string; d: string | null; total: number | null;
  }>(sql`
    SELECT id, supplier, invoice_no,
           COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) d,
           total
    FROM purchase_invoice WHERE status <> '취소' ORDER BY id DESC LIMIT 300
  `);

  // ④ 거래처 판매 (매출 계산서의 상대)
  const quotes = await db.execute<{ id: number; quote_no: string; supplier_name: string; d: string; total: number }>(sql`
    SELECT id, quote_no, supplier_name, to_char(COALESCE(work_date, created_at::date), 'YYYY-MM-DD') d,
           total_amount total
    FROM quote WHERE status = '성사' AND supplier_name IS NOT NULL
    ORDER BY id DESC LIMIT 400
  `);

  // ⑤ 이미 연결된 것 — 같은 매입/판매를 두 계산서에 잇지 않는다
  const linked = await db.execute<{ ref_table: string; ref_id: number }>(sql`
    SELECT ref_table, ref_id FROM recon_match
    WHERE kind IN ('매입계산서', '매출계산서') LIMIT 1000
  `);
  const linkedSet = new Set(linked.map((l) => `${l.ref_table}|${l.ref_id}`));
  // 0원·금액 없는 수기 매입은 후보에서 뺀다 — 이어 봐야 맞을 수 없다
  const freePurchases = purchases.filter((p) => Number(p.total) > 0 && !linkedSet.has(`purchase_invoice|${p.id}`));
  const freeQuotes = quotes.filter((q) => !linkedSet.has(`quote|${q.id}`));

  const open: TaxSuggestion[] = [];
  for (const r of invs) {
    const inv: TaxRow = {
      id: Number(r.id),
      direction: r.direction,
      approvalNo: r.approval_no,
      writeDate: r.write_date,
      counterBizNo: r.counterparty_biz_no,
      counterName: r.counterparty_name,
      supplyAmount: Number(r.supply_amount),
      vat: Number(r.vat),
      total: Number(r.total),
      itemSummary: r.item_summary,
      reconStatus: r.recon_status,
    };

    if (inv.direction === "매입") {
      // 거래처 찾기 — ① 사업자번호 학습분 ② 이름 유사
      const byBiz = suppliers.find((s) => s.biz_no && s.biz_no.replace(/\D/g, "") === inv.counterBizNo);
      const byName =
        byBiz ??
        suppliers.find((s) => {
          const a = norm(s.name);
          const b = norm(inv.counterName);
          return a.length >= 2 && (b.includes(a) || a.includes(b));
        }) ??
        null;
      const sup = byName;
      const pool = sup
        ? freePurchases.filter((p) => norm(p.supplier) === norm(sup.name) || norm(p.supplier) === norm(inv.counterName))
        : freePurchases.filter((p) => norm(p.supplier) === norm(inv.counterName));
      const toRef = (p: (typeof pool)[number]): CandidateRef => ({
        table: "purchase_invoice",
        id: Number(p.id),
        label: `${p.invoice_no} · ${p.supplier} · ${won(Number(p.total))}원${p.d ? ` (${p.d.slice(5)})` : ""}`,
        date: p.d,
        amount: Number(p.total),
      });

      const exact = pool.filter((p) => Number(p.total) === inv.total && dayDiff(p.d, inv.writeDate) <= 7);
      // 자동확정은 사업자번호로 **확실히** 이어진 거래처일 때만 (이름 짐작만으로는 제안까지)
      const auto = byBiz && exact.length === 1 ? toRef(exact[0]) : null;

      const monthPool = pool.filter((p) => sameMonth(p.d, inv.writeDate));
      const monthSum = monthPool.reduce((s, p) => s + Number(p.total), 0);
      const bundle = !auto && monthPool.length > 1 && monthSum === inv.total ? monthPool.map(toRef) : null;

      const near = pool
        .filter((p) => sameMonth(p.d, inv.writeDate) || Math.abs(Number(p.total) - inv.total) <= Math.max(1000, inv.total * 0.01))
        .slice(0, 6)
        .map(toRef);

      open.push({
        inv,
        auto,
        bundle,
        candidates: auto ? [] : near,
        supplierId: sup ? Number(sup.id) : null,
        supplierName: sup?.name ?? null,
        learnable: !!sup && !sup.biz_no,
      });
    } else {
      // 매출 — 상대 = 거래처 판매 (supplier_name)
      const pool = freeQuotes.filter((q) => {
        const a = norm(q.supplier_name);
        const b = norm(inv.counterName);
        return a.length >= 2 && (b.includes(a) || a.includes(b));
      });
      const toRef = (q: (typeof pool)[number]): CandidateRef => ({
        table: "quote",
        id: Number(q.id),
        label: `${q.quote_no} · ${q.supplier_name} · ${won(Number(q.total))}원 (${q.d.slice(5)})`,
        date: q.d,
        amount: Number(q.total),
      });
      const exact = pool.filter((q) => Number(q.total) === inv.total && sameMonth(q.d, inv.writeDate));
      // 매출 자동확정: 이름이 이어진 거래처 판매 + 금액 정확 + 유일
      const auto = exact.length === 1 ? toRef(exact[0]) : null;
      const monthPool = pool.filter((q) => sameMonth(q.d, inv.writeDate));
      const monthSum = monthPool.reduce((s, q) => s + Number(q.total), 0);
      const bundle = !auto && monthPool.length > 1 && monthSum === inv.total ? monthPool.map(toRef) : null;
      open.push({
        inv,
        auto,
        bundle,
        candidates: auto ? [] : monthPool.slice(0, 6).map(toRef),
        supplierId: null,
        supplierName: pool[0]?.supplier_name ?? null,
        learnable: false,
      });
    }
  }

  return { open, autoCount: open.filter((s) => s.auto).length, doneCount, ignoredCount };
}
