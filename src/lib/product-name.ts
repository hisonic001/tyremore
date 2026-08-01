/**
 * 상품 표시 이름 만들기
 *
 * MARS 상품 마스터는 이름이 두 칸에 나뉘어 있다.
 *   「상세 항목 및 서비스」 raw_name : "Michelin    285/35 R 20  XL 104Y  TL"   ← 규격·하중·XL·TL
 *   「설명 2」            pattern  : "CROSSCLIMATE 3 SPORT"                   ← 모델명·OE마킹
 *
 * 둘을 합쳐야 사장님이 쓰시는 형태가 된다 (2026-08-01 요청):
 *   "285/35 R20 104Y XL TL CROSSCLIMATE 3 SPORT"   CAI 304349
 *
 * ⚠️ 모델명만 보여주면 안 된다. 같은 PILOT SPORT 4 S 가 285/35R20 에만 3건 있고,
 *    XL·ZR·OE마킹으로 갈린다. 모델명만 띄우면 셋이 똑같이 보인다.
 *
 * ⚠️ pattern 이 이미 전체 이름인 품목이 섞여 있다.
 *      "285/35ZR20 (104Y) XLTL P SPT CUP2 MI"
 *    이 경우 규격을 앞에 또 붙이면 두 번 나온다.
 */

/** 브랜드 접두어 — raw_name 앞에 붙어 있다. 화면에는 브랜드 배지로 따로 나온다 */
const BRAND_PREFIX =
  /^(michelin|hankook|pirelli|continental|kumho|nexen|bridgestone|goodyear|bfgoodrich|general|dunlop|laufenn)\s+/i;

/** pattern 이 이미 규격을 품고 있는가 (225/45 · 285/35ZR20 같은 꼴) */
function patternHasSpec(pattern: string): boolean {
  return /\d{3}\s*\/\s*\d{2}/.test(pattern);
}

/** MARS 원문 꼬리표 — 화면에서는 군더더기다 */
function stripNoise(s: string): string {
  return s
    .replace(/\s+MI\s*$/i, "") // 미쉐린 표기 접미
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * 화면에 띄울 전체 이름.
 * @example fullName("Michelin    285/35 R 20  XL 104Y  TL", "CROSSCLIMATE 3 SPORT")
 *          → "285/35 R 20 XL 104Y TL CROSSCLIMATE 3 SPORT"
 */
export function fullName(rawName: string, pattern: string | null): string {
  const spec = stripNoise(String(rawName ?? "").replace(BRAND_PREFIX, ""));
  const model = stripNoise(String(pattern ?? ""));

  if (!model) return spec;
  if (patternHasSpec(model)) return model; // pattern 이 이미 전체 이름
  if (!spec) return model;
  return `${spec} ${model}`;
}

/**
 * OE 마킹 — 어느 차 순정으로 나온 물건인지.
 * 같은 모델이라도 마킹이 다르면 다른 물건이다. 사장님이 이걸로 구분하신다.
 *
 * ⚠️ MARS 데이터에 마킹이 들어 있는 것은 일부뿐이다 (미쉐린 4,152건 중 약 200건).
 *    없는 것은 CAI 번호로 구분할 수밖에 없다.
 */
const OE_MARKS: [RegExp, string][] = [
  [/(^| )MO1( |$)/, "MO1"], // 벤츠 (AMG)
  [/(^| )MOE( |$)/, "MOE"], // 벤츠 (런플랫)
  [/(^| )MO( |$)/, "MO"], // 벤츠
  [/(^| )GOE( |$)/, "GOE"], // 제네시스
  [/(^| )K[123]( |$)/, "K"], // 페라리
  [/(^| )N[0-5]( |$)/, "N"], // 포르쉐
  [/(^| )AOE?( |$)/, "AO"], // 아우디
  [/(^| )VOL( |$)/, "VOL"], // 볼보
  [/(^| )T[01]( |$)/, "T0"], // 테슬라
  [/(^| )(JLR|LR)( |$)/, "LR"], // 재규어·랜드로버
  [/(^| )MGT( |$)/, "MGT"], // 마세라티
  [/(^| )RO1( |$)/, "RO1"], // 아우디 콰트로
  [/\*/, "★"], // BMW
];

export interface NameParts {
  /** 화면 제목 */
  full: string;
  /** 모델명만 (검색 강조용) */
  model: string | null;
  /** OE 마킹 배지 */
  oe: string[];
}

export function parseName(rawName: string, pattern: string | null): NameParts {
  const full = fullName(rawName, pattern);
  const src = `${pattern ?? ""} ${rawName ?? ""}`;
  const oe: string[] = [];
  for (const [re, label] of OE_MARKS) {
    if (re.test(src) && !oe.includes(label)) oe.push(label);
  }
  return {
    full,
    model: pattern && !patternHasSpec(pattern) ? stripNoise(pattern) : null,
    oe,
  };
}

/** CAI(미쉐린 고유번호) 로 볼 수 있는 입력인가. MARS 번호는 5~6자리다 */
export function looksLikeCai(q: string): boolean {
  return /^\d{5,6}$/.test(q.trim());
}
