import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { bodyTextOf, gridToText, parseTable, parseTables, pageTitle, topicBody } from "./spec-html";
import { harvestGrids, parseOilTable, parseTireWheelTable, readNumCell, unitsInHeader, viscosityIn } from "./spec-manual";
import { specFilter } from "./spec-verify";

/**
 * 🔴 아래 표 조각은 2026-09-03 에 실제로 받아 온
 *    ownersmanual.kia.com/full_webhelp/MQ4/2022/ko_KR/topics/t01115.html 의 모양 그대로다.
 *    **합쳐진 칸(rowspan)** 이 있어서, 그냥 글자로 펴면 20인치 줄에 공기압도 토크도 없어진다.
 */
const TIRE_TABLE = `
<table data-cols="5"><thead>
  <tr><th rowspan="2"><p>타이어 형식</p></th><th rowspan="2"><p>휠</p></th>
      <th colspan="2"><p>추천 공기압 [kpa(psi)]</p></th>
      <th rowspan="2"><p>휠 너트 체결 토크(kgf·m)</p></th></tr>
  <tr><th><p>앞</p></th><th><p>뒤</p></th></tr>
</thead><tbody>
  <tr><td><p>235/60 R18</p></td><td><p>7.5Jx18</p></td>
      <td rowspan="2"><p>240(35)</p></td><td rowspan="2"><p>240(35)</p></td>
      <td rowspan="2"><p>11~13</p></td></tr>
  <tr><td><p>255/45 R20</p></td><td><p>8.5Jx20</p></td></tr>
</tbody></table>`;

/**
 * 🔴 **스태거드 — 앞뒤 규격이 다른 차** (G80 RG3 모양, 2026-09-05 사장님 지적)
 *
 * 지금까지 시험 표는 전부 앞뒤 같은 규격이라 **이 결함이 한 번도 재현되지 않았다.**
 * 실제 DB 에서는 19인치 앞 245/45R19 와 뒤 275/40R19 가 **별개 두 벌**로 들어가
 * 화면에 「19인치 옵션이 두 개」로 보이고 있었다.
 */
const STAGGERED_TABLE = `
<table data-cols="5"><thead>
  <tr><th><p>구분</p></th><th><p>타이어 형식</p></th><th><p>휠</p></th>
      <th><p>추천 공기압 [kpa(psi)]</p></th>
      <th><p>휠 너트 체결 토크(kgf·m)</p></th></tr>
</thead><tbody>
  <tr><td><p>전륜</p></td><td><p>245/45R19</p></td><td><p>8.5Jx19</p></td>
      <td><p>250(36)</p></td><td rowspan="2"><p>14~16</p></td></tr>
  <tr><td><p>후륜</p></td><td><p>275/40R19</p></td><td><p>9.5Jx19</p></td>
      <td><p>250(36)</p></td></tr>
  <tr><td><p>전륜</p></td><td><p>245/40R20</p></td><td><p>8.5Jx20</p></td>
      <td><p>250(36)</p></td><td rowspan="2"><p>14~16</p></td></tr>
  <tr><td><p>후륜</p></td><td><p>275/35R20</p></td><td><p>9.5Jx20</p></td>
      <td><p>250(36)</p></td></tr>
</tbody></table>`;

/** t01118.html 「추천 오일 및 용량」 모양 */
const OIL_TABLE = `
<table><thead><tr><th colspan="3"><p>종류</p></th><th><p>용량(L)</p></th><th><p>추천 사양</p></th></tr></thead><tbody>
  <tr><td rowspan="2"><p>엔진 오일</p></td><td><p>디젤 엔진</p></td><td><p>스마트스트림 D2.2</p></td>
      <td><p>5.6</p></td><td><p>ACEA C5, C2 또는 C3급 SAE 점도 분류</p></td></tr>
  <tr><td><p>가솔린 엔진</p></td><td><p>스마트스트림 G2.5 T-GDi</p></td>
      <td><p>5.8</p></td><td><p>SAE 0W-30, API SN PLUS/SP 또는 ILSAC GF-6<sup>*1</sup></p></td></tr>
  <tr><td colspan="3"><p>브레이크 오일</p></td>
      <td><p>필요량(리저버 탱크 용량 : 493 &plusmn; 20 cc)</p></td><td><p>DOT 4</p></td></tr>
</tbody></table>`;

describe("합쳐진 칸(rowspan) 펴기 — 이게 안 되면 값이 어긋난다", () => {
  it("🔴 20인치 줄이 위 줄의 공기압·토크를 물려받는다", () => {
    const g = parseTable(TIRE_TABLE);
    assert.equal(g.headRows, 2);
    assert.deepEqual(g.cells[2], ["235/60 R18", "7.5Jx18", "240(35)", "240(35)", "11~13"]);
    assert.deepEqual(g.cells[3], ["255/45 R20", "8.5Jx20", "240(35)", "240(35)", "11~13"]);
  });

  it("가로로 합쳐진 머리글(colspan)도 펴진다", () => {
    const g = parseTable(TIRE_TABLE);
    assert.equal(g.cells[0][2], "추천 공기압 [kpa(psi)]");
    assert.equal(g.cells[0][3], "추천 공기압 [kpa(psi)]");
    assert.equal(g.cells[1][2], "앞");
    assert.equal(g.cells[1][3], "뒤");
  });

  it("모든 줄의 칸 수가 같다 — 네모여야 자리로 항목을 정할 수 있다", () => {
    const g = parseTable(TIRE_TABLE);
    assert.equal(new Set(g.cells.map((r) => r.length)).size, 1);
  });
});

describe("칸 안의 값 읽기", () => {
  it("240(35) 는 두 단위를 같이 적은 것이다", () => {
    assert.deepEqual(readNumCell("240(35)"), { min: 240, max: null, alt: 35, unit: null });
  });
  it("11~13 은 범위다", () => {
    assert.deepEqual(readNumCell("11~13"), { min: 11, max: 13, alt: null, unit: null });
  });
  it("🔴 현대는 범위를 붙임표로 적는다 — `11-13` 을 못 읽으면 토크가 사라진다", () => {
    assert.deepEqual(readNumCell("11-13"), { min: 11, max: 13, alt: null, unit: null });
  });
  it("🔴 단위가 칸 안에 있는 경우 — 현대는 머리글이 그냥 `용량` 이고 칸이 `4.3 ℓ` 다", () => {
    assert.deepEqual(readNumCell("4.3 ℓ"), { min: 4.3, max: null, alt: null, unit: "L" });
    assert.deepEqual(readNumCell("6.8ℓ"), { min: 6.8, max: null, alt: null, unit: "L" });
  });
  it("음수를 범위로 오해하지 않는다 — 점도표에 -30 같은 온도가 있다", () => {
    assert.equal(readNumCell("-30"), null);
  });
  it("🔴 493 ± 20 cc 는 읽지 않는다 — ±를 풀면 전사가 아니라 계산이다", () => {
    assert.equal(readNumCell("493 ± 20 cc"), null);
  });
  it("글자가 섞이면 안 읽는다", () => {
    assert.equal(readNumCell("필요량(리저버 탱크 용량 : 493 ± 20 cc)"), null);
    assert.equal(readNumCell("적당량"), null);
  });
  it("머리글에서 단위를 꺼낸다", () => {
    assert.deepEqual(unitsInHeader("휠 너트 체결 토크(kgf·m)"), { unit: "kgf·m", alt: null });
    assert.deepEqual(unitsInHeader("추천 공기압 [kpa(psi)]"), { unit: "kPa", alt: "psi" });
    assert.deepEqual(unitsInHeader("용량(L)"), { unit: "L", alt: null });
    assert.deepEqual(unitsInHeader("추천 사양"), { unit: null, alt: null });
  });
  it("추천 사양에서 점도만 꺼낸다", () => {
    assert.equal(viscosityIn("SAE 0W-30, API SN PLUS/SP 또는 ILSAC GF-6"), "0W-30");
    assert.equal(viscosityIn("ACEA C5, C2 또는 C3급 SAE 점도 분류"), null);
  });
});

describe("타이어·휠 표를 값으로", () => {
  const got = parseTireWheelTable(parseTable(TIRE_TABLE));
  const pick = (item: string, group: number, where?: string) =>
    got.find((c) => c.item === item && c.groupNo === group && (!where || c.qualifier?.["위치"] === where));

  it("인치별로 한 벌씩 묶인다", () => {
    assert.equal(new Set(got.map((c) => c.groupNo)).size, 2);
    assert.equal(pick("tire_size", 1)?.textValue, "235/60 R18");
    assert.equal(pick("tire_size", 2)?.textValue, "255/45 R20");
  });

  it("🔴 20인치 줄에도 토크가 붙는다 — 합쳐진 칸을 폈기 때문이다", () => {
    const t = pick("wheel_nut_torque", 2);
    assert.ok(t);
    assert.equal(t.numMin, 11);
    assert.equal(t.numMax, 13);
    assert.equal(t.unit, "kgf·m");
  });

  it("앞뒤 공기압이 갈라져 들어간다", () => {
    assert.equal(pick("tire_pressure", 1, "앞")?.numMin, 240);
    assert.equal(pick("tire_pressure", 1, "뒤")?.numMin, 240);
    assert.equal(pick("tire_pressure", 1, "앞")?.altNum, 35);
    assert.equal(pick("tire_pressure", 1, "앞")?.altUnit, "psi");
  });

  it("🔴 뽑은 값이 전부 검사를 통과한다 — 인용문이 원문에 그대로 있다", () => {
    const source = gridToText(parseTable(TIRE_TABLE));
    for (const c of got) {
      const p = specFilter(c, source, { bodyType: "SUV" });
      assert.equal(p, null, `${c.item} 이 걸렸다: ${p?.reason}`);
    }
  });
});

/**
 * 🔴 「차량 제원」 쪽의 치수 표. 여기서 `235/60 R18` 은 값이 아니라
 *    **어느 타이어일 때인지 알려주는 조건**이다 (쏘렌토 MQ4 실측 2026-09-03).
 *    그대로 읽으면 규격만 덜렁 든 가짜 한 벌이 네 개 생겼었다.
 */
const DIMENSION_TABLE = `
<table><thead><tr><th><p>항목</p></th><th><p>구분</p></th><th><p>타이어</p></th><th><p>치수(mm)</p></th></tr></thead><tbody>
  <tr><td rowspan="2"><p>윤거</p></td><td><p>전</p></td><td><p>235/60 R18</p></td><td><p>1,646</p></td></tr>
  <tr><td><p>후</p></td><td><p>255/45 R20</p></td><td><p>1,637</p></td></tr>
</tbody></table>`;

describe("타이어 규격이 있다고 다 타이어 표는 아니다", () => {
  it("🔴 치수 표에서는 아무것도 뽑지 않는다 — 휠·공기압·토크 칸이 없다", () => {
    assert.deepEqual(parseTireWheelTable(parseTable(DIMENSION_TABLE)), []);
  });

  it("휠 칸만 있어도 타이어 표로 본다", () => {
    const t = `<table><thead><tr><th><p>형식</p></th><th><p>휠</p></th></tr></thead>
      <tbody><tr><td><p>195/65R15</p></td><td><p>6.0Jx15</p></td></tr></tbody></table>`;
    const got = parseTireWheelTable(parseTable(t));
    assert.equal(got.length, 2);
  });
});

describe("오일 표를 값으로", () => {
  const got = parseOilTable(parseTable(OIL_TABLE));
  const find = (item: string) => got.filter((c) => c.item === item);

  it("엔진별로 용량이 갈라진다 — 디젤 5.6L · 가솔린 5.8L", () => {
    const q = find("engine_oil_qty");
    assert.equal(q.length, 2);
    assert.ok(q.some((c) => c.numMin === 5.6 && /디젤/.test(c.groupLabel ?? "")));
    assert.ok(q.some((c) => c.numMin === 5.8 && /가솔린/.test(c.groupLabel ?? "")));
    assert.ok(q.every((c) => c.unit === "L"));
  });

  it("점도는 따로 한 줄 더 만든다 — 현장에서 제일 자주 묻는 값이다", () => {
    assert.equal(find("engine_oil_viscosity")[0]?.textValue, "0W-30");
  });

  it("각주 표시 *1 은 값에서 뗀다", () => {
    assert.ok(find("engine_oil_spec").some((c) => c.textValue === "SAE 0W-30, API SN PLUS/SP 또는 ILSAC GF-6"));
  });

  it("🔴 브레이크액은 규격만 넣고 용량은 안 넣는다 — 493±20cc 는 우리가 풀 값이 아니다", () => {
    assert.equal(find("brake_fluid_spec")[0]?.textValue, "DOT 4");
    assert.equal(got.filter((c) => /brake/.test(c.item) && c.numMin != null).length, 0);
  });

  it("뽑은 값이 전부 검사를 통과한다", () => {
    const source = gridToText(parseTable(OIL_TABLE));
    for (const c of got) {
      const p = specFilter(c, source, { bodyType: "SUV" });
      assert.equal(p, null, `${c.item} 이 걸렸다: ${p?.reason}`);
    }
  });
});

/**
 * 🔴 현대는 적는 법이 다르다 (ownersmanual.hyundai.com/full_webhelp/GN7/2026, 실측):
 *    · 공기압 머리글에 괄호가 통째로 없다 — `추천 공기압 kPa (psi)`
 *    · 토크 머리글에도 괄호가 없다 — `휠 너트 체결토크 kgf·m`
 *    · 규격 칸 머리글이 `형 식` (가운데 공백), 앞에 `구 분` 칸이 하나 더 있다
 *    이 셋 중 하나만 놓쳐도 조용히 값이 틀리거나 사라진다.
 */
const HYUNDAI_TIRE_TABLE = `
<table><thead>
  <tr><th rowspan="2"><p>구 분</p></th><th rowspan="2"><p>형 식</p></th><th rowspan="2"><p>휠</p></th>
      <th colspan="2"><p>추천 공기압 kPa (psi)</p></th>
      <th rowspan="2"><p>휠 너트 체결토크 kgf&middot;m</p></th></tr>
  <tr><th><p>앞</p></th><th><p>뒤</p></th></tr>
</thead><tbody>
  <tr><td rowspan="3"><p>장착 타이어</p></td><td><p>225/55R18</p></td><td><p>7.5J X 18</p></td>
      <td><p>230(33)</p></td><td><p>230(33)</p></td><td rowspan="3"><p>11~13</p></td></tr>
  <tr><td><p>245/45R19</p></td><td><p>8.0J X 19</p></td><td><p>230(33)</p></td><td><p>230(33)</p></td></tr>
  <tr><td><p>245/40R20</p></td><td><p>8.0J X 20</p></td><td><p>230(33)</p></td><td><p>230(33)</p></td></tr>
</tbody></table>`;

describe("현대 표 — 적는 법이 달라도 같은 값이 나와야 한다", () => {
  const got = parseTireWheelTable(parseTable(HYUNDAI_TIRE_TABLE));

  it("🔴 `kPa (psi)` 를 psi 로 잘못 읽지 않는다 — 230psi 는 1586kPa 다", () => {
    const p = got.find((c) => c.item === "tire_pressure");
    assert.ok(p);
    assert.equal(p.unit, "kPa");
    assert.equal(p.numMin, 230);
    assert.equal(p.altNum, 33);
    assert.equal(p.altUnit, "psi");
  });

  it("🔴 괄호 없는 `체결토크 kgf·m` 도 읽는다 — 못 읽으면 토크가 통째로 사라진다", () => {
    const t = got.filter((c) => c.item === "wheel_nut_torque");
    assert.equal(t.length, 3, "세 인치 모두에 토크가 붙어야 한다");
    assert.equal(t[0].unit, "kgf·m");
    assert.equal(t[0].numMin, 11);
    assert.equal(t[0].numMax, 13);
  });

  it("🔴 머리글이 `형 식` 이고 앞에 `구 분` 칸이 있어도 규격 칸을 찾는다", () => {
    const sizes = got.filter((c) => c.item === "tire_size").map((c) => c.textValue);
    assert.deepEqual(sizes, ["225/55R18", "245/45R19", "245/40R20"]);
  });

  it("`7.5J X 18` 처럼 띄어 쓴 휠 규격도 읽는다", () => {
    assert.equal(got.find((c) => c.item === "wheel_size")?.textValue, "7.5J X 18");
  });

  it("뽑은 값이 전부 검사를 통과한다", () => {
    const source = gridToText(parseTable(HYUNDAI_TIRE_TABLE));
    for (const c of got) {
      const p = specFilter(c, source, { bodyType: "승용" });
      assert.equal(p, null, `${c.item} 이 걸렸다: ${p?.reason}`);
    }
  });
});

/**
 * 🔴 현대 오일 표 (쏘나타 DN8 2025 실측). 기아와 세 군데가 다르다:
 *    · 용량 단위가 머리글이 아니라 **칸 안**에 있다 — 머리글은 그냥 `용량`, 칸은 `4.3 ℓ`
 *    · 이 표가 「추천 오일 및 용량」이 아니라 그 아래 「가솔린/LPI 엔진」 쪽에 들어 있다
 *    · 각주가 이름 뒤에 붙는다 — `엔진 오일 *1`
 */
const HYUNDAI_OIL_TABLE = `
<table><thead><tr><th colspan="2"><p>종류</p></th><th><p>용량</p></th><th><p>추천 사양</p></th></tr></thead><tbody>
  <tr><td rowspan="2"><p>엔진 오일 *1</p></td><td><p>Smartstream G2.0 CVVL</p></td><td><p>4.3 &#8467;</p></td>
      <td><p>API SN PLUS/SP 또는 ILSAC GF-6 *2</p></td></tr>
  <tr><td><p>Smartstream G2.5 T-GDI</p></td><td><p>5.8 &#8467;</p></td>
      <td><p>SAE 0W-30 API SN PLUS/SP 또는 ILSAC GF-6 *2</p></td></tr>
  <tr><td><p>엔진 냉각수</p></td><td><p>Smartstream G2.0 CVVL</p></td><td><p>6.8&#8467;</p></td>
      <td><p>알루미늄 라디에이터용 부동액</p></td></tr>
  <tr><td colspan="2"><p>브레이크액 *3</p></td><td><p>필요량</p></td><td><p>DOT-4</p></td></tr>
</tbody></table>`;

describe("현대 오일 표 — 단위가 칸 안에 있다", () => {
  const got = parseOilTable(parseTable(HYUNDAI_OIL_TABLE));
  const find = (item: string) => got.filter((c) => c.item === item);

  it("🔴 머리글에 단위가 없어도 칸에서 읽는다 — 못 읽으면 오일 용량이 통째로 사라진다", () => {
    const q = find("engine_oil_qty");
    assert.equal(q.length, 2);
    assert.ok(q.every((c) => c.unit === "L"));
    assert.deepEqual(q.map((c) => c.numMin).sort(), [4.3, 5.8]);
  });

  it("냉각수도 붙어 있는 단위를 읽는다", () => {
    assert.equal(find("coolant_qty")[0]?.numMin, 6.8);
    assert.equal(find("coolant_qty")[0]?.unit, "L");
  });

  it("각주가 붙은 이름도 항목으로 알아본다", () => {
    assert.equal(find("brake_fluid_spec")[0]?.textValue, "DOT-4");
  });

  it("🔴 `필요량` 은 숫자가 아니라 용량을 안 만든다", () => {
    assert.equal(got.filter((c) => c.item === "brake_fluid_spec" && c.numMin != null).length, 0);
  });

  it("점도는 적혀 있는 줄에서만 나온다", () => {
    const v = find("engine_oil_viscosity");
    assert.equal(v.length, 1);
    assert.equal(v[0].textValue, "0W-30");
  });

  it("뽑은 값이 전부 검사를 통과한다", () => {
    const source = gridToText(parseTable(HYUNDAI_OIL_TABLE));
    for (const c of got) {
      const p = specFilter(c, source, { bodyType: "승용" });
      assert.equal(p, null, `${c.item} 이 걸렸다: ${p?.reason}`);
    }
  });
});

describe("페이지 다루기", () => {
  const PAGE = `<html><head><title>타이어 및 휠</title></head><body>
    <div id="wh_topic_container"><div id="wh_topic_body">
      <h1>타이어 및 휠</h1>${TIRE_TABLE}<p>예비 타이어는 별도 지급되지 않습니다.</p>
    </div></div>
    <div id="wh_publication_toc_content"><a href="topics/t00001.html">엔진 오일 점검</a></div>
  </body></html>`;

  it("🔴 본문만 도려낸다 — 페이지에 전체 목차 143줄이 같이 실려 있다", () => {
    const body = topicBody(PAGE);
    assert.match(body, /예비 타이어/);
    assert.doesNotMatch(body, /엔진 오일 점검/);
  });

  it("제목을 읽는다", () => {
    assert.equal(pageTitle(PAGE), "타이어 및 휠");
  });

  it("저장할 원문에 표가 편 모습으로 들어가고 표 밖 글도 남는다", () => {
    const body = bodyTextOf(PAGE);
    assert.match(body, /255\/45 R20 \| 8\.5Jx20 \| 240\(35\) \| 240\(35\) \| 11~13/);
    assert.match(body, /예비 타이어는 별도 지급되지 않습니다/);
  });

  it("🔴 제목이 무엇이든 표 스스로 판단한다 — 현대는 오일 표가 「가솔린/LPI 엔진」 아래에 있다", () => {
    const grids = parseTables(topicBody(PAGE));
    assert.ok(harvestGrids("타이어 및 휠", grids).length > 0);
    assert.equal(
      harvestGrids("전구의 용량", grids).length,
      harvestGrids("타이어 및 휠", grids).length,
      "제목을 바꿔도 결과가 같아야 한다",
    );
  });

  it("🔴 뽑은 값이 저장할 원문과 대조를 통과한다 — 이게 안 되면 저장이 거절된다", () => {
    const body = bodyTextOf(PAGE);
    const got = harvestGrids("타이어 및 휠", parseTables(topicBody(PAGE)));
    assert.ok(got.length >= 10);
    for (const c of got) assert.equal(specFilter(c, body, { bodyType: "SUV" }), null, c.item);
  });
});

/**
 * 🔴 스태거드는 **한 벌**이다 (2026-09-05).
 *    앞 245/45R19 와 뒤 275/40R19 는 「19인치 한 벌」이지 「옵션 두 개」가 아니다.
 *    이걸 두 벌로 두면 사장님이 화면에서 무엇을 끼워야 할지 알 수 없다.
 */
describe("스태거드 — 앞뒤 규격이 다른 차", () => {
  const got = parseTireWheelTable(parseTable(STAGGERED_TABLE));

  it("🔴 19인치 앞뒤가 한 벌로 묶인다 — 벌은 인치 수만큼만 생긴다", () => {
    const groups = new Set(got.map((c) => c.groupNo));
    assert.equal(groups.size, 2, `19인치·20인치 두 벌이어야 하는데 ${groups.size}벌`);
  });

  it("🔴 타이어 규격에도 앞/뒤가 붙는다 — 예전에는 공기압에만 붙어 짝을 잃었다", () => {
    const sizes = got.filter((c) => c.item === "tire_size");
    assert.equal(sizes.length, 4);
    const front = sizes.find((c) => c.textValue === "245/45R19");
    const rear = sizes.find((c) => c.textValue === "275/40R19");
    assert.equal(front?.qualifier?.["위치"], "앞");
    assert.equal(rear?.qualifier?.["위치"], "뒤");
    assert.equal(front?.groupNo, rear?.groupNo, "앞뒤가 같은 벌이어야 한다");
  });

  it("휠 규격에도 앞/뒤가 붙는다 — 앞 8.5J · 뒤 9.5J 로 서로 다르다", () => {
    const wheels = got.filter((c) => c.item === "wheel_size");
    const f = wheels.find((c) => c.textValue === "8.5Jx19");
    const r = wheels.find((c) => c.textValue === "9.5Jx19");
    assert.equal(f?.qualifier?.["위치"], "앞");
    assert.equal(r?.qualifier?.["위치"], "뒤");
    assert.equal(f?.groupNo, r?.groupNo);
  });

  it("벌 이름이 앞뒤를 함께 보여 준다", () => {
    const label = got.find((c) => c.textValue === "245/45R19")?.groupLabel ?? "";
    assert.match(label, /19인치/);
    assert.match(label, /245\/45R19/);
    assert.match(label, /275\/40R19/);
  });

  it("토크는 두 벌 모두에 붙는다 — 합쳐진 칸을 폈기 때문이다", () => {
    const t = got.filter((c) => c.item === "wheel_nut_torque");
    assert.ok(t.length >= 2, `벌마다 토크가 있어야 하는데 ${t.length}개`);
    assert.equal(t[0].numMin, 14);
    assert.equal(t[0].numMax, 16);
  });
});

/**
 * 🔴 **앞뒤가 같은 표는 예전 그대로여야 한다.** 스태거드 고치다가
 *    「18인치 한 벌 / 20인치 한 벌」을 한 벌로 뭉개면 더 큰 사고다.
 */
describe("앞뒤가 같은 표는 건드리지 않는다", () => {
  it("18인치·20인치는 여전히 두 벌", () => {
    const got = parseTireWheelTable(parseTable(TIRE_TABLE));
    assert.equal(new Set(got.map((c) => c.groupNo)).size, 2);
  });

  it("규격에 위치가 안 붙는다 — 앞뒤가 같으니 붙일 이유가 없다", () => {
    const got = parseTireWheelTable(parseTable(TIRE_TABLE));
    for (const c of got.filter((x) => x.item === "tire_size")) {
      assert.equal(c.qualifier?.["위치"], undefined);
    }
  });
});
