/**
 * ⭐ 자동 수집 받은 편지함 — /api/intake 가 받은 것을 종류별로 처리한다 (2026-11-17, D-41)
 *
 *   보내는 쪽
 *     · 사장님 폰(안드로이드) 알림 수집 앱 — 신한 SOL Biz 입출금 알림   → type 'bank-alert'
 *     · info@psiauto.co.kr 의 구글 스크립트(docs/21) — 메일 첨부·본문     → type 'mail-file' / 'mail-note'
 *
 *   처리
 *     은행 알림               → bank-alert.ingestBankAlertText (통장 「속보」 줄)
 *     인보이스 PDF·엑셀       → invoice-save.saveInvoiceCore (입고 대기 등록 — 화면 업로드와 같은 정본)
 *     홈택스 보안메일(Cri)    → cri-mail → nts-tax-xml → fin-ingest.ingestTaxInvoices (계산서 장부)
 *     카드 명세서 메일        → (우리) vestmail 해독 / (신한) EUC-KR → card-statement 검산 → 겹침 거르기 → ingestCashTxns
 *     발행 대행 메일(본문)    → tax-mail-notice 「계산서 도착 알림」 — 장부에 넣지 않는다(승인번호 없음), 홈택스 엑셀과 대조용
 *     콘티넨탈 Proforma · KICC 결제 알림 → 「쓰지 않음 — 까닭」 보관 (D-41 「쓰지 않기로 한 메일」)
 *
 *   mode 'review'(지난 메일 일괄 검토, docs/21 3장) — **해석까지만** 하고 장부에 넣지 않는다 → status '검토', parsed 에 요약.
 *     사장님 확인 뒤 applyIntakeRow(id) 가 보관된 원본으로 다시 처리해 반영한다.
 *
 * 🔴 무엇이 오든 **먼저 intake_log 에 남기고** 처리한다 — 처리 중 오류가 나도 자료는 잃지 않는다.
 * 🔴 같은 ref 는 한 번만 — 보내는 쪽이 같은 것을 다시 보내도 안전하다.
 * 🔴 "use server" 아님 — 라우트(비밀키 검사 뒤)와 PC 스크립트만 부른다.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getShopInfo } from "./shop";
import { ingestBankAlertText } from "./bank-alert";
import { decryptCriMail, isCriMail } from "./cri-mail";
import { parseNtsTaxXml } from "./nts-tax-xml";
import { ingestCashTxns, ingestTaxInvoices } from "./fin-ingest";
import type { TaxParseResult } from "./fin-sheet";
import { decryptVestMail, isVestMail } from "./vestmail";
import {
  decodeKorean,
  filterStatementOverlap,
  isShinhanStatement,
  isWooriStatement,
  parseShinhanStatement,
  parseWooriStatement,
  type StatementParse,
} from "./card-statement";
import { htmlToText, parseTaxMailNotice, vendorOf } from "./tax-mail-notice";
import { parseAccountMap } from "./bank-alert-pure";

export type IntakeMode = "apply" | "review";

export type IntakeInput =
  | { type: "bank-alert"; text: string; app?: string | null; title?: string | null }
  | {
      type: "mail-file";
      messageId: string;
      index: number;
      sender?: string | null;
      subject?: string | null;
      fileName: string;
      mime?: string | null;
      base64: string;
      mode?: IntakeMode;
    }
  | { type: "mail-note"; messageId: string; sender?: string | null; subject?: string | null; body: string; mode?: IntakeMode };

export type IntakeStatus = "반영" | "중복" | "보관" | "해석불가" | "오류" | "검토";
export interface IntakeOutcome {
  id: number | null;
  status: IntakeStatus;
  result: string;
}
type Routed = { status: IntakeStatus; result: string; linkedTable?: string; linkedId?: number; parsed?: unknown };

const MAX_FILE = 4 * 1024 * 1024;
const sha1 = (s: string) => createHash("sha1").update(s, "utf8").digest("hex");

function refOf(i: IntakeInput): string {
  if (i.type === "bank-alert") return `alert:${sha1(i.text.replace(/\s+/g, " ").trim())}`;
  if (i.type === "mail-file") return `mail:${i.messageId}#${i.index}`;
  return `mail:${i.messageId}#note`;
}

async function bizNoOrNull(): Promise<string | null> {
  const shop = await getShopInfo();
  const b = (shop.bizNo ?? process.env.INTAKE_BIZ_NO ?? "").replace(/\D/g, "");
  return b.length === 10 ? b : null;
}

async function saveOutcome(id: number, out: Routed): Promise<void> {
  await db.execute(sql`
    UPDATE intake_log SET status = ${out.status}, result = ${out.result.slice(0, 1000)},
           linked_table = ${out.linkedTable ?? null}, linked_id = ${out.linkedId ?? null},
           parsed = ${out.parsed == null ? null : JSON.stringify(out.parsed)}::jsonb, handled_at = now()
    WHERE id = ${id}
  `);
}

/** 받은 것 하나를 처리한다. 예외를 던지지 않는다 — 결과는 intake_log 와 반환값에 */
export async function handleIntake(input: IntakeInput): Promise<IntakeOutcome> {
  const ref = refOf(input);
  const bytes = input.type === "mail-file" ? Buffer.from(input.base64, "base64") : null;
  if (bytes && bytes.length > MAX_FILE) return { id: null, status: "오류", result: `첨부가 너무 큽니다 (${bytes.length} 바이트)` };

  const [row] = await db.execute<{ id: number }>(sql`
    INSERT INTO intake_log (kind, sender, subject, ref, file_name, mime, body, file_bytes)
    VALUES (
      ${input.type === "bank-alert" ? "은행알림" : "메일"},
      ${input.type === "bank-alert" ? (input.app ?? null) : (input.sender ?? null)},
      ${input.type === "bank-alert" ? (input.title ?? null) : (input.subject ?? null)},
      ${ref},
      ${input.type === "mail-file" ? input.fileName : null},
      ${input.type === "mail-file" ? (input.mime ?? null) : null},
      ${input.type === "bank-alert" ? input.text.slice(0, 4000) : input.type === "mail-note" ? input.body.slice(0, 200_000) : null},
      ${bytes}
    )
    ON CONFLICT (ref) DO NOTHING
    RETURNING id
  `);
  if (!row) {
    const [old] = await db.execute<{ id: number; status: string; result: string | null }>(sql`
      SELECT id, status, result FROM intake_log WHERE ref = ${ref}
    `);
    return { id: old ? Number(old.id) : null, status: "중복", result: `이미 받은 것 (${old?.status ?? "?"}: ${old?.result ?? ""})` };
  }
  const id = Number(row.id);

  let out: Routed;
  try {
    out = await route(input, bytes);
  } catch (e) {
    out = { status: "오류", result: e instanceof Error ? e.message : String(e) };
  }
  await saveOutcome(id, out);
  return { id, status: out.status, result: out.result };
}

/**
 * 「검토」로 받아 둔 것을 보관된 원본으로 **다시 처리해 반영**한다 (사장님 확인 뒤, scripts/intake-review.ts --apply).
 * 🔴 '검토' 상태만 — 이미 반영·중복인 것은 건드리지 않는다.
 */
export async function applyIntakeRow(id: number): Promise<IntakeOutcome> {
  return rerunStored(id, "apply", ["검토"]);
}

/**
 * 보관된 원본을 **해석만 다시** 한다(장부에 넣지 않음) — 읽는 법을 고친 뒤 보관·해석불가였던 것을 「검토」로 되살린다.
 * (예: Vercel 에서 PDF 를 못 읽어 보관된 미쉐린 인보이스 · 검산 실패했던 명세서. scripts/intake-review.ts --reparse)
 */
export async function reparseIntakeRow(id: number): Promise<IntakeOutcome> {
  return rerunStored(id, "review", ["보관", "해석불가", "검토"]);
}

async function rerunStored(id: number, mode: IntakeMode, allowed: string[]): Promise<IntakeOutcome> {
  const [r] = await db.execute<{
    id: number; kind: string; status: string; sender: string | null; subject: string | null; ref: string;
    file_name: string | null; mime: string | null; body: string | null; file_bytes: Buffer | null;
  }>(sql`SELECT id, kind, status, sender, subject, ref, file_name, mime, body, file_bytes FROM intake_log WHERE id = ${id}`);
  if (!r) return { id, status: "오류", result: "그런 기록이 없습니다" };
  if (!allowed.includes(r.status)) return { id, status: r.status as IntakeStatus, result: `${allowed.join("·")} 상태가 아닙니다 (${r.status})` };
  const messageId = r.ref.replace(/^mail:/, "").replace(/#.*$/, "");
  const input: IntakeInput = r.file_name
    ? { type: "mail-file", messageId, index: 0, sender: r.sender, subject: r.subject, fileName: r.file_name, mime: r.mime, base64: "", mode }
    : { type: "mail-note", messageId, sender: r.sender, subject: r.subject, body: r.body ?? "", mode };
  let out: Routed;
  try {
    out = await route(input, r.file_bytes ? Buffer.from(r.file_bytes) : null);
  } catch (e) {
    out = { status: "오류", result: e instanceof Error ? e.message : String(e) };
  }
  await saveOutcome(id, out);
  return { id, status: out.status, result: out.result };
}

async function route(input: IntakeInput, bytes: Buffer | null): Promise<Routed> {
  if (input.type === "bank-alert") {
    const r = await ingestBankAlertText(input.text);
    return { status: r.status, result: r.result, ...("cashTxnId" in r && r.cashTxnId ? { linkedTable: "cash_txn", linkedId: r.cashTxnId } : {}) };
  }
  const review = input.mode === "review";
  if (input.type === "mail-note") return routeNote(input.sender ?? "", input.subject ?? "", input.body, review);

  const name = input.fileName;
  const buf = bytes!;
  const sender = (input.sender ?? "").toLowerCase();

  if (/^Continental Proforma Invoice/i.test(name)) {
    return {
      status: "보관",
      result: "콘티넨탈 Proforma — 쓰지 않음: 미출고 주문 전체를 1시간마다 다시 보내는 누적 청구서라 입고에 넣으면 중복된다. 입고는 billing-report 엑셀",
    };
  }

  if (/\.html?$/i.test(name)) {
    // 카드 명세서 — 우리(VestMail)·신한(EUC-KR 평문). 🔴 VestMail 은 우리카드 발신일 때만 엔진을 돈다
    if (/woori/i.test(name) || sender.includes("wooricard")) {
      const html = buf.toString("utf8");
      if (!sender.includes("wooricard") || !isVestMail(html)) return { status: "보관", result: "우리카드 발신 VestMail 이 아니라 열지 않았습니다 — 원본 보관" };
      return routeCardStatement("우리", () => html, review);
    }
    if (/shinhancard/i.test(name) || sender.includes("shinhancard")) {
      return routeCardStatement("신한", () => decodeKorean(new Uint8Array(buf)), review);
    }
    const html = buf.toString("utf8");
    if (isCriMail(html)) return routeHometax(html, review);
    return { status: "보관", result: "보안메일 형식이 아닌 HTML — 원본 보관" };
  }

  // 인보이스 (미쉐린 PDF 등) — 화면 업로드와 같은 정본
  if (/\.(pdf|xlsx?)$/i.test(name)) {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    if (review) {
      const { previewInvoice } = await import("./invoice");
      const pv = await previewInvoice(name, ab);
      if ("error" in pv) return { status: "보관", result: `${pv.error} — 원본 보관` };
      const invoices = pv.invoices.map((i) => ({ no: i.invoiceNo, orderNo: i.orderNo, supplier: i.supplier, issuedAt: i.issuedAt, total: i.total, qty: i.totalQty, duplicate: i.duplicate, ok: i.ok }));
      return { status: "검토", result: invoices.map((i) => `${i.supplier} ${i.no} 합계 ${(i.total ?? 0).toLocaleString()}${i.duplicate ? " (장부에 있음)" : " (장부에 없음)"}`).join(" · "), parsed: { kind: "invoice", invoices } };
    }
    const { saveInvoiceCore } = await import("./invoice-save");
    const r = await saveInvoiceCore(name, ab, { updatePrices: true });
    if (r.ok) {
      return {
        status: "반영",
        result: `인보이스 ${r.saved}건 입고 대기 등록${r.skipped ? ` (이미 있던 것 ${r.skipped}건)` : ""}${r.priceUpdates ? ` · 매입 할인율 ${r.priceUpdates}건 갱신` : ""}`,
        linkedTable: "purchase_invoice",
      };
    }
    if (/이미 등록된/.test(r.error)) return { status: "중복", result: r.error };
    return { status: "보관", result: `${r.error} — 원본 보관 (읽는 법이 생기면 다시 처리)` };
  }

  return { status: "보관", result: "자동 처리하지 않는 파일 — 원본 보관" };
}

/* ------------------------------------------------------------------ */

function routeNote(sender: string, subject: string, body: string, review: boolean): Routed {
  if (vendorOf(sender)) {
    const text = /<\w+[^>]*>/.test(body) ? htmlToText(body) : body;
    const n = parseTaxMailNotice(sender, subject, text);
    if (!n) return { status: "보관", result: "대행사 메일이지만 계산서 알림이 아닙니다" };
    const what = `${n.vendor} ${n.kind} ${n.supplier} ${n.writeDate ?? "날짜?"}${n.supplyAmount != null ? ` 공급가 ${n.supplyAmount.toLocaleString()}` : ""}`;
    return {
      status: review ? "검토" : "보관",
      result: `계산서 도착 알림 — ${what} (승인번호 없음: 홈택스 엑셀과 대조용, 장부에 넣지 않음)`,
      parsed: { kind: "notice", notice: n },
    };
  }
  return { status: "보관", result: "결제 알림 — 쓰지 않음: 미쉐린 가상계좌 결제는 통장 출금이 인보이스 합계와 원 단위로 맞아 지급 자동 대조로 이어진다" };
}

async function routeHometax(html: string, review: boolean): Promise<Routed> {
  const bizNo = await bizNoOrNull();
  if (!bizNo) return { status: "보관", result: "매장 사업자번호가 없어 보안메일을 못 엽니다 — 설정 → 매장 정보에 사업자번호를 넣어 주세요" };
  const dec = decryptCriMail(html, bizNo);
  if (!dec.ok) return { status: "보관", result: `보안메일을 못 열었습니다: ${dec.error} — 원본 보관` };
  const xmlFile = dec.files.find((f) => /\.xml$/i.test(f.name));
  if (!xmlFile) return { status: "보관", result: `보안메일은 열렸지만 계산서 XML 이 아닙니다 (${dec.files.map((f) => f.name).join(", ") || "첨부 없음"})` };
  const xml = Buffer.from(xmlFile.bytes).toString("utf8");
  const inv = parseNtsTaxXml(xml, bizNo);
  if (!inv) return { status: "해석불가", result: "계산서 XML 을 읽지 못했거나 우리 사업자번호가 없는 계산서입니다" };

  const what = `${inv.direction} ${inv.counterName} ${inv.writeDate} 합계 ${inv.total.toLocaleString()}원 (승인 ${inv.approvalNo})`;
  const parsed = {
    kind: "tax", approvalNo: inv.approvalNo, direction: inv.direction, counterName: inv.counterName, counterBizNo: inv.counterBizNo,
    writeDate: inv.writeDate, supplyAmount: inv.supplyAmount, vat: inv.vat, total: inv.total, itemSummary: inv.itemSummary,
  };
  if (review) return { status: "검토", result: what, parsed };

  const tp: TaxParseResult = {
    source: inv.direction === "매입" ? "홈택스매입" : "홈택스매출",
    formatName: "홈택스 발급 메일 (전자세금계산서)",
    rows: [inv],
    skipped: [],
    rawCsv: xml,
    periodFrom: inv.writeDate,
    periodTo: inv.writeDate,
    sumTotal: inv.total,
  };
  const r = await ingestTaxInvoices(tp, null, `메일: ${inv.counterName} ${inv.writeDate}`);
  if (r.newCount === 0) return { status: "중복", result: `${what} — 이미 장부에 있는 계산서`, parsed };
  const [t] = await db.execute<{ id: number }>(sql`SELECT id FROM tax_invoice WHERE approval_no = ${inv.approvalNo}`);
  return { status: "반영", result: what, linkedTable: "tax_invoice", linkedId: t ? Number(t.id) : undefined, parsed };
}

/** 카드사 → 앱 계정 이름 (확인 2026-11-17: 신한법인카드 · 우리법인카드). 바꾸려면 CARD_STATEMENT_LABELS="신한=…;우리=…" */
function cardLabel(card: "신한" | "우리"): string {
  const m = parseAccountMap(process.env.CARD_STATEMENT_LABELS);
  return m.get(card) ?? (card === "신한" ? "신한법인카드" : "우리법인카드");
}

async function routeCardStatement(card: "신한" | "우리", getHtml: () => string, review: boolean): Promise<Routed> {
  let html = getHtml();
  if (card === "우리") {
    const bizNo = await bizNoOrNull();
    if (!bizNo) return { status: "보관", result: "매장 사업자번호가 없어 우리카드 명세서를 못 엽니다 — 원본 보관" };
    const dec = decryptVestMail(html, bizNo);
    if (!dec.ok) return { status: dec.wrongPassword ? "해석불가" : "보관", result: `우리카드 명세서를 못 열었습니다: ${dec.error} — 원본 보관` };
    html = dec.html;
    // 우리카드는 계약갱신 안내·요청 거래내역·국외이용 매입내역도 같은 VestMail 로 보낸다 — 명세서가 아니면 보관만 (2026-11-18 실물)
    if (!isWooriStatement(html)) return { status: "보관", result: "우리카드 보안메일이지만 이용대금명세서가 아닙니다(안내·요청 내역 등) — 원본 보관" };
  } else if (!isShinhanStatement(html)) {
    return { status: "보관", result: "신한카드 메일이지만 이용대금명세서가 아닙니다 — 원본 보관" };
  }

  const p: StatementParse = card === "우리" ? parseWooriStatement(html) : parseShinhanStatement(html);
  const label = cardLabel(card);
  const head = `${card}카드 명세서 ${p.periodFrom ?? "?"}~${p.periodTo ?? "?"} (결제 ${p.payDate ?? "?"}) ${p.rows.length}줄 · 총액 ${(p.statementTotal ?? 0).toLocaleString()}원`;
  const parsedBase = { kind: "card", card, label, periodFrom: p.periodFrom, periodTo: p.periodTo, payDate: p.payDate, statementTotal: p.statementTotal, prepaid: p.prepaid, rows: p.rows.length, ok: p.ok, checks: p.checks, notes: p.notes };
  if (!p.ok) return { status: "해석불가", result: `${head} — 검산 실패: ${p.checks.join(" / ")} (반영 안 함)`, parsed: parsedBase };

  // 같은 계정에 이미 있는 줄(승인 엑셀·지난 명세서)과 겹침 거르기
  const from = p.rows.map((r) => r.occurredAt.slice(0, 10)).sort()[0] ?? p.periodFrom;
  const to = p.rows.map((r) => r.occurredAt.slice(0, 10)).sort().at(-1) ?? p.periodTo;
  const existing = await db.execute<{ day: string; out_amount: number }>(sql`
    SELECT to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day, out_amount
    FROM cash_txn
    WHERE is_active AND source = '법인카드' AND account_label = ${label}
      AND occurred_at BETWEEN ((${from}::date - 1)::timestamp AT TIME ZONE 'Asia/Seoul')
                          AND ((${to}::date + 2)::timestamp AT TIME ZONE 'Asia/Seoul')
    LIMIT 5000
  `);
  const { keep, dropped } = filterStatementOverlap(p.rows, existing.map((e) => ({ day: e.day, outAmount: e.out_amount })));
  const parsed = { ...parsedBase, newRows: keep.length, overlapRows: dropped.length };
  const summary = `${head} — 새 줄 ${keep.length} · 이미 있던 줄 ${dropped.length}`;
  if (review) return { status: "검토", result: summary, parsed };
  if (keep.length === 0) return { status: "중복", result: `${summary} — 넣을 줄 없음`, parsed };

  const r = await ingestCashTxns({ ...p, rows: keep }, label, null, `메일: ${card}카드 명세서 ${p.payDate ?? ""}`);
  return { status: "반영", result: `${summary} → 반영 ${r.newCount}줄 [${label}]`, linkedTable: "fin_upload", linkedId: r.uploadId, parsed };
}
