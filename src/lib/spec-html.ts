/**
 * 제조사 취급설명서 페이지 읽기 — **표를 표로 읽는다** (2026-09-03)
 *
 * 🔴 왜 그냥 글자로 펴면 안 되는가.
 *    쏘렌토 MQ4 「타이어 및 휠」 표는 이렇게 생겼다:
 *
 *      타이어 형식 | 휠      | 추천 공기압 앞 | 뒤      | 휠 너트 체결 토크(kgf·m)
 *      235/60 R18 | 7.5Jx18 | 240(35)      | 240(35) | 11~13
 *      255/45 R20 | 8.5Jx20 |   ↑ 위 칸과 합쳐짐(rowspan) ↑
 *
 *    합쳐진 칸을 모르면 20인치 줄에 공기압도 토크도 없는 것처럼 읽힌다.
 *    그대로 두면 **20인치 차에 토크가 안 뜨거나, 더 나쁘게는 옆 줄 값이 붙는다.**
 *    그래서 rowspan/colspan 을 펴서 네모난 표로 만든 다음에 읽는다.
 *
 * 🔴 라이브러리를 새로 들이지 않는다. 이 저장소는 cheerio 도 jsdom 도 안 쓴다.
 *    페이지가 DITA 로 만들어져 태그가 규칙적이라 이 정도로 충분하다.
 */

/** 표 한 장 — rowspan/colspan 을 펴서 칸이 다 채워진 네모 */
export interface Grid {
  /** 머리글 줄 수 (thead) */
  headRows: number;
  cells: string[][];
}

/* ------------------------------------------------------------------ */
/* 글자 다듬기                                                          */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", middot: "·", times: "×", plusmn: "±",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m);
}

/** 태그를 걷어 내고 공백을 한 칸으로 — 칸 하나 안의 글자를 만든다 */
export function cellText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    /* 얇은 공백·줄바꿈 공백까지 (제조사 페이지에 실제로 섞여 있다) */
    .replace(/[\s  -​　]+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* 본문만 잘라 내기                                                     */
/* ------------------------------------------------------------------ */

/**
 * 취급설명서 페이지에는 **전체 목차 143줄이 통째로 같이 실려 있다.**
 * 그대로 저장하면 원문 대조가 헐거워진다 (엉뚱한 데서 글자가 맞아 버린다).
 * 본문 상자 하나만 도려낸다.
 */
export function topicBody(html: string): string {
  const start = html.search(/<div[^>]*\bid="wh_topic_body"/i);
  if (start < 0) return html;
  /* <div> 짝을 세어 상자 끝을 찾는다 */
  let i = html.indexOf(">", start) + 1;
  let depth = 1;
  const re = /<(\/?)div\b[^>]*>/gi;
  re.lastIndex = i;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(i, m.index);
  }
  return html.slice(i);
}

/** 제목 (`<title>` 또는 첫 `<h1>`) */
export function pageTitle(html: string): string | null {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (t) {
    const s = cellText(t[1]);
    if (s) return s;
  }
  const h = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return h ? cellText(h[1]) || null : null;
}

/* ------------------------------------------------------------------ */
/* 표 읽기                                                              */
/* ------------------------------------------------------------------ */

interface RawCell {
  text: string;
  rowspan: number;
  colspan: number;
}

function attrNum(tag: string, name: string): number {
  const m = new RegExp(`\\b${name}\\s*=\\s*"(\\d+)"`, "i").exec(tag);
  const n = m ? Number(m[1]) : 1;
  /* 터무니없는 값은 무시한다 — 잘못된 표 하나가 메모리를 먹지 않도록 */
  return n >= 1 && n <= 100 ? n : 1;
}

/** 표 한 장을 네모난 격자로. rowspan/colspan 을 실제로 펴 준다 */
export function parseTable(tableHtml: string): Grid {
  const rows: { cells: RawCell[]; head: boolean }[] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  /* thead 구간을 먼저 표시해 둔다 */
  const theadEnd = (() => {
    const s = tableHtml.search(/<thead\b/i);
    if (s < 0) return -1;
    const e = tableHtml.search(/<\/thead>/i);
    return e < 0 ? -1 : e;
  })();

  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(tableHtml))) {
    const head = theadEnd >= 0 && tr.index < theadEnd;
    const cells: RawCell[] = [];
    const tdRe = /<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1]))) {
      cells.push({
        text: cellText(td[3]),
        rowspan: attrNum(td[2], "rowspan"),
        colspan: attrNum(td[2], "colspan"),
      });
    }
    if (cells.length) rows.push({ cells, head });
  }

  /* 🔴 여기가 핵심 — 합쳐진 칸을 펴서 모든 자리를 채운다 */
  const grid: string[][] = [];
  /** 아래 줄로 흘러내려야 할 칸: [줄번호][칸번호] = 글자 */
  const carry = new Map<string, string>();
  rows.forEach((row, r) => {
    if (!grid[r]) grid[r] = [];
    let c = 0;
    const place = (text: string, rs: number, cs: number) => {
      while (grid[r][c] !== undefined || carry.has(`${r},${c}`)) {
        if (carry.has(`${r},${c}`)) {
          grid[r][c] = carry.get(`${r},${c}`)!;
          carry.delete(`${r},${c}`);
        }
        c++;
      }
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          if (dr === 0) grid[r][c + dc] = text;
          else carry.set(`${r + dr},${c + dc}`, text);
        }
      }
      c += cs;
    };
    for (const cell of row.cells) place(cell.text, cell.rowspan, cell.colspan);
    /* 줄 끝에 남은 흘러내림도 채운다 */
    for (let k = 0; k < 40; k++) {
      const key = `${r},${c + k}`;
      if (carry.has(key)) {
        grid[r][c + k] = carry.get(key)!;
        carry.delete(key);
      }
    }
  });

  /* 빈 자리를 빈 글자로 메워 네모로 만든다 */
  const width = Math.max(0, ...grid.map((g) => g.length));
  for (const g of grid) for (let i = 0; i < width; i++) if (g[i] === undefined) g[i] = "";

  return { headRows: rows.filter((r) => r.head).length, cells: grid };
}

/** 페이지 안의 표를 전부 */
export function parseTables(html: string): Grid[] {
  const out: Grid[] = [];
  for (const m of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) out.push(parseTable(m[0]));
  return out;
}

/* ------------------------------------------------------------------ */
/* 저장할 원문 만들기                                                   */
/* ------------------------------------------------------------------ */

/**
 * `spec_source.body_text` 에 넣을 글자.
 *
 * 🔴 표는 **편 뒤의 모습**으로 적는다. 인용문이 이 글자 안에 그대로 있어야
 *    검사(specFilter)가 성립하기 때문이다. 합쳐진 칸을 편 것은 표의 뜻을 그대로
 *    옮긴 것이지 값을 만든 것이 아니다 — 20인치 줄의 공기압은 원래 18인치 줄과
 *    같은 칸을 가리키고 있었다.
 */
export function bodyTextOf(html: string): string {
  const body = topicBody(html);
  const parts: string[] = [];

  /* 표 바깥 글도 남긴다 (「예비 타이어는 별도 지급되지 않습니다」 같은 단서) */
  let rest = body;
  for (const m of body.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const g = parseTable(m[0]);
    parts.push(gridToText(g));
    rest = rest.replace(m[0], "\n");
  }

  const prose = decodeEntities(
    rest
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|h\d|caption)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/[\s  -​　]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  return [...parts, prose].filter(Boolean).join("\n\n");
}

/** 격자 한 장을 `칸 | 칸 | 칸` 줄로 — 인용문이 이 모양이 된다 */
export function gridToText(g: Grid): string {
  return g.cells.map(rowToText).join("\n");
}

export function rowToText(row: string[]): string {
  return row.join(" | ").replace(/\s+\|/g, " |").trim();
}
