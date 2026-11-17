/**
 * ⭐ 국세청 표준 전자세금계산서 XML → 앱 계산서 줄 (순수 함수) (2026-11-17)
 *
 *   홈택스 발급 메일의 보안 첨부(cri-mail.ts)를 풀면 나오는 XML.
 *   표준: urn:kr:or:kec:standard:Tax:ReusableAggregateBusinessInformationEntitySchemaModule:1:0
 *
 *     TaxInvoiceDocument/IssueID          승인번호 24자리 → 「8-8-8」 (홈택스 목록 엑셀과 같은 모양)
 *     TaxInvoiceDocument/IssueDateTime    작성일자 YYYYMMDD
 *     ExchangedDocument/IssueDateTime     발급 일시
 *     InvoicerParty / InvoiceeParty       공급자 / 공급받는자 (ID = 사업자번호)
 *     SpecifiedMonetarySummation          공급가액·세액·합계
 *     TaxInvoiceTradeLineItem*            품목
 *
 * 🔴 정본은 fin-sheet.NormalizedTaxInvoice — 엑셀로 들어오든 메일로 들어오든 같은 줄을 만든다.
 *    승인번호가 같으면 tax_invoice 에 한 번만 들어간다 (ON CONFLICT approval_no).
 */
import type { NormalizedTaxInvoice } from "./fin-sheet";

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml);
  return m ? m[1].trim() : null;
};
const block = (xml: string, name: string): string => tag(xml, name) ?? "";
const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const num = (s: string | null) => (s ? Math.round(Number(s.replace(/[^\d.-]/g, ""))) || 0 : 0);
const ymd = (s: string | null) => (s && /^\d{8}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

/** 「202610311026110225020047」 → 「20261031-10261102-25020047」 */
export function formatApprovalNo(id: string): string {
  const s = id.replace(/[^0-9a-zA-Z]/g, "");
  return s.length === 24 ? `${s.slice(0, 8)}-${s.slice(8, 16)}-${s.slice(16, 24)}`.toLowerCase() : id.trim();
}

export interface NtsTaxInvoice extends NormalizedTaxInvoice {
  /** 수정 사유·영수/청구 같은 부가 정보 — 화면 메모용 */
  typeCode: string | null;
  purposeCode: string | null;
  invoicerBizNo: string;
  invoiceeBizNo: string;
}

/**
 * @param myBizNo 우리 사업자번호 (숫자만) — 공급자면 매출, 공급받는자면 매입
 * @returns 우리 계산서가 아니거나 못 읽으면 null
 */
export function parseNtsTaxXml(xml: string, myBizNo: string): NtsTaxInvoice | null {
  const x = xml.replace(/<ds:Signature[\s\S]*?<\/ds:Signature>/, "");
  const doc = block(x, "TaxInvoiceDocument");
  const settle = block(x, "TaxInvoiceTradeSettlement");
  const issueId = tag(doc, "IssueID");
  const writeDate = ymd(tag(doc, "IssueDateTime"));
  if (!issueId || !writeDate) return null;

  const invoicer = block(settle, "InvoicerParty");
  const invoicee = block(settle, "InvoiceeParty");
  const invoicerBizNo = (tag(invoicer, "ID") ?? "").replace(/\D/g, "");
  const invoiceeBizNo = (tag(invoicee, "ID") ?? "").replace(/\D/g, "");
  const me = myBizNo.replace(/\D/g, "");
  const direction: "매출" | "매입" | null = invoiceeBizNo === me ? "매입" : invoicerBizNo === me ? "매출" : null;
  if (!direction) return null;
  const counter = direction === "매입" ? invoicer : invoicee;

  const sum = block(settle, "SpecifiedMonetarySummation");
  const supplyAmount = num(tag(sum, "ChargeTotalAmount"));
  const vat = num(tag(sum, "TaxTotalAmount"));
  const total = num(tag(sum, "GrandTotalAmount")) || supplyAmount + vat;

  const items = [...x.matchAll(/<(?:\w+:)?TaxInvoiceTradeLineItem>([\s\S]*?)<\/(?:\w+:)?TaxInvoiceTradeLineItem>/g)]
    .map((m) => decodeEntities(tag(m[1], "NameText") ?? ""))
    .filter(Boolean);
  const itemSummary = items.length === 0 ? null : items.length === 1 ? items[0] : `${items[0]} 외 ${items.length - 1}건`;

  const exchanged = block(x, "ExchangedDocument");
  const issueDate = ymd(tag(exchanged, "IssueDateTime"));

  return {
    direction,
    approvalNo: formatApprovalNo(issueId),
    writeDate,
    issueDate,
    counterBizNo: direction === "매입" ? invoicerBizNo : invoiceeBizNo,
    counterName: decodeEntities(tag(counter, "NameText") ?? ""),
    supplyAmount,
    vat,
    total,
    itemSummary,
    typeCode: tag(doc, "TypeCode"),
    purposeCode: tag(doc, "PurposeCode"),
    invoicerBizNo,
    invoiceeBizNo,
  };
}
