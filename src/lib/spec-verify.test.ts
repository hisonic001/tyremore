import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { bothUnits, normalizeUnit, specItem } from "./spec-core";
import { numbersIn, rankSource, specFilter, type SpecCandidate } from "./spec-verify";

/**
 * 🔴 이 시험들은 2026-09-03 에 **실제로 겪은 함정**을 그대로 재현한 것이다.
 *    ① 검색엔진이 출처 없이 「일반적으로 10~12kgf·m 로 알려져 있습니다」라고 답했다
 *    ② 검색이 준 출처 주소 두 개가 둘 다 404 였다
 *    ③ 요약끼리 값이 어긋났다 (250kPa vs 240kPa) — 페이지를 열어 보니 240kPa 가 맞았다
 *    ④ 검색엔진이 「11~13 N·m」이라고 10배 틀리게 말했다 (실제는 11~13 kgf·m)
 */

/** 실제로 읽어 온 쏘렌토 MQ4 2022 취급설명서 본문 (ownersmanual.kia.com) */
const SORENTO = `
타이어 및 휠
타이어 형식 235/60 R18 휠 7.5Jx18 추천 공기압 240 kPa (35 psi) 앞뒤 동일
타이어 형식 255/45 R20 휠 8.5Jx20 추천 공기압 240 kPa (35 psi) 앞뒤 동일
휠 너트 체결 토크 11~13 kgf·m
타이어 리페어킷 장착 차량입니다. 예비 타이어는 별도 지급되지 않습니다.
`;

const base = (over: Partial<SpecCandidate>): SpecCandidate => ({
  item: "wheel_nut_torque",
  numMin: 11,
  numMax: 13,
  unit: "kgf·m",
  quote: "휠 너트 체결 토크 11~13 kgf·m",
  ...over,
});

describe("specFilter — 원문에서 나온 값만 통과한다", () => {
  it("원문 그대로 옮긴 값은 통과한다", () => {
    assert.equal(specFilter(base({}), SORENTO, { bodyType: "SUV" }), null);
  });

  it("🔴 인용문을 지어내면 걸린다 — 가장 중요한 검사", () => {
    const r = specFilter(base({ quote: "쏘렌토의 휠너트 토크는 11~13 kgf·m 입니다" }), SORENTO);
    assert.ok(r);
    assert.match(r.reason, /인용한 문장이 원문에 없습니다/);
  });

  it("🔴 원문은 맞는데 숫자만 바꿔치면 걸린다", () => {
    const r = specFilter(base({ numMin: 12, numMax: 14 }), SORENTO, { bodyType: "SUV" });
    assert.ok(r);
    assert.match(r.reason, /인용문에 없습니다/);
  });

  it("🔴 「일반적으로 알려져 있다」류를 인용하면 걸린다 — 표가 아니라 남의 설명문이다", () => {
    const text = `${SORENTO}\n일반적으로 10~12kgf·m 로 알려져 있습니다.`;
    const r = specFilter(
      base({ numMin: 10, numMax: 12, quote: "일반적으로 10~12kgf·m 로 알려져 있습니다." }),
      text,
    );
    assert.ok(r);
    assert.match(r.reason, /규정값이 아니라 설명문/);
  });

  it("🔴 단위를 10배 틀리게 적으면 「바꿔 적었다」고 짚어 준다", () => {
    const text = SORENTO.replace("11~13 kgf·m", "11~13 N·m");
    const r = specFilter(base({ unit: "N·m", quote: "휠 너트 체결 토크 11~13 N·m" }), text, { bodyType: "SUV" });
    assert.ok(r);
    assert.match(r.reason, /단위를 잘못 적었습니다/);
    assert.match(r.reason, /kgf·m/);
  });

  it("🔴 110~130 을 kgf·m 라 적으면 「그건 N·m 입니다」라고 짚어 준다", () => {
    // 11~13 kgf·m = 108~127 N·m — 단위만 바꿔 적는 흔한 사고다
    const text = `${SORENTO}\n휠 너트 체결 토크 110~130 kgf·m`;
    const r = specFilter(
      base({ numMin: 110, numMax: 130, quote: "휠 너트 체결 토크 110~130 kgf·m" }),
      text,
      { bodyType: "SUV" },
    );
    assert.ok(r);
    assert.match(r.reason, /단위를 잘못 적었습니다/);
    assert.match(r.reason, /N·m/);
  });

  it("어느 단위로 읽어도 말이 안 되면 「정상 범위 밖」이라고 한다", () => {
    const text = `${SORENTO}\n휠 너트 체결 토크 1100 kgf·m`;
    const r = specFilter(
      base({ numMin: 1100, numMax: null, quote: "휠 너트 체결 토크 1100 kgf·m" }),
      text,
      { bodyType: "SUV" },
    );
    assert.ok(r);
    assert.match(r.reason, /정상 범위/);
  });

  it("🔴 차체 종류로 범위가 갈린다 — 승용 기준으로 다 막으면 상용차 값을 못 넣는다", () => {
    // 현대 상용 취급설명서 실측: 19.5인치 휠은 500±40 N·m 다 (승용의 4배)
    const text = "전륜 245/70R19.5 : 500±40 N.m";
    const c = base({ numMin: 500, numMax: null, unit: "N·m", quote: "전륜 245/70R19.5 : 500±40 N.m" });
    assert.ok(specFilter(c, text, { bodyType: "승용" }), "승용이면 걸려야 한다");
    assert.ok(specFilter(c, text, { bodyType: "소형트럭" }), "포터·봉고 급에도 500N·m 는 과하다");
    assert.equal(specFilter(c, text, { bodyType: "대형" }), null, "19.5인치 상용이면 통과해야 한다");
  });

  it("🔴 큰 세단의 진짜 값을 막지 않는다 — G80(RG3) 설명서가 14~16 kgf·m 다", () => {
    // 승용 범위를 8~15 로 좁게 잡았다가 제조사 실제 값을 막은 적이 있다 (2026-09-03).
    // 범위는 「자릿수 사고를 잡을 만큼 좁고, 진짜 값을 막지 않을 만큼 넓게」여야 한다.
    const text = "245/40R19 | 8.5J X 19 | 240(35) | 240(35) | 14~16";
    const c = base({ numMin: 14, numMax: 16, quote: text });
    assert.equal(specFilter(c, text, { bodyType: "승용" }), null);
    // 그래도 10배 사고는 여전히 걸린다
    const wrong = base({ numMin: 140, numMax: 160, quote: "토크 140~160 kgf·m" });
    assert.ok(specFilter(wrong, "토크 140~160 kgf·m", { bodyType: "승용" }));
  });

  it("🔴 「500±40」에서 460·540 을 계산해 내면 걸린다 — 전사이지 계산이 아니다", () => {
    const text = "전륜 245/70R19.5 : 500±40 N.m";
    const r = specFilter(
      base({ numMin: 460, numMax: 540, unit: "N·m", quote: text }),
      text,
      { bodyType: "소형트럭" },
    );
    assert.ok(r);
    assert.match(r.reason, /인용문에 없습니다/);
  });

  it("단위가 없으면 저장 안 한다", () => {
    const r = specFilter(base({ unit: null }), SORENTO, { bodyType: "SUV" });
    assert.ok(r);
    assert.match(r.reason, /단위가 없습니다/);
  });

  it("kgf.m · kg·m 같은 여러 표기를 같은 단위로 본다", () => {
    assert.equal(normalizeUnit("kgf.m"), "kgf·m");
    assert.equal(normalizeUnit("kg·m"), "kgf·m");
    assert.equal(normalizeUnit("N.m"), "N·m");
    assert.equal(normalizeUnit("ℓ"), "L");
    assert.equal(normalizeUnit("무슨단위"), null);
  });
});

describe("specFilter — 글자 값", () => {
  const tire = (v: string, q = `타이어 형식 ${v}`) =>
    specFilter({ item: "tire_size", textValue: v, quote: q }, SORENTO);

  it("원문에 있는 타이어 규격은 통과한다", () => {
    assert.equal(tire("235/60 R18"), null);
  });

  it("모양이 아닌 값은 걸린다", () => {
    const r = specFilter({ item: "tire_size", textValue: "18인치", quote: "타이어 형식 235/60 R18" }, SORENTO);
    assert.ok(r);
    assert.match(r.reason, /타이어 규격 모양이 아닙니다/);
  });

  it("모양은 맞아도 원문에 없으면 걸린다", () => {
    const r = specFilter(
      { item: "tire_size", textValue: "245/45 R19", quote: "타이어 형식 235/60 R18" },
      SORENTO,
    );
    assert.ok(r);
    assert.match(r.reason, /원문에 없습니다/);
  });

  it("점도는 실제로 쓰이는 표기만", () => {
    const t = "엔진 오일 SAE 0W-20, API SN PLUS/SP";
    assert.equal(specFilter({ item: "engine_oil_viscosity", textValue: "0W-20", quote: t }, t), null);
    const r = specFilter({ item: "engine_oil_viscosity", textValue: "0W-99", quote: t }, t);
    assert.ok(r);
    assert.match(r.reason, /점도 표기가 아닙니다/);
  });

  it("값이 비면 그 줄을 만들지 말라고 한다", () => {
    const r = specFilter({ item: "battery_ah", quote: "타이어 및 휠" }, SORENTO);
    assert.ok(r);
    assert.match(r.fix, /추측은 오답보다 나쁩니다/);
  });
});

describe("환산 교차검산 — 원문이 두 단위를 같이 적어 줄 때", () => {
  it("240 kPa 과 35 psi 는 서로 맞는다", () => {
    const c: SpecCandidate = {
      item: "tire_pressure",
      numMin: 240,
      unit: "kPa",
      altNum: 35,
      altUnit: "psi",
      quote: "추천 공기압 240 kPa (35 psi) 앞뒤 동일",
    };
    assert.equal(specFilter(c, SORENTO), null);
  });

  it("🔴 250 kPa 이라 적고 35 psi 라 하면 걸린다 — 검색 요약이 실제로 틀렸던 값", () => {
    const text = "추천 공기압 250 kPa (35 psi) 앞뒤 동일";
    const r = specFilter(
      { item: "tire_pressure", numMin: 250, unit: "kPa", altNum: 35, altUnit: "psi", quote: text },
      text,
    );
    assert.ok(r);
    assert.match(r.reason, /두 단위가 서로 안 맞습니다/);
  });
});

describe("출처 등급과 독립성 — 교차검증의 뜻", () => {
  it("제조사 공식 문서가 1등급", () => {
    const r = rankSource("https://ownersmanual.kia.com/full_webhelp/MQ4/2022/ko_KR/topics/t01115.html");
    assert.equal(r.rank, 1);
    assert.equal(r.official, true);
    assert.equal(r.independenceKey, "kia");
  });

  it("🔴 커뮤니티는 열 곳이든 전부 하나로 센다", () => {
    const a = rankSource("https://www.clien.net/service/board/use/17766530");
    const b = rankSource("https://namu.wiki/w/기아쏘렌토");
    const c = rankSource("https://tip.daum.net/question/72021901");
    assert.equal(a.independenceKey, "community");
    assert.equal(b.independenceKey, "community");
    assert.equal(c.independenceKey, "community");
    assert.equal(new Set([a, b, c].map((x) => x.independenceKey)).size, 1);
  });

  it("같은 제조사의 다른 사이트도 하나로 센다 — 발행자가 같다", () => {
    const a = rankSource("https://ownersmanual.kia.com/x");
    const b = rankSource("https://webmanual.kia.com/y");
    assert.equal(a.independenceKey, b.independenceKey);
  });

  it("주소가 아니면 최하 등급", () => {
    assert.equal(rankSource("주소아님").rank, 5);
  });
});

describe("두 단위 병기 — 현장에서 렌치 눈금이 다르다", () => {
  it("토크는 kgf·m 와 N·m 를 같이 보여 준다", () => {
    assert.equal(bothUnits(11, 13, "kgf·m"), "11~13 kgf·m (108~127 N·m)");
  });
  it("공기압도 마찬가지", () => {
    assert.match(bothUnits(240, null, "kPa"), /240 kPa \(35 psi\)/);
  });
  it("환산이 없는 단위는 그대로", () => {
    assert.equal(bothUnits(6.1, null, "L"), "6.1 L");
  });
});

describe("항목 정본", () => {
  it("휠너트 토크와 오일 용량은 위험 높음 — 검증 전 숫자를 안 보여준다", () => {
    assert.equal(specItem("wheel_nut_torque")?.risk, "높음");
    assert.equal(specItem("engine_oil_qty")?.risk, "높음");
  });
  it("모르는 항목은 없다고 한다", () => {
    assert.equal(specItem("무슨항목"), null);
  });
  it("숫자 뽑기", () => {
    assert.deepEqual(numbersIn("11~13 kgf·m"), ["11", "13"]);
    assert.deepEqual(numbersIn("240 kPa (35 psi)"), ["240", "35"]);
  });
});
