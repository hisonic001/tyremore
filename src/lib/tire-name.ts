/**
 * 타이어 표시 이름 만들기 — 화면은 깔끔하게, 정보는 하나도 안 버린다
 *
 * 사장님 요청 (2026-08-01)
 *   "MARS 입력용은 따로 유지하고 화면표시용은 깔끔하게. 다만 세부사항이 전부 나와야 함.
 *    간단한 타이어 명칭(E PRIMACY), 속도지수/하중지수, CPJ·흡음재 여부·ZP 등, OE 마킹"
 *
 * 데이터 사정
 *   MARS 는 이름을 두 칸에 나눠 담는다.
 *     raw_name "Michelin    245/60 R 18  105H  TL"   ← 규격·하중속도·XL·TL
 *     pattern  "PRIMACY TOUR A/S"                    ← 모델명·부가코드
 *   그런데 pattern 이 **두 형태로 섞여 있다**:
 *     ① 순수 모델명   "E PRIMACY" · "CROSSCLIMATE 2"
 *     ② 전체 상품명   "245/60R18 105H TL PRIMACY TOUR A/S MI"
 *   ②는 규격을 걷어내야 모델명이 나온다. 안 그러면 규격이 두 번 찍힌다.
 *
 * 코드 사전은 **실데이터 전수 조사**로 만들었다 (2026-08-01, 타이어 10,318건).
 * 사전에 없는 코드는 버리지 않고 `unknown` 으로 그대로 보여준다.
 * 모르는 표기를 지우면 사장님이 알아보시던 정보가 사라진다.
 */

export type BadgeKind = "runflat" | "feature" | "oe" | "structure";

export interface Badge {
  /** 원문 코드 — 사장님이 이 표기로 기억하신다 */
  code: string;
  /** 정비사용 한글 뜻 */
  label: string;
  kind: BadgeKind;
}

/**
 * 코드 → 뜻. 앞에 있는 것이 먼저 매칭된다 (MOE 를 MO 보다 앞에 둘 것).
 * 실측 건수를 주석에 남긴다 — 나중에 사전을 손볼 때 근거가 된다.
 */
const CODES: [RegExp, string, string, BadgeKind][] = [
  // ── 런플랫 (제조사마다 표기가 다르다) ──────────────────
  [/(^|[\s(])ZPS([\s)]|$)/i, "ZPS", "런플랫", "runflat"],
  [/(^|[\s(])ZP([\s)]|$)/i, "ZP", "런플랫", "runflat"], // 미쉐린 18
  [/(^|[\s(])RFT([\s)]|$)/i, "RFT", "런플랫", "runflat"], // 브리지스톤 72
  [/(^|[\s(])ROF([\s)]|$)/i, "ROF", "런플랫", "runflat"], // 굿이어 65
  [/(^|[\s(])SSR([\s)]|$)/i, "SSR", "런플랫", "runflat"], // 콘티넨탈
  [/(^|[\s(])R-F([\s)]|$)/i, "R-F", "런플랫", "runflat"], // 피렐리
  [/(^|[\s(])EMT([\s)]|$)/i, "EMT", "런플랫", "runflat"],
  [/(^|[\s(])DSST([\s)]|$)/i, "DSST", "런플랫", "runflat"],
  [/(^|[\s(])MOE([\s)]|$)/i, "MOE", "벤츠 런플랫", "runflat"], // 115

  // ── 기능 ──────────────────────────────────────────────
  [/(^|[\s(])ACOUSTIC([\s)]|$)/i, "ACOUSTIC", "흡음재", "feature"],
  [/(^|[\s(])(SILENT|SILENCE)([\s)]|$)/i, "SILENT", "흡음재", "feature"],
  [/흡음/, "ACOUSTIC", "흡음재", "feature"], // 금호는 한글로 적는다 — `Majesty X Solus 흡음`
  [/(^|[\s(])SELF-?SEAL([\s)]|$)/i, "SELFSEAL", "셀프씰", "feature"],
  [/(^|[\s(])(GRNX|GRX)([\s)]|$)/i, "GRNX", "저연비", "feature"], // 미쉐린 Green X 90
  [/(^|[\s(])EV([\s)]|$)/i, "EV", "전기차", "feature"], // 163
  /**
   * CPJ = Cordon de Protection de Jante (프랑스어) = 림 보호 (Rim Protector).
   * 인도 턱·장애물로부터 휠과 타이어 측면을 지키는 림 가드가 적용된 사양.
   * DT = Different Tread. 기존 모델 대비 트레드 패턴·컴파운드·내부 구조가 개선된 사양.
   * GO = 공식 명칭이 확인되지 않는다.
   * → 사장님 지시로 화면에는 **코드만** 띄운다 (2026-08-01).
   */
  [/(^|[\s(])CPJ([\s)]|$)/i, "CPJ", "CPJ", "structure"],
  [/(^|[\s(])DT1?([\s)]|$)/i, "DT", "DT", "feature"],
  [/(^|[\s(])AC([\s)]|$)/i, "AC", "흡음재", "feature"], // 주문사이트 표기 (= ACOUSTIC)
  // ⚠️ GO 는 배지가 아니다 — 브랜드 접미다. 아래 BRAND_SUFFIX 참조

  // ── OE 마킹 (어느 차 순정인가) ────────────────────────
  [/(^|[\s(])MO1([\s)]|$)/i, "MO1", "벤츠 AMG", "oe"],
  [/(^|[\s(])MO([\s)]|$)/i, "MO", "벤츠", "oe"], // 254
  [/(^|[\s(])GOE([\s)]|$)/i, "GOE", "제네시스", "oe"],
  [/(^|[\s(])AOE?([\s)]|$)/i, "AO", "아우디", "oe"], // 149
  [/(^|[\s(])RO1([\s)]|$)/i, "RO1", "아우디 콰트로", "oe"],
  [/(^|[\s(])VOL([\s)]|$)/i, "VOL", "볼보", "oe"], // 90
  [/(^|[\s(])N[0-5]([\s)]|$)/i, "N", "포르쉐", "oe"], // 88
  [/(^|[\s(])ND0([\s)]|$)/i, "ND0", "포르쉐", "oe"],
  [/(^|[\s(])K[123]([\s)]|$)/i, "K", "페라리", "oe"],
  [/(^|[\s(])T[01]([\s)]|$)/i, "T0", "테슬라", "oe"],
  [/(^|[\s(])(JLR|LR)([\s)]|$)/i, "LR", "랜드로버", "oe"], // 62
  [/(^|[\s(])MGT([\s)]|$)/i, "MGT", "마세라티", "oe"],
  [/(^|[\s(])J([\s)]|$)/i, "J", "재규어", "oe"],
  /**
   * 🔴 BMW 별표는 **홀로 선 `*`** 일 때만이다.
   *    한국타이어 모델명에 별이 들어간다 — `i*cept`, `i*Pike`.
   *    전에는 아무 데나 있는 `*` 를 잡아서 `iON i*cept IW01` 이
   *    `iON IW01` 로 뭉개졌다 (2026-08-02 사장님 지적으로 발견).
   */
  [/(^|\s)\*(\s|$)/, "★", "BMW", "oe"],

  // ── 구조 표기 ─────────────────────────────────────────
  [/(^|[\s(])(XL|EXTRA\s+LOAD)([\s)]|$)/i, "XL", "하중강화", "structure"], // 3,382
  [/(^|[\s(])FR([\s)]|$)/i, "FR", "림보호", "structure"], // 733 콘티넨탈·제네럴
  [/(^|[\s(])(\d)P([\s)]|$)/i, "PLY", "겹수", "structure"], // 4P/8P 넥센·한국
  [/(^|[\s(])LT([\s)]|$)/i, "LT", "소형트럭", "structure"],
  [/(^|[\s(])SL([\s)]|$)/i, "SL", "표준하중", "structure"],
];

/**
 * ⭐ 배지로 뽑았더라도 **모델명에 그대로 남겨야** 하는 것 (사장님 지적 2026-08-02)
 *
 * 한국·금호는 「모델명 + 모델코드」 순서로 짓는다 —
 *   `Ventus S2 AS H462` · `Solus TA31` · `Majesty Solus EDGE TA91+`
 * 그 순서를 흐트러뜨리면 사장님이 아는 이름이 아니게 된다.
 * `Vantra LT RA18` 의 LT 를 배지로 떼서 `Vantra RA18` 이 된 적이 있다.
 * (맨 앞에 홀로 오는 LT 는 미쉐린 규격 표기 `LT265/70R17` 의 잔해라 뺀다)
 */
const KEEP_IN_MODEL = /^(LT)$/i;

/**
 * 금호가 모델명 뒤에 붙여 놓는 겹수(ply) — `Solus TA31 98V **04**` · `Road Venture MT **06**`
 * 0 을 채운 두 자리이거나 10·12·14·16, 혹은 4·6·8 이다.
 * 홀수(`Majesty **9** Solus`)는 세대 번호이므로 건드리지 않는다.
 */
const PLY_TOKEN = /^(0[468]|1[0246]|[468])$/;

/** 배지로 뽑고 나면 모델명에서 지워야 하는 토큰 (브랜드 접미·튜브리스 등) */
const DROP_TOKENS =
  /^(MI|GO|TL|TUBELESS|MICHELIN|HANKOOK|PIRELLI|CONTINENTAL|KUMHO|NEXEN|BRIDGESTONE|GOODYEAR|BFGOODRICH|GENERAL)$/i;

/**
 * ⭐ MARS 상품명 끝의 브랜드 접미 (사장님 확인 2026-08-01)
 *
 *   MI → 미쉐린 · GO → BFGoodrich (미쉐린 자회사)
 *
 * 🔴 그런데 **`brand_code` 가 틀려 있다.** `GO` 로 끝나는 64건 중 58건이
 *    `MI`(미쉐린)로 분류돼 있는데, 모델명은 `ADVANTAGE T/A DRIVE`,
 *    `ALL-TERRAIN T/A KO3` 처럼 전부 BFGoodrich 라인업이다.
 *    (`T/A` 가 든 259건 중 221건이 MI 로 잘못 잡혀 있다)
 *    브랜드 코드를 함부로 고치지 않고, **화면 표시만** 바로잡는다.
 */
const BRAND_SUFFIX: [RegExp, string][] = [
  [/(^|\s)GO\s*$/i, "BFGoodrich"],
  [/(^|\s)MI\s*$/i, "미쉐린"],
];

/**
 * 접미가 없어도 모델명으로 알 수 있는 브랜드.
 * `T/A` 는 BFGoodrich 전용 표기다 — All-Terrain T/A · Mud-Terrain T/A ·
 * Advantage T/A · Trail-Terrain T/A(TRTERTA). 미쉐린 라인업에는 T/A 가 없다.
 */
const BRAND_MODEL: [RegExp, string][] = [[/\bT\s*\/\s*A\b/i, "BFGoodrich"]];

function detectBrandSuffix(pattern: string | null): string | null {
  const p = String(pattern ?? "").trim();
  if (!p) return null;
  // 접미가 가장 확실하다 (GO 를 MI 보다 먼저 본다)
  for (const [re, name] of BRAND_SUFFIX) if (re.test(p)) return name;
  for (const [re, name] of BRAND_MODEL) if (re.test(p)) return name;
  return null;
}

/**
 * ⭐ MARS 축약 표기 → 정식 모델명 (사장님 요청 2026-08-01)
 *
 * MARS 원문에는 `PRIMTOURAS`, `CROSCLISUV`, `PILSP3` 같은 축약이 섞여 있다.
 * 미쉐린 주문 사이트(mymichelin)는 정식 이름으로 표기하므로, 주문할 때
 * 대조하려면 우리도 정식 이름이어야 한다.
 *
 * 긴 것부터 치환한다 (PRIMTOURAS 를 PRIM 보다 먼저).
 */
const MODEL_ALIASES: [RegExp, string][] = [
  [/\bPRIMTOURAS\b/gi, "PRIMACY TOUR A/S"],
  [/\bENRGYSVRAS\b/gi, "ENERGY SAVER A/S"],
  [/\bENRGYSVR\b/gi, "ENERGY SAVER"],
  [/\bCROSCLISUV\b/gi, "CROSSCLIMATE SUV"],
  [/\bCROSSCLIMATE2\b/gi, "CROSSCLIMATE 2"],
  [/\bPILSPOR4S\b/gi, "PILOT SPORT 4 S"],
  [/\bPILSP(\d)\b/gi, "PILOT SPORT $1"],
  [/\bP\s+SPT\s+CUP\s*2\b/gi, "PILOT SPORT CUP 2"],
  [/\bPREMLTX\b/gi, "PREMIER LTX"],
  [/\bLATTOURHP\b/gi, "LATITUDE TOUR HP"],
  [/\bADVTOUR\b/gi, "ADVANTAGE TOURING"],
  [/\bEXM2\+*/gi, "ENERGY XM2+"],
  [/\bPCY(\d)\b/gi, "PRIMACY $1"],
  [/\bPSS\b/gi, "PILOT SUPER SPORT"],
  [/\bPS(\d)\b/gi, "PILOT SPORT $1"],
  [/\bPRIM\s+MXM4\b/gi, "PRIMACY MXM4"],
  [/\bPRIM\b/gi, "PRIMACY"],
  [/\bPCY\b/gi, "PRIMACY"],
  [/\bCNT\b/gi, "CONNECT"],
];

export function expandModel(s: string): string {
  let out = s;
  for (const [re, to] of MODEL_ALIASES) out = out.replace(re, to);
  return out.replace(/\s{2,}/g, " ").trim();
}

/** 브랜드 접두어 — raw_name 맨 앞에 붙는다 */
const BRAND_PREFIX =
  /^(michelin|hankook|pirelli|continental|kumho|nexen|bridgestone|goodyear|bfgoodrich|general|dunlop|laufenn)\s+/i;

export interface TireName {
  /** ⭐ 화면 제목 — "E PRIMACY" 처럼 짧게 */
  model: string;
  /** "245/60R18" */
  spec: string | null;
  /** "105H" — 하중지수 + 속도지수 */
  loadSpeed: string | null;
  /** 런플랫·흡음재·OE 등 세부사항 */
  badges: Badge[];
  /** 사전에 없는 코드. 버리지 않는다 */
  unknown: string[];
  /** MARS 입력용 원본 (절대 바꾸지 않는다) */
  marsName: string;
  /** ⭐ 미쉐린 주문 사이트 표기 형태 — 주문 화면과 대조할 때 쓴다 */
  orderName: string;
  /** 상품명 접미로 알아낸 실제 브랜드. brand_code 가 틀린 경우를 잡는다 */
  brandHint: string | null;
}

/**
 * 붙어 있는 표기를 띄어 놓는다.
 * MARS 원문에는 `XLTL`, `104YXLTL`, `97HTLPRIM` 처럼 붙은 것이 흔하다.
 * ⚠️ 이 처리를 **배지 추출 전에** 해야 한다. `XLTL` 상태로는 XL 이 안 잡혀서
 *    배지에도 없고 모델명에는 남는다 — 실제로 그런 버그가 났다 (2026-08-01).
 */
/** 붙어 올 수 있는 코드들 — 순서 중요(긴 것 먼저) */
const CODE_ALT = "MOE|MO1|MO|GRNX|CPJ|ZPS|ZP|ACOUSTIC|AC|DT|GOE|GO|AO|VOL|MI";
const GLUED_RUN = new RegExp(`(?:${CODE_ALT}){2,}`, "g");
const ONE_CODE = new RegExp(`^(?:${CODE_ALT})`);

function loosen(s: string): string {
  let out = String(s ?? "")
    .replace(/\bXLTL\b/gi, " XL TL ")
    .replace(/(\d{2,3}[A-Z]{1,2})(XL|TL)/gi, " $1 $2 ") // 104YXL · 97HTLPRIM
    .replace(/\b(XL|TL)(?=[A-Z]{3,})/gi, " $1 ") // TLPRIM → TL PRIM
    .replace(/\bEXTRA\s+LOAD\b/gi, " XL ");

  /**
   * 마킹이 통째로 붙어 오는 경우가 있다 — `MOGRNXCPJMI`, `GRNXCPJMI`, `MOMI`.
   *
   * ⚠️ 코드를 하나씩 떼면 **멀쩡한 단어가 잘린다.** `PRIMACY` 안의 `AC` 를 떼어
   *    `PRIMAC Y` 가 된 적이 있다 (2026-08-01).
   *    그래서 **코드가 2개 이상 연달아 붙은 덩어리**만 골라 그 안에서 나눈다.
   */
  out = out.replace(GLUED_RUN, (m) => {
    const parts: string[] = [];
    let rest = m;
    while (rest) {
      const hit = ONE_CODE.exec(rest);
      if (!hit) break;
      parts.push(hit[0]);
      rest = rest.slice(hit[0].length);
    }
    return ` ${parts.join(" ")} ${rest} `;
  });
  return out.replace(/\s{2,}/g, " ");
}

/**
 * 규격 표기를 걷어낸다.
 * ⚠️ **반드시 loosen 보다 먼저** 돌려야 한다. 순서가 거꾸로면
 *    `235/45R1797HXLTL` 에서 정규식이 규격의 마지막 자리까지 먹어
 *    `235/45R1` 같은 잔해가 남는다 (2026-08-01에 실제로 그랬다).
 */
function stripSpec(s: string): string {
  return String(s ?? "")
    .replace(/\d{3}\s*\/\s*\d{2,3}\s*(Z|W|Y)?\s*R\s*F?\s*\d{2}(\.\d)?/gi, " ")
    .replace(/\d{2}(\.\d+)?\s*[X×]\s*\d{1,2}(\.\d+)?\s*R\s*\d{2}/gi, " ") // 31X10.50R15
    // 편평비 없는 밴·소형트럭 규격 — 금호 Portran 계열에 많다 (185R14 · 145R13C)
    .replace(/\b\d{3}\s*R\s*\d{2}C?\b/gi, " ")
    .replace(/\(\s*\d{2,3}\/?\d{0,3}\s*[A-Z]{1,2}\s*\)/gi, " ") // (104Y)
    .replace(/\b\d{2,3}\/\d{2,3}[A-Z]{1,2}\b/g, " ") // 120/116Q
    .replace(/\b\d{2,3}[A-Z]{1,2}\b/g, " "); // 104Y
}

/**
 * 화면·배지용 정규화 문자열.
 * 규격 제거 → 붙은 것 띄우기 → **한 번 더** 규격 제거.
 * 두 번 하는 이유: `104YXLTL` 은 붙어 있는 동안 하중지수로 안 잡힌다.
 * 띄운 뒤에야 `104Y` 가 보인다.
 */
function clean(s: string): string {
  return stripSpec(loosen(stripSpec(s)))
    .replace(/[()]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * 화면에 쓸 이름을 만든다.
 * @param rawName MARS 「상세 항목 및 서비스」
 * @param pattern MARS 「설명 2」
 * @param spec    파싱된 규격 (width/aspect/rim) — 있으면 표준 형태로 표시
 */
export function parseTireName(
  rawName: string,
  pattern: string | null,
  spec?: {
    width: number | null;
    aspectRatio: number | null;
    rimInch: string | number | null;
    /** 브랜드마다 이름 짓는 법이 다르다 — 아래 KEEP_IN_MODEL·PLY_TOKEN 참조 */
    brandCode?: string | null;
  },
): TireName {
  const marsName = String(rawName ?? "").trim();
  // 배지 추출도 규격을 걷고 띄어쓰기를 푼 뒤에 한다 ((97Y)XL · XLTL · MOGRNXCPJMI)
  const src = clean(`${pattern ?? ""} ${marsName}`);

  // ── 배지 뽑기 ──
  const badges: Badge[] = [];
  const seen = new Set<string>();
  for (const [re, code, label, kind] of CODES) {
    if (re.test(src) && !seen.has(code)) {
      seen.add(code);
      badges.push({ code, label, kind });
    }
  }

  // ── 규격 · 하중/속도 ──
  // 편평비 없는 밴 규격(145R13)은 편평비 자리를 비우고 적는다 (2026-08-03)
  // ⭐ 편평비 80 도 생략한다 (사장님 지시 2026-08-08) — MARS 의 145/80R13 은
  //    우리 화면에선 145R13 으로. 그 표기 자체가 80 을 뜻한다.
  const displaySpec =
    spec && spec.width && spec.rimInch !== null
      ? spec.aspectRatio && spec.aspectRatio !== 80
        ? `${spec.width}/${spec.aspectRatio}R${Number(spec.rimInch)}`
        : `${spec.width}R${Number(spec.rimInch)}`
      : null;

  /**
   * 하중지수+속도기호는 raw_name 쪽이 정확하다 ("105H", "120/116Q").
   * 🔴 규격을 **먼저 지워야** 한다. 안 지우면 `145 R 13` 의 `145`+`R` 을
   *    하중지수로 읽어 화면에 「145R」 이 찍힌다 (사장님 지적 2026-08-03).
   */
  const ls = /(\d{2,3}(?:\/\d{2,3})?)\s*([A-Z]{1,2})(?=\s|$)/.exec(
    marsName
      .replace(BRAND_PREFIX, "")
      .replace(/\d{3}\s*\/\s*\d{2,3}\s*Z?R\s*\d{2}(\.\d)?/i, " ")
      .replace(/\d{3}\s*R\s*\d{2}(\.\d)?\s*C?/i, " "),
  );
  const loadSpeed = ls ? `${ls[1]}${ls[2].toUpperCase()}` : null;

  // ── 모델명 ──
  // pattern 이 없으면 raw_name 에서 규격을 걷어낸 나머지가 모델명이다
  const base = pattern?.trim() || marsName.replace(BRAND_PREFIX, "");
  const words = clean(base)
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  const isKumho = String(spec?.brandCode ?? "").toUpperCase() === "KM";

  const modelWords: string[] = [];
  const unknown: string[] = [];
  for (const w of words) {
    if (DROP_TOKENS.test(w)) continue;
    /**
     * ⭐ 금호는 모델명 뒤에 겹수(ply)를 그대로 붙여 놓는다 (사장님 확인 2026-08-02).
     *   `235/55 R16 Solus TA31 98V 04` 의 `04`, `Road Venture MT 104Q 06` 의 `06`.
     *   모델명이 아니므로 배지로 뺀다.
     *
     * 🔴 금호에만 적용한다. 다른 브랜드는 끝의 숫자가 **세대 번호**다 —
     *    CROSSCLIMATE **2** · PILOT SPORT **4** S. 떼면 서로 다른 타이어가
     *    화면에 같은 이름으로 나온다 (2026-08-01에 실제로 그랬다).
     */
    const pr = /^(\d{1,2})PR?$/i.exec(w); // 8P (한국·넥센) · 12PR (금호 밴)
    const ply = pr ? Number(pr[1]) : isKumho && modelWords.length > 0 && PLY_TOKEN.test(w) ? Number(w) : null;
    if (ply !== null && ply <= 20) {
      if (!seen.has("PLY#")) {
        seen.add("PLY#");
        // 화면에는 `4P` 로만 (사장님 지시 2026-08-07 — 「4P 4겹 (ply)」는 길다, 간단하게 4P)
        // code === label 이면 화면이 코드만 그린다 (cards.tsx · stock/[id])
        badges.push({ code: `${ply}P`, label: `${ply}P`, kind: "structure" });
      }
      continue;
    }
    // 배지로 이미 뽑은 코드는 모델명에서 뺀다
    const isBadge = CODES.some(([re, code]) => seen.has(code) && re.test(` ${w} `));
    if (isBadge) {
      // 모델명의 일부이기도 한 코드는 배지로도 띄우고 이름에도 남긴다 (Vantra **LT** RA18)
      if (KEEP_IN_MODEL.test(w) && modelWords.length > 0) modelWords.push(w);
      continue;
    }
    /**
     * ⚠️ 숫자는 모델명의 일부다. CROSSCLIMATE **2** · PILOT SPORT **4** S · E. F1 ASY **3**.
     *    이걸 코드로 오인해서 떼면 서로 다른 세대가 화면에 같은 이름으로 나온다.
     *    실제로 그런 버그가 났다 (2026-08-01).
     *    정말 알 수 없는 것(내부 일련번호 `_242407` 같은 것)만 따로 뺀다.
     */
    if (/_/.test(w) || /^[A-Z]{2,}\d{5,}$/i.test(w)) {
      unknown.push(w);
      continue;
    }
    modelWords.push(w);
  }

  // 숫자 있는 겹수를 찾았으면 밋밋한 `PLY` 배지는 지운다
  if (seen.has("PLY#")) {
    const i = badges.findIndex((b) => b.code === "PLY");
    if (i >= 0) badges.splice(i, 1);
  }

  /**
   * 같은 코드가 두 번 적힌 것을 하나로 줄인다.
   * MARS 에 `Winter i*Pike LV(RW15) RW15` 처럼 모델코드를 괄호로도, 뒤에도 적어 놓은 것이 있다.
   */
  const dedup = modelWords.filter((w, i) => i === 0 || w.toUpperCase() !== modelWords[i - 1].toUpperCase());

  let model = expandModel(dedup.join(" "));
  if (!model) model = pattern?.trim() || marsName;

  /**
   * ⭐ 미쉐린 주문 사이트(mymichelin) 표기 형태로도 만들어 둔다 (2026-08-01).
   * 주문할 때 화면끼리 대조해야 하므로 같은 순서로 적는다:
   *   "245/45R18 96V TL PRIMACY A/S"
   *   규격 → 하중속도 → XL → TL → 모델명 → 마킹
   */
  const orderParts: string[] = [];
  if (displaySpec) orderParts.push(displaySpec);
  if (loadSpeed) orderParts.push(loadSpeed);
  if (badges.some((b) => b.code === "XL")) orderParts.push("XL");
  if (/\bTL\b/i.test(src)) orderParts.push("TL");
  orderParts.push(model);
  for (const b of badges) {
    if (b.kind === "oe" || b.kind === "runflat" || b.code === "GRNX" || b.code === "AC") {
      orderParts.push(b.code === "★" ? "*" : b.code);
    }
  }
  const orderName = orderParts.join(" ");

  return {
    model,
    spec: displaySpec,
    loadSpeed,
    badges,
    unknown,
    marsName,
    orderName,
    brandHint: detectBrandSuffix(pattern),
  };
}

/**
 * ⭐ 표준 표시 이름 (사장님 승인 2026-08-08 — 품목명 통일 1·2단계)
 *
 *   모델명 + 사전에 없는 표기 + **겹수(ply)** + **OE 마킹**
 *
 * 🔴 OE 마킹과 겹수는 이름에 반드시 남긴다 (사장님 2026-08-08):
 *    "같은 모델이더라도 OE 마킹에 따라서 구분되는 경우도 가끔 있음.
 *     ply 수에 따라서 달라지는 경우도 있음."
 *    PRIMACY 4 MO ≠ PRIMACY 4 ★, Solus TA21 4P ≠ 6P — 배지로만 빼면
 *    이름만 보이는 화면(리포트·정비 내역 줄)에서 다른 상품이 같은 이름이 된다.
 *
 * 🔴 세대·강화판 표기를 「같은 모델」로 합치지 않는다 (사장님 2026-08-08):
 *    TA91 의 강화판이 Solus **EDGE** TA91(향간 표기 TA91+)로 나왔지만 여전히
 *    TA91 로 불리고, 원래 TA91 도 아직 있다. TA51 도 **ADVANCE** 가 강화판.
 *    → EDGE·ADVANCE·+ 같은 말은 모델명의 일부다. 나중에 축약 사전을 만들 때도
 *      이런 세대 표기를 정규화한다고 지우면 안 된다.
 *
 * 규격·하중속도는 이름에 넣지 않는다 — 화면이 따로 칸을 갖고 있다.
 * 그래도 겹치는 상품은 backfill-display-names.ts 가 XL·런플랫 등을 덧붙인다.
 */
export function cleanTireName(n: TireName): string {
  const ply = n.badges.filter((b) => b.kind === "structure" && /^\d+P$/.test(b.code)).map((b) => b.code);
  const oe = n.badges.filter((b) => b.kind === "oe").map((b) => (b.code === "★" ? "★" : b.code));
  return [n.model, ...n.unknown, ...ply, ...oe]
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 배지 색 — 종류별로 눈에 다르게 걸리게 */
export const BADGE_STYLE: Record<BadgeKind, string> = {
  runflat: "bg-violet-100 text-violet-800",
  feature: "bg-indigo-100 text-indigo-800",
  oe: "bg-amber-100 text-amber-900",
  structure: "bg-slate-100 text-slate-600",
};

/** CAI(미쉐린 고유번호) 로 볼 수 있는 입력인가. MARS 번호는 5~6자리다 */
export function looksLikeCai(q: string): boolean {
  return /^\d{5,6}$/.test(q.trim());
}

/** ⭐ 배치2 — 카테고리 배지 테두리형(글자색만). 채움형 BADGE_STYLE 은 다른 화면이 아직 씀(배치4 이관) */
export const BADGE_TEXT: Record<BadgeKind, string> = {
  runflat: "text-violet-700",
  feature: "text-slate-600",
  oe: "text-amber-700",
  structure: "text-slate-500",
};
