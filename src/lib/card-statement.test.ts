/**
 * ⭐ 법인카드 명세서(메일) 읽기 — 실물과 같은 표 구조에 가짜 값 (2026-11-17)
 *   실물 검산: 신한 11월 4줄 193,018 · 우리 11월 78줄(취소 1) 4,181,156 — 둘 다 원 단위 일치 확인.
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { filterStatementOverlap, isShinhanStatement, isWooriStatement, parseShinhanStatement, parseWooriStatement } from "./card-statement";
import { isVestMail } from "./vestmail";

const shinhan = (rows: string, total: string) => `<html><body>신한카드 법인카드 이메일 명세서 이용대금명세서
<p>결제일 : 2026.11.15 (출금예정일 : 2026.11.16)</p>
<h3>카드이용내역</h3><p>카드 이용 기간 : 2026.10.01 ~ 2026.10.31</p>
<table><tr><th>이용일자</th><th>가맹점명(소재지/업종)</th><th>당월거래내역</th></tr>
${rows}
<tr><td>총합계</td><td>3건</td><td></td><td></td><td>${total}</td><td></td></tr></table>
<table><tr><th>이용일자</th><th>이용 카드</th><th>국가 도시</th><th>이용가맹점 업종</th><th>현지통화 현지금액</th><th>미국달러</th><th>전신환 매도율</th><th>수수료</th><th>청구금액</th></tr>
<tr><td>26.10.21</td><td>1111******2222</td><td>미국</td><td>가짜 해외 상점</td><td>USD 10.00</td><td>10.10</td><td>1,300.00</td><td>24</td><td>13,000</td></tr></table></body></html>`;
const sRow = (d: string, m: string, amt: string) => `<tr><td>${d}</td><td>${m}</td><td></td><td></td><td></td><td>${amt}</td><td></td></tr><tr><td>${amt}</td><td></td><td></td></tr>`;

describe("신한 명세서", () => {
  const html = shinhan(sRow("26.09.30", "알림서비스이용료 ( / )", "200") + sRow("26.10.14", "가짜타이어 (서울/기타)", "29,000") + sRow("26.10.21", "가짜 해외 상점 (US/소프트웨어)", "13,000"), "42,200");
  test("표 줄을 읽고 총합계로 검산 — 해외 상세표는 다시 세지 않는다", () => {
    assert.ok(isShinhanStatement(html));
    const p = parseShinhanStatement(html);
    assert.equal(p.ok, true, p.checks.join());
    assert.equal(p.rows.length, 3);
    assert.equal(p.statementTotal, 42200);
    assert.equal(p.periodFrom, "2026-10-01");
    assert.equal(p.payDate, "2026-11-15");
    assert.equal(p.rows[0].occurredAt, "2026-09-30 00:00:00");
    assert.equal(p.rows[0].description, "알림서비스이용료");
    assert.equal(p.rows[1].outAmount, 29000);
  });
  test("합계가 안 맞으면 ok=false — 반영하지 않는다", () => {
    const p = parseShinhanStatement(shinhan(sRow("26.10.14", "가짜", "29,000"), "30,000"));
    assert.equal(p.ok, false);
    assert.match(p.checks[0], /≠/);
  });
  test("「취소매출」 표(칸 6개)는 환급 줄 — 원거래금액을 이용금액으로 읽지 않고, 「입금하실 금액」으로 검산 (2026-09 실물)", () => {
    const html = shinhan(sRow("26.08.01", "가짜 구독 (US/소프트웨어)", "148,743") + sRow("26.08.14", "가짜타이어 (서울/기타)", "29,000"), "177,743")
      .replace("결제일 : 2026.11.15", "입금하실 금액 합계 171,671 원 결제일 : 2026.11.15")
      .replace("</body>", `<table><tr><th>취소일자</th><th>가맹점명(업종)</th><th>이용카드</th><th>취소금액</th><th>원거래일자</th><th>원거래금액</th></tr>
<tr><td>26.08.03</td><td>가짜 구독(소프트웨어)</td><td>1111******2222</td><td>-2,989</td><td>26.05.10</td><td>32,943</td></tr>
<tr><td>26.08.03</td><td>가짜 구독(소프트웨어)</td><td>1111******2222</td><td>-3,083</td><td>26.07.10</td><td>33,867</td></tr></table></body>`);
    const p = parseShinhanStatement(html);
    assert.equal(p.ok, true, p.checks.join());
    assert.equal(p.statementTotal, 171671);
    assert.equal(p.rows.length, 4);
    assert.equal(p.rows.filter((r) => r.inAmount > 0).map((r) => r.inAmount).join(), "2989,3083");
    assert.match(p.rows[2].description, /^\[취소\]/);
  });
});

const woori = (rows: string, total: string, period = "2026년10월01일 ~ 2026년10월31일") => `<html><body>
우리카드 이용대금 명세서 총 결제금액 ${total} 원 결제일 2026년11월15일 출금예정일 2026년11월16일
<p>카드이용내역 이용기간 일시불 / 할부 : ${period}</p>
<table><tr><th>이용 일자</th><th>이용가맹점</th><th>이용금액</th></tr>${rows}</table></body></html>`;
const wRow = (d: string, m: string, used: string, fee: string, pay: string) =>
  `<tr><td>${d}</td><td>${m}</td><td>${used}</td><td></td><td></td><td>${used}</td><td>${fee}</td><td></td><td></td><td>${pay}</td><td></td><td></td><td></td></tr>`;

describe("우리 명세서 (VestMail 로 푼 HTML)", () => {
  test("납부하실 금액(수수료 포함)을 쓰고 취소 줄은 빼서 순액으로 검산", () => {
    const html = woori(
      wRow("09/01", "휴대폰메시지 면제", "", "", "0") +
        wRow("10/01", "가짜 식당", "35,000", "", "35,000") +
        wRow("10/13", "GOOGLE CLOUD", "6,845", "20", "6,865") +
        wRow("10/20", "가짜 취소", "-10,000", "", "-10,000"),
      "31,865",
    );
    assert.ok(isWooriStatement(html));
    const p = parseWooriStatement(html);
    assert.equal(p.ok, true, p.checks.join());
    assert.equal(p.rows.length, 3); // 0원 안내 줄은 뺀다
    assert.equal(p.rows[1].outAmount, 6865);
    assert.deepEqual(p.rows[1].matchAmounts, [6865, 6845]); // 겹침은 수수료 전 금액으로도 본다
    assert.equal(p.rows[2].inAmount, 10000);
    assert.equal(p.rows[0].occurredAt, "2026-10-01 00:00:00");
  });
  test("「선결제-…」 줄은 장부 줄이 아니다 — 빼고, 검산에서만 차감 (2026-08 실물 47줄)", () => {
    const html = woori(
      wRow("08/04", "가짜 식당", "35,000", "", "35,000") +
        wRow("08/18", "선결제-가짜 배달", "-30,000", "", "-30,000") +
        wRow("08/18", "선결제-가짜 마트", "-5,000", "", "-5,000") +
        wRow("08/20", "가짜 주유소", "50,000", "", "50,000"),
      "50,000",
      "2026년08월01일 ~ 2026년08월31일",
    );
    const p = parseWooriStatement(html);
    assert.equal(p.ok, true, p.checks.join());
    assert.equal(p.prepaid, 35000);
    assert.equal(p.rows.length, 2);
    assert.equal(p.rows.some((r) => /선결제/.test(r.description)), false);
    assert.equal(p.rows.some((r) => r.inAmount > 0), false);
  });
  test("1월 명세서의 12월 줄은 전년도", () => {
    const p = parseWooriStatement(woori(wRow("12/30", "가짜", "1,000", "", "1,000"), "1,000", "2027년01월01일 ~ 2027년01월31일"));
    assert.equal(p.rows[0].occurredAt, "2026-12-30 00:00:00");
  });
});

describe("filterStatementOverlap", () => {
  const line = (day: string, amts: number[], foreign = false) => ({
    source: "법인카드" as const, occurredAt: `${day} 00:00:00`, description: "x", inAmount: 0, outAmount: amts[0],
    balance: null, approvalNo: null, bizNo: null, installment: null, branch: null, payerCode: null, matchAmounts: amts, foreign,
  });
  test("해외 줄은 ±3일·5% 안이면 같은 결제 (승인 원화 ≠ 청구 원화) — 국내 줄은 정확히만", () => {
    const r = filterStatementOverlap(
      [line("2026-07-15", [32569], true), line("2026-07-15", [32569])],
      [{ day: "2026-07-13", outAmount: 31800 }, { day: "2026-07-13", outAmount: 31800 }],
    );
    assert.equal(r.dropped.length, 1); // 해외 줄만 짝
    assert.equal(r.keep.length, 1);
    const far = filterStatementOverlap([line("2026-07-15", [32569], true)], [{ day: "2026-07-15", outAmount: 25000 }]);
    assert.equal(far.keep.length, 1); // 5% 넘게 다르면 다른 결제
  });
  test("승인 엑셀로 이미 있는 줄(±1일·같은 금액)은 뺀다 — 수수료 전 금액으로도", () => {
    const r = filterStatementOverlap(
      [line("2026-09-10", [35000]), line("2026-09-13", [6865, 6845]), line("2026-10-02", [24400])],
      [{ day: "2026-09-11", outAmount: 35000 }, { day: "2026-09-13", outAmount: 6845 }],
    );
    assert.equal(r.dropped.length, 2);
    assert.equal(r.keep.length, 1);
    assert.equal(r.keep[0].occurredAt.slice(0, 10), "2026-10-02");
  });
  test("같은 날 같은 금액 두 번 결제 — 기존 한 줄은 한 번만 짝", () => {
    const r = filterStatementOverlap([line("2026-09-10", [5000]), line("2026-09-10", [5000])], [{ day: "2026-09-10", outAmount: 5000 }]);
    assert.equal(r.dropped.length, 1);
    assert.equal(r.keep.length, 1);
  });
});

describe("isVestMail", () => {
  test("VestMail 표식", () => {
    assert.equal(isVestMail(`<script>var b_p='x';eval(atob(b_p))</script> VestMail <form id="decForm"></form>`), true);
    assert.equal(isVestMail("<html>보통 메일</html>"), false);
  });
});
