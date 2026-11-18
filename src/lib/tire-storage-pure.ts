/**
 * ⭐ 타이어 보관 — 순수 규칙 정본 (D-42, 2026-11-17)
 *
 *   DB·화면 없이 판정만. 화면·서버·스크립트가 같이 쓴다 (`tire-storage-pure.test.ts`).
 *   🔴 "use server" 아님.
 */

export const STORAGE_KINDS = ["스노", "일반"] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];

export const STORAGE_STATUSES = ["확인대기", "보관중", "찾아감", "폐기", "제외"] as const;
export type StorageStatus = (typeof STORAGE_STATUSES)[number];

/** 보관료 서비스 — 금액은 판매 줄에서 손님마다 정한다 (사장님 2026-11-17 「손님마다 다름」) */
export const STORAGE_FEE_SERVICE_NO = "S001/1194";

/** 라벨 기본 크기 — 기종 확인 전 기본값(브라더 62mm 연속지 기준) */
export const DEFAULT_LABEL = { w: 62, h: 40 } as const;
export const LABEL_SIZE_KEY = "storage_label_size";
/**
 * 스티커 용지 — 「a4」(일반 프린터, A4 한 장에 8개를 잘라 붙임) · 「label」(라벨프린터, 한 장에 하나).
 * 기본 a4 — 라벨프린터를 아직 안 샀다 (사장님 2026-11-17).
 */
export const LABEL_PAPER_KEY = "storage_label_paper";
export type LabelPaper = "a4" | "label";
export function parseLabelPaper(raw: string | null | undefined): LabelPaper {
  return raw === "label" ? "label" : "a4";
}
/**
 * 한 세트에 한 장(set) / **타이어마다 한 장(tire, 기본)** — 사장님 2026-11-18: 「한 대분씩이 아니라 8개 2대분, 6개(4+2)처럼
 * 섞여 있음」 → 섞인 더미에서도 어느 타이어가 누구 것인지 보이게 본수만큼 뽑는다.
 */
export const LABEL_PER_KEY = "storage_label_per";
export type LabelPer = "tire" | "set";
export function parseLabelPer(raw: string | null | undefined): LabelPer {
  return raw === "set" ? "set" : "tire";
}
/** 타이어마다 한 장 — 세트를 본수만큼 늘리고 「1/4」 를 붙인다 */
export function expandPerTire<T extends { id: number; qty: number }>(sets: T[]): (T & { idx: number; key: string })[] {
  return sets.flatMap((s) => Array.from({ length: Math.max(1, Math.min(8, s.qty)) }, (_, i) => ({ ...s, idx: i + 1, key: `${s.id}-${i + 1}` })));
}

/** 라벨에 쓰는 종류 이름 — 사장님 표현 「일반 / 윈터」 */
export function labelKind(kind: string | null | undefined): string {
  return kind === "스노" ? "윈터" : kind === "일반" ? "일반" : "";
}

/** 0012 — 4자리 미만만 앞을 0으로 채운다(1만 번째부터는 그대로) */
export function formatStorageNo(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "----";
  return String(Math.trunc(n)).padStart(4, "0");
}

/**
 * 검색어가 보관번호일 수 있으면 그 숫자. `#12` · `0012` · `12` → 12.
 * 4자리 숫자는 번호판 끝자리일 수도 있다 — 부르는 쪽이 둘 다 찾는다.
 */
export function parseStorageNoQuery(q: string): number | null {
  const m = /^#?\s*0*(\d{1,5})$/.exec(q.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
}

/** "62x40" · "62*40" · "62×40mm" → {w,h}. 엉뚱하면 기본값 */
export function parseLabelSize(raw: string | null | undefined): { w: number; h: number } {
  const m = /^\s*(\d{2,3}(?:\.\d)?)\s*[x×*X]\s*(\d{2,3}(?:\.\d)?)\s*(?:mm)?\s*$/.exec(raw ?? "");
  if (!m) return { ...DEFAULT_LABEL };
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w < 25 || w > 150 || h < 15 || h > 150) return { ...DEFAULT_LABEL };
  return { w, h };
}

export function formatLabelSize(s: { w: number; h: number }): string {
  return `${s.w}x${s.h}`;
}

/** 「미쉐린 스노 4본 225/45R18」 */
export function describeSet(s: { brand?: string | null; kind?: string | null; size?: string | null; qty?: number | null }): string {
  return [s.brand?.trim(), s.kind, s.qty ? `${s.qty}본` : null, s.size?.trim()].filter(Boolean).join(" ");
}

export function oppositeKind(k: StorageKind): StorageKind {
  return k === "스노" ? "일반" : "스노";
}

/**
 * 맡길 세트의 종류 짐작 — 화면이 미리 채우는 값일 뿐, 사람이 고친다.
 *   ① 오늘 찾아가는(장착하는) 보관 세트가 있으면 그 반대 (스노 끼우면 일반을 맡긴다)
 *   ② 오늘 겨울 타이어를 팔아 끼우면 일반을 맡긴다 / 다른 타이어를 끼우면 스노
 *   ③ 둘 다 없으면 달로: 8~2월은 겨울 준비(일반 맡김), 3~7월은 봄 교체(스노 맡김)
 */
export function suggestDropKind(o: { pickupKinds?: (string | null)[]; mountedSeasons?: (string | null)[]; month?: number }): StorageKind {
  const pk = (o.pickupKinds ?? []).find((k): k is StorageKind => k === "스노" || k === "일반");
  if (pk) return oppositeKind(pk);
  const seasons = (o.mountedSeasons ?? []).filter(Boolean);
  if (seasons.length > 0) return seasons.includes("겨울") ? "일반" : "스노";
  const m = o.month ?? new Date().getMonth() + 1;
  return m >= 8 || m <= 2 ? "일반" : "스노";
}

export interface StorageDropInput {
  kind: StorageKind | null;
  brand?: string | null;
  size?: string | null;
  qty: number;
  dot?: string | null;
  memo?: string | null;
}

/** 판매와 함께 — 오늘 맡기는 세트 · 오늘 찾아가는(꺼내 끼우는) 보관 세트 id */
export interface SaleStorageInput {
  drops: StorageDropInput[];
  pickupIds: number[];
}

/* ------------------------------------------------------------------
 * 고르는 입력 (사장님 2026-11-17 — "일일이 미쉐린·한국을 쓰고 규격도 써야 해서 실사가 힘들다.
 * 텍스트보다 옵션을 펼쳐서 고르는 형식이 낫다")
 * ---------------------------------------------------------------- */

/** 브랜드 버튼 — 앞쪽이 자주 쓰는 것. 메모 해석(brandsIn)과 같은 이름을 쓴다 */
export const STORAGE_BRANDS = [
  "한국",
  "금호",
  "미쉐린",
  "넥센",
  "콘티넨탈",
  "피렐리",
  "브리지스톤",
  "굿이어",
  "제너럴",
  "라우펜",
  "던롭",
  "요코하마",
  "맥시스",
  "쿠퍼",
] as const;

/** "금호,넥센" ↔ ["금호","넥센"] — 섞인 세트는 여러 개를 고른다 */
export function splitBrands(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[,·/]/)
    .map((x) => x.trim())
    .filter(Boolean);
}
export function joinBrands(list: string[]): string {
  return [...new Set(list.map((x) => x.trim()).filter(Boolean))].join(",");
}

export const SIZE_WIDTHS = [135, 145, 155, 165, 175, 185, 195, 205, 215, 225, 235, 245, 255, 265, 275, 285, 295, 305, 315, 325];
export const SIZE_ASPECTS = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
export const SIZE_RIMS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

export interface SizeParts {
  w: number;
  /** null = 편평비 없는 밴 표기(145R13) */
  a: number | null;
  r: number;
  /** 145R13C 의 C */
  c?: boolean;
}

/** "225/45R18" · "225/45ZR18" · "145R13C" → 칸 셋. 앞뒤 다른 규격·이상한 글은 null(직접 입력으로) */
export function parseSizeParts(raw: string | null | undefined): SizeParts | null {
  const t = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  let m = /^(\d{3})\/(\d{2})Z?R(\d{2})$/.exec(t);
  if (m) return { w: +m[1], a: +m[2], r: +m[3] };
  m = /^(\d{3})R(\d{2})(C?)$/.exec(t);
  if (m) return { w: +m[1], a: null, r: +m[2], c: m[3] === "C" };
  return null;
}

export function composeSize(p: SizeParts): string {
  return p.a == null ? `${p.w}R${p.r}${p.c ? "C" : ""}` : `${p.w}/${p.a}R${p.r}`;
}

/** 규격 바로 고르기 버튼 — 겹치지 않게, 칸 셋으로 읽히는 것만 */
export function sizeHints(...raw: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    for (const piece of (r ?? "").split(/,\s*/)) {
      const p = parseSizeParts(piece);
      if (p) {
        const s = composeSize(p);
        if (!out.includes(s)) out.push(s);
      }
    }
  }
  return out.slice(0, 4);
}

/** 맡김 한 줄 검사 — 문제 있으면 사람에게 보일 문장 */
export function validateDrop(d: StorageDropInput): string | null {
  if (d.kind !== "스노" && d.kind !== "일반") return "스노/일반 중 하나를 골라 주세요";
  if (!Number.isInteger(d.qty) || d.qty < 1 || d.qty > 8) return "본수는 1~8 사이로 적어 주세요";
  if ((d.brand ?? "").length > 40 || (d.size ?? "").length > 60 || (d.memo ?? "").length > 300) return "글자가 너무 깁니다";
  return null;
}

export function cleanDrop(d: StorageDropInput): StorageDropInput {
  const t = (s: string | null | undefined) => {
    const v = (s ?? "").trim();
    return v ? v : null;
  };
  return { kind: d.kind, brand: t(d.brand), size: t(d.size)?.toUpperCase() ?? null, qty: d.qty, dot: t(d.dot), memo: t(d.memo) };
}

/* ------------------------------------------------------------------
 * 판매 메모 → 보관 후보 (2단계 실사 체크표)
 *
 *   실제 메모 모양 (2026-08~11, 81건):
 *     「한국 스노 보관 탈부착 4개 / 금호 일반 4개 보관[215/55R17]-카드」
 *       앞 = 보관해 둔 스노를 **꺼내 끼움**(찾아감), 뒤 = 뺀 일반을 **새로 맡김**
 *     「… / 컨티 일반 4개 폐기[보관 없음]」 — 버림, 맡긴 것 없음
 *     「보관되어 있던 … 가지고 가심」 — 찾아감
 *   후보는 사람이 창고에서 확인한다 — 틀려도 「없음」 한 번이면 된다. 원문을 같이 보여 준다.
 * ---------------------------------------------------------------- */

const BRAND_ALIASES: [RegExp, string][] = [
  [/한국|한타/, "한국"],
  [/금호/, "금호"],
  [/컨티|콘티/, "콘티넨탈"],
  [/미쉐린|미셰린/, "미쉐린"],
  [/피렐리/, "피렐리"],
  [/넥센/, "넥센"],
  [/제너럴/, "제너럴"],
  [/라우펜/, "라우펜"],
  [/맥시스/, "맥시스"],
  [/굿이어/, "굿이어"],
  [/브리지|브릿지/, "브리지스톤"],
  [/던롭/, "던롭"],
  [/요코하마/, "요코하마"],
  [/토요/, "토요"],
  [/쿠퍼|COOPER/i, "쿠퍼"],
];

const SIZE_RE = /\d{3}\/\d{2}\s*Z?R\s*\d{2}(?:\.\d)?C?|\d{3}\/\d{2}\+\d{3}\/\d{2}\s*Z?R\s*\d{2}|\b\d{3}R\d{2}C?\b/gi;

/** 숫자 사이가 아닌 「/」 — 225/45R18 의 「/」는 나누지 않는다 */
const SEG_SLASH = /(?<!\d)\/|\/(?!\d)/;

export function brandsIn(text: string): string[] {
  const hits: { at: number; name: string }[] = [];
  for (const [re, name] of BRAND_ALIASES) {
    const m = re.exec(text);
    if (m) hits.push({ at: m.index, name });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.name);
}

export function sizesIn(text: string): string[] {
  return [...text.matchAll(SIZE_RE)].map((m) => m[0].replace(/\s+/g, "").toUpperCase());
}

/** 마지막에 나온 종류 낱말 */
export function kindIn(text: string): StorageKind | null {
  let best: { at: number; k: StorageKind } | null = null;
  for (const m of text.matchAll(/스노우?|윈터|겨울|snow|일반|사계절|여름/gi)) {
    const k: StorageKind = /일반|사계절|여름/.test(m[0]) ? "일반" : "스노";
    if (!best || m.index! >= best.at) best = { at: m.index!, k };
  }
  return best?.k ?? null;
}

function lastCount(text: string): number | null {
  let n: number | null = null;
  for (const m of text.matchAll(/(\d)\s*개|\*\s*(\d)(?!\d)/g)) n = Number(m[1] ?? m[2]);
  return n;
}

export interface MemoSet {
  kind: StorageKind | null;
  brand: string | null;
  size: string | null;
  qty: number;
}

export interface ParsedStorageMemo {
  /** 「보관 없음」·「보관X」 — 이 판매로 맡긴 것 없음이라고 적혀 있다 */
  none: boolean;
  /** 새로 맡긴 세트 (후보) */
  drops: MemoSet[];
  /** 보관해 둔 것을 꺼내 끼웠거나 가져감 */
  pickups: MemoSet[];
}

export function parseStorageMemo(raw: string | null | undefined, month?: number): ParsedStorageMemo {
  const text = (raw ?? "").replace(/\s+/g, " ");
  const out: ParsedStorageMemo = { none: false, drops: [], pickups: [] };
  if (!text.includes("보관")) return out;

  const occ = [...text.matchAll(/보관/g)].map((m) => m.index!);
  let prevEnd = 0;
  const pending: { set: MemoSet; inferKind: boolean }[] = [];

  for (let i = 0; i < occ.length; i++) {
    const at = occ[i];
    const end = at + 2;
    const nextAt = occ[i + 1] ?? text.length;
    const afterRaw = text.slice(end, nextAt);
    const afterTight = afterRaw.replace(/\s/g, "");

    // 앞 창: 직전 「보관」 뒤부터, 마지막 구분자(/ [ ]) 뒤까지
    let before = text.slice(prevEnd, at);
    const segParts = before.split(SEG_SLASH);
    const segBefore = segParts[segParts.length - 1];
    const cut = Math.max(segBefore.lastIndexOf("["), segBefore.lastIndexOf("]"));
    before = cut >= 0 ? segBefore.slice(cut + 1) : segBefore;
    // 뒤 창: 다음 구분자까지
    const after = afterRaw.split(SEG_SLASH)[0];
    prevEnd = end;

    if (/^(없음|없|x|X|안)/.test(afterTight)) {
      out.none = true;
      continue;
    }
    if (/^(은|는|료|비)/.test(afterTight)) continue; // 보관료 이야기
    const isPickup =
      /^(되어|된|돼|분)/.test(afterTight) ||
      /^[^/]{0,12}?탈부착/.test(afterTight) ||
      /^(타이어)?(장착|교체)/.test(afterTight);

    const kind = kindIn(before);
    const brands = brandsIn(before);
    if (isPickup) {
      out.pickups.push({ kind, brand: brands.join(",") || null, size: sizesIn(before + after)[0] ?? null, qty: lastCount(before + after) ?? 4 });
      continue;
    }
    // 앞에 아무 낱말도 없는 「보관 …」 은 맡김이 아니다 (예: 「보관 스노 … 폐기」)
    if (!/[가-힣A-Za-z0-9]/.test(before)) continue;
    // 「… 보관 타이어 마모로 폐기」 — 보관하던 것을 버렸다는 말이지 맡김이 아니다
    if (/폐기|버림|버렸/.test(after)) continue;

    const afterCount = /^\s*\*?\s*(\d)\s*개/.exec(after);
    const sizes = sizesIn(after).length ? sizesIn(after) : sizesIn(before).length ? sizesIn(before) : sizesIn(segBefore);
    const dropBrands = brands.length ? brands : brandsIn(after); // 「…보관(이 타이어도 쿠퍼임)」
    pending.push({
      set: {
        kind,
        brand: dropBrands.join(",") || null,
        size: sizes.length ? [...new Set(sizes)].join(", ") : null,
        qty: afterCount ? Number(afterCount[1]) : (lastCount(before) ?? 4),
      },
      inferKind: kind == null,
    });
  }

  const seen = new Set<string>();
  for (const p of pending) {
    if (p.inferKind) p.set.kind = suggestDropKind({ pickupKinds: out.pickups.map((x) => x.kind), month });
    if (p.set.qty < 1 || p.set.qty > 8) p.set.qty = 4;
    out.drops.push(p.set);
  }
  // 같은 글이 판매 메모와 줄 메모에 두 번 적힌 경우 — 똑같은 세트는 하나로
  out.drops = out.drops.filter((d) => {
    const k = `${d.kind}|${d.brand}|${d.size}|${d.qty}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return out;
}

/* ------------------------------------------------------------------
 * 환절기 연락 명단 (4단계)
 * ---------------------------------------------------------------- */

/** 이맘때 연락할 쪽 — 8~12월: 스노 맡긴 손님(겨울 장착), 1~7월: 일반 맡긴 손님(봄 교체) */
export function contactKindFor(month: number): StorageKind {
  return month >= 8 ? "스노" : "일반";
}

export interface ContactRow {
  storageNo: number | null;
  kind: string | null;
  customerId: number;
  customerName: string;
  supplierName: string | null;
  phone: string | null;
  plateNo: string | null;
  storedOn: string;
  describe: string;
  consentMarketing: boolean | null;
}

export interface ContactTarget {
  customerId: number;
  name: string;
  phone: string | null;
  plates: string[];
  sets: string[];
  oldest: string;
  consentMarketing: boolean | null;
}

/** 손님 하나당 한 줄 — 오래 맡긴 순. 자리표시 손님은 부르는 쪽이 미리 뺀다 */
export function contactTargets(rows: ContactRow[], kind: StorageKind): ContactTarget[] {
  const by = new Map<number, ContactTarget>();
  for (const r of rows) {
    if (r.kind !== kind) continue;
    const t = by.get(r.customerId) ?? {
      customerId: r.customerId,
      name: r.supplierName ?? r.customerName,
      phone: r.phone,
      plates: [],
      sets: [],
      oldest: r.storedOn,
      consentMarketing: r.consentMarketing,
    };
    if (r.plateNo && !t.plates.includes(r.plateNo)) t.plates.push(r.plateNo);
    t.sets.push(`#${formatStorageNo(r.storageNo)} ${r.describe}`);
    if (r.storedOn < t.oldest) t.oldest = r.storedOn;
    by.set(r.customerId, t);
  }
  return [...by.values()].sort((a, b) => a.oldest.localeCompare(b.oldest) || a.name.localeCompare(b.name));
}

/** 메모에 적힌 차량번호 중 지금 차와 다른 것 — 「84고0717보관 이 차량번호로 바꿔 적어서 붙이기」 */
export function otherPlatesIn(text: string | null | undefined, current: string | null | undefined): string[] {
  const norm = (p: string) => p.replace(/\s/g, "");
  const cur = norm(current ?? "");
  return [...new Set([...(text ?? "").matchAll(/\d{2,3}\s?[가-힣]\s?\d{4}/g)].map((m) => norm(m[0])))].filter((p) => p !== cur).slice(0, 3);
}
