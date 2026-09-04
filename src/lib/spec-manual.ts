/**
 * 제조사 취급설명서 표 → 제원 값 (2026-09-03)
 *
 * 🔴 **여기에 AI 가 없다.** 이게 이 설계에서 가장 중요한 결정이다.
 *    2026-09-03 에 검색엔진이 같은 자리에서 세 번 거짓말을 했다:
 *      ① 출처 없이 「일반적으로 10~12kgf·m 로 알려져 있습니다」
 *      ② 준 주소 두 개가 둘 다 404
 *      ③ 요약끼리 값이 어긋남 (250kPa vs 240kPa — 페이지엔 240kPa)
 *    표가 규칙적이면 **규칙으로 옮기는 것이 모델에게 옮겨 적게 하는 것보다 안전하다.**
 *    규칙은 틀리면 늘 같은 자리에서 틀려서 눈에 띄고, 모델은 매번 다르게 틀린다.
 *
 * 값은 전부 `검수대기` 로 들어가고, 사장님이 원문과 나란히 보고 누르셔야 `승인`이 된다.
 * 여기서 만든 인용문(`quote`)은 `spec_source.body_text` 안에 **글자 그대로** 있어야 하며,
 * `specFilter` 가 그걸 기계로 대조한다.
 */
import { looksLikeTireSize, looksLikeViscosity, looksLikeWheelSize, normalizeUnit } from "./spec-core";
import { type Grid, rowToText } from "./spec-html";
import type { SpecCandidate } from "./spec-verify";

export interface HarvestedSpec extends SpecCandidate {
  /** 한 벌 묶음 — 18인치 한 벌, 20인치 한 벌 / 가솔린 한 벌, 디젤 한 벌 */
  groupNo: number;
  groupLabel?: string;
  /** 앞/뒤, 엔진 종류 같은 조건 */
  qualifier?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* 칸 안의 숫자 읽기                                                    */
/* ------------------------------------------------------------------ */

export interface NumCell {
  min: number;
  max: number | null;
  alt: number | null;
  /** 🔴 칸 안에 단위가 같이 적혀 있을 때 — 현대는 머리글이 그냥 `용량` 이고 칸이 `4.3 ℓ` 다 */
  unit: string | null;
}

/**
 * `240(35)` · `11~13` · `11-13` · `5.8` · `4.3 ℓ` · `6.8ℓ` 를 읽는다.
 *
 * 🔴 `493 ± 20 cc` 처럼 **우리가 계산해야 나오는 값은 읽지 않는다.**
 *    ±를 풀면 그건 전사가 아니라 계산이고, 계산은 원문에 없는 숫자를 만든다.
 * 🔴 범위를 붙임표로 적는 곳이 있다 — 현대 쏘나타 DN8 은 `11-13`, 기아는 `11~13`.
 *    숫자와 숫자 사이의 붙임표만 물결로 본다 (`-30` 같은 음수를 범위로 오해하지 않도록).
 */
export function readNumCell(raw: string): NumCell | null {
  const s = raw
    .replace(/\s+/g, "")
    .replace(/[–—−∼〜]/g, "~")
    .replace(/(\d)-(\d)/g, "$1~$2");
  if (/±/.test(s)) return null;
  const m = /^(\d+(?:\.\d+)?)(?:~(\d+(?:\.\d+)?))?(?:\((\d+(?:\.\d+)?)\))?([A-Za-zℓ·.]*)$/.exec(s);
  if (!m) return null;
  return {
    min: Number(m[1]),
    max: m[2] ? Number(m[2]) : null,
    alt: m[3] ? Number(m[3]) : null,
    unit: m[4] ? normalizeUnit(m[4]) : null,
  };
}

/**
 * 머리글에 적힌 단위를 꺼낸다.
 *
 * 🔴 제조사마다 적는 법이 달라서, 여기가 틀리면 **값이 통째로 엉뚱한 단위가 된다.**
 *    실측한 세 가지 모양 (2026-09-03):
 *      기아  `추천 공기압 [kpa(psi)]`    · `휠 너트 체결 토크(kgf·m)`
 *      현대  `추천 공기압 kPa (psi)`     · `휠 너트 체결토크 kgf·m`   ← 괄호가 아예 없다
 *    괄호 안만 보면 현대 공기압을 `psi` 로 읽어 230psi(=1586kPa) 가 되고,
 *    괄호를 요구하면 현대 토크를 통째로 놓친다. 그래서 세 단계로 본다.
 */
export function unitsInHeader(header: string): { unit: string | null; alt: string | null } {
  const h = header.replace(/[　]/g, " ").replace(/\s+/g, " ");

  /* ① `kpa(psi)` · `kPa (psi)` — 두 단위를 나란히 적은 모양이 가장 먼저다 */
  const two = /([A-Za-z][A-Za-z·.]*)\s*[[(]\s*([A-Za-z][A-Za-z·.]*)\s*[\])]/.exec(h);
  if (two) {
    const u = normalizeUnit(two[1]);
    const a = normalizeUnit(two[2]);
    if (u) return { unit: u, alt: a };
  }

  /* ② 괄호 안에 단위 하나 — `용량(L)` · `체결 토크(kgf·m)` */
  for (const m of h.matchAll(/[[(]([^\])]*)[\])]/g)) {
    const u = normalizeUnit(m[1]);
    if (u) return { unit: u, alt: null };
  }

  /* ③ 괄호 없이 그냥 붙여 쓴 단위 — 현대 `휠 너트 체결토크 kgf·m` */
  const bare = /(?:^|[\s(])(kgf\s?[·.]?\s?m|N\s?[·.]\s?m|kPa|psi|bar|Ah|CCA|L)(?:$|[\s)])/i.exec(h);
  if (bare) {
    const u = normalizeUnit(bare[1]);
    if (u) return { unit: u, alt: null };
  }
  return { unit: null, alt: null };
}

/**
 * 이 칸 가까이에 있는 **묶음 이름**을 찾는다 (`왜건(미니버스)` · `밴`).
 *
 * 🔴 종이 설명서는 묶음 이름을 여러 칸 한가운데에 한 번만 적는다. 그러면
 *    `[뒤] 325` 와 `[뒤] 350` 이 이름 없이 나란히 떠서 **어느 것이 왜건이고
 *    어느 것이 밴인지 알 수 없다** (그랜드 스타렉스 TQ 실측 2026-09-03).
 *
 * 🔴 이 값은 **이름표로만 쓴다.** 단위나 항목 종류를 정하는 데는 절대 안 쓴다 —
 *    두 칸 떨어진 `휠 너트 체결 토크` 를 끌어와 공기압을 토크로 읽는 사고가 나기 때문이다.
 *    이름을 잘못 붙여도 숫자와 단위는 그대로고, 사장님이 원문 줄을 보고 판단하신다.
 */
function nearbyGroupLabel(g: Grid, col: number, head: number, skip: RegExp): string | null {
  for (let r = 0; r < head; r++) {
    let best: { d: number; v: string } | null = null;
    for (let c = 0; c < (g.cells[r]?.length ?? 0); c++) {
      const v = (g.cells[r][c] ?? "").trim();
      if (!v || skip.test(v.replace(/\s+/g, ""))) continue;
      const d = Math.abs(c - col);
      if (d > 2) continue;
      if (!best || d < best.d) best = { d, v };
    }
    if (best) return best.v;
  }
  return null;
}

/** 머리글 두 줄을 한 줄로 — `추천 공기압 [kpa(psi)]` + `앞` */
function headerOf(g: Grid, col: number): { full: string; leaf: string } {
  const parts: string[] = [];
  for (let r = 0; r < Math.max(1, g.headRows); r++) {
    const v = g.cells[r]?.[col] ?? "";
    if (v && parts[parts.length - 1] !== v) parts.push(v);
  }
  return { full: parts.join(" "), leaf: parts[parts.length - 1] ?? "" };
}

/* ------------------------------------------------------------------ */
/* ① 「타이어 및 휠」 표                                                */
/* ------------------------------------------------------------------ */

/**
 * 쏘렌토 MQ4 2022 실측 모양:
 *   타이어 형식 | 휠 | 추천 공기압 [kpa(psi)] 앞 | 뒤 | 휠 너트 체결 토크(kgf·m)
 *   235/60 R18 | 7.5Jx18 | 240(35) | 240(35) | 11~13
 *   255/45 R20 | 8.5Jx20 | 240(35) | 240(35) | 11~13   ← 합쳐진 칸을 편 줄
 */
export function parseTireWheelTable(g: Grid): HarvestedSpec[] {
  const head = Math.max(1, g.headRows);
  const width = g.cells[0]?.length ?? 0;
  if (g.cells.length <= head || width < 2) return [];
  const bodyRows = g.cells.slice(head);

  /**
   * 🔴 규격 칸은 **머리글이 아니라 내용으로** 찾는다.
   *    기아는 `타이어 형식`, 현대는 `형 식`(가운데 공백), 앞에 `구 분` 칸이 하나 더 있다.
   *    머리글 글자만 믿으면 제조사가 바뀔 때마다 조용히 아무것도 못 읽는다.
   *    「이 칸에 타이어 규격처럼 생긴 값이 실제로 들어 있는가」가 훨씬 튼튼하다.
   */
  const colHas = (c: number, ok: (v: string) => boolean) =>
    bodyRows.some((r) => ok((r[c] ?? "").trim()));
  let sizeCol = -1;
  let wheelCol = -1;
  for (let c = 0; c < width; c++) {
    if (sizeCol < 0 && colHas(c, looksLikeTireSize)) sizeCol = c;
    else if (wheelCol < 0 && colHas(c, looksLikeWheelSize)) wheelCol = c;
  }
  if (sizeCol < 0) return [];

  interface Col { i: number; item: string; unit: string | null; alt: string | null; where: string | null; group?: string | null }
  const cols: Col[] = [{ i: sizeCol, item: "tire_size", unit: null, alt: null, where: null }];
  if (wheelCol >= 0) cols.push({ i: wheelCol, item: "wheel_size", unit: null, alt: null, where: null });
  /**
   * 🔴 **표 전체 머리글**도 본다.
   *    종이 설명서(PDF)는 `추천공기압 kPa(psi)` 를 네 칸 한가운데에 한 번만 적고,
   *    각 칸 위에는 `앞`·`뒤` 만 적는다. 칸별 머리글만 보면 가운데 칸 하나만 공기압으로
   *    읽히고 나머지 세 칸은 통째로 버려진다 (그랜드 스타렉스 TQ 실측 2026-09-03).
   *    그래서 「이 표가 공기압 표라고 어딘가에 적혀 있고, 이 칸 머리가 앞/뒤이면」
   *    공기압 칸으로 본다. 단위도 표 전체 머리글에서 가져온다.
   */
  const allHeader = g.cells
    .slice(0, head)
    .flat()
    .filter((v, i, a) => v && a.indexOf(v) === i)
    .join(" ");
  const allUnits = unitsInHeader(allHeader);
  const headerSaysPressure = /공기압/.test(allHeader.replace(/\s+/g, ""));

  for (let c = 0; c < width; c++) {
    if (c === sizeCol || c === wheelCol) continue;
    const { full, leaf } = headerOf(g, c);
    const flat = full.replace(/\s+/g, "");
    const u = unitsInHeader(full);
    const where = /앞|전륜|전$/.test(leaf) ? "앞" : /뒤|후륜|후$/.test(leaf) ? "뒤" : null;
    /* 앞/뒤·공기압·단위·항목 이름은 묶음 이름이 아니다 */
    const SKIP =
      /^(앞|뒤|전|후|전륜|후륜|구분|휠|타이어|항목|치수|형식|종류|규격|사이즈|장착|장착타이어|예비타이어)$|공기압|토크|너트|단위|kPa|psi|kgf|N·m|mm/i;
    const group = where ? nearbyGroupLabel(g, c, head, SKIP) : null;
    if (/공기압/.test(flat)) {
      cols.push({ i: c, item: "tire_pressure", unit: u.unit ?? allUnits.unit, alt: u.alt ?? allUnits.alt, where, group });
    } else if (/너트|토크/.test(flat)) {
      cols.push({ i: c, item: "wheel_nut_torque", unit: u.unit ?? allUnits.unit, alt: u.alt, where: null });
    } else if (headerSaysPressure && where) {
      cols.push({ i: c, item: "tire_pressure", unit: allUnits.unit, alt: allUnits.alt, where, group });
    }
  }

  /**
   * 🔴 타이어 규격 칸 하나만으로 「타이어 표」라고 단정하지 않는다.
   *    「차량 제원」 쪽의 **치수 표**가 이렇게 생겼다 (쏘렌토 MQ4 실측 2026-09-03):
   *      윤거 | 전 | 235/60 R18 | 1,646
   *    여기서 235/60 R18 은 값이 아니라 **어느 타이어일 때인지 알려주는 조건**이다.
   *    그대로 읽으면 규격만 덜렁 든 가짜 한 벌이 네 개 생긴다.
   *    휠·공기압·토크 칸이 하나라도 같이 있어야 진짜 타이어 표다.
   */
  if (cols.length < 2) return [];

  const out: HarvestedSpec[] = [];
  let groupNo = 0;
  for (const row of bodyRows) {
    const size = (row[sizeCol] ?? "").trim();
    if (!looksLikeTireSize(size)) continue;
    groupNo++;
    const quote = rowToText(row);
    for (const c of cols) {
      const raw = (row[c.i] ?? "").trim();
      if (!raw) continue;
      const base = { groupNo, groupLabel: size, quote, item: c.item } as HarvestedSpec;
      if (c.item === "tire_size") {
        out.push({ ...base, textValue: size });
      } else if (c.item === "wheel_size") {
        if (looksLikeWheelSize(raw)) out.push({ ...base, textValue: raw });
      } else {
        const n = readNumCell(raw);
        /* 🔴 단위를 못 읽으면 값을 버린다. 단위 없는 숫자는 위험하기만 하다 */
        if (!n || !c.unit) continue;
        const qual: Record<string, string> = {};
        if (c.where) qual["위치"] = c.where;
        /* 같은 앞/뒤가 두 벌 있으면(왜건·밴) 어느 쪽인지 이름을 붙여 준다 */
        if (c.group) qual["구분"] = c.group;
        out.push({
          ...base,
          numMin: n.min,
          numMax: n.max,
          unit: c.unit,
          altNum: n.alt,
          altUnit: n.alt !== null ? c.alt : null,
          qualifier: Object.keys(qual).length ? qual : undefined,
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* ② 「추천 오일 및 용량」 표                                            */
/* ------------------------------------------------------------------ */

/** 첫 칸 이름 → 우리 항목 */
function oilItemsFor(name: string): { qty: string | null; spec: string | null } | null {
  if (/^엔진\s*오일/.test(name)) return { qty: "engine_oil_qty", spec: "engine_oil_spec" };
  if (/냉각수/.test(name)) return { qty: "coolant_qty", spec: null };
  if (/브레이크\s*(오일|액)/.test(name)) return { qty: null, spec: "brake_fluid_spec" };
  if (/변속기|미션|DCT|CVT|자동\s*변속/i.test(name)) return { qty: "transmission_oil_qty", spec: "transmission_oil_spec" };
  if (/^연료$/.test(name)) return { qty: "fuel_tank_qty", spec: null };
  return null;
}

/** `SAE 0W-30, API SN PLUS/SP …` 에서 점도만 */
export function viscosityIn(text: string): string | null {
  for (const m of text.matchAll(/\b(\d{1,2}W\s?-\s?\d{1,2})\b/gi)) {
    const v = m[1].replace(/\s/g, "").toUpperCase();
    if (looksLikeViscosity(v)) return v;
  }
  return null;
}

export function parseOilTable(g: Grid): HarvestedSpec[] {
  const head = Math.max(1, g.headRows);
  const width = g.cells[0]?.length ?? 0;
  if (g.cells.length <= head || width < 3) return [];
  const bodyRows = g.cells.slice(head);

  /**
   * 🔴 이름 칸도 **내용으로** 찾는다. 첫 칸이라고 단정하면 안 된다 —
   *    종이 설명서는 「전구의 용량」 표와 「추천오일 및 용량」 표를 좌우로 나란히 싣는다.
   *    그러면 첫 칸은 전구 이름이고, 오일 이름은 한참 오른쪽에 있다
   *    (그랜드 스타렉스 TQ 3쪽 실측 2026-09-03).
   */
  let nameCol = -1;
  for (let c = 0; c < width; c++) {
    if (bodyRows.some((r) => oilItemsFor((r[c] ?? "").trim()))) {
      nameCol = c;
      break;
    }
  }
  if (nameCol < 0) return [];

  let qtyCol = -1;
  let specCol = -1;
  let qtyUnit: string | null = null;
  for (let c = nameCol + 1; c < width; c++) {
    const { full } = headerOf(g, c);
    if (qtyCol < 0 && /용량/.test(full)) {
      qtyCol = c;
      qtyUnit = unitsInHeader(full).unit;
    } else if (specCol < 0 && /(추천\s*)?사양|규격/.test(full)) specCol = c;
  }
  if (qtyCol < 0 && specCol < 0) return [];

  /**
   * 🔴 **머리글이 값 칸 바로 위에 안 놓일 수 있다.** 종이 설명서는 숫자를 오른쪽으로
   *    맞추고 머리글은 가운데에 놓아서, `용량(ℓ)` 이 값보다 한 칸 왼쪽에 얹힌다.
   *    머리글이 가리킨 칸에 숫자가 하나도 없으면 바로 옆 칸을 본다
   *    (그랜드 스타렉스 TQ 3쪽 실측 2026-09-03).
   */
  const hasNum = (c: number) => c >= 0 && c < width && bodyRows.some((r) => readNumCell((r[c] ?? "").trim()));
  const hasText = (c: number) => c >= 0 && c < width && bodyRows.some((r) => (r[c] ?? "").trim().length > 2);
  if (qtyCol >= 0 && !hasNum(qtyCol)) {
    if (hasNum(qtyCol + 1)) qtyCol += 1;
    else if (hasNum(qtyCol - 1) && qtyCol - 1 > nameCol) qtyCol -= 1;
  }
  if (specCol >= 0 && !hasText(specCol)) {
    if (hasText(specCol + 1)) specCol += 1;
  }

  const out: HarvestedSpec[] = [];
  let groupNo = 0;
  for (const row of bodyRows) {
    const name = (row[nameCol] ?? "").trim();
    const items = oilItemsFor(name);
    /**
     * 🔴 **이름이 그 줄에 없으면 건너뛴다.** 종이 설명서는 이름 칸을 세로로 합쳐
     *    가운데에 한 번만 적어서, 위아래 줄 중 한 줄에만 글자가 놓인다.
     *    없는 줄에 위 이름을 끌어다 붙이면 「엔진오일 디젤 = 연료탱크 용량」 같은
     *    엉뚱한 짝이 생긴다. 짝이 틀리느니 그 줄을 버리는 게 낫다.
     *    (이름이 놓인 줄은 조건·용량·사양이 모두 그 줄 것이라 짝이 정확하다)
     */
    if (!items) continue;
    groupNo++;
    const quote = rowToText(row);
    const cond = row
      .slice(nameCol + 1, qtyCol < 0 ? width : qtyCol)
      .map((s) => s.trim())
      .filter((s, i, a) => s && s !== name && a.indexOf(s) === i);
    const qualifier = cond.length ? { 조건: cond.join(" ") } : undefined;
    const label = [name, ...cond].join(" ");

    if (items.qty && qtyCol >= 0) {
      const n = readNumCell(row[qtyCol] ?? "");
      /* 머리글에 단위가 없으면 칸 안에서 찾는다 (현대 `용량` / `4.3 ℓ`) */
      const unit = qtyUnit ?? n?.unit ?? null;
      if (n && unit) {
        out.push({
          item: items.qty,
          numMin: n.min,
          numMax: n.max,
          unit,
          quote,
          groupNo,
          groupLabel: label,
          qualifier,
        });
      }
    }
    if (specCol >= 0) {
      const text = (row[specCol] ?? "").replace(/\s*\*\d+\s*$/, "").trim();
      if (items.spec && text) {
        out.push({ item: items.spec, textValue: text, quote, groupNo, groupLabel: label, qualifier });
      }
      if (items.qty === "engine_oil_qty") {
        const v = viscosityIn(text);
        if (v) out.push({ item: "engine_oil_viscosity", textValue: v, quote, groupNo, groupLabel: label, qualifier });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */

/**
 * 표를 값으로 옮긴다.
 *
 * 🔴 **제목으로 표를 고르지 않는다.** 현대는 오일 표가 「추천 오일 및 용량」이 아니라
 *    그 아래 「가솔린/LPI 엔진」 쪽에 들어 있다 (쏘나타 DN8 실측 2026-09-03).
 *    제목을 믿으면 그 차는 오일 값이 통째로 비어 버린다.
 *    두 파서를 다 돌리고, 각 파서가 「내가 읽을 표가 맞는가」를 스스로 본다 —
 *    타이어 파서는 타이어 규격처럼 생긴 칸이 있어야 하고,
 *    오일 파서는 `용량`·`사양` 머리글과 아는 항목 이름이 있어야 한다.
 */
export function harvestGrids(_title: string, grids: Grid[]): HarvestedSpec[] {
  const out: HarvestedSpec[] = [];
  for (const g of grids) {
    out.push(...parseTireWheelTable(g));
    out.push(...parseOilTable(g));
  }
  /* 같은 항목·같은 묶음·같은 조건이 두 번 나오면 한 번만 */
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.item}|${c.groupNo}|${JSON.stringify(c.qualifier ?? {})}|${c.textValue ?? ""}|${c.numMin ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 목차에서 우리가 읽을 만한 쪽인가 */
export const SPEC_TOPIC_RE = /타이어\s*및\s*휠$|추천\s*오일\s*및\s*용량|차량\s*제원|타이어\s*공기압\s*라벨/;
