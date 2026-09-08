/**
 * 사장님이 친 것을 **정본 표기**로 바꾼다 (2026-09-08, 사장님 지시)
 *
 * 「니가 폼을 만들어주면 내가 찾아서 넣어볼게. 그대신 규격은 일정해야하니까
 *  어떤 쓰는 방법이나 타이어 규격이나 오일 규격 등 여러가지 제원의 단위나 표기방식이 일정해야함.」
 *
 * 🔴 **모양만 다듬는다. 값을 고쳐서 통과시키지 않는다.**
 *    `235/60 r18` → `235/60R18` 은 같은 값을 다르게 적은 것이라 바꿔도 된다.
 *    범위를 벗어난 값은 **막는다** — 잘라서 넣으면 틀린 값이 깨끗해 보이기만 한다.
 *
 * 🔴 **왜 틀렸는지 사장님이 읽을 한 줄로 돌려준다.** 「형식 오류」는 아무 도움이 안 된다.
 *    「승용차 kgf·m 는 8~20 입니다. N·m 을 고르셨는지 봐 주세요」라고 적어야 고치신다.
 *
 * 🔴 **순수하다** — `@/db` 도 React 도 들이지 않는다. 화면과 시험과 정리 스크립트가 같이 쓴다.
 */
import {
  SPEC_CHOICES,
  VISCOSITIES,
  bothUnits,
  looksLikeTireSize,
  normalizeUnit,
  specItem,
} from "@/lib/spec-core";

export interface Canonical {
  ok: boolean;
  /** 화면에 보여 줄 글자 — 「이렇게 저장됩니다」 */
  display: string | null;
  /** DB 의 text_value (글자 항목) */
  textValue: string | null;
  /** DB 의 num_min / num_max (숫자 항목) */
  numMin: number | null;
  numMax: number | null;
  unit: string | null;
  /** 왜 안 되는지 / 무엇을 봐야 하는지 — 사장님이 읽을 한 줄 */
  why: string | null;
}

const fail = (why: string): Canonical => ({
  ok: false,
  display: null,
  textValue: null,
  numMin: null,
  numMax: null,
  unit: null,
  why,
});

/**
 * 정본으로 바꾼다.
 * @param item  SPEC_ITEMS 의 key
 * @param raw   사장님이 친 글자
 * @param unit  숫자 항목에서 고르신 단위
 * @param opts  차체 종류(휠너트 토크 범위가 갈린다)
 */
export function canonical(
  item: string,
  raw: string,
  unit?: string | null,
  opts?: { bodyType?: string | null },
): Canonical {
  const def = specItem(item);
  if (!def) return fail("모르는 항목입니다");
  const s = String(raw ?? "").trim();
  if (!s) return fail("값을 넣어 주세요");

  /* 고르기로만 받는 항목 — 목록 밖은 안 받는다 */
  const choices = SPEC_CHOICES[item];
  if (choices) {
    const hit = choices.find((c) => c === s) ?? choices.find((c) => c.replace(/\s/g, "") === s.replace(/\s/g, ""));
    if (!hit) return fail(`${choices.join(" · ")} 중에서 골라 주세요`);
    return { ok: true, display: hit, textValue: hit, numMin: null, numMax: null, unit: null, why: null };
  }

  if (def.numeric) return numericValue(item, s, unit, opts);
  return textValue(item, s);
}

/* ────────────────────────────────────────────────────────────────────
 * 글자 항목
 * ──────────────────────────────────────────────────────────────────── */

function textValue(item: string, s: string): Canonical {
  const made = shapeText(item, s);
  if (typeof made === "string") {
    return { ok: true, display: made, textValue: made, numMin: null, numMax: null, unit: null, why: null };
  }
  return made;
}

function ok(v: string): Canonical {
  return { ok: true, display: v, textValue: v, numMin: null, numMax: null, unit: null, why: null };
}

function shapeText(item: string, s: string): string | Canonical {
  switch (item) {
    case "tire_size":
      return tireSize(s);
    case "wheel_size":
      return wheelSize(s);
    case "engine_oil_viscosity":
      return viscosity(s);
    case "brake_fluid_spec":
      return brakeFluid(s);
    case "battery_size":
      return batterySize(s);
    case "engine_oil_spec":
    case "transmission_oil_spec":
      return tidySpec(s);
    /* 브랜드·패턴·그 밖 — 공백만 정리한다 */
    default:
      return s.replace(/\s+/g, " ").trim();
  }
}

/**
 * `235/60 r18` · `235/60-R18` · `p235/60r18xl` → `235/60R18` · `235/60R18 XL`
 * 🔴 접두 `P`·`LT` 와 접미 `C`·`XL`·`RF` 는 **뜻이 있다** — 떼지 않는다.
 *    `LT` 는 화물용, `C` 는 승합·화물, `XL` 은 강화 타이어다.
 */
function tireSize(s: string): string | Canonical {
  const up = s.toUpperCase().replace(/\s+/g, " ").trim();
  const m = /^(\(?P\)?|LT)?\s*(\d{2,3})\s*\/\s*(\d{2})\s*[-\s]*([RZ])\s*(\d{2}(?:\.\d)?)\s*(C|LT|XL|RF)?$/.exec(up);
  if (!m) {
    return fail("타이어 규격은 「235/60R18」처럼 넣어 주세요");
  }
  const head = m[1] ? m[1].replace(/[()]/g, "") : "";
  const made = `${head}${m[2]}/${m[3]}${m[4]}${m[5]}${m[6] ? ` ${m[6]}` : ""}`;
  /* 🔴 모양이 맞아도 말이 되는 숫자인지 다시 본다 (spec-core 의 상식 범위) */
  if (!looksLikeTireSize(made.replace(/\s(C|LT|XL|RF)$/, ""))) {
    return fail("타이어 규격의 숫자가 상식 밖입니다 — 폭·편평비·인치를 다시 봐 주세요");
  }
  return made;
}

/** `7.5j x 18` · `8.5J×20` · `7.5J18` → `7.5Jx18` */
function wheelSize(s: string): string | Canonical {
  const up = s.toUpperCase().replace(/\s+/g, "");
  const m = /^(\d{1,2}(?:\.\d)?)J[X×*-]?(\d{2}(?:\.\d)?)$/.exec(up);
  if (!m) return fail("휠 규격은 「7.5Jx18」처럼 넣어 주세요 (J 가 있어야 합니다)");
  const width = Number(m[1]);
  const inch = Number(m[2]);
  if (width < 4 || width > 14) return fail("휠 폭이 상식 밖입니다 (4~14J)");
  if (inch < 12 || inch > 24) return fail("휠 인치가 상식 밖입니다 (12~24)");
  return `${m[1]}Jx${m[2]}`;
}

/** `0w20` · `0W20` · `0 w 20` → `0W-20` */
function viscosity(s: string): string | Canonical {
  const up = s.toUpperCase().replace(/\s+/g, "");
  const m = /^(\d{1,2})W-?(\d{1,2})$/.exec(up);
  const made = m ? `${m[1]}W-${m[2]}` : up;
  if (!VISCOSITIES.includes(made)) {
    return fail(`쓰는 점도가 아닙니다. ${VISCOSITIES.slice(0, 6).join(" · ")} … 중에서 넣어 주세요`);
  }
  return made;
}

/**
 * `dot4` · `DOT-4` · `DOT 4 LV` → `DOT 4` · `DOT 4 LV`
 *
 * 🔴 **설명서에서 옮겨 온 값은 문장이다** — 「SAE J1704 DOT-4 LV, ISO4925 CLASS-6,
 *    FMVSS 116 DOT-4」. 여기서 `DOT 4 LV` 만 뽑아 내면 나머지 규격 정보를 버리는 것이다.
 *    그래서 **짧은 코드면 정본으로 줄이고, 문장이면 띄어쓰기만 정리해 그대로 둔다.**
 *    (2026-09-08, 실제 값 8건에 걸려 알았다)
 */
function brakeFluid(s: string): string | Canonical {
  const up = s.toUpperCase().replace(/\s+/g, " ").trim();
  const m = /^DOT[\s-]?(3|4|5\.1|5)\s*(LV)?$/.exec(up);
  if (m) return `DOT ${m[1]}${m[2] ? " LV" : ""}`;
  /* 문장이어도 DOT 등급이 들어 있으면 브레이크액 규격이 맞다 */
  if (/DOT[\s-]?(3|4|5\.1|5)\b/.test(up)) return tidySpec(s);
  return fail("브레이크액은 「DOT 4」·「DOT 4 LV」처럼 넣어 주세요");
}

/**
 * `agm 80l` · `AGM-80L` · `din 80 l` → `AGM80L` · `DIN80L`
 * 🔴 **단자 방향(L/R)이 없으면 안 받는다.** 틀리면 케이블이 안 닿는다.
 */
function batterySize(s: string): string | Canonical {
  const up = s.toUpperCase().replace(/[\s-]+/g, "");
  const m = /^(AGM|DIN|CMF|MF|EFB)?(\d{2,3})([LR])$/.exec(up);
  if (!m) {
    return fail("배터리 규격은 「AGM80L」·「DIN80L」처럼 형식+용량+단자방향(L/R)으로 넣어 주세요");
  }
  return `${m[1] ?? ""}${m[2]}${m[3]}`;
}

/**
 * 오일·변속기유 **규격은 띄어쓰기만 정리한다.**
 *
 * 🔴 처음엔 대문자와 쉼표로 통일하려 했다가 **실제 값에 돌려 보고 물렀다** (2026-09-08).
 *    이건 짧은 코드가 아니라 **제조사가 쓴 문장**이라 손대면 뜻이 바뀐다:
 *      `API SN PLUS/SP 또는 ILSAC GF-6` → `API SN PLUS, SP, ILSAC GF-6`
 *        「SN PLUS 또는 SP」가 **두 개의 별개 규격**이 돼 버린다
 *      `Genesis/HYUNDAI genuine ATF SP-IV-RR` → 뒤의 규격이 앞 이름에서 떨어져 나간다
 *      `DCTF (H.K.SHELL),7 DCTF PLUS` → 상품 이름 안의 빗금까지 잘린다
 *
 *    타이어 규격(`235/60R18`)처럼 **모양이 정해진 것**만 정본으로 바꾼다.
 *    「틀린 값을 깨끗해 보이게 만들지 않는다」가 이 파일의 규칙이고, 여기도 같다.
 */
function tidySpec(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();
}

/* ────────────────────────────────────────────────────────────────────
 * 숫자 항목
 * ──────────────────────────────────────────────────────────────────── */

/** `11~13` · `11-13` · `40±5` · `6.1` */
function readRange(s: string): { min: number; max: number | null } | null {
  const t = s.replace(/\s+/g, "");
  const pm = /^(\d{1,4}(?:\.\d+)?)[±+\-]\/?[-]?(\d{1,3}(?:\.\d+)?)$/.exec(t.replace("±", "±"));
  if (t.includes("±")) {
    const m = /^(\d{1,4}(?:\.\d+)?)±(\d{1,3}(?:\.\d+)?)$/.exec(t);
    if (m) return { min: Number(m[1]) - Number(m[2]), max: Number(m[1]) + Number(m[2]) };
  }
  const r = /^(\d{1,4}(?:\.\d+)?)\s*[~–—-]\s*(\d{1,4}(?:\.\d+)?)$/.exec(t);
  if (r) {
    const a = Number(r[1]);
    const b = Number(r[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const one = /^(\d{1,4}(?:\.\d+)?)$/.exec(t);
  if (one) return { min: Number(one[1]), max: null };
  void pm;
  return null;
}

function numericValue(item: string, s: string, unitRaw: string | null | undefined, opts?: { bodyType?: string | null }): Canonical {
  const def = specItem(item)!;

  /* 값 안에 단위가 같이 적혀 있으면 그걸 쓴다 — 「35 psi」·「2.4 bar」 */
  let body = s;
  let unit = normalizeUnit(unitRaw ?? "");
  const withUnit = /^(.*?)\s*([a-zA-Z가-힣·.]+)$/.exec(s.trim());
  if (withUnit) {
    const maybe = normalizeUnit(withUnit[2]);
    if (maybe) {
      body = withUnit[1];
      unit = maybe;
    }
  }
  if (!unit) unit = def.units[0] ?? null;
  if (!unit) return fail("단위를 고를 수 없는 항목입니다");
  if (!def.units.includes(unit)) {
    /* bar 로 넣으신 공기압은 kPa 로 바꿔 받는다 — 흔한 표기다 */
    if (unit === "bar" && def.units.includes("kPa")) {
      const got = readRange(body);
      if (!got) return fail("숫자를 읽지 못했습니다");
      return numericValue(item, `${got.min * 100}${got.max === null ? "" : `~${got.max * 100}`}`, "kPa", opts);
    }
    return fail(`${def.label} 의 단위는 ${def.units.join(" 또는 ")} 입니다`);
  }

  const got = readRange(body);
  if (!got) return fail("숫자를 읽지 못했습니다 — 「35」·「11~13」·「40±5」처럼 넣어 주세요");

  /* 🔴 차체별 범위가 있으면 그걸 먼저 본다 — 화물차는 승용의 두 배다 */
  const band =
    (opts?.bodyType && def.rangeByBody?.[opts.bodyType]?.[unit]) ?? def.range?.[unit] ?? null;
  if (band) {
    const bad = got.min < band.min || got.min > band.max || (got.max !== null && (got.max < band.min || got.max > band.max));
    if (bad) return fail(rangeWhy(def.label, unit, band, def, opts?.bodyType ?? null));
  }
  if (got.max !== null && got.max < got.min) return fail("앞의 값이 뒤의 값보다 큽니다");

  /* 공기압은 psi 를 앞에 보여 드린다 */
  const prefer = item === "tire_pressure" ? "psi" : undefined;
  return {
    ok: true,
    display: bothUnits(got.min, got.max, unit, prefer),
    textValue: null,
    numMin: got.min,
    numMax: got.max,
    unit,
    why: null,
  };
}

/**
 * 상품 이름에서 **패턴명만** 남긴다 (2026-09-08).
 *
 * 우리 상품의 `pattern` 칸에 규격과 하중·속도 기호가 섞여 들어간 줄이 있다:
 *   「235/45R18 Majesty 9 Solus TA91」 → 「Majesty 9 Solus TA91」
 *   「245/40 R20 99Y XL TL PILOT SPORT」 → 「PILOT SPORT」
 *
 * 🔴 **못 알아보면 원래 글자를 그대로 둔다.** 지워서 빈 값을 만들면 패턴을 잃는다.
 */
export function cleanPattern(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  /* 앞에 붙은 규격 — 「235/45R18」·「245/40 ZR20」·「205/55 R16」 */
  s = s.replace(/^\s*\(?[PL]?T?\)?\s*\d{3}\s*\/\s*\d{2}\s*[ZR]{0,2}\s*\d{2}(\.\d)?\s*/i, "");
  /* 하중·속도 기호와 흔한 꼬리표 — 「99Y」·「(99Y)」·「91H」·XL·TL·EXTRA LOAD */
  s = s
    .replace(/\(?\b\d{2,3}\s?[A-Z]\b\)?/g, " ")
    .replace(/\b(XL|TL|RF|EXTRA\s*LOAD|REINFORCED)\b/gi, " ")
    .replace(/\s+\d{2}\s*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length >= 2 ? s : String(raw).trim();
}

/**
 * 범위를 벗어났을 때 **무엇을 봐야 하는지** 적어 준다.
 * 🔴 같은 숫자가 다른 단위 범위에는 딱 맞으면 그걸 짚어 준다 —
 *    `110 kgf·m` 은 거의 언제나 `110 N·m` 을 잘못 고르신 것이다.
 */
function rangeWhy(
  label: string,
  unit: string,
  band: { min: number; max: number },
  def: { units: string[]; range?: Record<string, { min: number; max: number }>; rangeByBody?: Record<string, Record<string, { min: number; max: number }>> },
  bodyType: string | null,
): string {
  const who = bodyType ? `${bodyType} ${label}` : label;
  const head = `${who}${eunNeun(who)} ${unit} 로 ${band.min}~${band.max} 입니다`;
  const other = def.units.find((u) => u !== unit);
  if (other) return `${head}. ${other}${eulReul(other)} 고르셨는지 봐 주세요`;
  return head;
}

/**
 * 「토크는」·「용량은」 — 받침에 따라 조사를 고른다.
 * 🔴 「토크 는」처럼 띄어 쓰면 사장님이 읽기에 어색하다. 화면 글은 사람 말이어야 한다.
 */
function hasBatchim(word: string): boolean {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  /* 한글이 아니면(N·m 같은 영문·기호) 받침이 있는 것처럼 다룬다 — 「N·m 을」이 자연스럽다 */
  if (code < 0xac00 || code > 0xd7a3) return true;
  return (code - 0xac00) % 28 !== 0;
}
const eunNeun = (w: string) => (hasBatchim(w) ? "은" : "는");
const eulReul = (w: string) => (hasBatchim(w) ? "을" : "를");
