/**
 * ⭐ 보관 위치 도면 — 순수 규칙 정본 (D-42 개정, 2026-11-18)
 *
 *   사장님: 「찾는 게 문제」 → 「이미지와 지도 도면 클릭으로 위치 특정」 → 「도면은 알아서 그려 주거나 내가 살짝 수정 가능하게」.
 *   그래서 **앱이 기본 도면을 그려 두고, 사장님이 손가락으로 칸을 옮기고·늘리고·이름 바꾸고·더하고·지운다.**
 *
 *   좌표: 도면 하나 = 가로 100 × 세로 h(도면마다) 단위. 세트의 점은 0~1 비율(x/100, y/h) — 화면 크기와 무관.
 *   🔴 "use server" 아님. DB 없음 — 화면·서버·시험이 같이 쓴다 (`storage-plan-pure.test.ts`).
 */

export type ShapeKind = "building" | "room" | "block" | "door" | "stairs" | "yard" | "road";

export interface PlanShape {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  /** 배치도(site)의 건물 칸 → 들어갈 구역 id 들 (3층 건물 = 층마다 하나) */
  areaIds?: number[];
}

export interface Plan {
  /** 세로 길이 (가로는 늘 100) */
  h: number;
  shapes: PlanShape[];
}

export const PLAN_W = 100;
const MIN = 3; // 칸 최소 크기
const GRID = 1; // 끌 때 1단위로 맞춘다

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
export function clamp01(n: number): number {
  return Number.isFinite(n) ? clamp(n, 0, 1) : 0;
}
const snap = (n: number) => Math.round(n / GRID) * GRID;

/** 칸이 도면 밖으로 안 나가고, 너무 작아지지 않게 */
export function fitShape(s: PlanShape, planH: number): PlanShape {
  const w = clamp(snap(s.w), MIN, PLAN_W);
  const h = clamp(snap(s.h), MIN, planH);
  return { ...s, w, h, x: clamp(snap(s.x), 0, PLAN_W - w), y: clamp(snap(s.y), 0, planH - h) };
}

export function moveShape(s: PlanShape, dx: number, dy: number, planH: number): PlanShape {
  return fitShape({ ...s, x: s.x + dx, y: s.y + dy }, planH);
}
/**
 * 🔴 자리(block)는 14단위 아래로 못 줄인다 (2026-11-18 검토 — 폰 360px 에서 1단위 ≈ 3.2px, 14 ≈ 45px = 손가락 한 개).
 *    저장된 옛 칸은 건드리지 않는다(sanitize 는 3) — 고칠 때만 막는다.
 */
export const SLOT_MIN = 14;
export function resizeShape(s: PlanShape, dw: number, dh: number, planH: number): PlanShape {
  const m = s.kind === "block" ? SLOT_MIN : MIN;
  const r = fitShape({ ...s, w: Math.max(m, s.w + dw), h: Math.max(m, s.h + dh) }, planH);
  return r;
}

let seq = 0;
export function newShapeId(): string {
  seq += 1;
  return `s${Date.now().toString(36)}${seq}`;
}

/** 저장 전에 받은 도면을 믿지 않고 다시 다듬는다 (화면이 보낸 JSON) */
export function sanitizePlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { h?: unknown; shapes?: unknown };
  const h = clamp(Number(r.h) || 60, 20, 200);
  if (!Array.isArray(r.shapes)) return null;
  const kinds: ShapeKind[] = ["building", "room", "block", "door", "stairs", "yard", "road"];
  const shapes = r.shapes.slice(0, 80).flatMap((x): PlanShape[] => {
    if (!x || typeof x !== "object") return [];
    const s = x as Record<string, unknown>;
    const kind = kinds.includes(s.kind as ShapeKind) ? (s.kind as ShapeKind) : "block";
    const areaIds = Array.isArray(s.areaIds) ? s.areaIds.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 10) : undefined;
    return [
      fitShape(
        {
          id: String(s.id ?? newShapeId()).slice(0, 40),
          kind,
          x: Number(s.x) || 0,
          y: Number(s.y) || 0,
          w: Number(s.w) || 10,
          h: Number(s.h) || 10,
          label: String(s.label ?? "").slice(0, 30),
          ...(areaIds?.length ? { areaIds } : {}),
        },
        h,
      ),
    ];
  });
  // 🔴 같은 id 두 칸이면 두 자리가 세트를 나눠 갖게 된다 — 뒤의 것에 새 id
  const seen = new Set<string>();
  for (const sh of shapes) {
    if (seen.has(sh.id)) sh.id = newShapeId();
    seen.add(sh.id);
  }
  return { h, shapes };
}

/* ------------------------------------------------------------------
 * 기본 도면 — 사장님이 준 항공사진·길 사진(2026-11-18)의 배치를 따랐다.
 *   가운데 매장(셔터 6칸) · 그 앞 마당 · 왼쪽 위 벽돌 창고(+파란 차양) · 그 아래 흰색 창고 · 오른쪽 3층 건물 · 아래 도로.
 *   비율은 항공사진 대로(가로 100 : 세로 48). 실제와 다르면 사장님이 칸을 끌어 고친다.
 * ---------------------------------------------------------------- */

export interface SeedAreaIds {
  brick: number;
  white: number;
  floor1: number;
  floor2: number;
  floor3: number;
}

export function defaultSitePlan(a: SeedAreaIds): Plan {
  return {
    h: 48,
    shapes: [
      { id: "brick", kind: "building", x: 1, y: 14, w: 16, h: 14, label: "벽돌 창고", areaIds: [a.brick] },
      { id: "awning", kind: "block", x: 1, y: 28, w: 16, h: 4, label: "파란 차양", areaIds: [a.brick] },
      { id: "white", kind: "building", x: 14, y: 34, w: 11, h: 10, label: "흰색 창고", areaIds: [a.white] },
      { id: "shop", kind: "building", x: 28, y: 1, w: 35, h: 28, label: "매장 (셔터 6칸)" },
      { id: "yard", kind: "yard", x: 26, y: 30, w: 38, h: 13, label: "마당" },
      { id: "b3", kind: "building", x: 65, y: 6, w: 34, h: 32, label: "3층 건물", areaIds: [a.floor1, a.floor2, a.floor3] },
      { id: "road", kind: "road", x: 0, y: 45, w: 100, h: 3, label: "도로" },
    ],
  };
}

/**
 * 구역 안 기본 도면 — 안을 모르니 **어느 방에나 맞는 틀** (2026-11-18 3차 개정).
 *   🔴 점 대신 **자리**: 칸(block) 하나가 손가락으로 누르는 자리다. 넓은 벽 하나(「안쪽 벽」)면 더미 20개를 뒤져야 하므로
 *   벽을 구간으로 나눴다 — 안쪽 1~4 · 왼쪽 1~3 · 오른쪽 1~3 · 가운데 1~2 (입구는 늘 아래). 사장님이 실제대로 고친다.
 *   이름이 곧 「자리 표지」(A4 에 크게 뽑아 벽에 붙임) — 화면 글자와 창고가 같은 말을 한다.
 */
export function defaultRoomPlan(opts: { stairs?: boolean } = {}): Plan {
  // 가로 100 × 세로 90 — 자리는 모두 16단위(≈51px) 이상 높고, 사이는 4단위(≈13px) 띄운다 (검토 2026-11-18: 장갑 손가락)
  const shapes: PlanShape[] = [{ id: "room", kind: "room", x: 0, y: 0, w: 100, h: 90, label: "" }];
  [3, 27, 51, 75].forEach((x, i) => shapes.push({ id: `in${i + 1}`, kind: "block", x, y: 3, w: 20, h: 16, label: `안쪽 ${i + 1}` }));
  [23, 43, 63].forEach((y, i) => shapes.push({ id: `l${i + 1}`, kind: "block", x: 3, y, w: 18, h: 16, label: `왼쪽 ${i + 1}` }));
  [23, 43, 63].forEach((y, i) => shapes.push({ id: `r${i + 1}`, kind: "block", x: 79, y, w: 18, h: 16, label: `오른쪽 ${i + 1}` }));
  [26, 52].forEach((x, i) => shapes.push({ id: `m${i + 1}`, kind: "block", x, y: 33, w: 22, h: 24, label: `가운데 ${i + 1}` }));
  shapes.push({ id: "door", kind: "door", x: 38, y: 84, w: 24, h: 6, label: "입구" });
  if (opts.stairs) shapes.push({ id: "stairs", kind: "stairs", x: 3, y: 83, w: 14, h: 7, label: "계단" });
  return { h: 90, shapes };
}

/** 2차 기본 도면(자리 12개지만 작고 촘촘했던 것, 11-18 낮 잠깐) — 손 안 댔으면 3차로 바꾼다 */
function v2RoomPlan(stairs: boolean): Plan {
  const shapes: PlanShape[] = [{ id: "room", kind: "room", x: 0, y: 0, w: 100, h: 70, label: "" }];
  [3, 27, 51, 75].forEach((x, i) => shapes.push({ id: `in${i + 1}`, kind: "block", x, y: 3, w: 22, h: 14, label: `안쪽 ${i + 1}` }));
  [20, 34, 48].forEach((y, i) => shapes.push({ id: `l${i + 1}`, kind: "block", x: 3, y, w: 18, h: 12, label: `왼쪽 ${i + 1}` }));
  [20, 34, 48].forEach((y, i) => shapes.push({ id: `r${i + 1}`, kind: "block", x: 79, y, w: 18, h: 12, label: `오른쪽 ${i + 1}` }));
  [25, 51].forEach((x, i) => shapes.push({ id: `m${i + 1}`, kind: "block", x, y: 26, w: 24, h: 18, label: `가운데 ${i + 1}` }));
  shapes.push({ id: "door", kind: "door", x: 40, y: 64, w: 20, h: 6, label: "입구" });
  if (stairs) shapes.push({ id: "stairs", kind: "stairs", x: 3, y: 62, w: 14, h: 8, label: "계단" });
  return { h: 70, shapes };
}

/** 1차 기본 도면(벽 셋 + 가운데, 2026-11-18 오전) — 손 안 댄 도면만 새 기본으로 바꾸려고 비교용으로 남긴다 */
function legacyRoomPlan(stairs: boolean): Plan {
  const shapes: PlanShape[] = [
    { id: "room", kind: "room", x: 0, y: 0, w: 100, h: 70, label: "" },
    { id: "back", kind: "block", x: 4, y: 4, w: 92, h: 14, label: "안쪽 벽" },
    { id: "left", kind: "block", x: 4, y: 20, w: 18, h: 38, label: "왼쪽 벽" },
    { id: "right", kind: "block", x: 78, y: 20, w: 18, h: 38, label: "오른쪽 벽" },
    { id: "mid", kind: "block", x: 32, y: 26, w: 36, h: 24, label: "가운데" },
    { id: "door", kind: "door", x: 40, y: 64, w: 20, h: 6, label: "출입문" },
  ];
  if (stairs) shapes.push({ id: "stairs", kind: "stairs", x: 4, y: 60, w: 14, h: 10, label: "계단" });
  return { h: 70, shapes };
}

const shapeKey = (p: Plan) =>
  JSON.stringify([p.h, [...p.shapes].sort((a, b) => a.id.localeCompare(b.id)).map((x) => [x.id, x.kind, x.x, x.y, x.w, x.h, x.label])]);

/** 사장님이 손 안 댄 옛 기본 도면(1차·2차)인가 — 그대로면 새 기본으로 바꿔도 된다. 계단 여부도 */
export function isLegacyDefaultRoom(p: Plan | null): { legacy: boolean; stairs: boolean } {
  if (!p) return { legacy: false, stairs: false };
  const k = shapeKey(p);
  for (const stairs of [false, true]) {
    if (k === shapeKey(legacyRoomPlan(stairs)) || k === shapeKey(v2RoomPlan(stairs))) return { legacy: true, stairs };
  }
  return { legacy: false, stairs: false };
}

/** 도면 저장 전 검사 — 자리 이름이 비었거나 겹치면 위치 글자로 구분이 안 된다 (검토 2026-11-18) */
export function slotNameProblem(p: Plan): string | null {
  const names = slotsOf(p).map((s) => s.label.trim());
  if (names.some((n) => !n)) return "이름 없는 자리가 있습니다 — 자리마다 이름을 붙여 주세요";
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  return dup ? `「${dup}」 이름이 두 자리에 있습니다 — 서로 다르게 해 주세요` : null;
}

/** 새 자리 이름 — 「새 자리 1」, 「새 자리 2」… 겹치지 않게 */
export function nextSlotName(p: Plan): string {
  const used = new Set(slotsOf(p).map((s) => s.label.trim()));
  for (let i = 1; ; i++) if (!used.has(`새 자리 ${i}`)) return `새 자리 ${i}`;
}

/** 배치도에서 이 구역이 들어 있는 건물 칸 */
export function siteShapeForArea(site: Plan | null, areaId: number): PlanShape | null {
  return site?.shapes.find((s) => s.areaIds?.includes(areaId)) ?? null;
}

/* ------------------------------------------------------------------
 * 자리 · 더미 (2026-11-18 3차 개정 — 사장님 「점찍기 허술·허접: 점이 작고 잘못 눌리고 겹친다. 찾는 사람 입장에서 고쳐라」)
 *   위치 = 구역 + 자리(구역 도면의 block 칸 id) + 더미 번호(자리 안 1,2,3…).
 *   점·좌표·「가까이 누르면 붙기」는 없앴다 — 칸 전체가 누르는 곳, 더미는 버튼.
 * ---------------------------------------------------------------- */

/** 자리 = 구역 도면의 block 칸. 읽는 순서(위→아래, 왼→오른) */
export function slotsOf(p: Plan | null): PlanShape[] {
  if (!p) return [];
  return p.shapes.filter((s) => s.kind === "block").sort((a, b) => a.y - b.y || a.x - b.x);
}

/** 자리 이름 — 이름이 비면 「칸 N」, 도면에서 지워졌으면 「지워진 자리」 */
export function slotLabel(p: Plan | null, slotId: string | null | undefined): string | null {
  if (!slotId) return null;
  const slots = slotsOf(p);
  const i = slots.findIndex((s) => s.id === slotId);
  if (i < 0) return "지워진 자리";
  return slots[i].label.trim() || `칸 ${i + 1}`;
}

export interface SetAtSlot {
  id: number;
  areaId: number | null;
  slotId: string | null;
  stackNo: number | null;
  qty: number;
}

/** 자리 안 더미들 — 번호 순, 더미마다 세트·본수 */
export function stacksIn<T extends SetAtSlot>(sets: T[], areaId: number, slotId: string): { no: number; sets: T[]; tires: number }[] {
  const m = new Map<number, T[]>();
  for (const s of sets) {
    if (s.areaId !== areaId || s.slotId !== slotId || s.stackNo == null) continue;
    m.set(s.stackNo, [...(m.get(s.stackNo) ?? []), s]);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([no, ss]) => ({ no, sets: ss, tires: ss.reduce((t, x) => t + x.qty, 0) }));
}

/** 새 더미 번호 = 자리 안 가장 큰 번호 + 1 (비면 1). 🔴 자동으로 다시 매기지 않는다 — 직원이 번호를 기억한다 */
export function nextStackNo(sets: SetAtSlot[], areaId: number, slotId: string): number {
  let mx = 0;
  for (const s of sets) if (s.areaId === areaId && s.slotId === slotId && s.stackNo != null) mx = Math.max(mx, s.stackNo);
  return mx + 1;
}

/** 「흰색 창고 › 안쪽 2 › 더미 3」 — 비면 「위치 없음」 */
export function locationText(o: { areaName?: string | null; slotLabel?: string | null; stackNo?: number | null }): string {
  if (!o.areaName) return "위치 없음";
  // 더미는 화면에서 뺐다(사장님 2026-11-18) — 옛 세트의 더미 번호가 DB 에 남아 있어도 안 보인다
  return [o.areaName, o.slotLabel].filter(Boolean).join(" › ");
}

/**
 * ⭐ 더미 없애기 (사장님 2026-11-18 — 「더미 구성하는 게 복잡 — 더 직관적이고 쉽게」, 세 안 중 「더미 없애기」 고름)
 *   위치 = **구역 › 자리** 까지만. 화면은 더미를 묻지도 보이지도 않고, 새로 놓는 세트는 stack_no 에 이 값을 넣는다.
 *   찾을 때는 그 자리에 가서 스티커 보관번호로 찾는다. 같은 자리 = 함께 있는 세트(섞여 쌓인 것 포함).
 *   🔴 stack_no 칸·옛 번호는 지우지 않았다(되돌릴 길) — 「더미를 다시 고르게」 재제안 금지.
 */
export const ONE_STACK = 1;

/** 같은 자리에 있는 세트들 (더미 구분 없이) */
export function setsAtSlot<T extends SetAtSlot>(sets: T[], areaId: number | null, slotId: string | null): T[] {
  if (areaId == null || !slotId) return [];
  return sets.filter((s) => s.areaId === areaId && s.slotId === slotId);
}

/** 도면 고칠 때 — 세트가 든 자리를 지우면 안 된다(그 세트가 어디 있는지 잃는다) */
export function removedOccupiedSlots(before: Plan | null, after: Plan, occupied: Iterable<string>): string[] {
  const keep = new Set(slotsOf(after).map((s) => s.id));
  const had = new Set(slotsOf(before).map((s) => s.id));
  return [...new Set(occupied)].filter((id) => had.has(id) && !keep.has(id));
}

/** 도면 배경 사진 — 데이터 URL 이고 너무 크지 않을 것 */
export function imageProblem(dataUrl: string | null | undefined): string | null {
  if (dataUrl == null || dataUrl === "") return null;
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) return "사진 파일만 올릴 수 있습니다";
  if (dataUrl.length > 900_000) return "사진이 너무 큽니다 — 다시 골라 주세요";
  return null;
}
