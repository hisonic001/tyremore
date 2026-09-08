/**
 * 제원 페이지를 **통째로 붙여넣으면 읽는다** (2026-09-08, 사장님 지시)
 *
 * 「그랜저 ig 제원이 이런식인데 현재의 폼으로는 해결이 안됨.」
 *
 * 🔴 **폼의 전제가 틀렸다.** 실제 제원은 「한 차종에 값 하나」가 아니라
 *    **세부모델(트림)마다 다른 표**다:
 *      타이어 (전)   225/55R    225/55R    245/45R
 *      휠   (전)    17 인치     17 인치     18 인치
 *    한 칸씩 치시게 하면 트림 셋이면 세 배를 치셔야 한다.
 *
 * 🔴 **타이어에 인치가 없다.** `225/55R` 이고 인치는 휠 칸에 따로 있다.
 *    둘을 합쳐야 `225/55R17` 이 된다 — 이걸 사람이 매번 머릿속으로 하면 틀린다.
 *
 * 🔴 **줄 수가 안 맞는 묶음은 통째로 버린다.** 라벨 6개인데 값이 7줄이면
 *    어긋난 채로 읽히고, 그러면 **엉뚱한 항목에 엉뚱한 값**이 들어간다.
 *    사양·옵션 쪽은 값이 여러 줄이라 실제로 어긋난다 — 그래서 안 읽는다.
 *
 * 🔴 이 파일은 순수하다 — `@/db` 도 React 도 들이지 않는다.
 */

export interface PastedItem {
  /** 우리 SPEC_ITEMS 의 key */
  item: string;
  /** 화면에 보여 줄 이름 */
  label: string;
  /** 앞/뒤 같은 조건 */
  qualifier: string | null;
  /** 트림 순서대로 — 값이 없으면 null */
  values: (string | null)[];
}

export interface PastedSpec {
  /** 세부모델 이름 — 「모던 (A/T)」 */
  trims: string[];
  /** 우리가 알아본 것 */
  items: PastedItem[];
  /** 알아봤지만 저장은 안 하는 참고값 — 연료·배기량은 엔진을 가르는 데 쓴다 */
  hints: { label: string; values: (string | null)[] }[];
  /** 왜 못 읽었는지 — 사장님이 보셔야 한다 */
  warn: string[];
}

/** 다나와 제원 쪽의 라벨 → 우리 항목 */
const MAP: Record<string, { item: string; qualifier?: string }> = {
  "타이어 (전)": { item: "tire_size", qualifier: "앞" },
  "타이어 (후)": { item: "tire_size", qualifier: "뒤" },
  "휠 (전)": { item: "wheel_size", qualifier: "앞" },
  "휠 (후)": { item: "wheel_size", qualifier: "뒤" },
  연료탱크: { item: "fuel_tank_qty" },
};

/** 저장하진 않지만 엔진·차체를 가르는 데 쓰는 것 */
const HINTS = ["연료", "배기량", "공차중량", "승차정원", "굴림방식", "변속기"];

/** 「31,700,000원」 */
const PRICE = /^[\d,]+\s*원$/;
/** 「[제원] 엔진」·「[사양·옵션] 외관」 */
const SECTION = /^\[[^\]]+\]/;

export function parseSpecPaste(text: string): PastedSpec | null {
  const raw = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  if (raw.length < 10) return null;

  /* ── ① 값이 어디서 시작하나 — 「… 제원 정보」 줄 다음이다 ── */
  const startAt = raw.findIndex((l) => /제원\s*정보\s*$/.test(l.trim()));
  if (startAt < 0) return null;

  /* ── ② 라벨: 맨 앞부터 첫 값(가격) 줄 전까지 ── */
  const firstPrice = raw.findIndex((l) => PRICE.test(l.trim()));
  if (firstPrice < 2) return null;

  /** 라벨을 묶음(섹션)으로 나눈다 — 값도 같은 묶음으로 나뉘어 있다 */
  const labelGroups: string[][] = [];
  let cur: string[] = [];
  for (const line of raw.slice(0, firstPrice - 1)) {
    const s = line.trim();
    if (!s || s === "세부모델") continue;
    if (SECTION.test(s)) {
      if (cur.length) labelGroups.push(cur);
      cur = [];
      continue;
    }
    cur.push(s);
  }
  if (cur.length) labelGroups.push(cur);
  if (labelGroups.length === 0) return null;

  /* ── ③ 트림 이름: (이름, 가격) 짝 ── */
  const trims: string[] = [];
  for (let i = firstPrice - 1; i < startAt; i++) {
    const name = raw[i]?.trim();
    const price = raw[i + 1]?.trim();
    if (name && price && PRICE.test(price) && !PRICE.test(name)) {
      trims.push(name);
      i++;
    }
  }
  if (trims.length === 0) return null;

  /* ── ④ 값: 빈 줄이 묶음 경계다 ── */
  const valueGroups: string[][] = [];
  let vcur: string[] = [];
  for (const line of raw.slice(startAt + 1)) {
    if (!line.trim()) {
      if (vcur.length) valueGroups.push(vcur);
      vcur = [];
      continue;
    }
    vcur.push(line);
  }
  if (vcur.length) valueGroups.push(vcur);

  /* ── ⑤ 묶음끼리 짝지어 읽는다. 줄 수가 다르면 그 묶음은 통째로 버린다 ── */
  const warn: string[] = [];
  const gotByLabel = new Map<string, (string | null)[]>();

  const n = Math.min(labelGroups.length, valueGroups.length);
  for (let g = 0; g < n; g++) {
    const labels = labelGroups[g];
    const values = valueGroups[g];
    if (labels.length !== values.length) {
      /* 🔴 어긋난 채로 읽으면 엉뚱한 항목에 엉뚱한 값이 들어간다 */
      warn.push(`${labels[0] ?? "?"} 쪽 ${labels.length}줄인데 값이 ${values.length}줄이라 건너뜁니다`);
      continue;
    }
    for (let i = 0; i < labels.length; i++) {
      gotByLabel.set(labels[i], splitTrims(values[i], trims.length));
    }
  }
  /**
   * 🔴 하나도 못 읽어도 `null` 이 아니라 **왜 못 읽었는지와 함께** 돌려준다.
   *    null 을 내면 「못 읽었습니다」만 남고 이유가 사라져 사장님이 고치실 수가 없다.
   */

  /* ── ⑥ 우리 항목으로 옮긴다 ── */
  const items: PastedItem[] = [];
  for (const [label, def] of Object.entries(MAP)) {
    const vals = gotByLabel.get(label);
    if (!vals) continue;
    items.push({
      item: def.item,
      label,
      qualifier: def.qualifier ?? null,
      values: vals.map((v) => cleanValue(def.item, v)),
    });
  }

  /* 🔴 타이어에 인치가 없다 — 휠 인치를 붙여 준다 */
  joinTireInch(items, warn);

  const hints = HINTS.filter((h) => gotByLabel.has(h)).map((h) => ({
    label: h,
    values: gotByLabel.get(h)!,
  }));

  return { trims, items: items.filter((i) => i.values.some(Boolean)), hints, warn };
}

/** 「225/55R    225/55R    245/45R」 → 트림 수만큼 */
function splitTrims(line: string, count: number): (string | null)[] {
  const parts = line
    .split(/\t|\s{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === count) return parts;
  /* 트림마다 같은 값이면 한 번만 적혀 있기도 하다 */
  if (parts.length === 1) return Array(count).fill(parts[0]);
  /* 수가 안 맞으면 앞에서부터 채우고 나머지는 비운다 — 지어내지 않는다 */
  return Array.from({ length: count }, (_, i) => parts[i] ?? null);
}

function cleanValue(item: string, v: string | null): string | null {
  if (!v) return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s || s === "-" || s === "–") return null;
  if (item === "fuel_tank_qty") {
    const m = /(\d+(?:\.\d+)?)\s*(?:ℓ|L|리터)/i.exec(s);
    return m ? m[1] : null;
  }
  return s;
}

/**
 * 🔴 **타이어 규격에 인치가 없다.** 다나와는 타이어를 `225/55R` 로,
 *    인치를 휠 칸에 `17 인치` 로 따로 적는다. 둘을 합쳐야 `225/55R17` 이다.
 *    같은 위치(앞/앞, 뒤/뒤)끼리만 합친다 — 앞 타이어에 뒤 휠 인치를 붙이면
 *    스태거드 차에서 없는 규격이 만들어진다.
 */
function joinTireInch(items: PastedItem[], warn: string[]) {
  for (const t of items) {
    if (t.item !== "tire_size") continue;
    const w = items.find((x) => x.item === "wheel_size" && x.qualifier === t.qualifier);
    for (let i = 0; i < t.values.length; i++) {
      const tv = t.values[i];
      if (!tv) continue;
      if (/[RZ]\s*\d{2}/i.test(tv)) continue; // 이미 인치가 있다
      const inch = w ? inchOf(w.values[i]) : null;
      if (inch === null) {
        warn.push(`「${tv}」에 인치가 없고 휠 쪽에서도 못 찾아 비웁니다`);
        t.values[i] = null;
        continue;
      }
      t.values[i] = `${tv.replace(/\s+/g, "").replace(/[RZ]$/i, "")}R${inch}`;
    }
  }
}

/** 「17 인치」·「17인치」·「17"」 → 17 */
export function inchOf(v: string | null): number | null {
  if (!v) return null;
  const m = /(\d{2})(?:\.\d)?\s*(?:인치|inch|"|″)/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 12 && n <= 24 ? n : null;
}
