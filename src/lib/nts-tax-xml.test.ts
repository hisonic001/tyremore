/**
 * ⭐ 국세청 표준 전자세금계산서 XML 읽기 (2026-11-17) — 가짜 값으로 만든 XML (실물과 같은 틀)
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatApprovalNo, parseNtsTaxXml } from "./nts-tax-xml";

const ME = "1112233333";
const xml = (invoicer: string, invoicee: string, items = ["배터리"]) => `<?xml version="1.0" encoding="UTF-8"?>
<TaxInvoice xmlns="urn:kr:or:kec:standard:Tax:ReusableAggregateBusinessInformationEntitySchemaModule:1:0">
<ExchangedDocument><IssueDateTime>20261102175445</IssueDateTime></ExchangedDocument>
<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo><NameText>서명 속 가짜</NameText></ds:SignedInfo></ds:Signature>
<TaxInvoiceDocument><IssueID>202610311026110200000047</IssueID><TypeCode>0101</TypeCode>
<IssueDateTime>20261031</IssueDateTime><PurposeCode>02</PurposeCode></TaxInvoiceDocument>
<TaxInvoiceTradeSettlement>
<InvoicerParty><ID>${invoicer}</ID><NameText>가나 상사 &amp; 주식회사</NameText></InvoicerParty>
<InvoiceeParty><ID>${invoicee}</ID><NameText>주식회사 우리</NameText></InvoiceeParty>
<SpecifiedMonetarySummation><ChargeTotalAmount>1616200</ChargeTotalAmount><TaxTotalAmount>161620</TaxTotalAmount>
<GrandTotalAmount>1777820</GrandTotalAmount></SpecifiedMonetarySummation>
</TaxInvoiceTradeSettlement>
${items.map((n, i) => `<TaxInvoiceTradeLineItem><SequenceNumeric>${i + 1}</SequenceNumeric><NameText>${n}</NameText></TaxInvoiceTradeLineItem>`).join("\n")}
</TaxInvoice>`;

describe("parseNtsTaxXml", () => {
  test("우리가 받는 쪽이면 매입 — 상대는 공급자", () => {
    const r = parseNtsTaxXml(xml("9998877777", ME), ME);
    assert.ok(r);
    assert.equal(r.direction, "매입");
    assert.equal(r.approvalNo, "20261031-10261102-00000047");
    assert.equal(r.writeDate, "2026-10-31");
    assert.equal(r.issueDate, "2026-11-02");
    assert.equal(r.counterBizNo, "9998877777");
    assert.equal(r.counterName, "가나 상사 & 주식회사");
    assert.equal(r.supplyAmount, 1616200);
    assert.equal(r.vat, 161620);
    assert.equal(r.total, 1777820);
    assert.equal(r.itemSummary, "배터리");
  });
  test("우리가 공급자면 매출 — 상대는 받는 쪽, 서명 속 NameText 에 속지 않는다", () => {
    const r = parseNtsTaxXml(xml(ME, "9998877777", ["타이어", "공임", "밸런스"]), ME);
    assert.ok(r);
    assert.equal(r.direction, "매출");
    assert.equal(r.counterName, "주식회사 우리");
    assert.equal(r.itemSummary, "타이어 외 2건");
  });
  test("우리 계산서가 아니면 null", () => {
    assert.equal(parseNtsTaxXml(xml("9998877777", "5554433333"), ME), null);
  });
  test("승인번호는 홈택스 목록 엑셀과 같은 8-8-8", () => {
    assert.equal(formatApprovalNo("2026081841000203000034a1"), "20260818-41000203-000034a1");
    assert.equal(formatApprovalNo("20260818-41000203-00003481"), "20260818-41000203-00003481");
  });
});
