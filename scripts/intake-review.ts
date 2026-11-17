/**
 * ⭐ 지난 메일 일괄 검토 보고서 (D-41 보강, 2026-11-17) — 구글 스크립트 backfill() 이 「검토」로 보낸 것을 장부와 대조
 *
 *   npx tsx scripts/intake-review.ts                 보고서만 (읽기 전용) → 화면 요약 + tyremore-data\검증\intake-review-날짜.xlsx
 *   npx tsx scripts/intake-review.ts --apply 카드     검산 통과한 카드 명세서를 법인카드 장부에 반영 (겹침 거름)
 *   npx tsx scripts/intake-review.ts --apply 홈택스   홈택스 메일 계산서를 계산서 장부에 반영 (승인번호로 중복 막음)
 *
 *   대조
 *     홈택스 메일   ↔ tax_invoice.approval_no   — 장부에 있고 공급가·세액·합계가 원 단위로 같은가 (해독기 검증)
 *     대행 메일     ↔ tax_invoice (이름·작성일자·공급가) — 짝 없으면 「확인 필요」(전송 전·수신 승인 대기·역발행 미승인)
 *     미쉐린 PDF    ↔ purchase_invoice.invoice_no — 장부에 없으면 목록만 (🔴 자동 입고 안 함, 2026-08-02 사고)
 *     카드 명세서   — 검산 · 겹침(이미 있는 줄) · 결제일 통장 출금(신한출금 등)이 명세서 총액과 같은가
 *
 * 🔴 --apply 없이는 아무것도 쓰지 않는다. 반영은 배치 단위라 화면 「최근 한 일」·배치 취소로 되돌릴 수 있다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import path from "node:path";
import { mkdir } from "node:fs/promises";

const argv = process.argv.slice(2);
const applyKind = argv.includes("--apply") ? argv[argv.indexOf("--apply") + 1] : null;
const OUT_DIR = process.env.REVIEW_OUT_DIR ?? path.resolve(process.cwd(), "..", "tyremore-data", "검증");

type Row = { id: number; at: string; sender: string | null; subject: string | null; file_name: string | null; status: string; result: string | null; parsed: Record<string, unknown> | null };

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { samePartyName } = await import("../src/lib/recon-data");
  const { matchNoticeToTaxInvoice } = await import("../src/lib/tax-mail-notice");
  const XLSX = await import("xlsx");

  const rows = (await db.execute<Row>(sql`
    SELECT id, to_char(received_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS at, sender, subject, file_name, status, result, parsed
    FROM intake_log
    WHERE kind = '메일' AND (status = '검토' OR parsed->>'kind' = 'notice')
    ORDER BY id
  `)).map((r) => ({ ...r, id: Number(r.id) }));
  const of = (k: string) => rows.filter((r) => r.parsed?.kind === k);

  /* ── 반영 ─────────────────────────────────────────────── */
  if (applyKind) {
    const { applyIntakeRow } = await import("../src/lib/intake");
    const target =
      applyKind === "카드" ? of("card").filter((r) => r.status === "검토" && r.parsed?.ok === true)
      : applyKind === "홈택스" ? of("tax").filter((r) => r.status === "검토")
      : [];
    if (target.length === 0) {
      console.log(`반영할 것이 없습니다 (--apply 카드 | 홈택스)`);
    }
    for (const r of target) {
      const o = await applyIntakeRow(r.id);
      console.log(`  #${r.id} ${o.status} — ${o.result}`);
    }
    process.exit(0);
  }

  /* ── 홈택스 메일 ───────────────────────────────────────── */
  const tax = of("tax");
  const taxRows: Record<string, unknown>[] = [];
  for (const r of tax) {
    const p = r.parsed as { approvalNo: string; direction: string; counterName: string; writeDate: string; supplyAmount: number; vat: number; total: number };
    const [t] = await db.execute<{ supply_amount: number; vat: number; total: number }>(sql`
      SELECT supply_amount, vat, total FROM tax_invoice WHERE approval_no = ${p.approvalNo} AND is_active
    `);
    const verdict = !t ? "장부에 없음" : t.supply_amount === p.supplyAmount && t.vat === p.vat && t.total === p.total ? "일치" : "금액 다름";
    taxRows.push({ 판정: verdict, 승인번호: p.approvalNo, 구분: p.direction, 상대: p.counterName, 작성일: p.writeDate, 공급가: p.supplyAmount, 세액: p.vat, 합계: p.total, 기록: r.id });
  }

  /* ── 대행 메일 (도착 알림) ─────────────────────────────── */
  type Notice = import("../src/lib/tax-mail-notice").TaxMailNotice;
  const notices = of("notice").map((r) => ({ r, n: (r.parsed as { notice: Notice }).notice }));
  const dates = notices.map((x) => x.n.writeDate).filter(Boolean).sort() as string[];
  const book = dates.length
    ? (await db.execute<{ id: number; approval_no: string; direction: "매입" | "매출"; write_date: string; counterparty_name: string; supply_amount: number }>(sql`
        SELECT id, approval_no, direction, write_date::text, counterparty_name, supply_amount FROM tax_invoice
        WHERE is_active AND write_date BETWEEN (${dates[0]}::date - 10) AND (${dates[dates.length - 1]}::date + 10)
      `)).map((t) => ({ id: Number(t.id), approvalNo: t.approval_no, direction: t.direction, writeDate: t.write_date, counterName: t.counterparty_name, supplyAmount: t.supply_amount }))
    : [];
  const noticeRows = notices.map(({ r, n }) => {
    const m = matchNoticeToTaxInvoice(n, book, (a, b) => samePartyName(a, b));
    return {
      판정: n.kind === "역발행요청" ? "역발행 요청 — 직접 확인" : m ? "홈택스에 있음" : "확인 필요",
      대행사: n.vendor, 구분: n.kind, 공급자: n.supplier, 작성일: n.writeDate, 공급가: n.supplyAmount, 세액: n.vat, 품목: n.item,
      홈택스승인번호: m?.approvalNo ?? "", 기록: r.id,
    };
  }).sort((a, b) => (a.판정 === "확인 필요" ? -1 : 0) - (b.판정 === "확인 필요" ? -1 : 0));

  /* ── 미쉐린 인보이스 ──────────────────────────────────── */
  const invRows: Record<string, unknown>[] = [];
  for (const r of of("invoice")) {
    for (const i of (r.parsed as { invoices: { no: string; supplier: string; issuedAt: string | null; total: number | null; qty: number | null }[] }).invoices) {
      const [p] = await db.execute<{ total: number; status: string }>(sql`SELECT total, status FROM purchase_invoice WHERE invoice_no = ${i.no}`);
      invRows.push({ 판정: !p ? "장부에 없음" : p.total === i.total ? "일치" : "금액 다름", 인보이스: i.no, 거래처: i.supplier, 발행일: i.issuedAt, 합계: i.total, 수량: i.qty, 장부상태: p?.status ?? "", 기록: r.id });
    }
  }

  /* ── 카드 명세서 ──────────────────────────────────────── */
  const cardRows: Record<string, unknown>[] = [];
  for (const r of of("card")) {
    const p = r.parsed as { card: string; label: string; periodFrom: string; periodTo: string; payDate: string | null; statementTotal: number | null; rows: number; ok: boolean; checks: string[]; newRows?: number; overlapRows?: number };
    let paid = "";
    if (p.payDate && p.statementTotal) {
      const hit = await db.execute<{ account_label: string; d: string }>(sql`
        SELECT account_label, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') AS d FROM cash_txn
        WHERE is_active AND source = '통장' AND out_amount = ${p.statementTotal}
          AND occurred_at BETWEEN ((${p.payDate}::date - 1)::timestamp AT TIME ZONE 'Asia/Seoul')
                              AND ((${p.payDate}::date + 4)::timestamp AT TIME ZONE 'Asia/Seoul')
        LIMIT 3
      `);
      paid = hit.length ? hit.map((h) => `${h.account_label} ${h.d}`).join(", ") : "통장에서 못 찾음(통장 엑셀 올린 뒤 다시)";
    }
    cardRows.push({ 판정: p.ok ? "검산 통과" : "검산 실패", 카드: p.card, 계정: p.label, 이용기간: `${p.periodFrom}~${p.periodTo}`, 결제일: p.payDate, 총액: p.statementTotal, 줄: p.rows, 새줄: p.newRows ?? "", 겹침: p.overlapRows ?? "", 통장출금: paid, 메모: p.checks.join(" / "), 기록: r.id });
  }

  /* ── 출력 ─────────────────────────────────────────────── */
  const count = (xs: Record<string, unknown>[], v: string) => xs.filter((x) => x.판정 === v).length;
  console.log(`홈택스 메일 ${taxRows.length}통 — 일치 ${count(taxRows, "일치")} · 금액 다름 ${count(taxRows, "금액 다름")} · 장부에 없음 ${count(taxRows, "장부에 없음")}`);
  console.log(`대행 메일   ${noticeRows.length}통 — 홈택스에 있음 ${count(noticeRows, "홈택스에 있음")} · ⚠️ 확인 필요 ${count(noticeRows, "확인 필요")} · 역발행 ${count(noticeRows, "역발행 요청 — 직접 확인")}`);
  console.log(`미쉐린      ${invRows.length}건 — 일치 ${count(invRows, "일치")} · 금액 다름 ${count(invRows, "금액 다름")} · 장부에 없음 ${count(invRows, "장부에 없음")}`);
  console.log(`카드 명세서 ${cardRows.length}통 — 검산 통과 ${count(cardRows, "검산 통과")} · 검산 실패 ${count(cardRows, "검산 실패")}`);
  for (const c of cardRows) console.log(`  · ${c.카드} ${c.이용기간} 총액 ${Number(c.총액 ?? 0).toLocaleString()} — 새 줄 ${c.새줄} · 겹침 ${c.겹침} · 출금 ${c.통장출금 || "-"}`);
  for (const n of noticeRows.filter((x) => x.판정 === "확인 필요")) console.log(`  ⚠️ ${n.대행사} ${n.공급자} ${n.작성일}${n.공급가 != null ? ` 공급가 ${Number(n.공급가).toLocaleString()}` : ""}`);

  await mkdir(OUT_DIR, { recursive: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cardRows), "카드명세서");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(noticeRows), "대행메일");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(taxRows), "홈택스메일");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invRows), "미쉐린");
  const file = path.join(OUT_DIR, `intake-review-${new Date().toISOString().slice(0, 10)}.xlsx`);
  XLSX.writeFile(wb, file);
  console.log(`\n보고서: ${file}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
