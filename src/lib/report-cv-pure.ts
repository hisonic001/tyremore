/**
 * ⭐ 손님·차량 리포트 — 순수 규칙 (2026-09-14 사장님 요청으로 신설)
 *
 *   "고객과 차량 관련 리포트가 필요" — 목적은 손님 구성 파악 + 차종 흐름(재고·마케팅 참고).
 *   명단(이름·전화)은 넣지 않는다 — 숫자·그래프만 (사장님 확정).
 *
 * 🔴 DB 없음. 구간 경계·낱말·연료 표기 매핑을 한 곳에 둔다 — SQL(report-customers.ts ·
 *    report-vehicles.ts)과 화면이 같은 표를 본다.
 */
import { BODY_TYPES } from "./sale-types";

/** [개인 · 거래처 · 전체] 단추 — 쏘카·AJ 물량이 섞이면 가게 체질이 안 보인다 */
export type Who = "person" | "biz" | "all";

export function pickWho(raw: unknown): Who {
  return raw === "biz" || raw === "all" ? raw : "person";
}

export const WHO_LABEL: Record<Who, string> = { person: "개인", biz: "거래처", all: "전체" };

/** 셈 단위 — 거래처는 「곳」 */
export const whoUnit = (who: Who): string => (who === "biz" ? "곳" : "명");
export const whoNoun = (who: Who): string => (who === "biz" ? "거래처" : "손님");

/** 구간 — [lo, hi) · hi 가 null 이면 끝까지 */
export interface Bucket {
  label: string;
  lo: number;
  hi: number | null;
}

/** 다시 오기까지 걸린 날 수 (1·3·6·12개월) */
export const GAP_BUCKETS: Bucket[] = [
  { label: "1개월 안", lo: 0, hi: 30 },
  { label: "1~3개월", lo: 30, hi: 91 },
  { label: "3~6개월", lo: 91, hi: 183 },
  { label: "6~12개월", lo: 183, hi: 366 },
  { label: "1년 넘게", lo: 366, hi: null },
];

/** 12개월 동안 쓴 돈 (원) */
export const SPEND_BUCKETS: Bucket[] = [
  { label: "10만 미만", lo: 0, hi: 100_000 },
  { label: "10~30만", lo: 100_000, hi: 300_000 },
  { label: "30~60만", lo: 300_000, hi: 600_000 },
  { label: "60~100만", lo: 600_000, hi: 1_000_000 },
  { label: "100만 이상", lo: 1_000_000, hi: null },
];

/** 12개월 방문 횟수 (같은 날 여러 건은 1번) */
export const VISIT_BUCKETS: Bucket[] = [
  { label: "1번", lo: 1, hi: 2 },
  { label: "2번", lo: 2, hi: 3 },
  { label: "3번", lo: 3, hi: 4 },
  { label: "4번 이상", lo: 4, hi: null },
];

/** 마지막 방문 뒤 지난 날 수 — 오랫동안 안 온 손님 */
export const LAPSE_BUCKETS: Bucket[] = [
  { label: "6~12개월", lo: 183, hi: 366 },
  { label: "1~2년", lo: 366, hi: 731 },
  { label: "2년 넘게", lo: 731, hi: null },
];

/** 차령 (년) = 기준 연도 − 연식 */
export const AGE_BUCKETS: Bucket[] = [
  { label: "3년 이하", lo: -1, hi: 4 },
  { label: "4~7년", lo: 4, hi: 8 },
  { label: "8~10년", lo: 8, hi: 11 },
  { label: "11~15년", lo: 11, hi: 16 },
  { label: "16년 이상", lo: 16, hi: null },
];

/** 주행거리 (km) */
export const KM_BUCKETS: Bucket[] = [
  { label: "5만 미만", lo: 0, hi: 50_000 },
  { label: "5~10만", lo: 50_000, hi: 100_000 },
  { label: "10~15만", lo: 100_000, hi: 150_000 },
  { label: "15~20만", lo: 150_000, hi: 200_000 },
  { label: "20만 이상", lo: 200_000, hi: null },
];

export function bucketOf(buckets: Bucket[], v: number): number {
  return buckets.findIndex((b) => v >= b.lo && (b.hi === null || v < b.hi));
}

/**
 * 연료 — MARS 표기(sale-types.ts FUEL: Fuel·Diesel·Hybird·BEV, LPG)를 화면 낱말로.
 * 🔴 `Hybird` 는 MARS 쪽 오타지만 실제 저장값이다 — 지우지 말 것.
 * 차량에 연료가 비어 있으면 확정된 세대(vehicle_generation.powertrain)의 값을 쓴다.
 */
export const FUEL_FROM_MARS: Record<string, string> = {
  Fuel: "가솔린",
  Diesel: "디젤",
  Hybird: "하이브리드",
  Hybrid: "하이브리드",
  BEV: "전기",
  LPG: "LPG",
};
export const FUEL_FROM_POWERTRAIN: Record<string, string> = {
  가솔린: "가솔린",
  디젤: "디젤",
  LPG: "LPG",
  하이브리드: "하이브리드",
  PHEV: "하이브리드",
  전기: "전기",
  수소: "수소",
};
export const FUEL_ORDER = ["가솔린", "디젤", "하이브리드", "전기", "LPG", "수소"];

/** 차체 — 종이 보고서 「차량 형태」 낱말 그대로 (정본 sale-types BODY_TYPES) */
export const BODY_ORDER: string[] = [...BODY_TYPES];

/**
 * ⭐ 품목(규격·인치)은 이 날부터 믿는다.
 *   그 전 판매 3,112건은 MARS 에서 금액만 이관돼 「MARS 정비 이관 (품목 내역 없음)」 한 줄이다.
 */
export const ITEM_DATA_START = "2026-08-01";

/** 기준일 — 이번 달이면 오늘, 지난 달이면 그 달 마지막 날 */
export function asOfDate(ym: string, today: string): string {
  if (today.slice(0, 7) === ym) return today;
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
}

/** 날 수 → 「N.N개월」 */
export function daysToMonthsText(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return "—";
  const m = days / 30.4;
  return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}개월`;
}

/** 정수 비율 (분모 0 이면 0) */
export const pctOf = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);
