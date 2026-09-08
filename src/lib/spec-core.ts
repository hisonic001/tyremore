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
  /**
   * ⭐ 순정으로 끼워 나오는 타이어 **브랜드** (2026-09-05, 사장님 요청)
   *
   * 🔴 **모델명(크로스클라이밋 같은 것)은 여기 안 온다.** 출처인 자동차 「차량정보」 장의
   *    타이어 에너지소비효율 표에는 **제조사와 규격까지만** 적혀 있다.
   *    한 규격에 공급사가 여럿일 수 있어 여러 줄이 붙는다 — 그게 정상이다.
   */
  {
    key: "oe_tire_brand",
    label: "순정 타이어 브랜드",
    numeric: false,
    units: [],
    risk: "낮음",
    hint: "넥센 (NEXEN)",
  },
  /**
   * ⭐ 순정 타이어의 **패턴명** (2026-09-08, 사장님 지시)
   *
   * 🔴 설명서에는 **없다.** 자료실 PDF 의 에너지소비효율 표에는 제조사와 규격까지만 적혀 있다.
   *    그래서 이 값은 **우리 상품 목록에서 고르거나** 사장님이 실물을 보고 넣는 길뿐이다.
   *    우리가 파는 물건에서 고르면 브랜드·패턴·규격이 한 번에 맞아 들어온다.
   */
  {
    key: "oe_tire_pattern",
    label: "순정 타이어 패턴",
    numeric: false,
    units: [],
    risk: "낮음",
    hint: "엔페라 AU7",
  },
  {
    /**
     * 🔴 **기본 단위는 psi** (2026-09-08, 사장님 지시). 현장에서 공기압을 넣을 때
     *    보는 눈금이 psi 다. 설명서에서 옮겨 온 값은 kPa 로 들어와 있는데
     *    그건 **원문 그대로 두고** 화면에서 psi 를 앞에 보여 준다.
     *    🔴 `units` 의 **첫 칸이 기본값**이다 — 입력칸의 단위 고르기가 이걸 따른다.
     */
    key: "tire_pressure",
    label: "표준 공기압",
    numeric: true,
    units: ["psi", "kPa"],
    risk: "보통",
    range: { kPa: { min: 150, max: 900 }, psi: { min: 22, max: 130 } },
    hint: "35 psi",
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
  /**
   * ⭐ 오일 갈 때 쓰는 두 토크 (2026-09-05, 사장님 요청)
   *
   * 🔴 **취급설명서에는 없다.** 받아 둔 설명서 43건에 「드레인」이 0건이었다 —
   *    운전자용 책이라 정비 토크를 안 싣는다. 정비지침서·제조사 자료 쪽 값이라
   *    인터넷에서 **서로 다른 두 곳이 같은 값을 말할 때만** 받아 온다 (spec-search.ts).
   *
   * 🔴 범위는 **자릿수 사고를 잡을 만큼 좁고, 진짜 값을 막지 않을 만큼 넓게.**
   *    국산 승용 드레인은 대개 35~45 N·m, 카트리지 필터캡은 25 N·m 안팎이다.
   *    너무 좁게 잡으면 진짜 값이 걸리고, 너무 넓으면 10배 오기를 못 잡는다.
   */
  {
    key: "oil_filter_torque",
    label: "오일필터 체결 토크",
    numeric: true,
    units: ["N·m", "kgf·m"],
    risk: "높음",
    range: { "N·m": { min: 8, max: 45 }, "kgf·m": { min: 0.8, max: 4.6 } },
    hint: "25 N·m",
  },
  {
    key: "oil_drain_plug_torque",
    label: "드레인 플러그 체결 토크",
    numeric: true,
    /** 🔴 과하게 조이면 오일팬 나사산이 나간다 — 알루미늄 오일팬은 특히 */
    units: ["N·m", "kgf·m"],
    risk: "높음",
    range: { "N·m": { min: 15, max: 70 }, "kgf·m": { min: 1.5, max: 7.2 } },
    hint: "35~45 N·m",
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
  /**
   * 🔴 정본은 **형식+용량+단자방향을 한 덩어리로** — `AGM80L` · `DIN80L` · `CMF60R`.
   *    이 한 줄에 AGM 인지 일반인지와 단자가 왼쪽인지 오른쪽인지가 다 들어간다.
   *    단자 방향을 틀리면 케이블이 안 닿는다.
   */
  { key: "battery_size", label: "배터리 규격", numeric: false, units: [], risk: "보통", hint: "AGM80L" },
  /**
   * ⭐ 배터리 두 가지 (2026-09-08, 정비이력을 세어 보고 넣었다 — 배터리 작업이 62건)
   *
   * 🔴 공임표에 **「배터리교환 - 트렁크 내부」**가 따로 있다. 어디 붙어 있는지가 곧 작업 시간이다.
   * 🔴 리셋을 안 하면 충전 제어가 새 배터리를 옛 배터리로 알고 굴려 금방 상한다.
   */
  {
    key: "battery_position",
    label: "배터리 위치",
    numeric: false,
    units: [],
    risk: "낮음",
    hint: "엔진룸",
  },
  {
    key: "battery_reset",
    label: "교체 후 리셋",
    numeric: false,
    units: [],
    risk: "보통",
    hint: "IBS 리셋 필요",
  },
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
  /**
   * 🔴 **위치별 숫자 한 줄씩** 이다 (2026-09-08). 예전엔 「650mm / 400mm」 한 덩어리 글자였는데,
   *    그러면 운전석 것을 조수석에 끼우는 실수를 화면이 못 막는다.
   *    `qualifier.위치` 로 운전석·조수석·후방을 나눈다. 바꿀 때 옮길 자료가 **0건**이었다.
   */
  {
    key: "wiper_size",
    label: "와이퍼 규격",
    numeric: true,
    units: ["mm"],
    risk: "낮음",
    range: { mm: { min: 300, max: 800 } },
    hint: "650 mm",
  },
];

/** 고르기로만 받는 항목 — 자유 입력을 막아 표기가 갈리지 않게 한다 */
export const SPEC_CHOICES: Readonly<Record<string, readonly string[]>> = {
  battery_position: ["엔진룸", "트렁크", "뒷좌석 밑", "실내 바닥"],
  battery_reset: ["필요 없음", "IBS 리셋 필요", "스캐너로 등록 필요"],
};

/** 와이퍼는 위치가 있어야 뜻이 있다 */
export const WIPER_POSITIONS = ["운전석", "조수석", "후방"] as const;

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

/**
 * 화면에 두 단위를 나란히 — 토크는 늘 병기한다 (현장에서 렌치 눈금이 다르다)
 *
 * 🔴 `prefer` 를 주면 **그 단위를 앞에** 놓는다 (2026-09-08, 공기압을 psi 로 보시겠다는 지시).
 *    저장된 값은 손대지 않는다 — 보여 주는 순서만 바뀐다. 두 값이 늘 같이 나오므로
 *    어느 쪽이 원문인지 헷갈릴 일이 없다.
 */
export function bothUnits(min: number, max: number | null, unit: string, prefer?: string): string {
  if (prefer && prefer !== unit) {
    const a = convert(min, unit, prefer);
    const b = max === null ? null : convert(max, unit, prefer);
    if (a !== null) {
      /* 앞에 세우는 쪽은 우리가 환산한 값이라 반올림한다 — 공기압은 눈금이 정수다 */
      const head = b === null || Math.round(b) === Math.round(a) ? String(Math.round(a)) : `${Math.round(a)}~${Math.round(b)}`;
      const one = (v: number) => String(Number(v.toFixed(3)));
      const tail = max === null || max === min ? one(min) : `${one(min)}~${one(max)}`;
      return `${head} ${prefer} (${tail} ${unit})`;
    }
  }
  return bothUnitsPlain(min, max, unit);
}

function bothUnitsPlain(min: number, max: number | null, unit: string): string {
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

/**
 * ⭐ 타이어 규격에서 **림 인치**만 뽑는다 (2026-09-05, 스태거드 때문에 생겼다)
 *
 * 🔴 앞뒤 규격이 다른 차(G80 245/45R19 앞 · 275/40R19 뒤)를 **한 벌로 묶는 열쇠**다.
 *    폭은 다르지만 인치는 같다 — 그게 「같은 휠 한 벌」이라는 뜻이다.
 */
export function tireRimInch(v: string): number | null {
  if (!looksLikeTireSize(v)) return null;
  const m = /[RZ](\d{2})/.exec(v.replace(/\s/g, "").toUpperCase());
  return m ? Number(m[1]) : null;
}

/** 휠 규격에서 인치만 — 타이어 인치와 맞는지 견주는 데 쓴다 (교차검산) */
export function wheelRimInch(v: string): number | null {
  if (!looksLikeWheelSize(v)) return null;
  const m = /[xX×]\s?(\d{2})/.exec(v.replace(/\s/g, ""));
  return m ? Number(m[1]) : null;
}

export function looksLikeWheelSize(v: string): boolean {
  return WHEEL_SIZE_RE.test(v.trim().replace(/\s/g, ""));
}

export function looksLikeViscosity(v: string): boolean {
  return VISCOSITIES.includes(v.trim().toUpperCase().replace(/\s/g, ""));
}
