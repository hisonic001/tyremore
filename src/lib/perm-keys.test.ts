/** ⭐ 기능 권한 판정 시험 (2026-09-02) — owner 무조건 통과, 직원은 켠 것만 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { allOnPerms, BASE_KEYS, evalPerm, evalStoragePerm, OWNER_KEYS, PERM_KEYS } from "./perm-keys";

describe("evalPerm", () => {
  test("owner 는 스위치와 무관하게 전부 된다", () => {
    for (const k of PERM_KEYS) {
      assert.equal(evalPerm("owner", {}, k), true);
      assert.equal(evalPerm("owner", null, k), true);
      assert.equal(evalPerm("owner", { [k]: false }, k), true);
    }
  });

  test("직원은 켜 둔 것만 — 없는 키·null·{} 는 꺼진 것", () => {
    assert.equal(evalPerm("tech", { sale: true }, "sale"), true);
    assert.equal(evalPerm("tech", { sale: true }, "stock"), false);
    assert.equal(evalPerm("tech", null, "sale"), false);
    assert.equal(evalPerm("tech", {}, "mars"), false);
  });

  test("true 가 아닌 값은 전부 거절 (임의 JSON 방어)", () => {
    assert.equal(evalPerm("tech", { sale: 1 as unknown as boolean }, "sale"), false);
    assert.equal(evalPerm("tech", { sale: "true" as unknown as boolean }, "sale"), false);
  });

  test("전부 켬 맵 = 매장 일 7개만 (민감 5개는 개별 해금 — 사장님 지시 2026-09-02)", () => {
    const on = allOnPerms();
    for (const k of BASE_KEYS) assert.equal(evalPerm("tech", on, k), true);
    for (const k of OWNER_KEYS) assert.equal(evalPerm("tech", on, k), false, k);
  });

  test("사장님 영역 키도 켜면 직원이 쓸 수 있다 (해금)", () => {
    assert.equal(evalPerm("tech", { finance: true }, "finance"), true);
    assert.equal(evalPerm("tech", { cost: true }, "cost"), true);
    assert.equal(evalPerm("tech", {}, "finance"), false);
  });

  test("모르는 역할은 owner 대접을 못 받는다", () => {
    assert.equal(evalPerm("admin", {}, "sale"), false);
  });
});

test("타이어 보관 관리(2026-11-18) — storage 하나로 전부, 옛 키도 계속 통함", () => {
  // 보관 관리만 켠 직원: 쓰기·고치기 다 됨
  assert.equal(evalStoragePerm("tech", { storage: true }, "use"), true);
  assert.equal(evalStoragePerm("tech", { storage: true }, "edit"), true);
  // 옛 키: 판매 등록 = 쓰기만, 정비 내역 수정 = 고치기만
  assert.equal(evalStoragePerm("tech", { sale: true }, "use"), true);
  assert.equal(evalStoragePerm("tech", { sale: true }, "edit"), false);
  assert.equal(evalStoragePerm("tech", { sale_edit: true }, "edit"), true);
  // 아무것도 없으면 안 됨, 사장님은 늘 됨
  assert.equal(evalStoragePerm("tech", {}, "use"), false);
  assert.equal(evalStoragePerm("owner", {}, "edit"), true);
  // 「전부 켜기」에 들어간다
  assert.ok(BASE_KEYS.includes("storage"));
});
