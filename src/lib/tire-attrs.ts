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
 *
 * 🔴 2026-08-03 전면 손질 — 사장님 지적
 *    "대부분 summer tire로 표기되어 있음. 실제로는 all season 이 대부분인데 잘못 들어간 게 많음."
 *
 *    원인은 **「모르면 여름」이라는 기본값**이었다 (`else if (pattern) season = "여름"`).
 *    사전에 없는 모델이 전부 여름으로 떨어져 10,320건 중 7,916건이 여름이 됐다.
 *    실데이터를 훑어 보니 그중 상당수가 사계절·올웨더였고, **겨울 타이어까지 여름**으로
 *    들어가 있었다:
 *      · 한국 `ION i*cept IW01` 54건 — 정규식이 `ICEPT` 라 별표가 낀 `i*cept` 를 놓쳤다
 *      · 넥센 `WG Sport 2` 87건 — Winguard 를 `WG` 로 줄여 적어 놓았다
 *      · 콘티 `NorthContact NC7` 20건 · 금호 `IZEN XW KW17` 15건
 *
 *    ⭐ 그래서 **기본값을 없앴다.** 모르면 `null`(미분류)로 둔다.
 *       틀린 계절을 자신 있게 띄우는 것보다, 모른다고 하는 편이 낫다.
 *       미분류는 상품 화면에서 사장님이 직접 고칠 수 있고(D-05 「쓰면서 채운다」),
 *       고친 값은 `attrs_override` 에 남아 재이관·재계산해도 살아남는다.
 */

import { expandModel } from "./tire-name";

export type Season = "겨울" | "올웨더" | "사계절" | "여름";

export interface TireAttrs {
  season: Season | null;
  isRunflat: boolean;
  isAcoustic: boolean;
  isSuv: boolean;
}

/**
 * 겨울 — 가장 먼저, 가장 넓게 판정한다. 놓치면 안전 문제다.
 *
 * 🔴 `I.?CEPT` 의 `.?` 는 한국타이어 `i*cept` 의 별표를 위한 것이다.
 *    `ICEPT` 로 적어 두어 `ION i*cept IW01` 54건이 여름으로 새어 나갔다 (2026-08-03).
 * 🔴 `\bWG\b` 는 넥센 Winguard 의 축약이다 — MARS 에는 `WG Sport 2` 로만 적혀 있다.
 * 🔴 `IZEN` 은 금호 겨울 브랜드(IZEN XW KW17), `NORTHCONTACT` 는 콘티넨탈 스터드리스,
 *    `STUD` 는 스터드(못박이) 타이어다.
 */
const WINTER =
  /ALPIN|\bPA[345]\b|X-?ICE|\bICE\b|I.?CEPT|I.?FIT|SNOW|WINTER|WINGUARD|\bWG\b|WINTGUARD|BLIZZAK|\bWS\d|SOTTOZERO|WINTER.?CONTACT|NORTH.?CONTACT|\bIZEN\b|\bCW\d{2}\b|\bSTUDS?\b|STUDDED|TS\s?8|DM-?V|NORDI[CK]|VIKING|W.?DRIVE|겨울|스노우/i;

/**
 * 올웨더 — 3PMSF(눈꽃) 인증. 사계절보다 겨울 성능이 높다.
 * `WEATHER…` 계열은 브랜드마다 이름만 다를 뿐 전부 이 등급이다 —
 * 굿이어 Assurance **WeatherReady** · 브리지스톤 **WeatherGrip** · 한국 **Weatherflex**.
 */
const ALL_WEATHER =
  /CROS{1,2}.?CLIMA(TE)?|ALL.?WEATHER|\bA\/W\b|(FOUR|4).?SEASONS?|QUATRAC|VECTOR|WEATHER.?(READY|GRIP|FLEX|CONTROL)/i;

/**
 * ⭐ `AS` = All Season. 브랜드마다 붙여 쓰는 법이 다르다 (2026-08-03 실데이터 조사).
 *
 *   한국·넥센·라우펜   띄어 쓴다    `Ventus S2 AS H462` · `NF Primus AS` · `S FIT AS LH01`
 *   피렐리             붙여 쓴다    `P7AS+3` · `SZROAS` · `S-VEAS` · `PZRAS+` · `SVAS+2`
 *   브리지스톤         `-AS`        `DHPS-AS`
 *
 * 🔴 `ASY`(Asymmetric) · `ASSURANCE` · `ALENZA` 를 잡으면 안 된다.
 *    그래서 `AS` **뒤에 글자가 오면 안 된다** — `+`·숫자·공백·끝만 허용한다.
 *    (굿이어 `E. F1 ASY 3` 37건이 여기 걸리면 여름 타이어가 사계절이 된다)
 */
const AS_MARK = /(?:^|[\s\-/])AS(?![A-Z])|[A-Z0-9]AS(?:\s*\+\s*\d?)?(?![A-Z])/i;

/** 사계절 — M+S 표기 수준. 모델 사전은 실데이터 1,000종을 훑어 만들었다 */
const ALL_SEASON =
  /ALL.?SEASON|사계절|\b4S\b|\bA\s*[/.]\s*S\b|KINERGY.?4S/i;

/**
 * 브랜드별 사계절 라인업 — 이름만으로는 `AS` 가 안 붙는 것들.
 * 근거는 2026-08-03 실데이터 전수 조사(10,320건 / 모델 1,000종)다.
 */
const ALL_SEASON_MODELS =
  new RegExp(
    [
      // 미쉐린 — 그랜드 투어링·밴 라인은 전부 사계절이다 (`ADV` 는 Advantage 축약)
      "\\bPREMIER\\b", "\\bLTX\\b", "\\bMXM4\\b", "\\bMXV4\\b", "\\bHARMONY\\b",
      "\\bAGILIS\\b", "\\bDEFENDER\\b", "\\bADVANTAGE\\b", "\\bADV\\b",
      // BFGoodrich — T/A 는 전 라인 사계절(온·오프로드 겸용). `TRTERTA` = Trail-Terrain T/A
      "\\bT\\s*/\\s*A\\b", "TRTERTA",
      // 콘티넨탈 — DWS(Dry·Wet·Snow) · ProContact · CrossContact 투어링
      "\\bDWS\\d*", "PRO.?CONTACT", "CROSS.?CONTACT\\s*(LX|H\\s*/\\s*T|AT)", "TRUE.?CONTACT", "VANCO.?CONTACT",
      // 금호 — Solus 투어링 · Crugen SUV · Portran 밴 · Road Venture AT/MT · SuperMile
      // (Crugen 은 사장님 확인 2026-08-03 — HP51·HP71·HP72·Premium KL33 전부 사계절)
      "\\bSOLUS\\b", "\\bCRUGEN\\b", "PORTRAN", "SUPER.?MILE", "ROAD\\s*VENTURE\\s*(AT|MT)",
      // 한국 — Dynapro(SUV 하이웨이/AT) · Vantra(밴) · Kinergy · Optimo
      "\\bDYNAPRO\\b", "\\bVANTRA\\b", "\\bKINERGY\\b", "\\bOPTIMO\\b",
      // 넥센 — Roadian(RO) · N'Priz(NP) · Classe Premiere(CP)
      "\\bRO\\s*(AT|GT|HT|CT|MT)", "\\bNP\\s*(AH|RH)", "\\bCP\\d{3}\\b",
      // 브리지스톤 — Destination · Dueler H/L (H/P 는 여름이다)
      "\\bDESTINATION\\b", "DUELER\\s*H\\s*/\\s*L", "\\bH\\s*/\\s*L\\s*\\d",
      // 피렐리 — Scorpion ATR/MTR/STR 은 온·오프로드 겸용
      "\\bS\\s*-?\\s*(ATR|MTR|STR)\\b", "SCORPION\\s*(ATR|MTR|STR)",
      // 제너럴 — Grabber · AltiMax · 상용 밴(Cargo)
      "\\bGRABBER\\b", "ALTI.?MAX", "\\bALT\\s*GS", "\\bCARGO\\b",
    ].join("|"),
    "i",
  );

/** 오프로드·머드 — 사실상 사계절로 쓴다 */
const OFF_ROAD = /MUD.?TERRAIN|ALL.?TERRAIN|\bA\/T\b|\bM\/T\b|\bKO[23]?\b|\bKM[23]\b/i;

/**
 * 여름 — **명시적으로** 아는 것만 여름이라고 한다.
 * 예전처럼 「나머지는 전부 여름」으로 두지 않는다 (위 머리말 참조).
 */
const SUMMER_MODELS = new RegExp(
  [
    // 미쉐린
    "PILOT\\s*(SPORT|SUPER|PRIMACY|PRECEDA|HX|EXALTO)", "\\bPRIMACY\\b", "\\bLATITUDE\\b",
    "ENERGY\\s*(SAVER|XM|MILE|MXV)", "\\bCERTIS\\b", "DIAMARIS",
    // 피렐리 — Cinturato P7 · P Zero · Scorpion Verde
    "\\bP\\s*-?\\s*ZERO\\b", "\\bPZRO\\b", "\\bP7\\b", "P7\\s*-?\\s*(CINT|CONNECT)", "CINTURATO",
    "S\\s*-?\\s*VE?RD", "SCORPION\\s*VERDE", "\\bS\\s*-?\\s*ZERO\\b", "\\bNERO\\b",
    "CORSA", "TROFEO", "\\bROSSO\\b",
    // 콘티넨탈
    "SPORT.?CONTACT", "PREMIUM.?CONTACT", "ECO.?CONTACT", "MAX.?CONTACT",
    "ULTRA.?CONTACT", "COMFORT.?CONTACT", "EXTREME.?CONTACT(?!\\s*DWS)",
    // 한국 — Ventus(AS 붙은 것은 위에서 이미 사계절로 빠진다)
    "\\bVENTUS\\b", "\\bLAUFENN\\b",
    // 금호 (Crugen 은 SUV 사계절이라 위 사계절 사전에 있다)
    "\\bECSTA\\b",
    // 넥센 — N'Fera
    "\\bNF\\b", "\\bN.?FERA\\b",
    // 브리지스톤 — Potenza · Turanza · Alenza · Ecopia · Dueler H/P
    "POTENZA", "TURANZA", "ALENZA", "ECOPIA", "SERENITY", "\\bEP\\d{3}\\b", "\\bDHP",
    "\\bRE\\d{3}\\b", "\\bT0\\d{2}\\b", "\\bS0\\d{2}\\b",
    // 굿이어 — Eagle F1 · EfficientGrip
    "EAGLE\\s*F1", "\\bE\\.?\\s*F1\\b", "EFFICIENT.?GRIP", "\\bEFG\\b", "TRIPLEMAX", "EXCELLENCE",
  ].join("|"),
  "i",
);

/** 런플랫 — 제조사마다 표기가 다르다 */
const RUNFLAT = /\bZPS?\b|\bRFT\b|\bSSR\b|\bROF\b|\bR-F\b|RUN.?FLAT|\bEMT\b|\bHRS\b|\bDSST\b|런플랫/i;

/** 흡음재 (소음 저감 폼) */
const ACOUSTIC = /ACOUSTIC|SILENT|SILENCE|\bSOUND\b|NOISE|SEAL|흡음/i;

const SUV = /\bSUV\b|LATITUDE|\bLT\b|4X4|\bCUV\b/i;

/**
 * 모델명(과 원문)에서 속성을 읽는다.
 * @param pattern MARS 「설명 2」 — 모델명이 여기 있다
 * @param rawName MARS 「상세 항목 및 서비스」 — 보조
 *
 * ⚠️ **축약을 먼저 편다.** MARS 는 `CROSCLISUV`, `PRIMTOURAS`, `ENRGYSVRAS` 처럼
 *    줄여 적어 놓은 것이 섞여 있어서, 편 이름으로 봐야 계절이 제대로 잡힌다.
 *    이걸 안 해서 같은 `CROSSCLIMATE SUV` 가 올웨더 10건 / 여름 23건으로
 *    갈려 있었다 (2026-08-03 발견).
 */
export function parseTireAttrs(pattern: string | null, rawName = ""): TireAttrs {
  const raw = `${pattern ?? ""} ${rawName}`.trim();
  if (!raw) return { season: null, isRunflat: false, isAcoustic: false, isSuv: false };
  const t = expandModel(raw);

  let season: Season | null = null;
  if (WINTER.test(t)) season = "겨울";
  else if (ALL_WEATHER.test(t)) season = "올웨더";
  else if (ALL_SEASON.test(t) || AS_MARK.test(t) || ALL_SEASON_MODELS.test(t) || OFF_ROAD.test(t))
    season = "사계절";
  else if (SUMMER_MODELS.test(t)) season = "여름";
  // 그 외는 **모른다**. 여름으로 찍지 않는다 — 상품 화면에서 고칠 수 있다.

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
