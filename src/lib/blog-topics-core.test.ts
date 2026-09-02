import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { CATEGORIES, inferCategory, seasonTopic, stalestCategories } from "./blog-topics-core";

/**
 * 실제 사장님 폴더 이름으로 시험한다 — 처음 붙였을 때
 * 「포터2 주간등교환」이 수입차 타이어 글로, 「익스플로러 배터리」가 엔진오일로 잡혔다.
 * 차량이 앱에 없어 제조사가 null 인 폴더가 절반이라 **폴더 이름이 가장 믿을 만한 단서**다.
 */
describe("카테고리 추론 — 사장님 실제 폴더 이름으로", () => {
  const byLabel = (label: string, over: Partial<Parameters<typeof inferCategory>[0]> = {}) =>
    inferCategory({ maker: null, model: null, hasTire: false, services: [], label, ...over });

  it("차량이 앱에 없어도 폴더 이름으로 작업을 알아본다", () => {
    assert.equal(byLabel("익스플로러 배터리"), "배터리");
    assert.equal(byLabel("포터2 주간등교환"), "엔진오일/기타");
    assert.equal(byLabel("더 뉴 K3 엔진체크스캐너점검"), "엔진오일/기타");
    assert.equal(byLabel("코란도스포츠 TPMS 센서"), "엔진오일/기타");
    assert.equal(byLabel("렉스턴스포츠칸 얼라인먼트"), "휠얼라인먼트");
  });

  it("얼라인먼트는 타이어보다 먼저 — 같이 해도 글의 중심은 얼라인먼트", () => {
    assert.equal(
      inferCategory({ maker: "기아", model: "쏘렌토", hasTire: true, services: ["휠얼라인먼트"], label: null }),
      "휠얼라인먼트",
    );
  });

  it("제조사를 모를 때 국산 차종을 수입차로 넘기지 않는다", () => {
    assert.equal(byLabel("포터2", { hasTire: true }), "국산차 타이어 교환");
    assert.equal(byLabel("펠리세이드", { hasTire: true }), "국산차 타이어 교환");
    assert.equal(byLabel("G80", { hasTire: true }), "국산차 타이어 교환");
  });

  it("수입차는 수입차로", () => {
    assert.equal(
      inferCategory({ maker: "메르세데스벤츠", model: "GLS", hasTire: true, services: [], label: "벤츠 GLS" }),
      "수입차 타이어 교환",
    );
    assert.equal(byLabel("포르쉐박스터", { hasTire: true }), "수입차 타이어 교환");
  });

  it("전기차는 국산·수입보다 먼저", () => {
    assert.equal(byLabel("테슬라 모델Y", { hasTire: true }), "전기차(EV) 타이어 교환");
    assert.equal(byLabel("모델3", { hasTire: true }), "전기차(EV) 타이어 교환");
  });

  it("타이어 얘기가 아니면 국산·수입을 가르지 않는다", () => {
    assert.equal(byLabel("이름만 있는 폴더"), "엔진오일/기타");
  });

  it("나오는 값은 늘 사장님 블로그에 실제로 있는 카테고리다", () => {
    const names = CATEGORIES.map((c) => c.name) as string[];
    for (const l of ["익스플로러 배터리", "포터2 주간등교환", "벤츠 GLS", "모델3", "무엇인지 모름"]) {
      assert.ok(names.includes(byLabel(l, { hasTire: true })), l);
    }
  });
});

describe("계절 글감", () => {
  it("9~11월은 겨울 준비 — 속초 고갯길 각도", () => {
    const s = seasonTopic(9);
    assert.ok(s);
    assert.match(s.why, /미시령|한계령/);
  });
  it("7~8월은 관광객 각도 — 다른 지역 매장이 못 가지는 검색어", () => {
    const s = seasonTopic(7);
    assert.ok(s);
    assert.match(s.why, /외지|여행/);
  });
  it("어느 달이든 하나는 나온다", () => {
    for (let m = 1; m <= 12; m++) assert.ok(seasonTopic(m), String(m));
  });
});

describe("오래 빈 카테고리부터", () => {
  it("한 번도 안 쓴 것(null)이 가장 먼저", () => {
    const r = stalestCategories([
      { category: "국산차 타이어 교환", daysAgo: 3 },
      { category: "전기차(EV) 타이어 교환", daysAgo: null },
      { category: "배터리", daysAgo: 40 },
    ]);
    assert.equal(r[0].category, "전기차(EV) 타이어 교환");
    assert.equal(r[1].category, "배터리");
  });
});
