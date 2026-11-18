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
export function resizeShape(s: PlanShape, dw: number, dh: number, planH: number): PlanShape {
  return fitShape({ ...s, w: s.w + dw, h: s.h + dh }, planH);
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
 * 구역 안 기본 도면 — 안을 모르니 **어느 방에나 맞는 틀**만: 벽 쪽 셋 + 가운데 + 출입문(+계단).
 * 「선반 1」·「안쪽 더미」처럼 실제대로 사장님이 고친다.
 */
export function defaultRoomPlan(opts: { stairs?: boolean } = {}): Plan {
  const shapes: PlanShape[] = [
    { id: "room", kind: "room", x: 0, y: 0, w: 100, h: 70, label: "" },
    { id: "back", kind: "block", x: 4, y: 4, w: 92, h: 14, label: "안쪽 벽" },
    { id: "left", kind: "block", x: 4, y: 20, w: 18, h: 38, label: "왼쪽 벽" },
    { id: "right", kind: "block", x: 78, y: 20, w: 18, h: 38, label: "오른쪽 벽" },
    { id: "mid", kind: "block", x: 32, y: 26, w: 36, h: 24, label: "가운데" },
    { id: "door", kind: "door", x: 40, y: 64, w: 20, h: 6, label: "출입문" },
  ];
  if (opts.stairs) shapes.push({ id: "stairs", kind: "stairs", x: 4, y: 60, w: 14, h: 10, label: "계단" });
  return { h: 70, shapes };
}

/** 배치도에서 이 구역이 들어 있는 건물 칸 */
export function siteShapeForArea(site: Plan | null, areaId: number): PlanShape | null {
  return site?.shapes.find((s) => s.areaIds?.includes(areaId)) ?? null;
}

/* ------------------------------------------------------------------
 * 점 · 섞인 더미 (사장님 11-18 — 「한 대분씩이 아니라 8개 2대분, 6개(4+2)처럼 섞여 있음」)
 *   기존 점 가까이(도면 가로의 3% 안)를 누르면 그 점에 붙는다 = 같은 더미(같은 좌표).
 * ---------------------------------------------------------------- */

export interface PinLite {
  id: number;
  x: number; // 0~1
  y: number; // 0~1
}

export const STACK_RADIUS = 0.03;

/** 누른 자리(0~1)에서 가까운 기존 점 — 도면 비율(planH/100)을 고려한 실제 거리로 */
export function nearestPin<T extends PinLite>(pins: T[], x: number, y: number, planH: number, selfId?: number): T | null {
  const ry = planH / PLAN_W;
  let best: { p: T; d: number } | null = null;
  for (const p of pins) {
    if (p.id === selfId) continue;
    const d = Math.hypot(p.x - x, (p.y - y) * ry);
    if (d <= STACK_RADIUS && (!best || d < best.d)) best = { p, d };
  }
  return best?.p ?? null;
}

/** 같은 더미 = 같은 구역·같은 좌표 (붙일 때 좌표를 그대로 복사하므로 정확히 같다) */
export function sameStack<T extends PinLite & { areaId: number | null }>(all: T[], me: T): T[] {
  if (me.areaId == null) return [];
  return all.filter((p) => p.areaId === me.areaId && Math.abs(p.x - me.x) < 1e-6 && Math.abs(p.y - me.y) < 1e-6);
}

/** 도면 배경 사진 — 데이터 URL 이고 너무 크지 않을 것 */
export function imageProblem(dataUrl: string | null | undefined): string | null {
  if (dataUrl == null || dataUrl === "") return null;
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) return "사진 파일만 올릴 수 있습니다";
  if (dataUrl.length > 900_000) return "사진이 너무 큽니다 — 다시 골라 주세요";
  return null;
}
