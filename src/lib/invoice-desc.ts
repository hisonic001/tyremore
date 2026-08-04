/**
 * 인보이스 자재명 읽기 — 브랜드마다 다른 줄임말·내부코드를 푼다 (사장님 지적 2026-08-03)
 *
 *   "invoice 업로드시 타이어 품명을 이미 있는데도 못알아보거나
 *    새로운 품목을 생성해도 이상하게 생성됨."
 *
 * 실측(2026-08-03, 샘플 인보이스 3종)으로 확인한 것
 *
 *   금호  `KH 245/60  R18 V04L HP72 8K;RK`
 *         → 지금까지 모델명이 «V04L HP72 8K» 로 만들어졌다.
 *           `V04L`·`VXLL` 은 [속도기호][하중표기][내부], `8K`·`N`·`;RK` 는 내부코드다.
 *           남는 것은 **모델코드 `HP72`** 뿐이고, 그게 Crugen 계열을 가리킨다.
 *
 *   콘티  `275/35R19 96W FR PROCRX SIL` → «PROCRX SIL»
 *         `195/70R15C 104/102R VANCAP`  → «C VANCAP» (규격의 C 까지 새어 들어갔다)
 *         카탈로그의 같은 상품은 `ProContact RX ContiSilent` · `VanContact AP` 다.
 *
 * ⚠️ 사전에 없는 줄임말은 **그대로 둔다.** 지우면 사장님이 알아보시던 표기가 사라진다.
 *    모르는 것을 지우는 것보다 낯설게 남는 편이 낫다 (D-08 과 같은 태도).
 */

/** 내부코드 — 모델명이 아니다. 브랜드가 자기 시스템에서 쓰는 표기 */
const NOISE: RegExp[] = [
  /^(KH|KM|CO|MI|BS|HK|NX|GY|BFG|GN)$/i, // 브랜드 접두
  /^[A-Z]?(XL|\d{2})[A-Z]$/i, // 금호 `V04L` `VXLL` `W04L` — [속도][하중][내부]
  /^\d[A-Z]$/i, // 금호 `8K`
  /^TL$/i, // 튜블리스 — 거의 전부라 이름이 되지 못한다
];

/**
 * 🔴 **홀로 선 한 글자는 함부로 지우지 않는다.**
 *    금호 자재명 끝의 `N` 은 내부코드지만, 미쉐린 `PILOT SPORT 4 **S**` 의 S 는
 *    모델의 일부다. 한 글자를 통째로 지웠더니 `PILOT SPORT 4` 와 구분이 사라졌다
 *    (2026-08-03 시험 중 발견).
 *    금호 자재명(`;RK` 처럼 세미콜론이 붙는다)에서만 떼어낸다.
 */
const isKumhoStyle = (s: string) => /;/.test(s);

/**
 * 줄임말 → 정식 모델명.
 * 긴 것부터 본다 (`PROCRX` 를 `PRO` 보다 먼저).
 * 근거는 카탈로그의 같은 상품 이름이다 — 지어내지 않았다.
 */
const ALIASES: [RegExp, string][] = [
  // ── 콘티넨탈 ──
  [/\bPROCRX\s*SIL\b/gi, "ProContact RX ContiSilent"],
  [/\bPROCRX\b/gi, "ProContact RX"],
  [/\bPROCTX\b/gi, "ProContact TX"],
  [/\bCCLXSP\b/gi, "CrossContact LX Sport"],
  [/\bCCLX\b/gi, "CrossContact LX"],
  [/\bCCRX\b/gi, "CrossContact RX"],
  [/\bCCHT\b/gi, "CrossContact H/T"],
  [/\bCCUHP\b/gi, "CrossContact UHP"],
  [/\bVANCAP\b/gi, "VanContact AP"],
  [/\bVANCO4S\b/gi, "VanContact 4Season"],
  [/\bVANCECO\b/gi, "VanContact Eco"],
  [/\bECOC\s*6Q\b/gi, "EcoContact 6 Q"],
  [/\bECOC\s*6\b/gi, "EcoContact 6"],
  [/\bPREMC\s*6\b/gi, "PremiumContact 6"],
  [/\bSPOC\s*(\d)\b/gi, "SportContact $1"],
  [/\bMAXC\s*MC(\d)\b/gi, "MaxContact MC$1"],
  [/\bULTC\s*UC(\d)\b/gi, "UltraContact UC$1"],
  [/\bALLSC\s*2\b/gi, "AllSeasonContact 2"],
  [/\bWINTC\s*TS\s*(\d+)\b/gi, "WinterContact TS $1"],
  [/\bGRAB\s*HT(\d)\b/gi, "Grabber HT$1"],
  [/\bGRAB\s*AT(\d)\b/gi, "Grabber AT$1"],
  [/\bSIL\b/gi, "ContiSilent"],

  // ── 금호 — 패턴코드가 곧 모델이다. 확인된 것만 편다 (아래 KUMHO_MODEL 주석) ──
  [/\bHP72\b/gi, "Crugen GT Pro HP72"],
  [/\bHP71\b/gi, "Crugen HP71"],
  [/\bHP5(\d)\b/gi, "Crugen HP5$1"],
  [/\bKL33\b/gi, "Crugen Premium KL33"],
  [/\bKL71\b/gi, "Road Venture MT KL71"],
  [/\bVX51\b/gi, "Ennov SuperMile VX51"],
  [/\bTA92\b/gi, "Majesty X Solus TA92"],
  [/\bTA91\b/gi, "Majesty 9 Solus TA91"],
  [/\bTA([1235]\d)\b/gi, "Solus TA$1"],
  [/\bPS7(\d)\b/gi, "Ecsta PS7$1"],
  [/\bWP(\d\d)\b/gi, "WinterCraft WP$1"],
  [/\bWS(\d\d)\b/gi, "WinterCraft WS$1"],
  [/\bSW(\d\d)\b/gi, "WinterCraft SW$1"],
  [/\bKC(\d\d)\b/gi, "PorTran KC$1"],
];

/* ============================================================
 * ⭐ 금호 패턴코드 → 모델명 (2026-08-04)
 *
 * 금호는 자재명에 모델 이름을 쓰지 않고 **패턴코드**만 적는다 (`TA51`·`HP72`).
 * 인보이스에도 「패턴」 칸이 따로 있을 만큼 이것이 곧 모델이다.
 * 사장님이 주신 「자재검색」 목록도 같은 코드를 쓴다.
 *
 * ⚠️ **지어내지 않았다.** MARS 카탈로그에서 품번(`KM`+자재코드)으로 확실히 이어진
 *    상품들의 이름을 세어 다수를 골랐다.
 *      KL33 → Crugen Premium (6건)    TA21·TA31·TA51 → Solus (35건)
 *      TA91 → Majesty 9 Solus (15건)  TA92 → Majesty X Solus (3건)
 *      HP71 → Crugen HP71 (다수)      HP72 → CRUGEN GT Pro (1건)
 *
 * 🔴 **모르는 코드는 코드 그대로 둔다.**
 *    예전에는 `KL\d\d` 를 전부 「Crugen Premium」으로 폈는데, KL71·KL78 은
 *    Road Venture 계열(오프로드)이라 엉뚱한 이름이 붙었다 (2026-08-04 발견).
 *    틀린 이름보다 낯선 코드가 낫다 — D-08 과 같은 태도.
 * ========================================================== */
export const KUMHO_MODEL: Record<string, string> = {
  KL33: "Crugen Premium KL33",
  KL71: "Road Venture MT KL71",
  TA11: "Solus TA11",
  TA21: "Solus TA21",
  TA31: "Solus TA31",
  TA51: "Solus TA51",
  TA91: "Majesty 9 Solus TA91",
  TA92: "Majesty X Solus TA92",
  HP51: "Crugen HP51",
  HP71: "Crugen HP71",
  HP72: "Crugen GT Pro HP72",
  VX51: "Ennov SuperMile VX51",
};

/**
 * 아직 이름을 모르는 코드: HP91 · KL12 · KL21 · KL61 · KL78 · PA41 · PA71.
 * KL·PA 계열은 사이즈로 보면 오프로드·UHP 인데, 근거가 될 상품이 우리 카탈로그에
 * 하나도 없다. **짐작으로 이름을 붙이지 않는다** — 코드 그대로 둔다.
 * 사장님이 상품 화면에서 이름을 고쳐 주시면 그게 `display_name` 으로 남는다.
 */

/**
 * ⭐ 계절만 아는 코드 (2026-08-04)
 *
 * 이름은 몰라도 계절은 아는 경우가 있다. 계절은 상담에서 바로 쓰는 값이라
 * (「사계절 있어요?」) 비워 두면 그 상품이 검색 필터에서 통째로 빠진다.
 *
 *   HP91 — 사장님 확인 (2026-08-03): "금호 hp91은 사계절이 맞음"
 */
export const KUMHO_SEASON: Record<string, string> = {
  HP91: "사계절",
};

/** 패턴코드로 모델명을 만든다. 모르는 코드는 그대로 돌려준다 */
export function modelForPattern(patternCode: string): string {
  const k = patternCode.trim().toUpperCase();
  return KUMHO_MODEL[k] ?? k;
}

/**
 * ⭐ 타이어가 아닌 줄 (사장님 확인 2026-08-03 — "타이어 아님으로 표시하고 넘김")
 *
 * 미쉐린 인보이스에는 `TYREPLUS FRANCHISE EXPRESS` 같은 **프랜차이즈 수수료** 줄이
 * 섞여 들어온다. 물건이 아니므로 재고가 될 수 없다.
 * 예전에는 이런 줄이 「상품 미등록 — 먼저 등록해야 입고됩니다」로 빨갛게 떠서,
 * 사장님이 등록하려다 규격을 못 읽는다는 오류만 보게 됐다.
 *
 * 🔴 **규격이 없다는 이유만으로 「타이어 아님」이라고 하지 않는다.**
 *    우리가 규격을 못 읽는 진짜 타이어가 있을 수 있고, 그걸 조용히 넘기면
 *    매입한 타이어가 재고에서 통째로 빠진다. 요금성 낱말이 함께 있어야 한다.
 */
const FEE_WORDS =
  /FRANCHISE|ROYALTY|MEMBERSHIP|SUBSCRIPTION|\bFEE\b|CHARGE|FREIGHT|DELIVERY|SHIPPING|SERVICE|수수료|운임|배송|보증금|교육|광고/i;

export type LineKind = "tire" | "notTire" | "unreadable";

/**
 * 이 줄이 타이어인가.
 *   `tire`        — 규격을 읽었다. 상품으로 다룬다
 *   `notTire`     — 규격이 없고 요금성 낱말이 있다. 넘긴다
 *   `unreadable`  — 규격이 없는데 요금인지도 모르겠다. **사람이 봐야 한다**
 */
export function classifyLine(description: string, specParsed: boolean): LineKind {
  if (specParsed) return "tire";
  return FEE_WORDS.test(String(description ?? "")) ? "notTire" : "unreadable";
}

/**
 * 자재명에서 **모델코드**만 뽑는다 — `HP72` · `PROCRX` · `VANCAP`.
 * 이미 있는 상품을 규격+모델로 찾을 때 쓴다.
 * 규격·하중속도·내부코드를 걷어내고 남는 토큰 중 가장 그럴듯한 것.
 */
export function modelTokens(description: string): string[] {
  return stripNoise(description)
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9/+-]/g, ""))
    .filter((w) => w.length >= 2 && /[A-Z]/i.test(w) && !NOISE.some((re) => re.test(w)));
}

/** 규격·하중속도·구조표기·내부코드를 걷어낸 나머지 */
function stripNoise(description: string): string {
  return String(description ?? "")
    .replace(/;.*$/, " ") // 금호 `;RK` 뒤는 내부코드
    .replace(/\d{3}\s*\/\s*\d{2,3}\s*(Z|W|Y)?\s*R\s*\d{2}(\.\d)?\s*C?/gi, " ") // 규격 (밴 규격의 C 까지)
    .replace(/\b\d{3}\s*R\s*\d{2}\s*C?\b/gi, " ") // 편평비 없는 규격
    .replace(/\(\s*\d{2,3}[A-Z]{1,2}\s*\)/gi, " ") // (99Y)
    .replace(/\b\d{2,3}\/\d{2,3}\s*[A-Z]{1,2}\b/gi, " ") // 104/102R
    .replace(/\b\d{2,3}\s*[A-Z]{1,2}\b/gi, " ") // 96W · 104V
    .replace(/\b(XL|EXTRA\s+LOAD|FR|TL|SL|RF)\b/gi, " ") // 구조표기
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ⭐ 화면·상품등록에 쓸 모델명.
 * 줄임말을 펴고, 내부코드를 걷어내고, 남은 것을 붙인다.
 * 아무것도 안 남으면 원문을 그대로 돌려준다 — 빈 이름보다는 낫다.
 */
export function readModelName(description: string): string {
  let s = stripNoise(description);
  for (const [re, to] of ALIASES) s = s.replace(re, to);

  const kumho = isKumhoStyle(description);
  const words = s
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !NOISE.some((re) => re.test(w)))
    // 금호 자재명 끝의 홀로 선 한 글자(`N`)만 뗀다 — 위 주석 참조
    .filter((w) => !(kumho && /^[A-Z]$/i.test(w)));

  // 같은 말이 연달아 나오면 하나로 (`Crugen HP72 Crugen HP72`)
  const out: string[] = [];
  for (const w of words) if (out[out.length - 1]?.toUpperCase() !== w.toUpperCase()) out.push(w);

  const model = out.join(" ").trim();
  return model || String(description ?? "").trim();
}
