/**
 * 차대번호(VIN) 읽기 — 외부 조회 없이 (2026-09-04)
 *
 * `C:\dev\carinfo` 실험실에서 옮겨 왔다 (그 프로젝트는 폐기, 사장님 결정 2026-09-04).
 * 사진 인식(OCR)은 가져오지 않는다 — 성능이 나빠 쓰지 않기로 하셨다.
 *
 * 🔴 **차대번호로 차종을 해독하는 것은 불가능하다.** 2026-09-04 에 확인한 것:
 *    · 법(「자동차 차대번호 등의 운영에 관한 규정」)은 자리 구조만 정한다 —
 *      제작사군(1~3) · 자동차특성군(4~9) · 제작일련번호군(10~17).
 *      **4~9자리의 뜻은 제작사가 교통안전공단에 따로 제출하는 비공개 자료다.**
 *    · 미국 정부 무료 API(NHTSA vPIC)에 실제로 넣어 보니 미국 시장 차는 정확한데
 *      (`5NPE24AF8FH…` → HYUNDAI Sonata 2015) **우리 내수 차는 모델이 전부 null** 이고,
 *      르노 SM5 를 「NISSAN 1984년」이라고 자신 있게 틀렸다.
 *
 * 그래서 여기서는 **국제 규격(ISO 3779)만으로 확실히 읽히는 것**만 읽는다:
 *    · 1~3자리 WMI → 제조사·생산국
 *    · 10번째 자리 → 연식(모델 이어)
 *    · I·O·Q 는 차대번호에 쓰이지 않는다 (숫자 1·0 과 혼동 방지)
 *
 * ⚠️ 연식 문자는 30년마다 돈다 (A=1980=2010). 타이어 매장에 오는 차는 사실상
 *    2001년 이후이므로 2001~2030 창으로 읽는다.
 */

export interface VinInfo {
  vin: string;
  valid: boolean;
  problems: string[];
  maker: string | null;
  country: string | null;
  year: number | null;
  /** 뒤 6자리 — 제작일련번호. 부품가게가 이 여섯 자리로 차를 특정한다 */
  serial: string;
}

/** WMI(앞 3자리) → 제조사. 국산 전체 + 매장에 자주 오는 수입차 위주 */
const WMI: Record<string, { maker: string; country: string }> = {
  // ── 국산 ──
  KMH: { maker: "현대", country: "한국" },
  KM8: { maker: "현대 (SUV)", country: "한국" },
  KMF: { maker: "현대 (상용)", country: "한국" },
  KMJ: { maker: "현대 (버스·상용)", country: "한국" },
  KMT: { maker: "제네시스", country: "한국" },
  KMG: { maker: "제네시스", country: "한국" },
  KNA: { maker: "기아", country: "한국" },
  KND: { maker: "기아 (SUV·MPV)", country: "한국" },
  KNE: { maker: "기아", country: "한국" },
  KNC: { maker: "기아 (상용)", country: "한국" },
  KNH: { maker: "기아 (상용)", country: "한국" },
  KPB: { maker: "KG모빌리티(쌍용)", country: "한국" },
  KPT: { maker: "KG모빌리티(쌍용)", country: "한국" },
  KPA: { maker: "KG모빌리티(쌍용)", country: "한국" },
  KL1: { maker: "한국GM(쉐보레)", country: "한국" },
  KL4: { maker: "한국GM(쉐보레)", country: "한국" },
  KLA: { maker: "한국GM(대우)", country: "한국" },
  KLY: { maker: "한국GM(대우)", country: "한국" },
  KNM: { maker: "르노코리아", country: "한국" },
  // 해외 생산 현대·기아
  "5NP": { maker: "현대 (미국산)", country: "미국" },
  "5NM": { maker: "현대 (미국산 SUV)", country: "미국" },
  "5XY": { maker: "기아 (미국산 SUV)", country: "미국" },
  "5XX": { maker: "기아 (미국산)", country: "미국" },
  TMA: { maker: "현대 (체코산)", country: "체코" },
  U5Y: { maker: "기아 (슬로바키아산)", country: "슬로바키아" },
  U6Y: { maker: "기아 (슬로바키아산)", country: "슬로바키아" },
  MAL: { maker: "현대 (인도산)", country: "인도" },
  // ── 수입 ──
  WBA: { maker: "BMW", country: "독일" },
  WBS: { maker: "BMW M", country: "독일" },
  WBY: { maker: "BMW (전기)", country: "독일" },
  WDB: { maker: "메르세데스-벤츠", country: "독일" },
  WDD: { maker: "메르세데스-벤츠", country: "독일" },
  W1K: { maker: "메르세데스-벤츠", country: "독일" },
  W1N: { maker: "메르세데스-벤츠 (SUV)", country: "독일" },
  WDC: { maker: "메르세데스-벤츠 (SUV)", country: "독일" },
  WAU: { maker: "아우디", country: "독일" },
  WA1: { maker: "아우디 (SUV)", country: "독일" },
  WVW: { maker: "폭스바겐", country: "독일" },
  WVG: { maker: "폭스바겐 (SUV)", country: "독일" },
  WP0: { maker: "포르쉐", country: "독일" },
  WP1: { maker: "포르쉐 (SUV)", country: "독일" },
  YV1: { maker: "볼보", country: "스웨덴" },
  YV4: { maker: "볼보 (SUV)", country: "스웨덴" },
  LVY: { maker: "볼보 (중국산)", country: "중국" },
  SAL: { maker: "랜드로버", country: "영국" },
  SAJ: { maker: "재규어", country: "영국" },
  ZFF: { maker: "페라리", country: "이탈리아" },
  JTD: { maker: "토요타", country: "일본" },
  JTM: { maker: "토요타 (SUV)", country: "일본" },
  JTH: { maker: "렉서스", country: "일본" },
  JTJ: { maker: "렉서스 (SUV)", country: "일본" },
  JHM: { maker: "혼다", country: "일본" },
  JH4: { maker: "혼다(어큐라)", country: "일본" },
  JN1: { maker: "닛산", country: "일본" },
  JN8: { maker: "닛산 (SUV)", country: "일본" },
  JF1: { maker: "스바루", country: "일본" },
  JF2: { maker: "스바루 (SUV)", country: "일본" },
  "1FA": { maker: "포드", country: "미국" },
  "1FM": { maker: "포드 (SUV)", country: "미국" },
  "1FT": { maker: "포드 (트럭)", country: "미국" },
  "1C4": { maker: "지프", country: "미국" },
  "1C6": { maker: "램(닷지)", country: "미국" },
  "1G1": { maker: "쉐보레", country: "미국" },
  "1GC": { maker: "쉐보레 (트럭)", country: "미국" },
  "5YJ": { maker: "테슬라", country: "미국" },
  "7SA": { maker: "테슬라", country: "미국" },
  LRW: { maker: "테슬라 (중국산)", country: "중국" },
  XP7: { maker: "테슬라 (독일산)", country: "독일" },
  VF1: { maker: "르노", country: "프랑스" },
  VF3: { maker: "푸조", country: "프랑스" },
  VF7: { maker: "시트로엥", country: "프랑스" },
  ZAR: { maker: "알파로메오", country: "이탈리아" },
  ZFA: { maker: "피아트", country: "이탈리아" },
  SB1: { maker: "토요타 (유럽산)", country: "유럽" },
  VSS: { maker: "세아트", country: "스페인" },
  TRU: { maker: "아우디 (헝가리산)", country: "헝가리" },
};

/** 10번째 자리 → 연식. 2001~2030 창 (매장에 오는 차 기준) */
const YEAR: Record<string, number> = {
  "1": 2001, "2": 2002, "3": 2003, "4": 2004, "5": 2005,
  "6": 2006, "7": 2007, "8": 2008, "9": 2009,
  A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017,
  J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025,
  T: 2026, V: 2027, W: 2028, X: 2029, Y: 2030,
};

export function looksLikeVin(s: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(s.replace(/[\s-]/g, ""));
}

/**
 * 🔴 차종을 결정하는 자리 = **앞 9자리** (제작사군 1~3 + 자동차특성군 4~9).
 *    10번째는 연식, 11번째는 공장, 12~17은 일련번호라 차종과 무관하다.
 *    학습으로 세대를 추정할 때 이 길이를 쓴다 (lib/vin-learn.ts).
 */
export const VIN_MODEL_LEN = 9;

/** 차종을 가리키는 앞부분 — 없으면 null */
export function vinModelKey(vin: string): string | null {
  const s = vin.replace(/[\s-]/g, "").toUpperCase();
  return s.length === 17 ? s.slice(0, VIN_MODEL_LEN) : null;
}

export function parseVin(input: string): VinInfo {
  const vin = input.replace(/[\s-]/g, "").toUpperCase();
  const problems: string[] = [];

  if (vin.length !== 17) problems.push(`차대번호는 17자리입니다 (지금 ${vin.length}자리)`);
  const badChar = vin.match(/[IOQ]/);
  if (badChar) {
    const looksLike = badChar[0] === "Q" ? "9나 0" : badChar[0] === "I" ? "1" : "0";
    problems.push(`'${badChar[0]}' 는 차대번호에 쓰이지 않는 글자입니다 — 숫자 ${looksLike} 을 잘못 본 것일 수 있습니다`);
  }
  if (/[^A-Z0-9]/.test(vin)) problems.push("영문 대문자와 숫자만 쓸 수 있습니다");

  /* WMI: 3자리 정확 일치 → 2자리 앞부분 일치 순으로 찾는다 */
  const w3 = vin.slice(0, 3);
  let hit: { maker: string; country: string } | null = WMI[w3] ?? null;
  if (!hit) {
    const found = Object.entries(WMI).find(([k]) => k.slice(0, 2) === w3.slice(0, 2));
    hit = found ? found[1] : null;
  }
  if (!hit) {
    /* 국가만이라도 — 첫 글자 지역 코드 */
    const c = vin[0];
    const region =
      c >= "1" && c <= "5" ? "북미"
      : c === "J" ? "일본"
      : c === "K" ? "한국"
      : c === "L" ? "중국"
      : c === "S" ? "영국"
      : c === "V" ? "프랑스·스페인"
      : c === "W" ? "독일"
      : c === "Y" ? "북유럽"
      : c === "Z" ? "이탈리아"
      : null;
    if (region) hit = { maker: "미등록 제조사", country: region };
  }

  const year = vin.length === 17 ? (YEAR[vin[9]] ?? null) : null;

  return {
    vin,
    valid: problems.length === 0,
    problems,
    maker: hit?.maker ?? null,
    country: hit?.country ?? null,
    year,
    serial: vin.slice(11),
  };
}
