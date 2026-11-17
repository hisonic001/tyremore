import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contactKindFor,
  contactTargets,
  describeSet,
  formatStorageNo,
  parseLabelSize,
  parseStorageMemo,
  parseStorageNoQuery,
  suggestDropKind,
  validateDrop,
  type ContactRow,
  composeSize,
  joinBrands,
  parseSizeParts,
  sizeHints,
  splitBrands,
  labelKind,
  parseLabelPaper,
  brandsIn,
} from "./tire-storage-pure";

test("라벨 — 일반/윈터 · 용지 기본 A4 · COOPER", () => {
  assert.equal(labelKind("스노"), "윈터");
  assert.equal(labelKind("일반"), "일반");
  assert.equal(parseLabelPaper(null), "a4");
  assert.equal(parseLabelPaper("label"), "label");
  assert.deepEqual(brandsIn("235/55R19 *4개 COOPER"), ["쿠퍼"]);
});

test("규격 칸 셋 — 읽기·만들기", () => {
  assert.deepEqual(parseSizeParts("225/45R18"), { w: 225, a: 45, r: 18 });
  assert.deepEqual(parseSizeParts("225/45 zr 18"), { w: 225, a: 45, r: 18 });
  assert.deepEqual(parseSizeParts("145R13C"), { w: 145, a: null, r: 13, c: true });
  assert.equal(parseSizeParts("245/40+275/35R20"), null);
  assert.equal(composeSize({ w: 235, a: 55, r: 19 }), "235/55R19");
  assert.equal(composeSize({ w: 145, a: null, r: 13, c: true }), "145R13C");
});

test("규격 바로 고르기 — 겹침 없이, 읽히는 것만", () => {
  assert.deepEqual(sizeHints("225/45R18", null, "225/45ZR18", "195/70R15, 145R13", "엉뚱"), ["225/45R18", "195/70R15", "145R13"]);
});

test("브랜드 여러 개", () => {
  assert.deepEqual(splitBrands("금호,넥센"), ["금호", "넥센"]);
  assert.equal(joinBrands(["금호", "넥센", "금호"]), "금호,넥센");
  assert.deepEqual(splitBrands(null), []);
});

test("보관번호 — 4자리, 1만부터 그대로", () => {
  assert.equal(formatStorageNo(12), "0012");
  assert.equal(formatStorageNo(1), "0001");
  assert.equal(formatStorageNo(12345), "12345");
  assert.equal(formatStorageNo(null), "----");
});

test("검색어 → 보관번호", () => {
  assert.equal(parseStorageNoQuery("#12"), 12);
  assert.equal(parseStorageNoQuery("0012"), 12);
  assert.equal(parseStorageNoQuery(" 7 "), 7);
  assert.equal(parseStorageNoQuery("0"), null);
  assert.equal(parseStorageNoQuery("12가3456"), null);
  assert.equal(parseStorageNoQuery("225/45R18"), null);
});

test("라벨 크기 — 엉뚱하면 기본값", () => {
  assert.deepEqual(parseLabelSize("62x40"), { w: 62, h: 40 });
  assert.deepEqual(parseLabelSize("100×50mm"), { w: 100, h: 50 });
  assert.deepEqual(parseLabelSize("62*29"), { w: 62, h: 29 });
  assert.deepEqual(parseLabelSize("5x5"), { w: 62, h: 40 });
  assert.deepEqual(parseLabelSize(null), { w: 62, h: 40 });
});

test("세트 한 줄 설명", () => {
  assert.equal(describeSet({ brand: "미쉐린", kind: "스노", qty: 4, size: "225/45R18" }), "미쉐린 스노 4본 225/45R18");
  assert.equal(describeSet({ kind: "일반", qty: 2 }), "일반 2본");
});

test("맡길 종류 짐작 — 찾아가는 세트 반대 > 끼우는 타이어 > 달", () => {
  assert.equal(suggestDropKind({ pickupKinds: ["스노"], mountedSeasons: ["여름"] }), "일반");
  assert.equal(suggestDropKind({ pickupKinds: ["일반"] }), "스노");
  assert.equal(suggestDropKind({ mountedSeasons: ["겨울"] }), "일반");
  assert.equal(suggestDropKind({ mountedSeasons: ["사계절"] }), "스노");
  assert.equal(suggestDropKind({ month: 11 }), "일반");
  assert.equal(suggestDropKind({ month: 4 }), "스노");
});

test("맡김 검사", () => {
  assert.equal(validateDrop({ kind: "스노", qty: 4 }), null);
  assert.ok(validateDrop({ kind: null, qty: 4 }));
  assert.ok(validateDrop({ kind: "일반", qty: 0 }));
  assert.ok(validateDrop({ kind: "일반", qty: 9 }));
});

/* --- 판매 메모 해석 — 실제 메모 모양 (이름·번호판 없음) --- */

test("메모: 스노 꺼내 끼우고 일반 맡김 — 규격은 뒤 괄호", () => {
  const p = parseStorageMemo("금호 스노 보관 탈부착 4개/금호 일반 4개보관[215/55R17]-카드");
  assert.equal(p.none, false);
  assert.equal(p.pickups.length, 1);
  assert.equal(p.pickups[0].kind, "스노");
  assert.deepEqual(p.drops, [{ kind: "일반", brand: "금호", size: "215/55R17", qty: 4 }]);
});

test("메모: 띄어쓰기 없이 붙은 모양", () => {
  const p = parseStorageMemo("한국스노보관탈부착4개[175/65R14]라우펜일반4개보관[165/60R14]");
  assert.deepEqual(p.drops, [{ kind: "일반", brand: "라우펜", size: "165/60R14", qty: 4 }]);
  assert.equal(p.pickups[0].brand, "한국");
});

test("메모: 맡김이 괄호 안 — 종류 낱말 없으면 찾아간 세트의 반대", () => {
  const p = parseStorageMemo("금호 스노 보관 탈부착4개[245/45R18 미쉐린 4개 보관]-카드(소낙스 탈취제 서비스)");
  assert.deepEqual(p.drops, [{ kind: "일반", brand: "미쉐린", size: "245/45R18", qty: 4 }]);
});

test("메모: 폐기·보관 없음 → 맡김 0", () => {
  const p = parseStorageMemo("금호 스노 보관 탈부착4개[165/60R14]/금호 일반 4개 폐기[보관 없음]-카드");
  assert.equal(p.none, true);
  assert.equal(p.drops.length, 0);
  assert.equal(parseStorageMemo("한국스노 보관탈부착4개/컨티 일반 4개폐기[275/40R21]-카드").drops.length, 0);
});

test("메모: 보관되어 있던 것 가져감 → 찾아감", () => {
  const p = parseStorageMemo("차 팔아서 보관되어 있던 한국 스노우 225/55R17*3개 가져가심");
  assert.equal(p.drops.length, 0);
  assert.equal(p.pickups.length, 1);
});

test("메모: 보관료 이야기는 무시", () => {
  const p = parseStorageMemo("금호 235/65R17 스노우 WS71*4개 결제[공임,보관은 거래처 청구하기 나중에");
  assert.equal(p.drops.length, 0);
  assert.equal(p.pickups.length, 0);
});

test("메모: 섞인 브랜드·본수·두 규격", () => {
  const a = parseStorageMemo("한국 스노 보관 탈부착 4개/금호(2),넥센굿(2)총 4개보관[205/55R16]-현금");
  assert.deepEqual(a.drops, [{ kind: "일반", brand: "금호,넥센", size: "205/55R16", qty: 4 }]);
  const b = parseStorageMemo("금호 235/60R18 WS71*4개[제너럴 일반 2개만 보관/2개는 마모로 폐기]-카드", 11);
  assert.deepEqual(b.drops, [{ kind: "일반", brand: "제너럴", size: "235/60R18", qty: 2 }]);
  const c = parseStorageMemo("한국스노보관탈부착6개[195/70R15(미쉐린),145R13(한국)일반 6개 보관]-카드");
  assert.equal(c.drops[0].qty, 6);
  assert.equal(c.drops[0].size, "195/70R15, 145R13");
});

test("메모: 스노를 사서 끼우고 일반 맡김 — 달로 짐작", () => {
  const p = parseStorageMemo("금호 245/40R19 WP72*4개[넥센 235/45R19*4개 보관] -카드(선완불,예약)", 11);
  assert.deepEqual(p.drops, [{ kind: "일반", brand: "넥센", size: "235/45R19", qty: 4 }]);
});

test("메모: 보관하던 것을 폐기 / 같은 글 두 번", () => {
  const p = parseStorageMemo("앞 전에 보관되어있던 쿠퍼 일반 보관 타이어 마모로 폐기 4개/오늘 한거는 보관(이 타이어도 쿠퍼임)", 10);
  assert.equal(p.drops.length, 1);
  assert.equal(p.drops[0].brand, "쿠퍼");
  const twice = "금호 스노 보관 탈부착 4개/금호 일반 4개보관[215/55R17]";
  assert.equal(parseStorageMemo(`${twice} / ${twice}`).drops.length, 1);
});

test("메모: 보관 언급 없음", () => {
  assert.deepEqual(parseStorageMemo("금호 225/45R18 4개 교체-카드"), { none: false, drops: [], pickups: [] });
  assert.deepEqual(parseStorageMemo(null), { none: false, drops: [], pickups: [] });
});

/* --- 연락 명단 --- */

test("연락할 쪽 — 8~12월 스노, 1~7월 일반", () => {
  assert.equal(contactKindFor(11), "스노");
  assert.equal(contactKindFor(8), "스노");
  assert.equal(contactKindFor(3), "일반");
  assert.equal(contactKindFor(1), "일반");
});

test("연락 명단 — 손님 하나당 한 줄, 오래된 순, 거래처는 거래처 이름", () => {
  const base: Omit<ContactRow, "storageNo" | "customerId" | "storedOn" | "kind"> = {
    customerName: "손님",
    supplierName: null,
    phone: "01000000000",
    plateNo: "00가0000",
    describe: "일반 4본",
    consentMarketing: false,
  };
  const rows: ContactRow[] = [
    { ...base, storageNo: 3, customerId: 1, storedOn: "2026-11-10", kind: "일반" },
    { ...base, storageNo: 5, customerId: 1, storedOn: "2026-11-01", kind: "일반", plateNo: "11나1111" },
    { ...base, storageNo: 7, customerId: 2, storedOn: "2026-10-01", kind: "일반", supplierName: "거래처A" },
    { ...base, storageNo: 9, customerId: 3, storedOn: "2026-09-01", kind: "스노" },
  ];
  const t = contactTargets(rows, "일반");
  assert.equal(t.length, 2);
  assert.equal(t[0].name, "거래처A");
  assert.equal(t[1].sets.length, 2);
  assert.equal(t[1].oldest, "2026-11-01");
  assert.deepEqual(t[1].plates, ["00가0000", "11나1111"]);
});
