/**
 * 사진에서 읽어 온 차량 정보를 **믿을 만한 것만 남기고 거른다** (2026-09-05)
 *
 * 🔴 이 기능은 차대번호를 **해독하지 않는다.** 17자리에서 차종을 알아내는 것은
 *    불가능하다(4~9자리가 제작사만 아는 비공개 자료 — 09-04 결론, 재조사 금지).
 *    대신 **B필러 차량 카드·자동차등록증에 적힌 차명을 그대로 읽는다** (사장님 지적).
 *    그래서 여기서 하는 일은 「해독」이 아니라 「읽은 것 검사」다.
 *
 * 🔴 **틀린 값은 없는 것보다 나쁘다.** 규격이 틀리면 엉뚱한 타이어를 끼운다.
 *    그래서 모양이 안 맞으면 **고치지 않고 버린다**(비운다). 모르는 것은 비어 있어야 한다.
 *
 * 🔴 이 파일은 순수하다 — `@/db` 도 `node:fs` 도 들이지 않는다 (시험에서 그대로 쓴다).
 */
import { TIRE_SIZE_RE } from "./spec-core";
import { codeWordPattern } from "./parts-fit-core";
import { looksLikeVin, parseVin } from "./vin";

/** 모델이 내놓는 그대로 — 무엇이든 올 수 있다고 보고 받는다 */
export interface RawRead {
  vin?: unknown;
  carName?: unknown;
  modelCode?: unknown;
  year?: unknown;
  tireFront?: unknown;
  tireRear?: unknown;
  psiFront?: unknown;
  psiRear?: unknown;
  source?: unknown;
  unread?: unknown;
  /* ⭐ 판매등록 모드 전용 (2026-09-05, 사장님 「사진 세 장」 흐름) */
  plateNo?: unknown;
  odoKm?: unknown;
  ownerName?: unknown;
}

/**
 * ⭐ 읽기 용도 (2026-09-05) — 무엇을 읽어도 되는가가 용도에 따라 다르다.
 *   · '제원'(기본, /carinfo): 차량번호·이름은 **읽지 않는다** (개인정보 2차 방어)
 *   · '판매등록'(/sale 사진 찾기): **차량번호가 조회 열쇠**라 읽어야 하고,
 *     계기판 주행거리·등록증 소유자 이름까지 받는다 (주소·전화는 여전히 금지).
 *     사진은 어느 모드든 읽고 나면 즉시 지워진다.
 */
export type ScanMode = "제원" | "판매등록";

/** 검사를 통과한 것만 담긴다. 못 믿을 값은 null 이다 */
export interface CleanRead {
  vin: string | null;
  carName: string | null;
  modelCode: string | null;
  year: number | null;
  tireFront: string | null;
  tireRear: string | null;
  psiFront: number | null;
  psiRear: number | null;
  /** 등록증 · 차량카드 · 번호판 · 계기판 · 기타 */
  source: string | null;
  /** 모델이 「못 읽었다」고 한 것들 */
  unread: string[];
  /** 우리가 버린 값과 그 이유 — 화면에 그대로 보여 준다 */
  dropped: string[];
  /* ⭐ 판매등록 모드에서만 채워진다 — 제원 모드에서는 항상 null */
  plateNo: string | null;
  /** 한글이 오독으로 버려졌을 때 살린 숫자 끝 4자리 — 되찾기 검색용 (2026-09-06) */
  plateTail: string | null;
  odoKm: number | null;
  ownerName: string | null;
}

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  /* 모델이 「없음」·「확인 불가」 같은 말을 값 자리에 넣는 일이 있다 */
  if (/^(없음|없습니다|미상|불명|확인\s*불가|판독\s*불가|n\/?a|none|unknown|-{1,})$/i.test(s)) return null;
  return s;
};

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v);
  if (!s) return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/**
 * 🔴 **개인정보 2차 방어.** 지시문에서 이름·주소·전화·번호판을 읽지 말라고 못 박지만,
 *    모델이 어길 수 있다. 값 자리에 그런 것이 섞여 오면 **그 칸을 통째로 버린다.**
 */
const PLATE_RE = /\d{2,3}\s?[가-힣]\s?\d{4}/;
const PHONE_RE = /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/;
const ADDRESS_RE = /(특별시|광역시|[가-힣]{2,}시\s|[가-힣]{2,}군\s|[가-힣]{2,}구\s|[가-힣]+로\s?\d|[가-힣]+길\s?\d|읍|면|동\s?\d|아파트|번지)/;
const NAME_RE = /(소유자|성명|이름|명의)/;

export function looksPersonal(s: string): boolean {
  return PLATE_RE.test(s) || PHONE_RE.test(s) || ADDRESS_RE.test(s) || NAME_RE.test(s);
}

/** 타이어 규격 — 제원 DB 와 **같은 자**를 쓴다. 자가 두 개면 어긋난다 */
function cleanTire(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const up = s.toUpperCase().replace(/\s+/g, " ").trim();
  return TIRE_SIZE_RE.test(up) ? up : null;
}

/** 공기압 — 라벨은 보통 psi 나 kPa 로 적혀 있다. 사람이 넣는 값의 상식 범위만 통과 */
function cleanPsi(v: unknown): number | null {
  const n = num(v);
  if (n === null) return null;
  /* kPa 로 적힌 것을 psi 로 바꾼다 (라벨에 240 kPa 처럼 적힌다) */
  const psi = n > 120 ? n / 6.895 : n;
  const r = Math.round(psi * 10) / 10;
  return r >= 20 && r <= 80 ? r : null;
}

const SOURCES = ["등록증", "차량카드", "번호판", "계기판", "기타"];

/** 차량번호판 전체 모양 — 「12가3456」·「서울12가3456」·「123가4567」. 한글 자리 「?」 허용 */
const FULL_PLATE_RE = /^([가-힣]{2})?\d{2,3}([가-힣?])(\d{4})$/;

/**
 * ⭐ 번호판 가운데 한글의 **법정 목록** (사장님 제보 2026-09-06 — "중간의 한국어를
 *    잘 못 읽는 것 같음"). 자가용 32자 + 영업 아바사자·배 + 렌터카 하허호.
 *    이 밖의 글자가 오면 오독이다 — 버려야 끝 4자리 되찾기가 대신 나선다.
 * 🔴 scripts/vin-photo.ts 의 읽기 지침(SALE_SYSTEM)과 한 벌 — 글자를 더하면 같이.
 */
export const PLATE_MID_CHARS =
  "가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호";

/**
 * ⭐ 판매등록 모드의 차량번호 정리 — 모양이 안 맞으면 버린다 (틀린 번호로 엉뚱한
 *    차를 찾으면 안 된다). 한글 자리는 「?」도 받는다 (2026-09-05 — 모델이 한글만
 *    확신 못 할 때 숫자까지 통째로 비우던 것을 고침: 숫자는 살려 되찾기가 나선다).
 * 🔴 export 인 이유: 매장 PC 대리인이 옛/딴 코드로 돌아 깨진 값을 적어 놔도
 *    앱(getVinScan)이 이 정본으로 **한 번 더 걸러** 화면까지는 못 오게 한다.
 */
export function cleanPlate(v: unknown): { plate: string | null; tail: string | null; reason: string | null } {
  /* 딴 코드가 {plate: "..."} 객체를 통째로 넣은 사고가 실제로 있었다 (2026-09-05 스캔 14) */
  const inner = v && typeof v === "object" && "plate" in v ? (v as { plate?: unknown }).plate : v;
  const s = str(inner);
  if (!s) return { plate: null, tail: null, reason: null };
  const up = s.replace(/\s/g, "").replace(/[*？]/g, "?");
  const m = up.match(FULL_PLATE_RE);
  if (!m) return { plate: null, tail: null, reason: `차량번호 「${s}」 — 번호판 모양이 아니라 버렸습니다` };
  if (m[2] === "?") {
    return {
      plate: null,
      tail: m[3],
      reason: `차량번호 「${up}」 — 가운데 한글을 확신하지 못해 숫자 끝 4자리로 찾습니다`,
    };
  }
  if (!PLATE_MID_CHARS.includes(m[2])) {
    /* 🔴 한글은 오독이라도 숫자는 믿을 만하다 — 끝 4자리를 살려 되찾기가 대신 나선다 */
    return {
      plate: null,
      tail: m[3],
      reason: `차량번호 「${up}」 — 가운데 「${m[2]}」는 번호판에 안 쓰이는 글자라 버렸습니다 (한글 오독 — 끝 4자리로 찾습니다)`,
    };
  }
  return { plate: up, tail: null, reason: null };
}

/** 계기판 주행거리 — 상식 범위(0 ~ 150만 km)만 통과 */
function cleanOdo(v: unknown): number | null {
  const n = num(v);
  if (n === null) return null;
  const r = Math.round(n);
  return r >= 0 && r <= 1_500_000 ? r : null;
}

/** 등록증 소유자 이름 — 한글 2~5자만. 주소·전화가 섞이면 버린다 */
function cleanOwner(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = s.replace(/\s/g, "");
  if (!/^[가-힣]{2,5}$/.test(t)) return null;
  return t;
}

/**
 * 읽어 온 것을 검사해 **믿을 만한 것만** 남긴다.
 * 버린 값은 `dropped` 에 이유와 함께 남겨 화면이 사장님께 보여 준다 —
 * 조용히 사라지면 사장님이 「왜 안 나오지」 하게 된다.
 */
export function cleanRead(raw: RawRead, today = new Date(), mode: ScanMode = "제원"): CleanRead {
  const dropped: string[] = [];

  /* ── ⭐ 판매등록 모드 전용 칸 (2026-09-05) — 제원 모드에서는 받지 않는다 ── */
  let plateNo: string | null = null;
  let plateTail: string | null = null;
  let odoKm: number | null = null;
  let ownerName: string | null = null;
  if (mode === "판매등록") {
    const p = cleanPlate(raw.plateNo);
    plateNo = p.plate;
    plateTail = p.tail;
    if (p.reason) dropped.push(p.reason);
    odoKm = cleanOdo(raw.odoKm);
    if (num(raw.odoKm) !== null && num(raw.odoKm) !== 0 && odoKm === null)
      dropped.push(`주행거리 ${num(raw.odoKm)} — 있을 수 없는 값이라 버렸습니다`);
    ownerName = cleanOwner(raw.ownerName);
    // 소유자 이름은 등록증에서만 믿는다 — 차량카드·번호판 사진에 이름이 있을 리 없다
    if (ownerName && str(raw.source) !== "등록증") ownerName = null;
  }

  /* ── 차대번호: 모양이 안 맞으면 버린다. I·O·Q 는 1·0 오독이다 ── */
  let vin: string | null = null;
  const rawVin = str(raw.vin);
  if (rawVin) {
    const up = rawVin.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (looksLikeVin(up)) vin = up;
    else dropped.push(`차대번호 「${rawVin}」 — 17자리 모양이 아니라 버렸습니다`);
  }

  /* ── 차명·형식 ── */
  const nameRaw = str(raw.carName);
  let carName: string | null = nameRaw;
  if (nameRaw && looksPersonal(nameRaw)) {
    carName = null;
    dropped.push("차명 자리에 개인정보로 보이는 것이 있어 버렸습니다");
  }
  const codeRaw = str(raw.modelCode);
  let modelCode: string | null = codeRaw ? codeRaw.toUpperCase() : null;
  if (codeRaw && looksPersonal(codeRaw)) {
    modelCode = null;
    dropped.push("형식 자리에 개인정보로 보이는 것이 있어 버렸습니다");
  }

  /* ── 연식: 1990 ~ 올해+2 밖은 버린다 ── */
  let year: number | null = null;
  const y = num(raw.year);
  if (y !== null) {
    const max = today.getFullYear() + 2;
    if (y >= 1990 && y <= max) year = Math.round(y);
    else dropped.push(`연식 ${y} — 있을 수 없는 값이라 버렸습니다`);
  }

  /* ── 타이어·공기압 ── */
  const tireFront = cleanTire(raw.tireFront);
  if (str(raw.tireFront) && !tireFront) dropped.push(`앞 타이어 「${str(raw.tireFront)}」 — 규격 모양이 아니라 버렸습니다`);
  const tireRear = cleanTire(raw.tireRear);
  if (str(raw.tireRear) && !tireRear) dropped.push(`뒤 타이어 「${str(raw.tireRear)}」 — 규격 모양이 아니라 버렸습니다`);
  const psiFront = cleanPsi(raw.psiFront);
  const psiRear = cleanPsi(raw.psiRear);

  const src = str(raw.source);
  const source = src && SOURCES.includes(src) ? src : null;

  const unread = Array.isArray(raw.unread)
    ? raw.unread.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 8)
    : [];

  return { vin, carName, modelCode, year, tireFront, tireRear, psiFront, psiRear, source, unread, dropped, plateNo, plateTail, odoKm, ownerName };
}

/**
 * ⭐ **두 눈으로 본다** — 차대번호에서 읽은 것과 라벨에 적힌 것을 맞춰 본다.
 *
 * 🔴 어긋난 것을 조용히 넘기지 않는다. 어느 쪽이 맞는지는 **사장님이 정하신다.**
 *    (차대번호 10번째 자리가 연식이라, 라벨의 연식과 1년까지는 흔히 다르다 —
 *     연식은 「제작 연도」와 「등록 연도」가 다를 수 있어 2년까지는 넘어간다.)
 */
export function crossCheck(r: CleanRead, vinAgreed = true): string[] {
  const out: string[] = [];

  /**
   * 🔴 **두 번 읽어 다르면 그대로 말한다** (2026-09-05, 실제로 겪은 것).
   *    흐린 사진에서 `KNAPB8…` 을 `KNAPB6…` 로 읽었는데 17자리 모양은 맞아
   *    검사를 조용히 통과했다. 한 글자 다른 차대번호는 **다른 차**다.
   */
  if (r.vin && !vinAgreed) {
    out.push("차대번호를 두 번 읽었는데 서로 달랐습니다 — 사진과 한 글자씩 맞춰 봐 주세요");
  }

  if (!r.vin) return out;
  const v = parseVin(r.vin);

  if (v.year !== null && r.year !== null && Math.abs(v.year - r.year) > 2) {
    out.push(`차대번호는 ${v.year}년식으로 읽히는데 사진에는 ${r.year}년으로 적혀 있습니다`);
  }
  if (v.maker && r.carName) {
    /* 「현대 (SUV)」 처럼 괄호가 붙으므로 앞부분만 본다 */
    const maker = v.maker.split(" ")[0];
    const KNOWN = ["현대", "기아", "제네시스", "르노", "쉐보레", "쌍용", "KG모빌리티"];
    if (KNOWN.includes(maker) && !r.carName.includes(maker)) {
      /* 차명에 제조사가 안 적히는 것이 보통이라 경고가 아니라 참고로만 남긴다 */
    }
  }
  if (!v.valid) out.push(`차대번호 모양에 문제가 있습니다 — ${v.problems.join(", ")}`);
  return out;
}

export interface GenRow {
  variantKey: string;
  label: string;
}

export interface GenMatch {
  /** 하나로 좁혀졌을 때만 채워진다 */
  pick: GenRow | null;
  /** 좁히지 못했을 때 보여 줄 후보들 */
  candidates: GenRow[];
  why: string;
}

/**
 * 우리 세대 표에서 후보를 찾는다.
 *
 * 🔴 **후보가 둘 이상이면 고르지 않는다.** 프로그램이 찍으면 사장님은 그게 찍은 것인지
 *    확인된 것인지 알 수 없다. 틀린 규격은 없는 것보다 나쁘다.
 */
export function matchGeneration(r: CleanRead, gens: GenRow[]): GenMatch {
  /* ① 형식 코드가 세대 코드와 낱말로 맞으면 그게 신원이다 (RBK 가 BK 에 걸리면 안 된다) */
  if (r.modelCode) {
    const hits = gens.filter(
      (g) =>
        new RegExp(codeWordPattern(g.variantKey), "i").test(r.modelCode!) ||
        new RegExp(codeWordPattern(r.modelCode!), "i").test(g.variantKey),
    );
    if (hits.length === 1) return { pick: hits[0], candidates: hits, why: `형식 「${r.modelCode}」 이 맞습니다` };
    if (hits.length > 1) return { pick: null, candidates: hits, why: `형식 「${r.modelCode}」 으로 좁혀지지 않습니다` };
  }

  /* ② 차명으로 */
  if (r.carName) {
    const name = r.carName.replace(/\s+/g, "");
    const hits = gens.filter((g) => g.label.replace(/\s+/g, "").includes(name));
    if (hits.length === 1) return { pick: hits[0], candidates: hits, why: `차명 「${r.carName}」 이 맞습니다` };
    if (hits.length > 1) {
      return { pick: null, candidates: hits.slice(0, 8), why: `「${r.carName}」 는 세대가 여러 개입니다 — 골라 주세요` };
    }
  }

  return { pick: null, candidates: [], why: "우리 제원 표에서 못 찾았습니다" };
}
