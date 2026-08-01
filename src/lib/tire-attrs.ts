/**
 * 타이어 속성 분류 — 계절 · 런플랫 · 흡음재 · 차종
 *
 * 상담 화면에서 걸러내는 축이다. 정비사가 "겨울용만" "런플랫만" 을 눌러 좁힌다.
 *
 * ⚠️ 판정 근거는 `pattern`(모델명)이다. `raw_name`은 "Michelin 225/45 R 17 94Y TL"
 *    형태라 모델명이 들어 있지 않다. 1차 이관 때 이걸 놓쳐 10,318건 중 3건만
 *    분류됐다 (2026-08-01 발견).
 *
 * ⚠️ 겨울 타이어를 여름으로 잘못 분류하면 안전 문제가 된다.
 *    겨울 판정을 가장 먼저, 가장 넓게 잡는다.
 */

export type Season = "겨울" | "올웨더" | "사계절" | "여름";

export interface TireAttrs {
  season: Season | null;
  isRunflat: boolean;
  isAcoustic: boolean;
  isSuv: boolean;
}

/** 겨울 — 가장 먼저 판정한다. 놓치면 안전 문제다 */
const WINTER =
  /ALPIN|X-?ICE|\bICE\b|ICEPT|I.?FIT|SNOW|WINTER|WINGUARD|WINTGUARD|BLIZZAK|\bWS\d|SOTTOZERO|WINTER.?CONTACT|TS\s?8|DM-?V|NORDIC|VIKING|W.?DRIVE|겨울|스노우/i;

/** 올웨더 — 3PMSF(눈꽃) 인증. 사계절보다 겨울 성능이 높다 */
const ALL_WEATHER = /CROSS.?CLIMATE|ALL.?WEATHER|\bA\/W\b|4.?SEASONS?|QUATRAC|VECTOR/i;

/** 사계절 — M+S 표기 수준 */
const ALL_SEASON = /\bA\/S\b|ALL.?SEASON|사계절|\b4S\b|KINERGY.?4S|SOLUS.?TA/i;

/** 오프로드·머드 — 사실상 사계절로 쓴다 */
const OFF_ROAD = /MUD.?TERRAIN|ALL.?TERRAIN|\bA\/T\b|\bM\/T\b|\bKO2\b|\bKM3\b/i;

/** 런플랫 — 제조사마다 표기가 다르다 */
const RUNFLAT = /\bZPS?\b|\bRFT\b|\bSSR\b|\bROF\b|\bR-F\b|RUN.?FLAT|\bEMT\b|\bHRS\b|\bDSST\b|런플랫/i;

/** 흡음재 (소음 저감 폼) */
const ACOUSTIC = /ACOUSTIC|SILENT|SILENCE|\bSOUND\b|NOISE|SEAL|흡음/i;

const SUV = /\bSUV\b|LATITUDE|\bLT\b|4X4|\bCUV\b/i;

/**
 * 모델명(과 원문)에서 속성을 읽는다.
 * @param pattern MARS 「설명 2」 — 모델명이 여기 있다
 * @param rawName MARS 「상세 항목 및 서비스」 — 보조
 */
export function parseTireAttrs(pattern: string | null, rawName = ""): TireAttrs {
  const t = `${pattern ?? ""} ${rawName}`.trim();
  if (!t) return { season: null, isRunflat: false, isAcoustic: false, isSuv: false };

  let season: Season | null = null;
  if (WINTER.test(t)) season = "겨울";
  else if (ALL_WEATHER.test(t)) season = "올웨더";
  else if (ALL_SEASON.test(t) || OFF_ROAD.test(t)) season = "사계절";
  else if (pattern) season = "여름"; // 모델명을 아는데 위에 안 걸리면 여름용이다

  return {
    season,
    isRunflat: RUNFLAT.test(t),
    isAcoustic: ACOUSTIC.test(t),
    isSuv: SUV.test(t),
  };
}

export const SEASON_ORDER: Season[] = ["여름", "사계절", "올웨더", "겨울"];

/** 화면 배지 색 — 계절이 한눈에 보여야 한다 */
export const SEASON_STYLE: Record<Season, string> = {
  여름: "bg-orange-100 text-orange-800",
  사계절: "bg-emerald-100 text-emerald-800",
  올웨더: "bg-teal-100 text-teal-800",
  겨울: "bg-sky-100 text-sky-800",
};
