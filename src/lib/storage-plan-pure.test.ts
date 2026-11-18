import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clamp01,
  defaultRoomPlan,
  defaultSitePlan,
  fitShape,
  imageProblem,
  isLegacyDefaultRoom,
  locationText,
  nextSlotName,
  slotNameProblem,
  moveShape,
  nextStackNo,
  removedOccupiedSlots,
  resizeShape,
  sanitizePlan,
  siteShapeForArea,
  slotLabel,
  slotsOf,
  stacksIn,
  type Plan,
} from "./storage-plan-pure";
import { expandPerTire, otherPlatesIn, parseLabelPer } from "./tire-storage-pure";

test("기본 배치도 — 매장·창고 둘·3층 건물, 3층 건물은 층 셋으로 이어짐", () => {
  const site = defaultSitePlan({ brick: 1, white: 2, floor1: 3, floor2: 4, floor3: 5 });
  const names = site.shapes.map((s) => s.label);
  for (const n of ["벽돌 창고", "흰색 창고", "매장 (셔터 6칸)", "3층 건물"]) assert.ok(names.includes(n), n);
  assert.equal(siteShapeForArea(site, 4)?.label, "3층 건물");
  assert.equal(siteShapeForArea(site, 99), null);
  for (const s of site.shapes) assert.deepEqual(fitShape(s, site.h), s);
});

test("구역 기본 도면 — 자리 12개, 도면 안, 이름 겹침 없음, 입구는 아래, 층이면 계단", () => {
  const p = defaultRoomPlan();
  const slots = slotsOf(p);
  assert.equal(slots.length, 12);
  assert.deepEqual(slots.slice(0, 4).map((s) => s.label), ["안쪽 1", "안쪽 2", "안쪽 3", "안쪽 4"]);
  assert.equal(new Set(slots.map((s) => s.label)).size, 12);
  for (const s of p.shapes) assert.deepEqual(fitShape(s, p.h), s);
  // 자리끼리 안 겹친다 (누르면 정확히 그 칸)
  for (const a of slots)
    for (const b of slots) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.label}/${b.label}`);
  assert.ok(p.shapes.find((s) => s.kind === "door")!.y > 60);
  // 장갑 손가락 (검토 2026-11-18): 자리는 14단위(폰 ≈45px) 이상, 이웃 사이는 4단위(≈13px) 이상
  for (const a of slots) assert.ok(a.w >= 14 && a.h >= 14, `${a.label} 크기`);
  for (const a of slots)
    for (const b of slots) {
      if (a === b) continue;
      const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
      const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      assert.ok(Math.max(gapX, gapY) >= 4, `${a.label}↔${b.label} 사이`);
    }
  assert.ok(defaultRoomPlan({ stairs: true }).shapes.some((s) => s.kind === "stairs"));
});

test("손 안 댄 1차 기본 도면만 새 기본으로 — 고친 도면은 그대로", () => {
  const legacy: Plan = {
    h: 70,
    shapes: [
      { id: "room", kind: "room", x: 0, y: 0, w: 100, h: 70, label: "" },
      { id: "back", kind: "block", x: 4, y: 4, w: 92, h: 14, label: "안쪽 벽" },
      { id: "left", kind: "block", x: 4, y: 20, w: 18, h: 38, label: "왼쪽 벽" },
      { id: "right", kind: "block", x: 78, y: 20, w: 18, h: 38, label: "오른쪽 벽" },
      { id: "mid", kind: "block", x: 32, y: 26, w: 36, h: 24, label: "가운데" },
      { id: "door", kind: "door", x: 40, y: 64, w: 20, h: 6, label: "출입문" },
    ],
  };
  assert.deepEqual(isLegacyDefaultRoom(legacy), { legacy: true, stairs: false });
  const withStairs = { ...legacy, shapes: [...legacy.shapes, { id: "stairs", kind: "stairs" as const, x: 4, y: 60, w: 14, h: 10, label: "계단" }] };
  assert.deepEqual(isLegacyDefaultRoom(withStairs), { legacy: true, stairs: true });
  const edited = { ...legacy, shapes: legacy.shapes.map((s) => (s.id === "mid" ? { ...s, label: "선반" } : s)) };
  assert.equal(isLegacyDefaultRoom(edited).legacy, false);
  assert.equal(isLegacyDefaultRoom(defaultRoomPlan()).legacy, false); // 두 번 돌려도 그대로
  // 2차(작고 촘촘했던 12자리)도 손 안 댔으면 옛 기본으로 본다
  const v2 = {
    h: 70,
    shapes: [
      { id: "room", kind: "room" as const, x: 0, y: 0, w: 100, h: 70, label: "" },
      ...[3, 27, 51, 75].map((x, i) => ({ id: `in${i + 1}`, kind: "block" as const, x, y: 3, w: 22, h: 14, label: `안쪽 ${i + 1}` })),
      ...[20, 34, 48].map((y, i) => ({ id: `l${i + 1}`, kind: "block" as const, x: 3, y, w: 18, h: 12, label: `왼쪽 ${i + 1}` })),
      ...[20, 34, 48].map((y, i) => ({ id: `r${i + 1}`, kind: "block" as const, x: 79, y, w: 18, h: 12, label: `오른쪽 ${i + 1}` })),
      ...[25, 51].map((x, i) => ({ id: `m${i + 1}`, kind: "block" as const, x, y: 26, w: 24, h: 18, label: `가운데 ${i + 1}` })),
      { id: "door", kind: "door" as const, x: 40, y: 64, w: 20, h: 6, label: "입구" },
    ],
  };
  assert.deepEqual(isLegacyDefaultRoom(v2), { legacy: true, stairs: false });
});

test("자리 이름 — 비면 「칸 N」, 지워졌으면 「지워진 자리」", () => {
  const p: Plan = {
    h: 70,
    shapes: [
      { id: "b", kind: "block", x: 50, y: 10, w: 20, h: 14, label: "" },
      { id: "a", kind: "block", x: 10, y: 10, w: 20, h: 14, label: "선반 1" },
      { id: "d", kind: "door", x: 40, y: 64, w: 20, h: 6, label: "입구" },
    ],
  };
  assert.deepEqual(slotsOf(p).map((s) => s.id), ["a", "b"]);
  assert.equal(slotLabel(p, "a"), "선반 1");
  assert.equal(slotLabel(p, "b"), "칸 2");
  assert.equal(slotLabel(p, "zz"), "지워진 자리");
  assert.equal(slotLabel(p, null), null);
});

test("더미 — 자리 안 번호 순 · 본수 · 새 더미 = 가장 큰 번호 + 1 (빈 번호 안 메움)", () => {
  const sets = [
    { id: 1, areaId: 7, slotId: "a", stackNo: 1, qty: 4 },
    { id: 2, areaId: 7, slotId: "a", stackNo: 3, qty: 2 },
    { id: 3, areaId: 7, slotId: "a", stackNo: 1, qty: 4 },
    { id: 4, areaId: 7, slotId: "b", stackNo: 1, qty: 4 },
    { id: 5, areaId: 8, slotId: "a", stackNo: 9, qty: 4 },
  ];
  const st = stacksIn(sets, 7, "a");
  assert.deepEqual(st.map((x) => [x.no, x.sets.length, x.tires]), [
    [1, 2, 8],
    [3, 1, 2],
  ]);
  assert.equal(nextStackNo(sets, 7, "a"), 4);
  assert.equal(nextStackNo(sets, 7, "c"), 1);
});

test("위치 글자", () => {
  assert.equal(locationText({ areaName: "흰색 창고", slotLabel: "안쪽 2", stackNo: 3 }), "흰색 창고 › 안쪽 2 › 더미 3");
  assert.equal(locationText({ areaName: "흰색 창고" }), "흰색 창고");
  assert.equal(locationText({}), "위치 없음");
});

test("도면 고칠 때 — 세트 든 자리 지우기는 잡아냄, 이름 바꾸기는 괜찮음", () => {
  const before = defaultRoomPlan();
  const renamed = { ...before, shapes: before.shapes.map((s) => (s.id === "in2" ? { ...s, label: "선반 A" } : s)) };
  assert.deepEqual(removedOccupiedSlots(before, renamed, ["in2"]), []);
  const removed = { ...before, shapes: before.shapes.filter((s) => s.id !== "in2" && s.id !== "in3") };
  assert.deepEqual(removedOccupiedSlots(before, removed, ["in2", "l1"]), ["in2"]);
});

test("받은 도면 다듬기 — 엉뚱한 값·같은 id 걸러냄", () => {
  assert.equal(sanitizePlan(null), null);
  assert.equal(sanitizePlan({ h: 50 }), null);
  const p = sanitizePlan({ h: 999, shapes: [{ kind: "해킹", x: -5, y: 0, w: 500, h: 4, label: "x".repeat(99), areaIds: ["3", -1, "a"] }, null] })!;
  assert.equal(p.h, 200);
  assert.equal(p.shapes[0].kind, "block");
  assert.equal(p.shapes[0].w, 100);
  assert.equal(p.shapes[0].label.length, 30);
  assert.deepEqual(p.shapes[0].areaIds, [3]);
  const dup = sanitizePlan({ h: 70, shapes: [{ id: "a", kind: "block", x: 0, y: 0, w: 10, h: 10, label: "1" }, { id: "a", kind: "block", x: 20, y: 0, w: 10, h: 10, label: "2" }] })!;
  assert.notEqual(dup.shapes[0].id, dup.shapes[1].id);
  assert.equal(dup.shapes[0].id, "a");
});

test("칸 옮기기·크기 — 도면 밖으로 안 나감", () => {
  const s = { id: "a", kind: "block" as const, x: 10, y: 10, w: 20, h: 10, label: "" };
  assert.deepEqual(moveShape(s, 200, 200, 70), { ...s, x: 80, y: 60 });
  assert.deepEqual(resizeShape(s, -100, -100, 70), { ...s, w: 14, h: 14 }); // 자리는 14 아래로 못 줄임
  const door = { ...s, kind: "door" as const };
  assert.deepEqual(resizeShape(door, -100, -100, 70), { ...door, w: 3, h: 3 });
});

test("사진 검사 · 비율 자르기", () => {
  assert.equal(clamp01(1.4), 1);
  assert.equal(imageProblem(null), null);
  assert.ok(imageProblem("data:text/html;base64,AAAA"));
});

test("타이어마다 스티커 · 메모 속 다른 번호판", () => {
  assert.equal(expandPerTire([{ id: 5, qty: 4 }, { id: 6, qty: 2 }]).length, 6);
  assert.equal(parseLabelPer(null), "tire");
  assert.deepEqual(otherPlatesIn("84고0717보관 이 차량번호로 바꿔 적어서 붙이기", "12가3456"), ["84고0717"]);
});

test("자리 이름 — 빈 이름·겹친 이름 막기, 새 자리는 번호를 붙여서", () => {
  const p = defaultRoomPlan();
  assert.equal(slotNameProblem(p), null);
  const dup = { ...p, shapes: p.shapes.map((x) => (x.id === "in2" ? { ...x, label: "안쪽 1" } : x)) };
  assert.ok(slotNameProblem(dup)?.includes("안쪽 1"));
  const empty = { ...p, shapes: p.shapes.map((x) => (x.id === "in2" ? { ...x, label: " " } : x)) };
  assert.ok(slotNameProblem(empty));
  assert.equal(nextSlotName(p), "새 자리 1");
  const one = { ...p, shapes: [...p.shapes, { id: "z", kind: "block" as const, x: 30, y: 60, w: 20, h: 14, label: "새 자리 1" }] };
  assert.equal(nextSlotName(one), "새 자리 2");
});
