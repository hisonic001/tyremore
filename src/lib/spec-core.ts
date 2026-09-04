/**
 * 차종별 순정 제원 — 항목 정본과 단위 (D-04 3차 개정, 2026-09-03)
 *
 * 🔴 이 표는 **틀리면 사람이 다치는 자료**다. 휠너트 토크가 틀리면 바퀴가 빠지고,
 *    오일 규격이 틀리면 엔진이 상한다. 그래서 「모르면 비워 둔다」가 정상 상태다.
 *
 * 항목·단위·정상범위를 **여기 한 곳에만** 둔다. 검사(spec-verify)·화면·수집이 전부 이걸 본다.
 *
 * 🔴 `@/db` 도 `node:fs` 도 import 하지 않는다 — 화면과 테스트가 같이 쓴다.
 */

/** 값 하나가 얼마나 위험한가 — 「높음」은 검증 전에 숫자를 아예 안 보여준다 */
export type Risk = "높음" | "보통" | "낮음";

export interface SpecItemDef {
  /** DB 의 item 값 */
  key: string;
  label: string;
  /** 숫자 값인가 (아니면 '0W-20' 같은 글자) */
  numeric: boolean;
  /** 허용 단위 — 이 밖의 단위는 저장 자체가 거절된다 */
  units: string[];
  risk: Risk;
  /**
   * 단위별 정상 범위. **자릿수 사고와 단위 혼동을 여기서 잡는다.**
   * 검색엔진이 실제로 「11~13 N·m」라고 10배 틀리게 말한 적이 있다 (2026-09-03 실측).
   */
  range?: Record<string, { min: number; max: number }>;
  /** 화물차는 승용의 두 배다 — 차체 종류로 범위가 갈리는 항목 */
  rangeByBody?: Record<string, Record<string, { min: number; max: number }>>;
  hint?: string;
}

export const SPEC_ITEMS: SpecItemDef[] = [
  {
    key: "tire_size",
    label: "타이어 규격",
    numeric: false,
    units: [],
    risk: "낮음",
    hint: "235/60R18",
  },
  { key: "wheel_size", label: "휠 규격", numeric: false, units: [], risk: "낮음", hint: "7.5Jx18" },
  {
    key: "tire_pressure",
    label: "표준 공기압",
    numeric: true,
    units: ["kPa", "psi"],
    risk: "보통",
    range: { kPa: { min: 150, max: 900 }, psi: { min: 22, max: 130 } },
    hint: "240 kPa (35 psi)",
  },
  {
    key: "wheel_nut_torque",
    label: "휠너트 체결 토크",
    numeric: true,
    /** 🔴 가장 위험한 값 — 틀리면 주행 중 바퀴가 빠진다 */
    units: ["kgf·m", "N·m"],
    risk: "높음",
    range: { "kgf·m": { min: 6, max: 70 }, "N·m": { min: 60, max: 700 } },
    /**
     * 🔴 차체 종류로 범위가 크게 갈린다. 승용 기준으로 다 막으면 화물차 값을 못 넣고,
     *    화물차 기준으로 다 열면 승용의 자릿수 사고를 놓친다.
     *    19.5인치 상용 휠은 실제로 `500±40 N·m` 다 (현대 상용 취급설명서 실측 2026-09-03).
     */
    rangeByBody: {
      /**
       * 🔴 8~15 로 좁게 잡았다가 **진짜 값을 막았다.** 제네시스 G80(RG3) 취급설명서의
       *    실제 값이 `14~16 kgf·m` 다 (2026-09-03 실측). 큰 세단·큰 SUV 는 더 높다.
       *    그래서 20 까지 연다 — 자릿수 사고(110·1.1)는 여전히 걸린다.
       */
      승용: { "kgf·m": { min: 8, max: 20 }, "N·m": { min: 78, max: 196 } },
      SUV: { "kgf·m": { min: 8, max: 20 }, "N·m": { min: 78, max: 196 } },
      소형트럭: { "kgf·m": { min: 9, max: 25 }, "N·m": { min: 88, max: 250 } },
      "밴·소형버스": { "kgf·m": { min: 9, max: 25 }, "N·m": { min: 88, max: 250 } },
      /** 19.5인치 이상 상용 — 매장에서 자주 보진 않지만 범위를 막아 두면 값을 못 넣는다 */
      대형: { "kgf·m": { min: 25, max: 70 }, "N·m": { min: 250, max: 700 } },
    },
    hint: "11~13 kgf·m",
  },
  {
    key: "engine_oil_viscosity",
    label: "엔진오일 점도",
    numeric: false,
    units: [],
    risk: "보통",
    hint: "0W-20",
  },
  {
    key: "engine_oil_spec",
    label: "엔진오일 규격",
    numeric: false,
    units: [],
    risk: "보통",
    hint: "API SN PLUS/SP, ILSAC GF-6",
  },
  {
    key: "engine_oil_qty",
    label: "엔진오일 용량",
    numeric: true,
    /** 🔴 적게 넣으면 엔진이 상한다 */
    units: ["L"],
    risk: "높음",
    range: { L: { min: 2, max: 20 } },
    hint: "6.1 L (필터 포함)",
  },
  {
    key: "coolant_qty",
    label: "냉각수 용량",
    numeric: true,
    units: ["L"],
    risk: "보통",
    range: { L: { min: 2, max: 30 } },
  },
  { key: "brake_fluid_spec", label: "브레이크액 규격", numeric: false, units: [], risk: "보통", hint: "DOT-4" },
  {
    key: "transmission_oil_spec",
    label: "변속기유 규격",
    numeric: false,
    units: [],
    risk: "보통",
    hint: "ATF SP-Ⅳ",
  },
  {
    key: "transmission_oil_qty",
    label: "변속기유 용량",
    numeric: true,
    units: ["L"],
    risk: "보통",
    range: { L: { min: 1, max: 20 } },
  },
  { key: "battery_size", label: "배터리 규격", numeric: false, units: [], risk: "보통", hint: "AGM 80Ah (DIN80L)" },
  {
    key: "battery_ah",
    label: "배터리 용량",
    numeric: true,
    units: ["Ah"],
    risk: "보통",
    range: { Ah: { min: 30, max: 250 } },
  },
  {
    key: "battery_cca",
    label: "배터리 CCA",
    numeric: true,
    units: ["CCA"],
    risk: "보통",
    range: { CCA: { min: 250, max: 1200 } },
  },
  {
    key: "fuel_tank_qty",
    label: "연료탱크 용량",
    numeric: true,
    units: ["L"],
    risk: "낮음",
    range: { L: { min: 20, max: 200 } },
  },
  { key: "wiper_size", label: "와이퍼 규격", numeric: false, units: [], risk: "낮음", hint: "650mm / 400mm" },
];

const BY_KEY = new Map(SPEC_ITEMS.map((i) => [i.key, i]));
export function specItem(key: string): SpecItemDef | null {
  return BY_KEY.get(key) ?? null;
}

/* ------------------------------------------------------------------ */
/* 단위                                                                */
/* ------------------------------------------------------------------ */

/**
 * 사람이 쓰는 여러 표기를 정본 단위로 모은다.
 * 원문이 `kgf.m`·`kg·m`·`kgfm`·`N.m` 등으로 제각각이라 여기서 통일하지 않으면
 * 범위 검산이 통째로 헛돈다.
 */
export function normalizeUnit(raw: string | null | undefined): string | null {
  const s = String(raw ?? "")
    .replace(/[\s]/g, "")
    .replace(/[․·ㆍ．]/g, ".")
    .toLowerCase();
  if (!s) return null;
  if (/^kgf?\.?m$/.test(s) || s === "kg중.m" || s === "kgm") return "kgf·m";
  if (/^n\.?m$/.test(s) || s === "newtonmeter") return "N·m";
  if (s === "kpa") return "kPa";
  if (s === "psi") return "psi";
  if (s === "bar") return "bar";
  if (s === "l" || s === "ℓ" || s === "리터") return "L";
  if (s === "ah") return "Ah";
  if (s === "cca") return "CCA";
  if (s === "mm") return "mm";
  return null;
}

/** kgf·m ↔ N·m (1 kgf·m = 9.80665 N·m) */
export const KGFM_TO_NM = 9.80665;
/** kPa ↔ psi (1 psi = 6.89476 kPa) */
export const PSI_TO_KPA = 6.89476;

/** 원문이 `230(33)` 처럼 두 단위를 같이 적어 줄 때, 우리가 계산해 맞는지 본다 */
export function convert(value: number, from: string, to: string): number | null {
  if (from === to) return value;
  if (from === "kgf·m" && to === "N·m") return value * KGFM_TO_NM;
  if (from === "N·m" && to === "kgf·m") return value / KGFM_TO_NM;
  if (from === "psi" && to === "kPa") return value * PSI_TO_KPA;
  if (from === "kPa" && to === "psi") return value / PSI_TO_KPA;
  if (from === "bar" && to === "kPa") return value * 100;
  if (from === "kPa" && to === "bar") return value / 100;
  return null;
}

/** 화면에 두 단위를 나란히 — 토크는 늘 병기한다 (현장에서 렌치 눈금이 다르다) */
export function bothUnits(min: number, max: number | null, unit: string): string {
  /**
   * 🔴 값을 반올림해 보여 주지 않는다. `2.45~2.5 L` 을 `2.5~2.5 L` 로 적으면
   *    사장님이 검수하실 때 원문과 달라 보인다 — 화면 글자도 원문 그대로여야 한다.
   *    (병기하는 환산값만 반올림한다. 그건 우리가 계산한 것이라 원문에 없다)
   */
  const one = (v: number) => String(Number(v.toFixed(3)));
  const head = max === null || max === min ? one(min) : `${one(min)}~${one(max)}`;
  const other = unit === "kgf·m" ? "N·m" : unit === "N·m" ? "kgf·m" : unit === "kPa" ? "psi" : unit === "psi" ? "kPa" : null;
  if (!other) return `${head} ${unit}`;
  const cMin = convert(min, unit, other);
  const cMax = max === null ? null : convert(max, unit, other);
  if (cMin === null) return `${head} ${unit}`;
  const conv = cMax === null || Math.round(cMax) === Math.round(cMin)
    ? String(Math.round(cMin))
    : `${Math.round(cMin)}~${Math.round(cMax)}`;
  return `${head} ${unit} (${conv} ${other})`;
}

/* ------------------------------------------------------------------ */
/* 모양 검사 — 형태가 아닌 값은 애초에 안 받는다                          */
/* ------------------------------------------------------------------ */

/**
 * 235/60R18 · 265/70 R17 · 145/80R13 · 215/70R16C · 215/65R17 XL
 * 🔴 뒤에 붙는 글자를 받아 준다. 상용 타이어의 `C`(승합·화물)와 `XL`(강화)은
 *    실제 취급설명서에 그대로 적혀 있다 — 안 받아 주면 그랜드 스타렉스·포터 같은
 *    상용차 표를 통째로 못 읽는다 (2026-09-03 실측).
 */
export const TIRE_SIZE_RE = /^(\(?P\)?|LT)?\s?\d{3}\/\d{2}\s?[RZ]\s?\d{2}(\.\d)?\s?(C|LT|XL|RF)?$/;
/** 7.5Jx18 · 8.5J x 20 */
export const WHEEL_SIZE_RE = /^\d{1,2}(\.\d)?J\s?[xX×]\s?\d{2}(\.\d)?$/;
/** 0W-20 · 5W-30 · 10W-40 — 실제로 쓰이는 것만 */
export const VISCOSITIES = [
  "0W-8", "0W-16", "0W-20", "0W-30", "0W-40",
  "5W-20", "5W-30", "5W-40", "5W-50",
  "10W-30", "10W-40", "10W-50", "15W-40", "20W-50",
];

export function looksLikeTireSize(v: string): boolean {
  const s = v.replace(/\s/g, "").toUpperCase();
  if (!TIRE_SIZE_RE.test(v.trim().toUpperCase()) && !TIRE_SIZE_RE.test(s)) return false;
  const m = /(\d{3})\/(\d{2})/.exec(s);
  if (!m) return false;
  const width = Number(m[1]);
  const aspect = Number(m[2]);
  const rim = Number(/[RZ](\d{2})/.exec(s)?.[1] ?? 0);
  return width >= 125 && width <= 385 && aspect >= 25 && aspect <= 90 && rim >= 12 && rim <= 24;
}

export function looksLikeWheelSize(v: string): boolean {
  return WHEEL_SIZE_RE.test(v.trim().replace(/\s/g, ""));
}

export function looksLikeViscosity(v: string): boolean {
  return VISCOSITIES.includes(v.trim().toUpperCase().replace(/\s/g, ""));
}
