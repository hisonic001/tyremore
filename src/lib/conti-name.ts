/**
 * 콘티넨탈 이름 규칙 ⭐ (사장님 요청 2026-08-29)
 *
 *   2026 목록 두 파일의 `Description` 한 줄에서 **모델명과 속성**을 뽑는다.
 *     운영 규격  `255/35R19 96Y XL FR AllSeasonContact 2`
 *     겨울 주문서 `185/55R15 86H XL WinterContact TS 870`
 *
 *   금호(`kumho-name.ts`)와 달리 콘티넨탈은 Description 이 **이미 사람이 읽는 이름**이라
 *   훨씬 단순하다. 규격·하중·배지를 앞에서 떼면 모델명이 남는다.
 *
 * 🔴 **금호 겹수 규칙을 여기 끌어오면 안 된다.** 콘티넨탈은 모델명이 숫자로 끝나는 것이
 *    많다 (`EcoContact 6` · `SportContact 7` · `UltraContact UC6`). 끝 숫자를 겹수로 떼면
 *    서로 다른 타이어가 같은 이름이 된다 (CLAUDE.md D-17 의 경고 그대로).
 *    겹수는 콘티넨탈 표기가 명시적이다 — `6PR` · `8PR` · `10PR` 만 본다.
 *
 * 🔴 축약형은 **사전으로 편다** (사장님 결정 2026-08-29). 목록이 `VANCAP`·`CEC 5`·`CCRX`
 *    처럼 줄여 적은 줄이 섞여 있는데, 그대로 두면 같은 타이어가 두 이름으로 갈라진다.
 *    사전의 뿌리는 `invoice-desc.ts` 의 콘티넨탈 ALIASES 다 — 인보이스와 목록이
 *    **같은 이름을 내야 한다** (금호 때 가장 크게 데인 자리, 커밋 ddedbce).
 */

/** 규격 앞에 붙는 표기 — LT(경트럭) · P(승용) · HL(고하중) · ML(마킹) */
const PREFIX = /^(?:LT|HL|ML|P)(?=\d)/i;

/** `255/35R19` · `255/35ZR19` · `195/70R15C` */
const RE_SPEC = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*(Z)?\s*R\s*(\d{2}(?:\.\d)?)\s*(C)?\s*/i;
/** 편평비 없는 밴 규격 — `185R14C` · `205R16C` */
const RE_SPEC_NO_ASPECT = /^\s*(\d{2,3})\s*R\s*(\d{2}(?:\.\d)?)\s*(C)?\s*/i;
/** 하중지수+속도기호 — `96Y` · `(103Y)` · `106/104R` · `116/113S` */
const RE_LOAD = /^\(?\s*(\d{2,3}(?:\/\d{2,3})?)\s*\)?\s*([A-Z]{1,2})\s*\)?\s*/;

/** 이름에서 떼어 속성으로 보내는 배지 (앞쪽에 줄줄이 붙는다) */
const HEAD_BADGE = /^(XL|FR|TL|EXTRA\s*LOAD|LRC|LR[A-F])\s+/i;

/** 겹수 — 콘티넨탈은 `8PR` 처럼 명시한다 */
const RE_PLY = /\b(\d{1,2})\s*PR\b/i;

/**
 * OE 마크 — 자동차 회사가 요구한 전용 사양.
 * 값이 다르면 **다른 물건**이다 (같은 규격·같은 모델이라도 가격이 다르다).
 */
const OE_MARKS = [
  "MO-S", "MOE", "MO1", "MO",           // 벤츠 (긴 것부터)
  "AO", "RO1", "R0",                     // 아우디
  "VOL",                                 // 볼보
  "NF0", "ND0", "NE0", "N0",             // 포르쉐
  "TS0", "T0", "T1",                     // 테슬라
  "MGT",                                 // 마세라티
  "POL",                                 // 폴스타
  "BLE", "SUV", "LR",                    // 그밖 표기
];

/** 기술 사양 — 이름에 남기되 속성도 켠다 */
const TECH = {
  runflat: /\b(SSR|RunFlat|ROF)\b/i,
  acoustic: /\bContiSilent\b/i,
  seal: /\bContiSeal\b/i,
  suv: /\bSUV\b/i,
};

/**
 * 줄임말 → 정식 모델명. **긴 것부터** 본다.
 * 근거는 같은 파일 안의 다른 줄이 쓴 정식 표기다 — 지어내지 않았다.
 */
const ALIASES: [RegExp, string][] = [
  [/\bALLSEASONCONTACT\b/gi, "AllSeasonContact"],
  [/\bASC\s*2\b/gi, "AllSeasonContact 2"],
  [/\bCONTIPROCONTACT\b/gi, "ContiProContact"],
  [/\bCONTICROSSCONTACT\b/gi, "ContiCrossContact"],
  [/\bCONTISPORTCONTACT\b/gi, "ContiSportContact"],
  [/\bCONTIWINTERCONTACT\b/gi, "ContiWinterContact"],
  [/\bCONTIVANCONTACT\b/gi, "ContiVanContact"],
  [/\bCONTIECOCONTACT\b/gi, "ContiEcoContact"],
  [/\bCOMFORTCONTACT\b/gi, "ComfortContact"],
  [/\bCROSSCONTACT\b/gi, "CrossContact"],
  [/\bWINTERCONTACT\b/gi, "WinterContact"],
  [/\bNORTHCONTACT\b/gi, "NorthContact"],
  [/\bVIKINGCONTACT\b/gi, "VikingContact"],
  [/\bPREMIUMCONTACT\b/gi, "PremiumContact"],
  [/\bSPORTCONTACT\b/gi, "SportContact"],
  [/\bECOCONTACT\b/gi, "EcoContact"],
  [/\bMAXCONTACT\b/gi, "MaxContact"],
  [/\bULTRACONTACT\b/gi, "UltraContact"],
  [/\bEXTREMECONTACT\b/gi, "ExtremeContact"],
  [/\bPROCONTACT\b/gi, "ProContact"],
  [/\bVANCONTACT\b/gi, "VanContact"],
  [/\bALTIMAX\b/gi, "ALTIMAX"],
  [/\bGRABBER\b/gi, "Grabber"],
  // ── 줄여 적은 줄 (사장님 결정 2026-08-29 — 사전으로 푼다) ──
  [/\bVANCAP\b/gi, "VanContact AP"],
  [/\bCCRX\b/gi, "CrossContact RX"],
  [/\bCCLXSP?\b/gi, "CrossContact LX Sport"],
  [/\bCCLX\b/gi, "CrossContact LX"],
  [/\bCCHT\b/gi, "CrossContact H/T"],
  [/\bCEC\s*(\d)\b/gi, "ContiEcoContact $1"],
  [/\bCSC\s*(\d)\b/gi, "ContiSportContact $1"],
  [/\bEC\s*(\d)\s*Q\b/gi, "EcoContact $1 Q"],
  [/\bEC\s*(\d)\b/gi, "EcoContact $1"],
  [/\bPC\s*(\d)\b/gi, "PremiumContact $1"],
  [/\bSC\s*(\d)\b/gi, "SportContact $1"],
  [/\bALT\s+(GS\d)\b/gi, "ALTIMAX $1"],
  [/\bML\s+(?=[A-Z])/g, ""], // 홀로 선 ML 은 규격 표기 잔해다
  // ── 목록의 오타·띄어쓰기 흔들림 (실측 2026-08-29) ──
  [/\bConti\s+ProContact\b/gi, "ContiProContact"], // `Conti ProContact` 로 띄어 온 줄 하나
  [/\bM0\b/g, "MO"], // 벤츠 마크는 MO(영문 오). 목록에 M0(숫자 영) 오타가 있다
  [/\*(?=[A-Z])/g, "★ "], // `*MO` 처럼 별표가 마크에 붙어 온다
];

export interface ContiName {
  /** 화면에 쓸 모델명 — `AllSeasonContact 2 ★` */
  name: string;
  width: number | null;
  aspectRatio: number | null;
  rimInch: number | null;
  loadIndex: string | null;
  speedRating: string | null;
  /** 밴·상용 규격(`C`) */
  isCommercial: boolean;
  isRunflat: boolean;
  isAcoustic: boolean;
  isSuv: boolean;
  plyRating: number | null;
  /** 콤마로 이어 붙인 OE 마크 — `MO,ContiSeal` */
  oeMarks: string | null;
  /** 규격을 못 읽었나 */
  specParsed: boolean;
}

/** 모델명 정리 — 별칭을 펴고, 별표를 ★ 로 통일하고, 공백을 고른다 */
function tidy(s: string): string {
  let out = ` ${s} `;
  for (const [re, to] of ALIASES) out = out.replace(re, to);
  // 별표는 지금 쓰는 표기(★)로 통일한다 — 목록은 `*`, 우리 화면은 `★` 였다
  out = out.replace(/(^|\s)\*(?=\s|$)/g, "$1★");
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Description 한 줄 → 모델명 + 속성.
 * @param desc 목록의 `Description`
 * @param marketingLine 겨울 주문서의 `Marketing Line` — 있으면 **이름은 이것을 믿는다**
 */
export function parseContiDesc(desc: string, marketingLine?: string | null): ContiName {
  let s = String(desc ?? "").trim().replace(/\s+/g, " ");
  const out: ContiName = {
    name: "",
    width: null,
    aspectRatio: null,
    rimInch: null,
    loadIndex: null,
    speedRating: null,
    isCommercial: false,
    isRunflat: false,
    isAcoustic: false,
    isSuv: false,
    plyRating: null,
    oeMarks: null,
    specParsed: false,
  };

  // ① 규격 접두를 뗀다 — LT285/70R17 · P205/70R16 · HL245/40R19
  s = s.replace(PREFIX, "");

  // ② 규격
  const m = RE_SPEC.exec(s);
  if (m) {
    out.width = Number(m[1]);
    out.aspectRatio = Number(m[2]);
    out.rimInch = Number(m[4]);
    out.isCommercial = !!m[5];
    out.specParsed = true;
    s = s.slice(m[0].length);
  } else {
    const m2 = RE_SPEC_NO_ASPECT.exec(s);
    if (m2) {
      // 편평비는 추측해 넣지 않는다 (tire-spec.ts 와 같은 원칙)
      out.width = Number(m2[1]);
      out.rimInch = Number(m2[2]);
      out.isCommercial = !!m2[3];
      out.specParsed = true;
      s = s.slice(m2[0].length);
    }
  }

  // ③ 하중지수 + 속도기호 — 괄호째 받는다 `(103Y)`
  const ml = RE_LOAD.exec(s);
  if (ml) {
    out.loadIndex = ml[1];
    out.speedRating = ml[2].toUpperCase();
    s = s.slice(ml[0].length);
  }

  // ④ 앞에 줄줄이 붙는 배지를 뗀다 — `XL FR ` · `XL ` · `TL FR `
  for (let i = 0; i < 6 && HEAD_BADGE.test(s); i++) s = s.replace(HEAD_BADGE, "");

  // ⑤ 겹수 — `8PR`
  const mp = RE_PLY.exec(s);
  if (mp) {
    out.plyRating = Number(mp[1]);
    s = s.replace(RE_PLY, " ");
  }

  // ⑥ 기술 사양 — 이름엔 남기고 속성도 켠다
  out.isRunflat = TECH.runflat.test(s);
  out.isAcoustic = TECH.acoustic.test(s);
  out.isSuv = TECH.suv.test(s);

  // ⑦ OE 마크 — 이름엔 그대로 두고 따로도 적는다 (다르면 다른 물건이라 근거가 필요하다)
  const marks: string[] = [];
  for (const mk of OE_MARKS) {
    const re = new RegExp(`(^|\\s)${mk.replace(/[-]/g, "\\-")}(?=\\s|$)`, "i");
    if (re.test(s) && !marks.some((x) => x.startsWith(mk))) marks.push(mk);
  }
  if (/(^|\s)\*(\s|$)/.test(s)) marks.push("★");
  if (/(^|\s)#{1,3}(\s|$)/.test(s)) marks.push("#");
  if (TECH.seal.test(s)) marks.push("ContiSeal");
  out.oeMarks = marks.length ? marks.join(",") : null;

  // ⑧ 이름 — 겨울 주문서는 Marketing Line 이 정식 모델명이라 그것을 앞세우고,
  //    Description 에만 있는 꼬리(OE 마크·ContiSilent)를 뒤에 붙인다
  const tail = tidy(s);
  if (marketingLine && marketingLine.trim()) {
    const base = tidy(marketingLine);
    const extra = tail.replace(new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").trim();
    out.name = extra ? `${base} ${extra}`.replace(/\s+/g, " ").trim() : base;
  } else {
    out.name = tail;
  }
  return out;
}

/** 계절 — 모델명으로 판정한다 (`tire-attrs.ts` 와 같은 규칙, 콘티넨탈만 좁혀서) */
export function contiSeason(name: string): string | null {
  if (/winter|viking|north|ice|alpin/i.test(name)) return "겨울";
  if (/\be[.\s]?contact\b/i.test(name)) return "여름"; // Conti.eContact — 전기차용
  if (/allseason|all\s*season|4\s*season|crosscontact|procontact|vancontact\s*a\/s|comfortcontact\s*as/i.test(name)) return "사계절";
  if (/sportcontact|premiumcontact|ecocontact|maxcontact|ultracontact|extremecontact|comfortcontact|vancontact|grabber|altimax/i.test(name)) return "여름";
  return null;
}
