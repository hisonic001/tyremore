/**
 * ⭐ 금호 품목명 규칙 (사장님 요청 2026-08-27 — "품목명들을 전부 규칙이 있었으면 좋겠어")
 *
 *   이름 = 모델명 [+ 겹수(상용만)] [+ (차종 주석)]
 *
 * 왜 필요했나: 활성 금호 558품목에 이름이 **79가지**였다. 같은 패턴인데 KC53 은 10가지,
 * TA91 은 8가지(`EDGE`/`Edge`), HP72 는 오타(`CRUNGEN`)까지 있었다. 뿌리는 모델명 표가
 * 12개뿐이라 나머지는 패턴코드가 그대로 이름이 됐고, 그 자리를 사장님이 손으로 메워 오신 것이다.
 *
 * 규격·하중지수·속도기호·XL·흡음재·계절은 **이름에 안 넣는다** — 화면이 따로 칸을 갖고 있고,
 * 기존 `cleanTireName`(tire-name.ts) 과 같은 태도다.
 *
 * 🔴 **모델명을 모르면 이름을 바꾸지 않는다.** `modelForPattern` 이 패턴코드를 그대로 돌려주면
 *    (표에 없는 코드) 기존 이름을 그대로 둔다. 「KRA50 F」 같이 사장님이 붙여 둔 이름을
 *    낯선 코드로 바꿔 놓는 것이 더 나쁘다 — D-08 과 같은 태도.
 */
import { modelForPattern } from "./invoice-desc";

/**
 * 금호 자재내역의 「하중필드」 — 패턴코드 **바로 앞** 토큰이다.
 *
 *   `KH 245/45  R18 VXLL TA51  M;RK`  →  `VXLL`
 *   `KH 145     R13CR08L KC53 AR;RC`  →  `R13CR08L` (규격에 붙어 있다)
 *   `KH 315/80  R225 20L XS10   ;RK`  →  `20L`
 *
 * 짜임새 = `[C=상용][속도기호][XL 또는 겹수 2자리][L=일반 · F=흡음재 · S=실란트]`
 *
 * 끝 글자 F 가 흡음재라는 근거: Master 의 `F/G` 컬럼이 `FOAM` 인 55줄과 **정확히 일치**한다
 * (2026-08-27 교차 검증). 런플랫 표기는 금호 목록에 0건이다.
 */
export interface KumhoLoad {
  /** 겹수(PR). 승용 4겹은 4, 상용은 6~12, 트럭은 14~32 */
  ply: number | null;
  xl: boolean;
  /** 흡음재(FOAM) */
  acoustic: boolean;
  /** 실란트 */
  sealant: boolean;
  /** C 로 시작 = 상용 */
  commercial: boolean;
}

const EMPTY: KumhoLoad = { ply: null, xl: false, acoustic: false, sealant: false, commercial: false };

/** 자재내역에서 하중필드를 읽는다. 패턴코드를 알면 그 앞 토큰을 집는 것이 가장 확실하다 */
export function decodeKumhoLoad(materialName: string, patternCode?: string | null): KumhoLoad {
  const s = String(materialName ?? "").trim();
  if (!s) return EMPTY;

  let field = "";
  const pat = String(patternCode ?? "").trim().toUpperCase();
  if (pat) {
    // 패턴코드 바로 앞 토큰. `R13CR08L KC53` 처럼 규격에 붙어 있어도 뒤에서 잘라 낸다
    const m = new RegExp(`(\\S+)\\s+${pat}\\b`, "i").exec(s);
    if (m) field = m[1];
  }
  if (!field) {
    // 패턴코드를 모르면 생김새로 — `VXLL` · `H04L` · `20L` · `CR08L`
    const m = /\b(C?[A-Z]{0,2}(?:XL|\d{2})[LFS])\b/.exec(s.toUpperCase());
    field = m ? m[1] : "";
  }
  if (!field) return EMPTY;

  const f = field.toUpperCase();
  const tail = /[LFS]$/.exec(f)?.[0] ?? "";
  // 규격이 앞에 붙은 경우(`R13CR08L`)를 위해 뒤에서부터 본다
  const core = /(C?)([A-Z]{0,2})(XL|\d{2})[LFS]$/.exec(f);
  if (!core) return EMPTY;
  const plyStr = core[3];
  return {
    ply: plyStr === "XL" ? null : Number(plyStr) || null,
    xl: plyStr === "XL",
    acoustic: tail === "F",
    sealant: tail === "S",
    // `CR08L` 처럼 C 가 앞에 오거나, 규격 뒤에 바로 붙은 상용 표기
    commercial: /(?:^|\d)C[A-Z]{0,2}(?:XL|\d{2})[LFS]$/.test(f),
  };
}

/**
 * 이름 뒤에 살려 둘 「차종 주석」을 기존 이름에서 뽑는다.
 * 사장님이 붙이신 `스타리아 OE` · `올뉴투싼/스포티지` · `Tesla Model Y` · `EV3/EV4` 는 쓸모가 있다.
 * 반대로 규격(`195R15R`)·하중지수(`108V`)·겹수(`4P`)·XL 은 이름에서 뺀다 — 따로 칸이 있다.
 */
export function keepNote(oldName: string | null | undefined, model: string): string | null {
  const s = String(oldName ?? "").trim();
  if (!s) return null;
  /* 🔴 이미 붙어 있는 괄호를 먼저 벗긴다 (2026-08-27). 안 벗기면 다시 돌릴 때마다
     `(스타리아)` → `((스타리아))` 로 괄호가 한 겹씩 늘어난다. 실제로 그랬다. */
  const words = s
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  /* 🔴 「빼는 목록」이 아니라 **「남기는 목록」**으로 간다 (2026-08-27).
     뺄 것을 세다 보면 `CRUNGEN`(오타)·`TA51+`·`KC53`(옛 이름 부스러기) 같은 것이 자꾸 새어 나온다.
     차종 주석은 거의 늘 **한글**이거나 몇 안 되는 표식(OE·Tesla·EV3/EV4)이다. */
  const isMarker = (w: string) =>
    /[가-힣]/.test(w) || /^(OE|TESLA|MODEL|EV\d(?:\/EV\d)*)$/i.test(w);

  const at = words.findIndex(isMarker);
  if (at < 0) return null;
  // 표식이 나온 자리부터 끝까지가 주석이다 (`Tesla Model Y`, `스타리아 OE`)
  // 겹수·XL·EV 는 세부사항 칸에 있고, 「흡음재」는 규칙이 따로 붙이므로 주석에서 뺀다
  const tail = words.slice(at).filter((w) => !/^(\d+P|XL|EV|TL|흡음재|흡음)$/i.test(w));
  const note = tail.join(" ").trim();
  if (!note || note.toUpperCase() === model.toUpperCase()) return null;
  return note.length >= 2 ? note : null;
}

/** 겹수를 이름에 붙일 것인가 — 4겹(승용 기본)은 안 붙이고, 6겹 이상만 (사장님 결정 2026-08-27) */
export const showPly = (ply: number | null) => ply !== null && ply >= 6;

export interface KumhoNameInput {
  /** 패턴코드 `TA51` */
  patternCode: string | null | undefined;
  /** 금호 자재내역 `KH 245/45  R18 VXLL TA51  M;RK` (없으면 겹수·흡음재를 못 읽는다) */
  materialName?: string | null;
  /** 지금 쓰는 이름 — 차종 주석을 살리는 데 쓴다 */
  currentName?: string | null;
  /**
   * 이미 흡음재로 표시된 상품인가. 자재내역이 없으면(옛 코드만 있는 상품) 글자로는 알 수 없어서
   * 저장된 값을 받는다 — 안 그러면 같은 규격 일반판과 이름이 같아진다 (2026-08-27).
   */
  isAcoustic?: boolean;
}

/**
 * ⭐ 흡음재는 이름에 표시한다 (2026-08-27)
 *
 * 원래는 XL·흡음재·계절을 이름에서 빼기로 했다 — 화면이 따로 칸을 갖고 있으니까.
 * 그런데 흡음재만은 **같은 규격·같은 모델에 일반판이 따로 있고 값이 다르다**
 * (TA91 245/40R19: 일반 260,000 · 흡음재 276,900). 이름을 같게 두면 견적을 낼 때
 * 어느 쪽인지 화면에서 구분이 안 되고, 중복 상품으로도 잡힌다.
 */
const ACOUSTIC_TAG = "흡음재";

export interface KumhoNameResult {
  /** 규칙이 만든 이름. 모델명을 모르면 null (= 이름을 바꾸지 않는다) */
  name: string | null;
  model: string | null;
  load: KumhoLoad;
  note: string | null;
}

export function buildKumhoName(input: KumhoNameInput): KumhoNameResult {
  const pat = String(input.patternCode ?? "").trim().toUpperCase();
  const load = decodeKumhoLoad(input.materialName ?? "", pat);
  if (!pat) return { name: null, model: null, load, note: null };

  const model = modelForPattern(pat);
  // 🔴 모델명을 모르면(= 패턴코드가 그대로 돌아오면) 이름을 만들지 않는다
  if (model.toUpperCase() === pat) return { name: null, model: null, load, note: null };

  const note = keepNote(input.currentName, model);
  const name = [
    model,
    showPly(load.ply) ? `${load.ply}P` : "",
    load.acoustic || input.isAcoustic ? `(${ACOUSTIC_TAG})` : "",
    note && note !== ACOUSTIC_TAG ? `(${note})` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { name, model, load, note };
}
