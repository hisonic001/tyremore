import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clamp01,
  defaultRoomPlan,
  defaultSitePlan,
  fitShape,
  imageProblem,
  moveShape,
  nearestPin,
  resizeShape,
  sameStack,
  sanitizePlan,
  siteShapeForArea,
} from "./storage-plan-pure";
import { expandPerTire, otherPlatesIn, parseLabelPer } from "./tire-storage-pure";

test("기본 배치도 — 매장·창고 둘·3층 건물, 3층 건물은 층 셋으로 이어짐", () => {
  const site = defaultSitePlan({ brick: 1, white: 2, floor1: 3, floor2: 4, floor3: 5 });
  const names = site.shapes.map((s) => s.label);
  for (const n of ["벽돌 창고", "흰색 창고", "매장 (셔터 6칸)", "3층 건물"]) assert.ok(names.includes(n), n);
  assert.equal(siteShapeForArea(site, 4)?.label, "3층 건물");
  assert.equal(siteShapeForArea(site, 1)?.label, "벽돌 창고");
  assert.equal(siteShapeForArea(site, 99), null);
  // 모든 칸이 도면 안
  for (const s of site.shapes) assert.deepEqual(fitShape(s, site.h), s);
});

test("구역 기본 도면 — 벽 셋·가운데·문, 층이면 계단", () => {
  assert.ok(defaultRoomPlan().shapes.some((s) => s.kind === "door"));
  assert.ok(!defaultRoomPlan().shapes.some((s) => s.kind === "stairs"));
  assert.ok(defaultRoomPlan({ stairs: true }).shapes.some((s) => s.kind === "stairs"));
});

test("칸 옮기기·크기 — 도면 밖으로 안 나가고 3보다 작아지지 않음", () => {
  const s = { id: "a", kind: "block" as const, x: 10, y: 10, w: 20, h: 10, label: "" };
  assert.deepEqual(moveShape(s, 200, 200, 70), { ...s, x: 80, y: 60 });
  assert.deepEqual(moveShape(s, -50, -50, 70), { ...s, x: 0, y: 0 });
  assert.deepEqual(resizeShape(s, -100, -100, 70), { ...s, w: 3, h: 3 });
  assert.equal(moveShape(s, 2.4, 0, 70).x, 12); // 1단위로 맞춤
});

test("받은 도면 다듬기 — 엉뚱한 값은 걸러냄", () => {
  assert.equal(sanitizePlan(null), null);
  assert.equal(sanitizePlan({ h: 50 }), null);
  const p = sanitizePlan({ h: 999, shapes: [{ kind: "해킹", x: -5, y: 0, w: 500, h: 4, label: "x".repeat(99), areaIds: ["3", -1, "a"] }, null] })!;
  assert.equal(p.h, 200);
  assert.equal(p.shapes.length, 1);
  assert.equal(p.shapes[0].kind, "block");
  assert.equal(p.shapes[0].w, 100);
  assert.equal(p.shapes[0].label.length, 30);
  assert.deepEqual(p.shapes[0].areaIds, [3]);
});

test("섞인 더미 — 가까이 누르면 기존 점에 붙고, 멀면 새 점", () => {
  const pins = [
    { id: 1, x: 0.5, y: 0.5, areaId: 7 },
    { id: 2, x: 0.8, y: 0.2, areaId: 7 },
  ];
  assert.equal(nearestPin(pins, 0.51, 0.505, 70)?.id, 1);
  assert.equal(nearestPin(pins, 0.6, 0.5, 70), null);
  assert.equal(nearestPin(pins, 0.5, 0.5, 70, 1), null); // 자기 자신은 빼고
  const all = [...pins, { id: 3, x: 0.5, y: 0.5, areaId: 7 }, { id: 4, x: 0.5, y: 0.5, areaId: 8 }];
  assert.deepEqual(sameStack(all, all[0]).map((p) => p.id), [1, 3]);
});

test("점 좌표·사진 검사", () => {
  assert.equal(clamp01(1.4), 1);
  assert.equal(clamp01(-0.2), 0);
  assert.equal(clamp01(NaN), 0);
  assert.equal(imageProblem(null), null);
  assert.equal(imageProblem("data:image/jpeg;base64,AAAA"), null);
  assert.ok(imageProblem("data:text/html;base64,AAAA"));
  assert.ok(imageProblem("data:image/png;base64," + "A".repeat(900_001)));
});

test("타이어마다 스티커 — 본수만큼 1/4 … 4/4, 기본은 타이어마다", () => {
  const out = expandPerTire([{ id: 5, qty: 4 }, { id: 6, qty: 2 }]);
  assert.equal(out.length, 6);
  assert.deepEqual(out.map((x) => `${x.id}:${x.idx}`), ["5:1", "5:2", "5:3", "5:4", "6:1", "6:2"]);
  assert.equal(parseLabelPer(null), "tire");
  assert.equal(parseLabelPer("set"), "set");
});

test("메모 속 다른 번호판 — 「84고0717보관 이 차량번호로…」", () => {
  assert.deepEqual(otherPlatesIn("84고0717보관 이 차량번호로 바꿔 적어서 붙이기", "12가3456"), ["84고0717"]);
  assert.deepEqual(otherPlatesIn("12가 3456 보관", "12가3456"), []);
  assert.deepEqual(otherPlatesIn(null, "12가3456"), []);
});
