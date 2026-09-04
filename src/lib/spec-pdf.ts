/**
 * PDF 취급설명서 → 표 격자 (2026-09-03)
 *
 * 🔴 **왜 필요한가.** 제조사 온라인 설명서에는 **현행 세대만** 올라온다.
 *    우리 매장 차가 세대를 못 찾는 게 아니라, 찾아도 **설명서가 없었다.**
 *    그런데 현대 공식 자료실에 「취급설명서(단종차종)」 2,669건이 PDF 로 있고,
 *    그중 「N장-차량정보」가 우리가 쓰는 바로 그 표(타이어·휠·공기압·토크·오일)다.
 *
 * 🔴 **여기서도 AI 가 값을 만들지 않는다.** PDF 는 글자마다 x·y 자리를 들고 있다.
 *    그 자리로 줄과 칸을 되살려 `spec-html.ts` 와 **똑같은 `Grid`** 를 만든다.
 *    그러면 파서(spec-manual)·검사기(spec-verify)·검수 화면이 하나도 안 바뀌고 그대로 돈다.
 *
 * 실제 PDF 를 열어 보고 알게 된 세 가지 함정 (그랜드 스타렉스 TQ 2016, 실측):
 *
 *   ① **좌우 2단 편집이다.** 왼쪽에 「차량 제원」, 오른쪽에 「타이어 에너지 소비효율등급」이
 *      나란히 있다. 높이로만 줄을 묶으면 왼쪽 표와 오른쪽 표가 한 줄로 섞인다.
 *      → 글자가 하나도 지나가지 않는 **세로 빈 골목**을 찾아 먼저 단을 가른다.
 *
 *   ② **글자가 한 자씩 쪼개져 온다.** `6 | . | 5 | J | 16`. 틈으로 붙이고 띄운다.
 *
 *   ③ **세로로 합쳐진 칸이 줄 사이에 떠 있다.**
 *        y=84   6.5J × 16 | 215/70R16C | 290(42) | 325(47) | ...
 *        y=73.5                                              11~13   ← 두 줄 가운데
 *        y=63.5 6.5J × 17 | 215/65R17 XL | 290(42) | 290(42) | ...
 *      두 줄에 다 넣지 않으면 17인치 줄에서 토크가 사라진다.
 *      HTML 의 rowspan 과 똑같은 함정이고, 「두 줄 모두에 해당한다」는 표의 뜻을
 *      그대로 옮기는 것이지 값을 만드는 게 아니다.
 */
import type { Grid } from "./spec-html";

/** PDF 안의 글자 조각 하나 */
export interface PdfItem {
  x: number;
  x2: number;
  /** 아래에서부터 잰 높이 (PDF 는 위로 갈수록 크다) */
  y: number;
  /** 글자 높이 — 줄을 묶는 기준 */
  h: number;
  s: string;
}

/** pdfjs 의 `getTextContent()` 결과에서 조각을 꺼낸다 */
export function itemsFromTextContent(tc: {
  items: { str: string; width?: number; height?: number; transform?: number[] }[];
}): PdfItem[] {
  const out: PdfItem[] = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const t = it.transform;
    if (!t || t.length < 6) continue;
    const w = it.width ?? 0;
    out.push({ x: t[4], x2: t[4] + w, y: t[5], h: it.height || Math.abs(t[3]) || 9, s: it.str });
  }
  return out;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/* ------------------------------------------------------------------ */
/* ① 단(段) 가르기 — 좌우 2단 편집 때문에 반드시 먼저 한다               */
/* ------------------------------------------------------------------ */

/**
 * 글자가 하나도 지나가지 않는 **세로 빈 골목**을 찾아 단을 가른다.
 * 🔴 골목이 쪽 높이의 대부분을 관통할 때만 가른다 — 표 안의 넓은 빈 칸을
 *    단 경계로 잘못 보면 표가 반토막 난다.
 */
export function splitColumns(items: PdfItem[], minGutter = 16, depth = 2): PdfItem[][] {
  if (items.length < 8) return [items];
  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x2));
  const yMin = Math.min(...items.map((i) => i.y));
  const yMax = Math.max(...items.map((i) => i.y));
  const height = yMax - yMin;
  if (height <= 0) return [items];

  /* 1pt 눈금으로 「이 x 를 지나가는 글자가 있나」를 센다 */
  const step = 1;
  const n = Math.ceil((maxX - minX) / step) + 1;
  const busy = new Uint8Array(n);
  for (const it of items) {
    const a = Math.max(0, Math.floor((it.x - minX) / step));
    const b = Math.min(n - 1, Math.ceil((it.x2 - minX) / step));
    for (let k = a; k <= b; k++) busy[k] = 1;
  }
  /* 빈 골목 찾기 */
  const cuts: { mid: number; width: number }[] = [];
  let run = 0;
  for (let k = 0; k <= n; k++) {
    if (k < n && !busy[k]) run++;
    else {
      if (run * step >= minGutter && k - run > 0 && k < n) {
        const mid = minX + (k - run / 2) * step;
        /* 골목 양쪽에 글자가 충분히 있어야 진짜 단이다 */
        const left = items.filter((i) => i.x2 <= mid).length;
        const right = items.filter((i) => i.x >= mid).length;
        if (left >= 8 && right >= 8) cuts.push({ mid, width: run * step });
      }
      run = 0;
    }
  }
  if (!cuts.length) return [items];

  /**
   * 🔴 **가장 넓은 골목**으로 가른다. 가운데 것을 고르면 표 안의 빈 칸에서 갈라져
   *    표가 반토막 난다. 그리고 한 쪽에 표가 셋 이상 나란한 경우가 있어 재귀로 더 가른다
   *    (그랜드 스타렉스 3쪽: 「전구의 용량」과 「추천오일 및 용량」이 나란히 있다).
   */
  const best = cuts.reduce((a, b) => (b.width > a.width ? b : a));
  const left = items.filter((i) => i.x < best.mid);
  const right = items.filter((i) => i.x >= best.mid);
  const out: PdfItem[][] = [];
  for (const band of [left, right]) {
    if (band.length < 4) continue;
    out.push(...(depth > 0 ? splitColumns(band, minGutter, depth - 1) : [band]));
  }
  return out.length ? out : [items];
}

/* ------------------------------------------------------------------ */
/* ② 줄 묶기 · 낱말 붙이기                                              */
/* ------------------------------------------------------------------ */

export interface PdfRow {
  y: number;
  items: PdfItem[];
}

/**
 * 같은 높이의 조각을 한 줄로 묶는다.
 *
 * 🔴 **여유를 좁게 잡는다(글자 높이의 35%).** 넉넉하게 잡으면 여러 줄에 걸친
 *    병합 칸이 옆 줄에 빨려 들어간다. 아반떼 AD 실측(2026-09-04):
 *      y=308.9  205/55 R16 …
 *      y=298.8  230(33) 230(33) 11~13   ← 네 줄 한가운데 (병합 칸)
 *      y=294.7  225/45 R17 …
 *    여유가 4.5면 298.8 이 294.7 에 붙어 **17인치에만 공기압·토크가 생기고
 *    나머지 세 규격은 통째로 빈다.** 3.15 로 좁히면 병합 칸이 제 줄로 서고,
 *    그때 비로소 네 줄 모두에 퍼진다.
 */
export function groupRows(items: PdfItem[]): PdfRow[] {
  if (!items.length) return [];
  const tol = Math.max(1.5, median(items.map((i) => i.h)) * 0.35);
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const rows: PdfRow[] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= tol) {
      last.items.push(it);
      last.y = median(last.items.map((i) => i.y));
    } else rows.push({ y: it.y, items: [it] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

export interface PdfWord {
  x: number;
  x2: number;
  s: string;
}

/**
 * `6 | . | 5 | J` 처럼 쪼개진 글자를 붙인다.
 * 틈이 글자 폭의 30% 미만이면 딱 붙이고, 그보다 넓고 칸 간격보다 좁으면 공백을 넣는다.
 */
export function joinWords(row: PdfRow, colGap: number): PdfWord[] {
  const out: PdfWord[] = [];
  for (const it of row.items) {
    const last = out[out.length - 1];
    const charW = it.x2 > it.x && it.s.length ? (it.x2 - it.x) / it.s.length : 4;
    const gap = last ? it.x - last.x2 : Number.POSITIVE_INFINITY;
    if (last && gap < colGap) {
      last.s += gap > charW * 0.3 ? ` ${it.s}` : it.s;
      last.x2 = it.x2;
    } else out.push({ x: it.x, x2: it.x2, s: it.s });
  }
  return out.map((w) => ({ ...w, s: w.s.replace(/\s+/g, " ").trim() })).filter((w) => w.s);
}

/* ------------------------------------------------------------------ */
/* ③ 표 찾기 — 자료 줄에서 시작해 머리글까지 위로 걷는다                  */
/* ------------------------------------------------------------------ */

/** 타이어 규격이 들어 있는 줄인가 */
const TIRE_IN_ROW = /\b\d{3}\/\d{2}\s?[RZ]\s?\d{2}/;

/** 값이 들어 있는 줄인가 — 숫자 칸이 둘 이상이거나 타이어 규격이 있으면 */
export function looksLikeDataRow(words: PdfWord[]): boolean {
  const joined = words.map((w) => w.s).join(" ");
  if (TIRE_IN_ROW.test(joined.replace(/\s+/g, " "))) return true;
  const numeric = words.filter((w) => /\d/.test(w.s) && /^[\d.,~()\-\s×xX]+$/.test(w.s)).length;
  return numeric >= 2;
}

/** 표가 아니라 설명글인 줄인가 — 길고 숫자가 거의 없다 */
function looksLikeProse(words: PdfWord[]): boolean {
  const s = words.map((w) => w.s).join(" ");
  return s.length > 40 && (s.match(/\d/g) ?? []).length < 3;
}

/* ------------------------------------------------------------------ */
/* ④ 격자 만들기                                                       */
/* ------------------------------------------------------------------ */

export function columnEdges(rows: PdfWord[][], tol: number): number[] {
  const xs = rows
    .flat()
    .map((w) => w.x)
    .sort((a, b) => a - b);
  const edges: number[] = [];
  for (const x of xs) if (!edges.length || x - edges[edges.length - 1] > tol) edges.push(x);
  return edges;
}

function colOf(x: number, edges: number[]): number {
  let lo = 0;
  for (let i = 0; i < edges.length; i++) if (x >= edges[i] - 0.5) lo = i;
  return lo;
}

/** 가장 가까운 칸 자리 */
function nearestCol(x: number, edges: number[]): number {
  let best = 0;
  let d = Number.POSITIVE_INFINITY;
  for (let i = 0; i < edges.length; i++) {
    const dd = Math.abs(x - edges[i]);
    if (dd < d) {
      d = dd;
      best = i;
    }
  }
  return best;
}

/**
 * 머리글 줄 + 자료 줄 + 그 사이에 낀 줄을 받아 격자로.
 *
 * 🔴 **칸 자리는 자료 줄이 정한다.** 머리글은 칸 가운데에 얹혀 있어서
 *    (`휠 너트 체결토크` 는 x=502, 값은 x=518) 머리글 x 로 칸을 나누면
 *    머리글과 단위가 값과 다른 칸으로 흩어진다. 그러면 단위를 못 읽어 값이 버려진다.
 *    자료로 칸을 정하고, 머리글은 **가장 가까운 칸**에 얹는다.
 *
 * 🔴 **세로로 합쳐진 칸을 되살린다.** 자료 줄 사이에 낀 줄의 값은,
 *    그 칸이 자료 줄 전부에서 비어 있을 때만 **자료 줄 전부에** 넣는다.
 *    표에서 칸을 세로로 합쳤다는 건 「이 값이 이 줄들 모두에 해당한다」는 뜻이다.
 *    한 줄에라도 값이 있으면 어느 줄 것인지 모르므로 **버린다** (짐작하지 않는다).
 */
export function rowsToGrid(head: PdfWord[][], body: PdfWord[][], colGap: number): Grid {
  const dataRows = body.filter(looksLikeDataRow);
  const spanRows = body.filter((r) => !looksLikeDataRow(r));
  /**
   * 🔴 칸 자리는 **자료 줄 + 사이에 낀 줄**로 정한다.
   *    세로 병합 칸(`11~13`)은 자료 줄에는 없고 사이 줄에만 있다. 자료 줄만 보면
   *    그 칸이 아예 안 생겨서 토크가 옆 칸으로 밀려 들어가고, 결국 버려진다.
   */
  const edges = columnEdges(dataRows.length ? [...dataRows, ...spanRows] : body, colGap);
  const width = edges.length;

  const place = (rows: PdfWord[][], how: (x: number) => number) =>
    rows.map((row) => {
      const cells = new Array<string>(width).fill("");
      for (const w of row) {
        const c = how(w.x);
        cells[c] = cells[c] ? `${cells[c]} ${w.s}` : w.s;
      }
      return cells;
    });

  const headCells = place(head, (x) => nearestCol(x, edges));
  const dataCells = place(dataRows, (x) => colOf(x, edges));
  const spanCells = place(spanRows, (x) => nearestCol(x, edges));

  for (const span of spanCells) {
    for (let c = 0; c < width; c++) {
      const v = span[c];
      if (!v) continue;
      if (dataCells.some((r) => r[c])) continue; // 어느 줄 것인지 모른다 — 버린다
      for (const r of dataCells) r[c] = r[c] ? `${r[c]} ${v}` : v;
    }
  }

  /**
   * 🔴 **오른쪽 정렬 때문에 흩어진 칸을 합친다.**
   *    `83` · `5.1` · `2.2~2.3` 은 글자 폭이 달라 왼쪽 끝이 제각각이다.
   *    그래서 한 칸이어야 할 것이 두세 칸으로 갈라진다.
   *    **어느 줄에서도 둘 다 값을 갖지 않는 이웃 칸**은 원래 한 칸이었다고 본다 —
   *    한 줄에라도 둘 다 값이 있으면 진짜 다른 칸이므로 건드리지 않는다.
   */
  /**
   * 🔴 **숫자만 든 병합 칸 줄**도 되살린다.
   *    아반떼 AD 실측(2026-09-04): 네 규격이 공기압·토크를 함께 쓰는데,
   *    그 값이 `230(33) 230(33) 11~13` 한 줄로 네 줄 한가운데에 찍혀 있다.
   *    숫자가 둘 이상이라 「자료 줄」로 보이지만, 규격 칸이 비어 있고 **다른 줄과
   *    쓰는 칸이 하나도 겹치지 않는다.** 겹치지 않는다는 건 같은 자리를 다투지
   *    않는다는 뜻이고, 표에서 그건 「이 줄들 전부에 걸친 칸」이다.
   *    이걸 못 알아보면 **17인치에만 토크가 생기고 나머지 세 규격은 통째로 빈다.**
   *    (줄이 셋 이상일 때만 — 두 줄짜리 표에서는 진짜 그 줄만의 값일 수 있다)
   */
  const spread = spreadDisjointRows(dataCells);
  const merged = mergeExclusiveColumns(headCells, spread);
  return { headRows: merged.head.length, cells: [...merged.head, ...merged.body] };
}

export function spreadDisjointRows(body: string[][]): string[][] {
  if (body.length < 3) return body;
  const cols = (r: string[]) => new Set(r.flatMap((v, i) => (v ? [i] : [])));
  const sets = body.map(cols);
  const keep: string[][] = [];
  const donors: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const others = sets.filter((_, k) => k !== i);
    const overlaps = others.some((o) => [...sets[i]].some((c) => o.has(c)));
    if (!overlaps && sets[i].size) donors.push(i);
    else keep.push(body[i]);
  }
  if (!donors.length || keep.length < 2) return body;
  for (const d of donors) {
    for (const c of sets[d]) for (const r of keep) if (!r[c]) r[c] = body[d][c];
  }
  return keep;
}

export function mergeExclusiveColumns(
  head: string[][],
  body: string[][],
): { head: string[][]; body: string[][] } {
  const width = body[0]?.length ?? head[0]?.length ?? 0;
  if (width < 2 || !body.length) return { head, body };
  const drop = new Set<number>();
  for (let c = 0; c + 1 < width; c++) {
    if (drop.has(c)) continue;
    let both = false;
    let any = false;
    for (const r of body) {
      if (r[c] && r[c + 1]) both = true;
      if (r[c] || r[c + 1]) any = true;
    }
    if (both || !any) continue;
    for (const rows of [head, body]) {
      for (const r of rows) {
        const v = r[c + 1];
        if (v) r[c] = r[c] ? `${r[c]} ${v}` : v;
      }
    }
    drop.add(c + 1);
  }
  if (!drop.size) return { head, body };
  const keep = (r: string[]) => r.filter((_, i) => !drop.has(i));
  return { head: head.map(keep), body: body.map(keep) };
}

/**
 * 이 문서의 **칸 사이 틈**이 얼마인지 스스로 잰다.
 *
 * 🔴 문서마다 표가 촘촘하기도 넉넉하기도 하다. 고정값을 쓰면
 *    넉넉한 표(그랜드 스타렉스)는 잘 읽히는데 촘촘한 표(싼타페 DM)는
 *    `(P)235/60 R18 7.5J×18 235(34)` 가 한 칸으로 뭉쳐 아무것도 못 읽는다.
 *    낱말 사이 틈은 작고 칸 사이 틈은 크다는 성질을 이용해, 틈들의 60% 지점을
 *    기준으로 잡는다.
 */
export function gapThreshold(rows: PdfRow[]): number {
  const gaps: number[] = [];
  for (const r of rows) {
    for (let i = 1; i < r.items.length; i++) {
      const g = r.items[i].x - r.items[i - 1].x2;
      if (g > 0.5) gaps.push(g);
    }
  }
  if (gaps.length < 4) return 8;
  const s = gaps.sort((a, b) => a - b);
  const p60 = s[Math.floor(s.length * 0.6)];
  return Math.max(4, Math.min(14, p60 * 1.5));
}

/**
 * 한 단 안에서 표를 찾아 격자로 만든다.
 *
 * 🔴 **자료 줄에서 시작해 위로 걷는다.** PDF 는 `<thead>` 를 안 알려 주므로
 *    「값이 처음 나오는 줄」을 찾고, 그 위의 줄들을 머리글로 데려온다.
 *    파서가 단위를 머리글에서 읽기 때문에 이걸 놓치면 값이 통째로 버려진다.
 */
export function tablesInBand(rows: PdfRow[], colGapArg?: number): Grid[] {
  const colGap = colGapArg ?? gapThreshold(rows);
  const words = rows.map((r) => joinWords(r, colGap));
  const isData = words.map(looksLikeDataRow);
  const out: Grid[] = [];

  let i = 0;
  while (i < words.length) {
    if (!isData[i]) {
      i++;
      continue;
    }
    /**
     * 자료 줄 묶음.
     * 🔴 사이에 **세로 병합 칸이 여러 줄** 껴 있다. 그랜드 스타렉스 TQ 실측으로
     *    16인치 줄과 17인치 줄 사이에 `장착 타이어,` · `11~13` · `예비 타이어`
     *    세 줄이 있었다. 한 줄만 건너뛰게 만들면 표가 두 동강 나고 토크가 사라진다.
     */
    let end = i;
    for (let k = i + 1; k < words.length; k++) {
      if (isData[k]) {
        end = k;
        continue;
      }
      if (looksLikeProse(words[k]) || !words[k].length) break;
      /* 앞으로 3줄 안에 자료 줄이 또 나오면 아직 같은 표다 */
      let ahead = false;
      for (let j = k + 1; j <= Math.min(k + 3, words.length - 1); j++) if (isData[j]) ahead = true;
      if (!ahead) break;
    }
    /* 머리글 — 위로 최대 4줄, 빈 줄이나 설명글을 만나면 멈춘다 */
    const head: PdfWord[][] = [];
    for (let k = i - 1; k >= 0 && head.length < 6; k--) {
      if (isData[k] || looksLikeProse(words[k]) || !words[k].length) break;
      head.unshift(words[k]);
    }
    const body = words.slice(i, end + 1);
    if (body.length) out.push(rowsToGrid(head, body, colGap));
    i = end + 1;
  }
  return out;
}

/** 쪽 하나를 격자 여럿으로 */
export function pageToGrids(items: PdfItem[]): Grid[] {
  const out: Grid[] = [];
  for (const band of splitColumns(items)) {
    out.push(...tablesInBand(groupRows(band)));
  }
  return out.filter((g) => g.cells.length > 1 && (g.cells[0]?.length ?? 0) > 1);
}
