import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isSpecChapter, pickSpecDoc, titleHasCode, type ArchiveDoc } from "./spec-archive";
import { looksLikeWheelSize } from "./spec-core";
import { gridToText } from "./spec-html";
import { harvestGrids } from "./spec-manual";
import { gapThreshold, groupRows, joinWords, splitColumns, tablesInBand, type PdfItem } from "./spec-pdf";
import { specFilter } from "./spec-verify";

/**
 * 🔴 아래 자리값은 2026-09-03 에 실제로 받아 온
 *    현대 자료실 `2016 TQ-8-차량정보.pdf` 2쪽의 x·y 를 그대로 옮긴 것이다.
 *    PDF 는 표 테두리를 안 알려 주고 **글자 자리만** 준다. 그래서 이 자리에서
 *    표를 되살리지 못하면 값이 통째로 사라지거나 엉뚱한 줄에 붙는다.
 */
function item(x: number, y: number, s: string, w = s.length * 4.2, h = 8): PdfItem {
  return { x, x2: x + w, y, h, s };
}

/**
 * 그랜드 스타렉스 TQ 「타이어 및 휠」 — 세로 병합 칸(`11~13`)이 두 줄 사이에 떠 있다.
 * 🔴 이 시험은 **표 되살리기**(`tablesInBand`)만 본다. 단 가르기는 따로 시험한다 —
 *    한 표만 떼어 놓으면 표 안의 넓은 빈 칸이 단 경계처럼 보여 시험이 헛돈다.
 */
const TQ_TIRE: PdfItem[] = [
  item(330, 142.5, "추천공기압 kPa(psi)"),
  item(502, 128, "휠 너트 체결토크"),
  item(300, 115, "왜건(미니버스)"),
  item(430, 115, "밴"),
  item(518, 115, "kgf.m"),
  item(106, 104, "휠"),
  item(194, 104, "타이어"),
  item(266, 104, "앞"),
  item(330, 104, "뒤"),
  item(394, 104, "앞"),
  item(458, 104, "뒤"),
  /* 16인치 줄 — 글자가 한 자씩 쪼개져 온다 */
  item(123, 84, "6", 5),
  item(128, 84, ".", 2),
  item(130, 84, "5", 5),
  item(135, 84, "J", 5),
  item(143, 84, "×", 6),
  item(152, 84, "16", 10),
  item(181, 84, "215/70R16C", 42),
  item(255, 84, "290(42)", 30),
  item(319, 84, "325(47)", 30),
  item(394, 84, "290(42)", 30),
  item(458, 84, "350(51)", 30),
  /* 두 줄에 걸친 칸들 — 줄 사이에 떠 있다 */
  item(54, 79, "장착 타이어,", 40),
  item(518, 73.5, "11~13", 22),
  item(55, 68, "예비 타이어", 40),
  /* 17인치 줄 */
  item(123, 63.5, "6.5J", 20),
  item(143, 63.5, "×", 6),
  item(152, 63.5, "17", 10),
  item(178, 63.5, "215/65R17 XL", 50),
  item(255, 63.5, "290(42)", 30),
  item(319, 63.5, "290(42)", 30),
];

describe("PDF 자리값 → 표 격자", () => {
  it("쪼개진 글자를 낱말로 붙인다 — `6 . 5 J × 16` 은 한 낱말, 옆 칸과는 떨어진다", () => {
    const rows = groupRows(TQ_TIRE.filter((i) => i.y === 84));
    const words = joinWords(rows[0], gapThreshold(rows)).map((w) => w.s);
    assert.ok(words.includes("6.5J × 16"), `붙인 결과: ${words.join(" / ")}`);
    assert.ok(words.includes("215/70R16C"), "타이어 규격은 따로 서야 한다");
    assert.ok(looksLikeWheelSize("6.5J × 16"), "휠 규격으로 읽혀야 한다");
  });

  it("🔴 세로로 합쳐진 칸이 자료 줄 **둘 다**에 붙는다 — 안 그러면 17인치에 토크가 없다", () => {
    const grids = tablesInBand(groupRows(TQ_TIRE));
    const text = grids.map(gridToText).join("\n");
    const rows16 = text.split("\n").filter((l) => l.includes("215/70R16C"));
    const rows17 = text.split("\n").filter((l) => l.includes("215/65R17"));
    assert.equal(rows16.length, 1, text);
    assert.equal(rows17.length, 1, text);
    assert.match(rows16[0], /11~13/);
    assert.match(rows17[0], /11~13/, "17인치 줄에도 토크가 있어야 한다");
  });

  it("🔴 뽑은 값이 전부 검사를 통과한다 — 인용문이 격자 글자와 맞는다", () => {
    const grids = tablesInBand(groupRows(TQ_TIRE));
    const specs = harvestGrids("", grids);
    assert.ok(specs.length >= 10, `${specs.length}개만 나왔다`);
    const src = grids.map(gridToText).join("\n");
    for (const c of specs) {
      const p = specFilter(c, src, { bodyType: "밴·소형버스" });
      assert.equal(p, null, `${c.item}: ${p?.reason}`);
    }
  });

  it("왜건과 밴을 구별해 이름을 붙인다 — 같은 「뒤」인데 325 와 350 이다", () => {
    const specs = harvestGrids("", tablesInBand(groupRows(TQ_TIRE)));
    const back = specs.filter((c) => c.item === "tire_pressure" && c.qualifier?.["위치"] === "뒤");
    const labels = back.map((c) => c.qualifier?.["구분"] ?? "");
    assert.ok(labels.some((l) => /왜건/.test(l)), `구분: ${labels.join(" / ")}`);
    assert.ok(labels.some((l) => /밴/.test(l)), `구분: ${labels.join(" / ")}`);
  });

  it("앞뒤 공기압이 두 단위로 함께 들어온다", () => {
    const specs = harvestGrids("", tablesInBand(groupRows(TQ_TIRE)));
    const p = specs.find((c) => c.item === "tire_pressure");
    assert.ok(p);
    assert.equal(p.unit, "kPa");
    assert.equal(p.altUnit, "psi");
  });
});

describe("좌우 2단 편집 가르기", () => {
  /** 왼쪽에 「차량 제원」, 오른쪽에 「타이어 에너지 소비효율등급」 — 실제 쪽 모양 */
  const TWO_COL: PdfItem[] = [
    ...[0, 1, 2, 3, 4, 5].map((k) => item(57, 300 - k * 15, `전 장${k}`, 40)),
    ...[0, 1, 2, 3, 4, 5].map((k) => item(120, 300 - k * 15, `5,15${k}`, 25)),
    ...[0, 1, 2, 3, 4, 5].map((k) => item(330, 300 - k * 15, `한국(Hankook)`, 60)),
    ...[0, 1, 2, 3, 4, 5].map((k) => item(410, 300 - k * 15, `215/6${k}R17`, 45)),
  ];

  it("🔴 높이로만 묶으면 왼쪽 표와 오른쪽 표가 한 줄로 섞인다 — 빈 골목에서 가른다", () => {
    const bands = splitColumns(TWO_COL);
    assert.equal(bands.length, 2);
    assert.ok(bands[0].every((i) => i.x < 300));
    assert.ok(bands[1].every((i) => i.x >= 300));
  });

  it("골목이 없으면 가르지 않는다", () => {
    const oneCol = [...Array(12)].map((_, k) => item(50 + (k % 3) * 40, 300 - k * 12, `값${k}`, 30));
    assert.equal(splitColumns(oneCol).length, 1);
  });
});

describe("칸 사이 틈은 문서마다 다르다", () => {
  it("촘촘한 표는 작은 틈, 넉넉한 표는 큰 틈으로 잡는다", () => {
    const wide = groupRows(TQ_TIRE);
    const tight = groupRows([
      item(50, 100, "(P)235/60 R18", 46),
      item(100, 100, "7.5J×18", 26),
      item(130, 100, "235(34)", 26),
      item(160, 100, "235(34)", 26),
      item(190, 100, "11~13", 20),
    ]);
    assert.ok(gapThreshold(tight) < gapThreshold(wide), `촘촘 ${gapThreshold(tight)} vs 넉넉 ${gapThreshold(wide)}`);
  });
});

describe("자료실 문서 고르기", () => {
  const doc = (title: string, year: string): ArchiveDoc => ({
    sn: title,
    title,
    category: "취급설명서 (단종차종)",
    fileName: `${title}.pdf`,
    kind: "PDF",
    url: `https://www.hyundai.com/files/${year}.pdf`,
    year: Number(year),
  });

  it("「차량정보」 장만 고른다", () => {
    assert.equal(isSpecChapter("2016 TQ-8-차량정보"), true);
    assert.equal(isSpecChapter("2016 TQ-3-안전장치"), false);
  });

  it("🔴 `RBK` 는 `BK` 가 아니다 — 이름이 비슷하다고 남의 차 문서를 집으면 안 된다", () => {
    assert.equal(titleHasCode("2016 BK-8-차량정보", "BK"), true);
    assert.equal(titleHasCode("2018RBK-8-차량 정보", "BK"), false);
  });

  it("코드가 맞는 것 중 가장 최신 연식을 고른다", () => {
    const docs = [doc("2014 DM-8-차량정보", "2014"), doc("2017 DM-8-차량정보", "2017"), doc("2018RBK-8-차량 정보", "2018")];
    assert.equal(pickSpecDoc(docs, "DM")?.year, 2017);
  });

  it("코드가 맞는 게 없으면 **아무것도 안 고른다** — 짐작하지 않는다", () => {
    assert.equal(pickSpecDoc([doc("2018RBK-8-차량 정보", "2018")], "BK"), null);
    assert.equal(pickSpecDoc([], "HR"), null);
  });
});
