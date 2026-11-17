/**
 * ⭐ 발행 대행 메일 → 계산서 도착 알림 (2026-11-17) — 실물 5종과 같은 모양, 가짜 값
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, matchNoticeToTaxInvoice, parseTaxMailNotice, vendorOf, type TaxInvoiceLite } from "./tax-mail-notice";

describe("parseTaxMailNotice", () => {
  test("팝빌 — 제목의 공급자, 본문의 작성일자·공급가액·세액", () => {
    const body = htmlToText(`<table><tr><td>작성일자</td><td>2026-11-05</td></tr><tr><td>공급가액</td><td>950,000 원</td></tr><tr><td>세액</td><td>95,000 원</td></tr></table>`);
    const n = parseTaxMailNotice("popbill@popbill.com", "[가짜코리아(주)]에서 전자세금계산서가 발행 되었습니다.", body);
    assert.deepEqual(
      { v: n?.vendor, k: n?.kind, s: n?.supplier, d: n?.writeDate, a: n?.supplyAmount, t: n?.vat, e: n?.exactDate },
      { v: "팝빌", k: "매입", s: "가짜코리아(주)", d: "2026-11-05", a: 950000, t: 95000, e: true },
    );
  });
  test("bill36524 — 담당자 이름은 떼고, 부가세액·품목·관리번호", () => {
    const body = "| 관리번호 | TX2026110000001 | | 품목 | 10월 위탁운영비 | | 공급가액 | 89,046 원 | 부가세액 | 8,905 원 | | 작성일자 | 2026-11-03 |";
    const n = parseTaxMailNotice("webmaster@bill36524.com", "[(주)가짜코스모스 홍길동님]으로부터 발행 세금계산서가 도착했습니다.", body);
    assert.equal(n?.supplier, "(주)가짜코스모스");
    assert.equal(n?.supplyAmount, 89046);
    assert.equal(n?.vat, 8905);
    assert.equal(n?.item, "10월 위탁운영비");
    assert.equal(n?.ref, "TX2026110000001");
  });
  test("스마트빌 — 금액 없음", () => {
    const n = parseTaxMailNotice("mailing@businesson.co.kr", "[전자세금계산서 정발행] 가짜타이어 양양점 ▶ 주식회사 싸이오토모티브", "작성일자 | 2026-11-12 | 거래업체 (공급자)");
    assert.equal(n?.supplier, "가짜타이어 양양점");
    assert.equal(n?.kind, "매입");
    assert.equal(n?.supplyAmount, null);
  });
  test("바로빌 · 이카운트(발행일자 → 날짜 폭 넓힘)", () => {
    assert.equal(parseTaxMailNotice("baro@barobill.co.kr", "가짜윤활유님으로부터 전자세금계산서가 발급되었습니다.", "| 작성일자 | 2026-10-26 | 조회코드 | 2U2110c99S2HX90K |")?.supplier, "가짜윤활유");
    const e = parseTaxMailNotice("ecount@ecount.com", "[주식회사 가짜타이어](으)로부터 [전자(세금)계산서](이)가 도착했습니다.", "보낸회사 | 주식회사 가짜타이어 | 발행일자 | 2026/10/22 |");
    assert.equal(e?.writeDate, "2026-10-22");
    assert.equal(e?.exactDate, false);
  });
  test("우리가 공급자면 매출, 계산서 메일이 아니면 null, 모르는 발신은 null", () => {
    assert.equal(parseTaxMailNotice("popbill@popbill.com", "[주식회사 싸이오토모티브]에서 전자세금계산서가 발행 되었습니다.", "작성일자 2026-11-01")?.kind, "매출");
    assert.equal(parseTaxMailNotice("popbill@popbill.com", "팝빌 이용 안내", "공지"), null);
    assert.equal(vendorOf("someone@example.com"), null);
  });
});

describe("matchNoticeToTaxInvoice", () => {
  const inv = (id: number, d: string, name: string, supply: number, dir: "매입" | "매출" = "매입"): TaxInvoiceLite => ({
    id, approvalNo: `a${id}`, direction: dir, writeDate: d, counterName: name, supplyAmount: supply,
  });
  const book = [inv(1, "2026-11-05", "가짜코리아 주식회사", 950000), inv(2, "2026-11-05", "다른상사", 950000), inv(3, "2026-10-20", "주식회사 가짜타이어", 30000)];
  test("이름·날짜·공급가액이 맞으면 짝 — (주)·주식회사 표기 차이 견딤", () => {
    const n = parseTaxMailNotice("popbill@popbill.com", "[가짜코리아(주)]에서 전자세금계산서가 발행 되었습니다.", "작성일자 2026-11-05 공급가액 950,000 세액 95,000")!;
    assert.equal(matchNoticeToTaxInvoice(n, book)?.id, 1);
  });
  test("금액이 다르면 짝이 아니다 → 「확인 필요」", () => {
    const n = parseTaxMailNotice("popbill@popbill.com", "[가짜코리아(주)]에서 전자세금계산서가 발행 되었습니다.", "작성일자 2026-11-05 공급가액 1,000 세액 100")!;
    assert.equal(matchNoticeToTaxInvoice(n, book), null);
  });
  test("발행일자뿐(이카운트)이면 ±7일", () => {
    const n = parseTaxMailNotice("ecount@ecount.com", "[주식회사 가짜타이어](으)로부터 [전자(세금)계산서](이)가 도착했습니다.", "발행일자 | 2026/10/22")!;
    assert.equal(matchNoticeToTaxInvoice(n, book)?.id, 3);
  });
});
