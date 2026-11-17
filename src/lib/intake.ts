/**
 * ⭐ 자동 수집 받은 편지함 — /api/intake 가 받은 것을 종류별로 처리한다 (2026-11-17, D-41)
 *
 *   보내는 쪽
 *     · 사장님 폰(안드로이드) 알림 전달 앱 — 신한 SOL Biz 입출금 알림   → type 'bank-alert'
 *     · info@psiauto.co.kr 의 구글 스크립트(docs/21) — 메일 첨부·본문     → type 'mail-file' / 'mail-note'
 *
 *   처리
 *     은행 알림               → bank-alert.ingestBankAlertText (통장 「속보」 줄)
 *     인보이스 PDF·엑셀       → invoice-save.saveInvoiceCore (입고 대기 등록 — 화면 업로드와 같은 정본)
 *     보안메일 HTML(홈택스)   → cri-mail 로 풀고 → nts-tax-xml → fin-ingest.ingestTaxInvoices (계산서 장부)
 *     그 밖(콘티넨탈 PDF·카드 명세서·결제 알림 메일) → 원본을 intake_log 에 「보관」 (읽는 법이 생기면 다시 처리)
 *
 * 🔴 무엇이 오든 **먼저 intake_log 에 남기고** 처리한다 — 처리 중 오류가 나도 자료는 잃지 않는다.
 * 🔴 같은 ref 는 한 번만 — 보내는 쪽이 같은 것을 다시 보내도 안전하다.
 * 🔴 "use server" 아님 — 라우트(비밀키 검사 뒤)만 부른다.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getShopInfo } from "./shop";
import { ingestBankAlertText } from "./bank-alert";
import { decryptCriMail, isCriMail } from "./cri-mail";
import { parseNtsTaxXml } from "./nts-tax-xml";
import { ingestTaxInvoices } from "./fin-ingest";
import type { TaxParseResult } from "./fin-sheet";

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
    }
  | { type: "mail-note"; messageId: string; sender?: string | null; subject?: string | null; body: string };

export type IntakeStatus = "반영" | "중복" | "보관" | "해석불가" | "오류";
export interface IntakeOutcome {
  id: number | null;
  status: IntakeStatus;
  result: string;
}

const MAX_FILE = 4 * 1024 * 1024;
const sha1 = (s: string) => createHash("sha1").update(s, "utf8").digest("hex");

function refOf(i: IntakeInput): string {
  if (i.type === "bank-alert") return `alert:${sha1(i.text.replace(/\s+/g, " ").trim())}`;
  if (i.type === "mail-file") return `mail:${i.messageId}#${i.index}`;
  return `mail:${i.messageId}#note`;
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
      ${input.type === "bank-alert" ? input.text.slice(0, 4000) : input.type === "mail-note" ? input.body.slice(0, 20000) : null},
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

  let out: { status: IntakeStatus; result: string; linkedTable?: string; linkedId?: number };
  try {
    out = await route(input, bytes);
  } catch (e) {
    out = { status: "오류", result: e instanceof Error ? e.message : String(e) };
  }
  await db.execute(sql`
    UPDATE intake_log SET status = ${out.status}, result = ${out.result.slice(0, 1000)},
           linked_table = ${out.linkedTable ?? null}, linked_id = ${out.linkedId ?? null}, handled_at = now()
    WHERE id = ${id}
  `);
  return { id, status: out.status, result: out.result };
}

async function route(
  input: IntakeInput,
  bytes: Buffer | null,
): Promise<{ status: IntakeStatus; result: string; linkedTable?: string; linkedId?: number }> {
  if (input.type === "bank-alert") {
    const r = await ingestBankAlertText(input.text);
    return { status: r.status, result: r.result, ...("cashTxnId" in r && r.cashTxnId ? { linkedTable: "cash_txn", linkedId: r.cashTxnId } : {}) };
  }
  if (input.type === "mail-note") return { status: "보관", result: "메일 본문 보관 (결제 알림 등 — 아직 자동 처리 없음)" };

  const name = input.fileName;
  const buf = bytes!;

  // ① 보안메일 (홈택스 전자세금계산서)
  if (/\.html?$/i.test(name)) {
    const html = buf.toString("utf8");
    if (!isCriMail(html)) return { status: "보관", result: "보안메일 형식이 아닌 HTML — 원본 보관" };
    const shop = await getShopInfo();
    const bizNo = (shop.bizNo ?? process.env.INTAKE_BIZ_NO ?? "").replace(/\D/g, "");
    if (bizNo.length !== 10) return { status: "보관", result: "매장 사업자번호가 없어 보안메일을 못 엽니다 — 설정 → 매장 정보에 사업자번호를 넣어 주세요" };
    const dec = decryptCriMail(html, bizNo);
    if (!dec.ok) return { status: "보관", result: `보안메일을 못 열었습니다: ${dec.error} — 원본 보관` };

    const xmlFile = dec.files.find((f) => /\.xml$/i.test(f.name));
    if (!xmlFile) return { status: "보관", result: `보안메일은 열렸지만 계산서 XML 이 아닙니다 (${dec.files.map((f) => f.name).join(", ") || "첨부 없음"})` };
    const xml = Buffer.from(xmlFile.bytes).toString("utf8");
    const inv = parseNtsTaxXml(xml, bizNo);
    if (!inv) return { status: "해석불가", result: "계산서 XML 을 읽지 못했거나 우리 사업자번호가 없는 계산서입니다" };

    const parsed: TaxParseResult = {
      source: inv.direction === "매입" ? "홈택스매입" : "홈택스매출",
      formatName: "홈택스 발급 메일 (전자세금계산서)",
      rows: [inv],
      skipped: [],
      rawCsv: xml,
      periodFrom: inv.writeDate,
      periodTo: inv.writeDate,
      sumTotal: inv.total,
    };
    const r = await ingestTaxInvoices(parsed, null, `메일: ${inv.counterName} ${inv.writeDate}`);
    const what = `${inv.direction} ${inv.counterName} ${inv.writeDate} 합계 ${inv.total.toLocaleString()}원 (승인 ${inv.approvalNo})`;
    if (r.newCount === 0) return { status: "중복", result: `${what} — 이미 장부에 있는 계산서` };
    const [t] = await db.execute<{ id: number }>(sql`SELECT id FROM tax_invoice WHERE approval_no = ${inv.approvalNo}`);
    return { status: "반영", result: what, linkedTable: "tax_invoice", linkedId: t ? Number(t.id) : undefined };
  }

  // ② 인보이스 (미쉐린 PDF 등) — 화면 업로드와 같은 정본
  if (/\.(pdf|xlsx?)$/i.test(name)) {
    const { saveInvoiceCore } = await import("./invoice-save");
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
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
