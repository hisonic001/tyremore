import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { agreeAcrossSources, findTorques } from "./spec-torque-core";

/**
 * 🔴 인터넷에서 오일 토크를 받아 올 때 가장 위험한 두 가지를 여기서 막는다:
 *    ① 드레인 값과 필터 값을 뒤바꿔 읽는 것 (35 ↔ 25)
 *    ② 출처 없는 숫자를 값으로 삼는 것 — 실제로 검색이 「일반적으로 20~30 N·m」이라고 했다
 */
describe("페이지 글자에서 토크 뽑기", () => {
  it("「Torque spec 35 Nm」 같은 줄을 읽는다 — 실제 페이지에서 본 글자다", () => {
    const got = findTorques(["Drain Bolt & Hardware", "Drain plug torque spec 35 Nm"].join("\n"));
    assert.equal(got.length, 1);
    assert.equal(got[0].kind, "oil_drain_plug_torque");
    assert.equal(got[0].nm, 35);
  });

  it("ft-lb 를 N·m 로 바꾼다 — 26 ft-lbs 는 35 N·m 다", () => {
    const got = findTorques("Oil drain plug: 26 ft-lbs");
    assert.equal(got[0].kind, "oil_drain_plug_torque");
    assert.ok(Math.abs(got[0].nm - 35.3) < 0.3, String(got[0].nm));
  });

  it("kgf·m 도 바꾼다 — 3.5 kgf·m 는 34.3 N·m", () => {
    const got = findTorques("드레인 플러그 체결 토크 3.5 kgf·m");
    assert.ok(Math.abs(got[0].nm - 34.3) < 0.3, String(got[0].nm));
  });

  it("40±5 는 35~45 로 읽는다", () => {
    const got = findTorques("Drain plug torque 40±5 N·m");
    assert.equal(got[0].nm, 35);
    assert.equal(got[0].nmMax, 45);
  });

  it("🔴 드레인과 필터를 구분한다 — 뒤바꿔 읽으면 오일팬이 상한다", () => {
    const got = findTorques(["Oil filter cap torque 25 Nm", "Oil drain plug torque 35 Nm"].join("\n"));
    const f = got.find((h) => h.kind === "oil_filter_torque");
    const d = got.find((h) => h.kind === "oil_drain_plug_torque");
    assert.equal(f?.nm, 25);
    assert.equal(d?.nm, 35);
  });

  it("🔴 한 줄에 드레인과 필터가 둘 다 있으면 버린다 — 어느 값인지 알 수 없다", () => {
    assert.deepEqual(findTorques("Torque the oil filter and drain plug to 30 Nm"), []);
  });

  it("🔴 상식 밖 값은 버린다 — 350 N·m 짜리 드레인은 없다", () => {
    assert.deepEqual(findTorques("Drain plug torque 350 Nm"), []);
  });

  it("🔴 무엇의 토크인지 안 적힌 줄은 안 읽는다", () => {
    assert.deepEqual(findTorques("Torque: 35 Nm"), []);
  });
});

/**
 * 🔴 **두 곳 이상이 같은 값을 말할 때만** 후보로 삼는다.
 *    「몇 쪽에서 봤나」가 아니라 「서로 다른 사이트 몇 곳인가」다.
 */
describe("두 곳이 같은 값을 말하는가", () => {
  const 드레인 = (nm: number) => [{ kind: "oil_drain_plug_torque" as const, nm, nmMax: null, quote: `${nm} Nm` }];

  it("두 사이트가 같은 값이면 통과한다", () => {
    const r = agreeAcrossSources(
      [
        { host: "a.com", url: "https://a.com/1", hits: 드레인(35) },
        { host: "b.com", url: "https://b.com/2", hits: 드레인(35) },
      ],
      "oil_drain_plug_torque",
    );
    assert.equal(r?.hosts.length, 2);
    assert.equal(r?.conflict, false);
    assert.equal(r?.nm, 35);
  });

  it("🔴 한 곳뿐이면 값을 만들지 않는다 — 교차검증이 아니다", () => {
    assert.equal(agreeAcrossSources([{ host: "a.com", url: "u", hits: 드레인(35) }], "oil_drain_plug_torque"), null);
  });

  it("🔴 두 곳이 서로 다른 값이면 어긋났다고 남긴다 — 다수결로 조용히 고르지 않는다", () => {
    const r = agreeAcrossSources(
      [
        { host: "a.com", url: "u1", hits: 드레인(35) },
        { host: "b.com", url: "u2", hits: 드레인(25) },
      ],
      "oil_drain_plug_torque",
    );
    assert.equal(r?.conflict, true);
    assert.equal(r?.hosts.length, 0, "어긋나면 「같은 값을 말한 곳」이 없어야 한다");
    assert.equal(r?.others.length, 2);
  });

  it("셋 중 둘이 맞으면 그 둘을 쓰되 어긋난 곳도 남긴다", () => {
    const r = agreeAcrossSources(
      [
        { host: "a.com", url: "u1", hits: 드레인(35) },
        { host: "b.com", url: "u2", hits: 드레인(35) },
        { host: "c.com", url: "u3", hits: 드레인(25) },
      ],
      "oil_drain_plug_torque",
    );
    assert.equal(r?.hosts.length, 2);
    assert.equal(r?.conflict, true);
    assert.equal(r?.others[0].host, "c.com");
  });

  it("35 와 35.3 은 같은 말로 본다 — 단위 환산 반올림 차이다", () => {
    const r = agreeAcrossSources(
      [
        { host: "a.com", url: "u1", hits: 드레인(35) },
        { host: "b.com", url: "u2", hits: 드레인(35.3) },
      ],
      "oil_drain_plug_torque",
    );
    assert.equal(r?.hosts.length, 2);
    assert.equal(r?.conflict, false);
  });
});

/**
 * 🔴 **2026-09-05 에 실제로 당한 두 가지.** engineoiljournal.com 에서 쏘렌토 값이라며
 *    ① 「typical … for most passenger vehicles」(일반론)와
 *    ② 「Most Honda Civic … 29 ft-lb」(다른 차)를 집어 왔다.
 *    그대로 뒀으면 40.7 N·m 라는 엉뚱한 토크가 들어갔다.
 */
describe("남의 차·일반론을 우리 값으로 읽지 않는다", () => {
  it("🔴 「typical … most passenger vehicles」는 규정값이 아니다", () => {
    const got = findTorques("The typical torque for an oil drain plug is 20-30 ft-lb (27-40 Nm) for most passenger vehicles.");
    assert.deepEqual(got, []);
  });

  it("🔴 「일반적으로 20~30 N·m」도 아니다 — 검색이 실제로 이렇게 답했다", () => {
    assert.deepEqual(findTorques("드레인 플러그는 일반적으로 20~30 N·m 정도입니다"), []);
  });

  it("🔴 다른 제조사 이야기는 우리 차 값이 아니다", () => {
    const got = findTorques("Most Honda Civic oil drain plugs are torqued to 29 ft-lb", { model: "Sorento", maker: "Kia" });
    assert.deepEqual(got, []);
  });

  it("우리 차 이름이 같이 있으면 제조사가 적혀 있어도 읽는다", () => {
    const got = findTorques("Kia Sorento drain plug torque: 35 Nm", { model: "Sorento", maker: "Kia" });
    assert.equal(got.length, 1);
    assert.equal(got[0].nm, 35);
  });

  it("제조사 이름이 아예 없는 줄은 예전처럼 읽는다", () => {
    const got = findTorques("Drain plug torque 35 Nm", { model: "Sorento" });
    assert.equal(got[0].nm, 35);
  });
});
