/**
 * 「이 차에 맞는 부품」 — 순수 규칙 (2026-09-04)
 *
 * 🔴 `@/db` 를 import 하지 않는다 — 화면과 시험이 같이 쓴다 (spec-core.ts 와 같은 태도).
 *
 * 🔴 **여기 있는 낱말 경계 규칙 한 줄이 안전장치다.**
 *    적용 차종 글자는 사람이 손으로 적은 자유 문장이라 코드가 다른 낱말 안에 숨어 있다.
 *    `RBK`(투싼) 안의 `BK`(제네시스 쿠페)를 잡으면 그 순간 **다른 차의 부품 품번**을 권하게 된다.
 *    **틀린 품번은 없는 것보다 나쁘다.**
 *    SQL(`~*`)과 화면의 잘라내기가 **같은 규칙**을 쓰도록 여기 한 곳에서만 만든다.
 */

/**
 * 적용 차종 글자에서 이 코드를 낱말로 찾는 정규식 (SQL·화면 공용)
 *
 * 🔴 **붙임표(-)도 코드의 일부로 본다** (2026-09-05, 실측으로 정했다).
 *    붙임표를 낱말 경계로 두면 이런 것들이 걸린다:
 *      `HI-Q SP1117…`(금호 브레이크 브랜드) → G90 `HI` 에 브레이크패드 **91개**가 붙었다
 *      `TOYOTA /C-HR`                    → 포터2 `HR`
 *      `FILTER-AIR`                       → 에쿠스VI `AIR`
 *    전체 1,004짝 중 **94짝이 줄고, 그 94짝이 전부 오탐**이었다. 잃은 정상 짝은 0이다.
 */
export function codeWordPattern(code: string): string {
  /* 코드에 정규식 기호가 섞여 들어와도 글자 그대로 찾도록 막아 둔다 */
  const safe = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(^|[^A-Za-z0-9-])${safe}([^A-Za-z0-9-]|$)`;
}

/** 적용 차종 글자에 이 코드가 낱말로 들어 있나 */
export function fitmentHasCode(fitment: string, code: string): boolean {
  return new RegExp(codeWordPattern(code), "i").test(fitment);
}

/**
 * 적용 차종 글자에서 **왜 이 부품이 걸렸는지** 코드 언저리를 잘라 낸다.
 * 제원 검수 화면이 원문 줄을 보여 주는 것과 같은 이치 — 정비사가 눈으로 확인해야 한다.
 */
export function whySnippet(fitment: string, code: string): string {
  const m = new RegExp(codeWordPattern(code), "i").exec(fitment);
  if (!m) return fitment.slice(0, 60);
  const at = m.index;
  const from = Math.max(0, at - 22);
  const to = Math.min(fitment.length, at + code.length + 24);
  return `${from > 0 ? "…" : ""}${fitment.slice(from, to).trim()}${to < fitment.length ? "…" : ""}`;
}

/* ────────────────────────────────────────────────────────────────────────
 * 순정 품번 (2026-09-05, 사장님 요청: 「정확히 어떤 품번의 부품이 들어가는지까지」)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * 적용 차종 글자에 묻혀 있는 **순정 품번**을 꺼낸다.
 *
 * 🔴 **모양으로 찾지 않는다. 「품번」이라는 낱말을 닻으로 쓴다.**
 *    품번 모양이 제조사마다 다르다 — `26350-2T000`(현대) · `0K55361C14`(기아 구형) ·
 *    `04152-YZZA6`(도요타) · `2M5Z2001AA`(포드). 모양으로 찾으면 절반을 놓치고,
 *    동시에 연식(`2026-08`)·전화번호·타이어 규격(`235/60R18`)을 품번으로 착각한다.
 *    실제 1,503건에 미리 돌려 보니 낱말 닻은 1,502건이 깨끗했다.
 *
 * 🔴 **우리 상품코드(`MBA-049_MOBIS`)는 순정 품번이 아니다.** 그건 `product.part_no` 다.
 *    정비사가 부품상에 주문할 때 부르는 번호는 여기서 나오는 쪽이다.
 *
 * 🔴 **`whySnippet` 의 결과에서 뽑으면 안 된다.** 그건 코드 언저리 46자만 잘라내므로
 *    글 꼬리의 `· 품번 …` 이 잘려 나간다. 반드시 원본 `fitment` 을 넘긴다.
 */
export function oemPartNos(fitment: string | null | undefined, limit = 4): string[] {
  if (!fitment) return [];
  const out: string[] = [];
  /* 「품번 26350-2T000」·「품번 : 26320-2F000,26320-2F100」 — 가운뎃점에서 멈춘다 */
  const re = /(?:품\s*번|부품\s*번호|순정\s*품번)\s*[:：]?\s*([^\n·|]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fitment)) !== null) {
    /* 빗금은 품번을 나란히 적은 것이다 — `04152-37010/04152-YZZA6` 은 두 개다 */
    for (const raw of m[1].split(/[,\s/]+/)) {
      const v = raw.trim();
      if (!looksLikeOemPartNo(v)) continue;
      if (!out.includes(v)) out.push(v);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * 이 조각이 품번으로 보이나.
 * 🔴 모양을 좁게 정하지 않는다 — 「품번」 낱말이 이미 믿음을 주었다.
 *    여기서 하는 일은 **명백히 품번이 아닌 것만** 걷어내는 것이다.
 */
export function looksLikeOemPartNo(v: string): boolean {
  if (v.length < 5 || v.length > 20) return false;
  /* 한글이 섞였으면 품번이 아니라 설명이 딸려온 것이다 */
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(v)) return false;
  /* 숫자가 하나도 없으면 품번이 아니다 */
  if (!/[0-9]/.test(v)) return false;
  /* 타이어 규격이 품번 자리에 오는 일은 없지만, 와도 막는다 */
  if (/^\d{3}\/\d{2}/.test(v)) return false;
  return /^[0-9A-Za-z][0-9A-Za-z\-_.]*$/.test(v);
}

/* ────────────────────────────────────────────────────────────────────────
 * 엔진 갈래 (2026-09-05, 사장님 지시)
 *
 * 「부품은 정확하게 그 차량에 적합한 것이 들어가야 하기 때문임. 예를 들어 소나타라도
 *  디젤 모델 가솔린 모델이나 엔진 유형에 따라 다른 것임.」
 *
 * 🔴 **글 전체에서 「디젤」을 찾으면 안 된다.** 한 상품 글에 차가 여럿 적혀 있고
 *    엔진 표기는 각자 자기 차 것이다:
 *      「쏘렌토MQ4 하이브리드 , 쏘나타DN8 1.6가솔린」
 *         └ 하이브리드는 쏘렌토 것        └ 1.6가솔린은 쏘나타 것
 *    글 전체를 훑으면 쏘나타에 하이브리드용 오일필터를 권하게 된다.
 *
 * 🔴 **못 읽으면 `null` 을 낸다. 짐작해서 채우지 않는다.**
 *    필터류의 3분의 2에는 엔진 표기가 아예 없다. 그건 「모른다」가 정답이다.
 * ──────────────────────────────────────────────────────────────────────── */

export interface EngineRead {
  /** 사람이 읽는 짧은 이름 — 「2.2 디젤」·「하이브리드」·「1.6 가솔린」 */
  label: string;
  /** 글 맨 앞 괄호에서 왔나(글 전체에 걸린다) / 우리 차 코드 언저리에서 왔나 */
  from: "앞머리" | "언저리";
}

/** 연료·구동 낱말. 순서가 곧 우선순위다 — 하이브리드가 가솔린보다 좁은 말이다 */
const FUEL_WORDS: readonly (readonly [RegExp, string])[] = [
  [/하이브리드|HYBRID|HYD/i, "하이브리드"],
  [/LPI/i, "LPI"],
  [/LPG/i, "LPG"],
  [/디젤|DIESEL/i, "디젤"],
  [/가솔린|GASOLINE/i, "가솔린"],
  [/전기차|전기|EV(?![A-Za-z0-9])/i, "전기"],
];

/** 「2.2」·「1.6」 — 배기량. 연식(2019)이나 품번과 헷갈리지 않게 한 자리.한 자리만 본다 */
const DISPLACEMENT = /(?<![0-9.])([0-9])\.([0-9])(?![0-9])/;

/** 언저리를 어디서 끊나 — 쉼표·빗금·가운뎃점이 나오면 다음 차 이야기다 */
const SEGMENT_END = /[,/·|]/;

/** 코드 뒤로 이만큼만 본다. 더 보면 옆 차의 엔진을 끌어온다 */
const NEAR_CHARS = 14;

/**
 * 코드 뒤로 「이 차에 걸리는 말」이 어디까지인지 잘라 낸다.
 *
 * 🔴 빗금으로 이어진 차 목록은 **끝까지 한 덩어리**다:
 *      「아반떼HD/AD/MD디젤」 — 디젤은 HD·AD·MD 셋 다에 걸린다
 *    `AD` 에서 빗금을 만났다고 멈추면 MD 는 디젤로 읽고 AD 는 못 읽는,
 *    말이 안 되는 결과가 나온다 (2026-09-05 표본에서 실제로 그랬다).
 *
 * 🔴 그렇다고 아무 데나 넘어가면 옆 차의 엔진을 끌어온다. **빗금 다음이
 *    짧은 영문·숫자 코드일 때만** 이어 붙인다 — 「/MD」 는 잇고 「/ 팰리세이드 2.2 디젤」 은 안 잇는다.
 */
function nearText(fitment: string, from: number): string {
  let at = from;
  let out = "";
  for (let hop = 0; hop < 4; hop++) {
    const window = fitment.slice(at, at + NEAR_CHARS);
    const cut = window.search(SEGMENT_END);
    if (cut === -1) return out + window;
    out += window.slice(0, cut);
    /* 여기서 끊긴 자리가 빗금이고, 그 뒤가 짧은 코드면 같은 차 목록이 이어지는 것이다 */
    const sep = window[cut];
    if (sep !== "/") return out;
    const rest = fitment.slice(at + cut + 1);
    const token = /^([A-Za-z0-9]{1,4})(?![A-Za-z0-9])/.exec(rest);
    if (!token) return out;
    at = at + cut + 1 + token[1].length;
  }
  return out;
}

function fuelIn(text: string): string | null {
  for (const [re, name] of FUEL_WORDS) if (re.test(text)) return name;
  return null;
}

function labelOf(text: string): string | null {
  const fuel = fuelIn(text);
  const disp = DISPLACEMENT.exec(text);
  const cc = disp ? `${disp[1]}.${disp[2]}` : null;
  if (fuel && cc) return `${cc} ${fuel}`;
  if (fuel) return fuel;
  if (cc) return cc;
  return null;
}

/**
 * 이 부품이 **우리 차의 어느 엔진용인지** 읽는다. 못 읽으면 `null`.
 *
 * 두 자리만 본다:
 *   ① 글 맨 앞 괄호 — 「(가솔린) 팰리세이드,올뉴카니발,…」 처럼 **목록 전체**에 걸린다
 *   ② 우리 차 코드 바로 뒤 — 「쏘렌토MQ4 2.2디젤」 처럼 **그 차에만** 걸린다
 * 둘 다 있으면 ②가 이긴다. 좁은 말이 맞는 말이다.
 */
export function engineNear(fitment: string | null | undefined, code: string): EngineRead | null {
  if (!fitment || !code) return null;

  /* ② 코드 언저리 — 쉼표를 만나거나 NEAR_CHARS 를 넘으면 거기서 끊는다 */
  const m = new RegExp(codeWordPattern(code), "i").exec(fitment);
  if (m) {
    /* m[1] 은 코드 앞 한 글자라 그만큼 뒤로 민다 */
    const after = m.index + (m[1] ? m[1].length : 0) + code.length;
    const got = labelOf(nearText(fitment, after));
    if (got) return { label: got, from: "언저리" };
  }

  /* ① 글 맨 앞 괄호 — 「(순정부품)」 은 우리 표시라 건너뛴다 */
  const head = /^\s*(?:\(\s*순정부품\s*\)\s*)?\(([^)]{1,40})\)/.exec(fitment);
  if (head) {
    const got = labelOf(head[1]);
    if (got) return { label: got, from: "앞머리" };
  }

  return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * 🔴 남의 차 부품 걸러내기 (2026-09-05, 실제로 배포된 화면에서 12건을 찾았다)
 *
 * 세대 괄호코드는 짧아서 **수입차 차대코드와 그대로 겹친다.** 실제로 이런 일이 있었다:
 *   포터2 `HR`  ← 렉서스 `C-HR` 오일필터        (손님 차 92대짜리 차종이다)
 *   모닝 `JA`   ← 재규어 `XE(JA)` 브레이크패드
 *   GV70 `JK`   ← 지프 `WRANGLER JK` 오일필터
 *   투싼 `TL`   ← 혼다 `ACURA TL` 브레이크패드
 *   말리부 `ALL` ← 재규어 `ALL NEW XF` (코드가 영어 낱말이라 아무 데나 걸린다)
 *
 * 🔴 **국산차에 수입차 부품을 권하면 사장님이 그대로 주문하신다.**
 *    `spec-torque-core.ts` 가 「다른 제조사 이름이 줄에 있으면 우리 것이 아니다」로
 *    막은 것과 **똑같은 함정, 똑같은 처방**이다.
 * ──────────────────────────────────────────────────────────────────────── */

const FOREIGN_MAKERS =
  /(JAGUAR|LAND\s*ROVER|BMW|AUDI|BENZ|MERCEDES|VOLKSWAGEN|VOLVO|PORSCHE|LEXUS|TOYOTA|TOYODA|HONDA|ACURA|NISSAN|INFINITI|MAZDA|SUBARU|MITSUBISHI|FORD|LINCOLN|JEEP|DODGE|CHRYSLER|PEUGEOT|CITROEN|FIAT|TESLA|재규어|랜드로버|아우디|벤츠|폭스바겐|바겐|볼보|포르쉐|렉서스|도요타|도요다|토요타|혼다|아큐라|닛산|인피니티|마쓰다|스바루|미쓰비시|푸조|시트로엥|크라이슬러)/i;

/** 코드 앞뒤로 이만큼 안에 수입차 이름이 있으면 그 부품은 우리 차 것이 아니다 */
const FOREIGN_WINDOW = 30;

/**
 * 이 부품 글의 **우리 차 코드 언저리에 남의 제조사 이름**이 있나.
 *
 * 🔴 글 전체를 보지 않는다. 한 상품 글에 국산차와 수입차가 같이 적힌 공용 부품이 있고,
 *    그건 진짜로 우리 차에도 맞는다. **코드 바로 옆**에 있을 때만 남의 차 것이다.
 *
 * 🔴 **우리 차가 수입차면 그 제조사는 남이 아니다.** `own` 에 그 차의 제조사를 넘긴다.
 *    안 넘기면 BMW `E46` 에 붙은 진짜 BMW 부품까지 걸러 버린다 —
 *    2026-09-05 에 이 함수를 처음 돌렸을 때 실제로 그랬다.
 */
export function foreignNear(
  fitment: string | null | undefined,
  code: string,
  own?: string | null,
): string | null {
  if (!fitment || !code) return null;
  const m = new RegExp(codeWordPattern(code), "i").exec(fitment);
  if (!m) return null;
  const at = m.index + (m[1] ? m[1].length : 0);
  const from = Math.max(0, at - FOREIGN_WINDOW);
  const to = Math.min(fitment.length, at + code.length + FOREIGN_WINDOW);
  const near = fitment.slice(from, to);
  const hit = FOREIGN_MAKERS.exec(near);
  if (!hit) return null;
  /* 우리 차의 제조사면 남의 차가 아니다 — 「BMW 3시리즈 E46」은 BMW 것이 맞다 */
  if (own && isSameMaker(hit[0], own)) return null;
  return hit[0];
}

/** 「BMW」와 「BMW」, 「벤츠」와 「MERCEDES」를 같은 곳으로 본다 */
const MAKER_ALIASES: readonly (readonly string[])[] = [
  ["BMW", "비엠더블유"],
  ["BENZ", "MERCEDES", "벤츠", "메르세데스"],
  ["AUDI", "아우디"],
  ["VOLKSWAGEN", "폭스바겐", "바겐"],
  ["VOLVO", "볼보"],
  ["PORSCHE", "포르쉐"],
  ["LEXUS", "렉서스"],
  ["TOYOTA", "TOYODA", "도요타", "도요다", "토요타"],
  ["HONDA", "ACURA", "혼다", "아큐라"],
  ["NISSAN", "INFINITI", "닛산", "인피니티"],
  ["MAZDA", "마쓰다"],
  ["SUBARU", "스바루"],
  ["MITSUBISHI", "미쓰비시"],
  ["FORD", "LINCOLN", "포드", "링컨"],
  ["JEEP", "DODGE", "CHRYSLER", "지프", "크라이슬러"],
  ["JAGUAR", "LAND ROVER", "재규어", "랜드로버"],
  ["PEUGEOT", "푸조"],
  ["CITROEN", "시트로엥"],
  ["FIAT"],
  ["TESLA", "테슬라"],
];

function isSameMaker(a: string, b: string): boolean {
  const up = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");
  const x = up(a);
  const y = up(b);
  if (x === y) return true;
  return MAKER_ALIASES.some((g) => g.some((v) => up(v) === x) && g.some((v) => up(v) === y));
}

/* ────────────────────────────────────────────────────────────────────────
 * 부품이 갈리는 축은 갈래마다 다르다 (2026-09-05, 실제 자료를 보고 알았다)
 *
 *   오일필터·에어필터 → **엔진** (2.2 디젤 / 2.5 가솔린 / 하이브리드)
 *   브레이크패드     → **앞·뒤와 휠 인치** (모닝 JA 는 13"·14"·리어로 셋이 갈린다)
 *   에어컨필터       → 대개 하나
 *
 * 그래서 「엔진」 하나만 보면 브레이크패드는 영영 못 가른다.
 * ──────────────────────────────────────────────────────────────────────── */

export interface FitCondition {
  /** 「2.2 디젤」·「하이브리드」 — 없으면 null */
  engine: string | null;
  /** 「앞」·「뒤」 — 브레이크패드에서 결정적이다 */
  axle: "앞" | "뒤" | null;
  /** 「13"」·「17"」 — 브레이크패드·휠 관련 */
  inch: number | null;
}

/** 「R」 하나로 뒤를 뜻하기도 한다 — 「올뉴모닝 R (JA)」 */
const AXLE_REAR = /(리어|후륜|뒷바퀴|뒤)|(?:^|[^A-Za-z])R(?=[\s(),]|$)/;
const AXLE_FRONT = /(프론트|전륜|앞바퀴|앞)|(?:^|[^A-Za-z])F(?=[\s(),]|$)/;
/** 「13"」·「14인치」 */
const INCH = /(\d{2})\s*(?:"|인치|인지)/;

/**
 * 이 부품이 우리 차의 **어느 조건**에 맞는지 코드 언저리에서 읽는다.
 * 🔴 못 읽는 자리는 `null` 로 둔다. 짐작해서 채우면 사장님이 그걸 믿고 끼우신다.
 */
export function fitConditions(fitment: string | null | undefined, code: string): FitCondition {
  const engine = engineNear(fitment, code)?.label ?? null;
  if (!fitment || !code) return { engine, axle: null, inch: null };

  const m = new RegExp(codeWordPattern(code), "i").exec(fitment);
  if (!m) return { engine, axle: null, inch: null };
  const at = m.index + (m[1] ? m[1].length : 0);
  /* 브레이크패드는 조건이 코드 **앞**에 오는 일이 잦다 — 「올뉴모닝 R (JA)」 */
  const near = fitment.slice(Math.max(0, at - 24), Math.min(fitment.length, at + code.length + NEAR_CHARS));

  let axle: "앞" | "뒤" | null = null;
  if (AXLE_REAR.test(near)) axle = "뒤";
  else if (AXLE_FRONT.test(near)) axle = "앞";

  const im = INCH.exec(near);
  const inch = im ? Number(im[1]) : null;
  /* 휠 인치는 12~24 사이다. 밖이면 우리가 잘못 읽은 것이다 */
  return { engine, axle, inch: inch !== null && inch >= 12 && inch <= 24 ? inch : null };
}

/**
 * 같은 부품이 두 번 들어 있나 — 우리 자료에 `(순정부품)` 접두사만 다른 짝이 여럿 있다.
 * 화면에서 합치지 않으면 목록이 두 배로 길어져 읽히지 않는다.
 *
 * 🔴 **품번이 같을 때만 합친다.** 이름이 비슷하다고 합치면 다른 부품이 조용히 사라진다.
 */
export function partDedupeKey(category: string | null, oemNos: readonly string[], name: string): string {
  if (oemNos.length) return `${category ?? ""}|${[...oemNos].sort().join(",")}`;
  /* 품번을 모르면 합치지 않는다 — 이름에서 우리 표시만 떼고 그대로 열쇠로 쓴다 */
  return `${category ?? ""}|이름:${name.replace(/\(\s*순정부품\s*\)/g, "").replace(/\s+/g, "")}`;
}
