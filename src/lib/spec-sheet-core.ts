/**
 * 순정 제원을 **한눈에 들어오는 한 장**으로 (2026-09-05, 사장님 지시)
 *
 * 「현재 순정 제원 내용을 보는데 가독성이 떨어지고 한눈에 들어오질 않음.
 *  간단하게 내가 원하는 내용들이 한눈에 보였으면 좋겠음.」
 *
 * 🔴 **왜 지금 안 보이나 — 취향 문제가 아니라 자료가 섞여 있다.**
 *    `spec-manual.ts` 의 `parseTireWheelTable` 과 `parseOilTable` 이 **각자**
 *    벌 번호를 1,2,3… 으로 매기고 `harvestGrids` 가 오프셋 없이 이어 붙인다.
 *    그래서 DB 에 「18인치 벌」과 「엔진오일 가솔린」이 **같은 `group_no`** 로 들어가 있고,
 *    화면이 `group_no` 로 묶으니 「235/60R18」 제목 카드 안에 엔진오일이 나온다.
 *    여기서 **주제로 다시 묶으면 그 뒤엉킴이 자료를 안 옮기고 풀린다.**
 *
 * 🔴 **순수하다.** `@/db` 도 React 도 `"use server"` 파일도 들이지 않는다.
 *    화면 세 곳(검수·차량 상세·정비 조회)이 같은 묶음을 내야 하는데,
 *    묶는 규칙이 JSX 안에 있으면 세 곳이 반드시 갈라진다.
 *
 * 🔴 **어떤 값도 조용히 사라지지 않는다.** 모르는 항목은 「그밖에」로 간다.
 *    `dropped` 는 언제나 0이어야 하고, 시험이 그걸 지킨다.
 */
import { specItem } from "@/lib/spec-core";

export type SpecStatus = "검수대기" | "자동확인" | "승인" | "거절";
export type TopicKey = "타이어" | "경정비" | "배터리" | "그밖에";

export const TOPIC_ORDER: readonly TopicKey[] = ["타이어", "경정비", "배터리", "그밖에"];

/** 주제마다 「이건 있어야 한다」 — 없으면 화면에 「자료 없음」 줄을 만든다 */
export const EXPECTED: Readonly<Record<TopicKey, readonly string[]>> = {
  타이어: ["tire_size", "wheel_size", "tire_pressure", "wheel_nut_torque"],
  경정비: ["engine_oil_qty", "engine_oil_viscosity"],
  배터리: [],
  그밖에: ["wiper_size"],
};

/**
 * 항목이 어느 주제로 가나.
 * 🔴 모르는 항목은 **버리지 않고** 「그밖에」로 간다. 항목이 늘어도 값이 안 사라진다.
 */
const TOPIC_OF: Readonly<Record<string, TopicKey>> = {
  tire_size: "타이어",
  wheel_size: "타이어",
  oe_tire_brand: "타이어",
  tire_pressure: "타이어",
  wheel_nut_torque: "타이어",
  engine_oil_viscosity: "경정비",
  engine_oil_spec: "경정비",
  engine_oil_qty: "경정비",
  oil_filter_torque: "경정비",
  oil_drain_plug_torque: "경정비",
  coolant_qty: "경정비",
  brake_fluid_spec: "경정비",
  transmission_oil_spec: "경정비",
  transmission_oil_qty: "경정비",
  battery_size: "배터리",
  battery_ah: "배터리",
  battery_cca: "배터리",
  fuel_tank_qty: "그밖에",
  wiper_size: "그밖에",
};

export function topicOf(item: string): TopicKey {
  return TOPIC_OF[item] ?? "그밖에";
}

/** 부품 갈래가 어느 주제로 가나 — 모르는 갈래도 버리지 않는다 */
export function topicOfCategory(category: string | null): TopicKey {
  if (category === "배터리") return "배터리";
  if (category === "와이퍼") return "그밖에";
  return "경정비";
}

/* ── 들어오는 모양 ────────────────────────────────────────────────── */

export interface SheetSource {
  url: string;
  title: string | null;
  fetchedOn: string;
}

/**
 * 제원 값 한 줄.
 * 🔴 `spec.ts` 의 `SpecValueRow` 가 **구조적으로 그대로** 들어맞게 짰다 —
 *    그래야 어댑터 함수가 필요 없고, 순수 파일이 `"use server"` 파일을 안 들인다.
 */
export interface SheetInput {
  id: number | null;
  item: string;
  label: string;
  /** 사람이 읽는 값. `hidden`/`locked` 면 null 이다 — 여기서 숫자를 만들지 않는다 */
  shown: string | null;
  hidden: boolean;
  /** 세대 미확정이라 잠긴 값 (정비 조회 화면) */
  locked?: boolean;
  qualifier: string | null;
  groupNo: number;
  groupLabel: string | null;
  status?: string | null;
  quotes?: string[];
  sources?: SheetSource[];
  autoNote?: string | null;
}

/** 우리 부품 한 줄 — `parts-fit.ts` 의 `FitPart` 가 그대로 들어맞는다 */
export interface SheetPart {
  productId: number;
  category: string | null;
  name: string;
  /** 우리 상품코드 — 순정 품번이 아니다 */
  partNo: string | null;
  /** 순정 품번. 사장님이 부품상에 부르는 번호다 */
  oemNos: string[];
  /** 이 부품이 어느 조건용인지 — 못 읽으면 전부 null 이다 */
  engine: string | null;
  axle: "앞" | "뒤" | null;
  inch: number | null;
  why: string;
  listPrice: number | null;
  stock: number;
}

/* ── 나가는 모양 ──────────────────────────────────────────────────── */

export interface SheetValue {
  shown: string | null;
  hidden: boolean;
  locked: boolean;
  qualifier: string | null;
  status: SpecStatus | null;
  specId: number | null;
}

export interface SheetLine {
  kind: "값" | "부품" | "없음";
  /** 제원이면 item, 부품이면 category */
  item: string;
  label: string;
  values: SheetValue[];
  part: SheetPart | null;
  /**
   * 🔴 벌과 상관없는 항목인데 벌마다 값이 다르다.
   *    오일 5.3 L 과 6.0 L 중 하나를 조용히 고르면 엔진이 상한다 — 둘 다 남기고 알린다.
   */
  conflict: boolean;
  worstStatus: SpecStatus | null;
  specIds: number[];
}

export interface SheetSet {
  /** 타이어 벌 번호. 벌과 무관한 주제는 -1 */
  groupNo: number;
  title: string | null;
  lines: SheetLine[];
  specIds: number[];
  waitingIds: number[];
  autoIds: number[];
  approved: number;
  quotes: string[];
  sources: SheetSource[];
}

export interface SheetTopic {
  key: TopicKey;
  title: string;
  /** 타이어만 true — 벌마다 값이 다르다 */
  perSet: boolean;
  /** 제원에서 왔나 부품에서 왔나 — 부품은 승인할 대상이 아니다 */
  origin: "제원" | "부품" | "섞임" | "없음";
  sets: SheetSet[];
  specIds: number[];
  waitingIds: number[];
  autoIds: number[];
  conflictIds: number[];
  approved: number;
  quotes: string[];
  sources: SheetSource[];
  /** 조건을 못 읽어 사장님이 고르셔야 하는 부품이 있나 */
  needsPick: boolean;
  /** 잘라 낸 부품 수 — 조용히 자르지 않는다 */
  moreParts: number;
}

export interface SpecSheet {
  label: string;
  variantKey: string;
  manualUrl: string | null;
  cars: number | null;
  /** 타이어 벌 수. 2 이상이면 화면이 「어느 인치인지 보고 고르세요」를 띄운다 */
  setCount: number;
  /** 이 차종에 있는 엔진 후보 — 부품에서 읽어 모은다 */
  engines: string[];
  /** 지금 고른 엔진 (없으면 안 좁힌다) */
  engine: string | null;
  topics: SheetTopic[];
  waitingIds: number[];
  autoIds: number[];
  approved: number;
  /** 🔴 어느 주제에도 못 들어간 값 수. 언제나 0 이어야 한다 */
  dropped: number;
}

/* ── 만들기 ──────────────────────────────────────────────────────── */

const STATUS_RANK: Record<string, number> = { 검수대기: 3, 자동확인: 2, 승인: 1, 거절: 0 };

/** 셋 중 가장 덜 확인된 것 — 카드 배지는 가장 약한 값을 따라간다 */
export function worstOf(list: readonly (SpecStatus | null)[]): SpecStatus | null {
  let best: SpecStatus | null = null;
  for (const s of list) {
    if (!s) continue;
    if (!best || (STATUS_RANK[s] ?? 0) > (STATUS_RANK[best] ?? 0)) best = s;
  }
  return best;
}

const asStatus = (v: string | null | undefined): SpecStatus | null =>
  v === "검수대기" || v === "자동확인" || v === "승인" || v === "거절" ? v : null;

/**
 * 같은 값이면 접는다 — 앞뒤 공기압이 둘 다 「230 kPa (33 psi)」면 한 줄로.
 * 🔴 `shown` 글자를 잘라 붙이지 않는다. `bothUnits` 가 만든 글자를 손대면 원문과 달라 보인다.
 */
export function collapseValues(values: SheetValue[]): { values: SheetValue[]; conflict: boolean } {
  if (values.length <= 1) return { values, conflict: false };
  const distinct = new Set(values.map((v) => v.shown ?? "∅"));
  if (distinct.size === 1) {
    /* 값이 같으니 조건표(앞/뒤)를 떼고 하나로 — 단 하나라도 잠겨 있으면 잠금을 유지한다 */
    const first = values[0];
    return {
      values: [
        {
          ...first,
          qualifier: null,
          hidden: values.some((v) => v.hidden),
          locked: values.some((v) => v.locked),
          status: worstOf(values.map((v) => v.status)),
        },
      ],
      conflict: false,
    };
  }
  return { values, conflict: false };
}

/** 벌 이름 — ①원래 이름 ②타이어 규격의 인치 ③몇 번째 벌 */
export function setTitle(rows: readonly SheetInput[], groupNo: number): string | null {
  const mine = rows.filter((r) => r.groupNo === groupNo);
  const named = mine.find((r) => r.groupLabel);
  if (named?.groupLabel) return named.groupLabel;
  const tire = mine.find((r) => r.item === "tire_size" && r.shown);
  if (tire?.shown) {
    const inch = /R\s*(\d{2})/i.exec(tire.shown);
    if (inch) return `${inch[1]}인치`;
    return tire.shown;
  }
  return null;
}

function toValue(r: SheetInput): SheetValue {
  return {
    shown: r.shown,
    hidden: r.hidden,
    locked: r.locked === true,
    qualifier: r.qualifier,
    status: asStatus(r.status),
    specId: r.id,
  };
}

function uniq<T>(list: T[], key: (v: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of list) {
    const k = key(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** 한 갈래에서 이만큼만 보여 준다 — 넘치면 `moreParts` 로 알린다 */
const PARTS_PER_CATEGORY = 4;

/* ── 엔진 ──────────────────────────────────────────────────────────
 *
 * 🔴 **사장님이 아시는 것은 「디젤이냐 가솔린이냐 하이브리드냐」다.**
 *    부품 글에서 읽은 그대로 두면 칩이 `[1.6 하이브리드] [2.2 디젤] [2.5] [디젤] [하이브리드]`
 *    처럼 다섯 개가 되는데, 실제로는 셋이다. 배기량은 **부품 옆에 조건으로** 붙여 두면 되고,
 *    고르는 것은 연료 수준이어야 한다 (2026-09-05, 실제 화면을 보고 고쳤다).
 * ──────────────────────────────────────────────────────────────── */

const FUELS = ["디젤", "가솔린", "하이브리드", "LPG", "LPI", "전기"] as const;

/** 「2.2 디젤」·「디젤 엔진 스마트스트림 D2.2」 → 「디젤」. 못 찾으면 null */
export function fuelOf(text: string | null | undefined): string | null {
  if (!text) return null;
  /* 좁은 말이 먼저 — 「가솔린 하이브리드」는 하이브리드다 */
  for (const f of ["하이브리드", "LPI", "LPG", "전기", "디젤", "가솔린"]) {
    if (text.includes(f)) return f;
  }
  return null;
}

/**
 * 조건표를 짧게 — 「디젤 엔진 스마트스트림 D2.2」 → 「디젤」.
 * 🔴 **원래 글자를 지우지 않는다.** 짧은 것을 화면에 쓰고 원래 것은 `title` 로 남긴다 —
 *    사장님이 「이게 무슨 엔진이지」 하실 때 볼 수 있어야 한다.
 */
export function shortQualifier(q: string | null): string | null {
  if (!q) return null;
  if (q.length <= 6) return q;
  const fuel = fuelOf(q);
  if (!fuel) return q.length > 14 ? `${q.slice(0, 13)}…` : q;
  /* 배기량이 같이 적혀 있으면 붙여 준다 — 「디젤 2.2」 */
  const cc = /(?<![0-9.])([0-9])\.([0-9])(?![0-9])/.exec(q);
  return cc ? `${fuel} ${cc[1]}.${cc[2]}` : fuel;
}

export interface BuildInput {
  label: string;
  variantKey: string;
  manualUrl?: string | null;
  cars?: number | null;
  rows: readonly SheetInput[];
  parts?: readonly SheetPart[];
  /** 사장님이 고르신 엔진. 없으면 **안 좁힌다** */
  engine?: string | null;
}

export function buildSpecSheet(input: BuildInput): SpecSheet {
  const rows = input.rows;
  const parts = input.parts ?? [];

  /**
   * 이 차종에 있는 엔진 후보 — **연료 수준으로** 모은다.
   * 부품 글의 「2.2 디젤」·「디젤」과 제원의 「디젤 엔진 스마트스트림 D2.2」가 다 「디젤」이다.
   */
  const engines = [...new Set([
    ...parts.map((p) => fuelOf(p.engine)),
    ...rows.map((r) => fuelOf(r.qualifier)),
  ].filter((v): v is string => !!v))].sort((a, b) => FUELS.indexOf(a as never) - FUELS.indexOf(b as never));
  const engine = input.engine && engines.includes(input.engine) ? input.engine : null;

  /**
   * 🔴 엔진을 고르시면 **제원 값도 같이 좁힌다.** 오일 용량이 디젤 5.6 L · 가솔린 5.8 L 인데
   *    디젤을 고르고도 둘 다 보이면 고른 뜻이 없다.
   * 🔴 연료가 안 적힌 값은 **남긴다** — 모든 엔진에 해당하는 값일 수 있다.
   */
  const visible = engine
    ? rows.filter((r) => {
        const f = fuelOf(r.qualifier);
        return f === null || f === engine;
      })
    : rows;

  /* 타이어 벌 — 타이어 주제에 든 값들의 groupNo 만 벌로 센다 */
  const tireGroupNos = [...new Set(visible.filter((r) => topicOf(r.item) === "타이어").map((r) => r.groupNo))].sort(
    (a, b) => a - b,
  );

  let dropped = 0;
  const topics: SheetTopic[] = [];

  for (const key of TOPIC_ORDER) {
    const mine = visible.filter((r) => topicOf(r.item) === key);
    const myParts = parts.filter((p) => topicOfCategory(p.category) === key);
    if (mine.length === 0 && myParts.length === 0 && EXPECTED[key].length === 0) continue;

    const perSet = key === "타이어";
    const sets: SheetSet[] = [];

    if (perSet) {
      for (const no of tireGroupNos) {
        sets.push(makeSet(mine.filter((r) => r.groupNo === no), no, setTitle(visible, no), []));
      }
      if (sets.length === 0) sets.push(makeSet([], -1, null, []));
    } else {
      /* 🔴 벌 번호를 무시한다 — 오일·배터리는 타이어 벌과 아무 상관이 없다.
         DB 의 group_no 뒤엉킴(파일 맨 위 설명)이 여기서 무해해진다 */
      sets.push(makeSet(mine, -1, null, pickParts(myParts, engine)));
    }

    /* 「자료 없음」 줄 — 있어야 하는데 없는 것도 보여야 한눈에 들어온다 */
    const have = new Set(mine.map((r) => r.item));
    const missing = EXPECTED[key].filter((it) => !have.has(it));
    if (missing.length && sets.length) {
      const last = sets[sets.length - 1];
      for (const it of missing) {
        if (perSet && sets.length > 1) continue; // 벌이 여럿이면 벌마다 따지지 않는다
        last.lines.push({
          kind: "없음",
          item: it,
          label: specItem(it)?.label ?? it,
          values: [],
          part: null,
          conflict: false,
          worstStatus: null,
          specIds: [],
        });
      }
    }

    const all = sets.flatMap((s) => s.lines);
    const specIds = all.flatMap((l) => l.specIds);
    const hasSpec = mine.length > 0;
    const hasPart = myParts.length > 0;
    const shownParts = sets.flatMap((s) => s.lines.filter((l) => l.kind === "부품")).length;

    topics.push({
      key,
      title: key,
      perSet,
      origin: hasSpec && hasPart ? "섞임" : hasSpec ? "제원" : hasPart ? "부품" : "없음",
      sets,
      specIds,
      waitingIds: sets.flatMap((s) => s.waitingIds),
      autoIds: sets.flatMap((s) => s.autoIds),
      conflictIds: all.filter((l) => l.conflict).flatMap((l) => l.specIds),
      approved: sets.reduce((n, s) => n + s.approved, 0),
      quotes: uniq(sets.flatMap((s) => s.quotes), (q) => q),
      sources: uniq(sets.flatMap((s) => s.sources), (s) => s.url),
      needsPick: sets.some((s) => s.lines.some((l) => l.kind === "부품" && l.part?.engine === null)),
      moreParts: Math.max(0, myParts.length - shownParts),
    });
  }

  /* 🔴 어느 주제에도 못 들어간 값이 있나 — 언제나 0 이어야 한다 */
  const placed = new Set(topics.flatMap((t) => t.specIds));
  dropped = visible.filter((r) => r.id !== null && !placed.has(r.id)).length;

  return {
    label: input.label,
    variantKey: input.variantKey,
    manualUrl: input.manualUrl ?? null,
    cars: input.cars ?? null,
    setCount: tireGroupNos.length,
    engines,
    engine,
    topics,
    waitingIds: topics.flatMap((t) => t.waitingIds),
    autoIds: topics.flatMap((t) => t.autoIds),
    approved: topics.reduce((n, t) => n + t.approved, 0),
    dropped,
  };
}

/**
 * 부품 고르기.
 * 🔴 **엔진을 안 고르셨으면 하나로 좁히지 않는다.** 후보를 다 보여 드리고 조건을 붙인다.
 * 🔴 엔진을 고르셨어도 **조건을 못 읽은 부품은 남긴다** — 그게 맞는 것일 수도 있다.
 */
function pickParts(parts: readonly SheetPart[], engine: string | null): SheetPart[] {
  const byCat = new Map<string, SheetPart[]>();
  for (const p of parts) {
    const k = p.category ?? "그밖에";
    byCat.set(k, [...(byCat.get(k) ?? []), p]);
  }
  const out: SheetPart[] = [];
  for (const [, list] of byCat) {
    const keep = engine ? list.filter((p) => fuelOf(p.engine) === null || fuelOf(p.engine) === engine) : list;
    /* 조건을 읽은 것 · 재고 있는 것을 앞에 세운다 */
    const sorted = [...keep].sort((a, b) => {
      const ae = fuelOf(a.engine) === engine ? 0 : a.engine ? 1 : 2;
      const be = fuelOf(b.engine) === engine ? 0 : b.engine ? 1 : 2;
      if (ae !== be) return ae - be;
      return b.stock - a.stock;
    });
    out.push(...sorted.slice(0, PARTS_PER_CATEGORY));
  }
  return out;
}

function makeSet(rows: SheetInput[], groupNo: number, title: string | null, parts: SheetPart[]): SheetSet {
  /* 같은 항목·같은 조건끼리 묶는다 (앞/뒤는 한 줄로 모은다) */
  const byItem = new Map<string, SheetInput[]>();
  for (const r of rows) byItem.set(r.item, [...(byItem.get(r.item) ?? []), r]);

  const lines: SheetLine[] = [];
  for (const [item, list] of byItem) {
    const raw = list.map(toValue);
    const { values } = collapseValues(raw);
    /* 🔴 벌과 무관한 주제에서 값이 갈리면 조용히 고르지 않는다 */
    const distinct = new Set(raw.map((v) => v.shown ?? "∅"));
    const conflict = groupNo === -1 && distinct.size > 1 && raw.length > 1 && !hasQualifierSplit(list);
    lines.push({
      kind: "값",
      item,
      label: list[0].label,
      values,
      part: null,
      conflict,
      worstStatus: worstOf(raw.map((v) => v.status)),
      specIds: list.map((r) => r.id).filter((v): v is number => v !== null),
    });
  }

  for (const p of parts) {
    lines.push({
      kind: "부품",
      item: p.category ?? "부품",
      label: p.category ?? "부품",
      values: [],
      part: p,
      conflict: false,
      worstStatus: null,
      specIds: [],
    });
  }

  const specIds = lines.flatMap((l) => l.specIds);
  const flat = rows;
  return {
    groupNo,
    title,
    lines,
    specIds,
    waitingIds: flat.filter((r) => r.status === "검수대기" && r.id !== null).map((r) => r.id as number),
    autoIds: flat.filter((r) => r.status === "자동확인" && r.id !== null).map((r) => r.id as number),
    approved: flat.filter((r) => r.status === "승인").length,
    quotes: uniq(flat.flatMap((r) => r.quotes ?? []), (q) => q),
    sources: uniq(flat.flatMap((r) => r.sources ?? []), (s) => s.url),
  };
}

/**
 * 값이 갈린 게 「앞/뒤」·「가솔린/디젤」처럼 **조건이 달라서**인가.
 * 그런 갈림은 정상이다 — 어긋남으로 보고하면 안 된다.
 */
function hasQualifierSplit(list: readonly SheetInput[]): boolean {
  const q = new Set(list.map((r) => r.qualifier ?? ""));
  return q.size > 1;
}
