/**
 * 현대 공식 자료실 — 단종차종 취급설명서 PDF (2026-09-03)
 *
 * 🔴 **왜 필요한가.** `ownersmanual.hyundai.com` 에는 **현행 세대만** 올라온다.
 *    매장에 제일 많이 오는 구형(그랜드 스타렉스 TQ 38대 · 싼타페 TM 31대 ·
 *    아반떼 AD 29대 · 싼타페 DM 26대 · 그랜저 HG 21대 · 투싼 TL 20대 …)은
 *    온라인 설명서가 아예 없다. 사장님 말씀대로 「인터넷에 분명 있을 것」이었고,
 *    현대 공식 자료실의 **「취급설명서 (단종차종)」 2,669건**이 그것이다.
 *    그중 「N장-차량정보」가 우리가 쓰는 표(타이어·휠·공기압·토크·오일)를 담고 있다.
 *
 * 🔴 **긁지 않는다.** 목록을 통째로 받지 않고 **차종 코드로 검색**한다.
 *    한 차종에 2~6번 요청이면 끝나고, 사이에 쉰다. 사람이 눌러야만 돈다.
 *
 * 🔴 **제목에 코드가 낱말로 있을 때만 쓴다.** 검색이 헐거워서 `BK` 로 찾으면
 *    `RBK`(투싼) 문서가 같이 나온다. 이름이 비슷하다고 가져다 쓰면 **다른 차의
 *    공기압·토크가 그 차에 붙는다.** 못 찾으면 못 찾았다고 한다.
 */
import type { Grid } from "./spec-html";
import { gridToText } from "./spec-html";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TyremoreSpec/1.0";
const HOST = "https://www.hyundai.com";
const LIST_URL = `${HOST}/wsvc/kr/front/biz/dataroom.dataroomlist.do`;
/** 자료실 대분류 — 02 = 취급설명서 (단종차종) */
const BIG_TYPE_DISCONTINUED = "02";

export interface ArchiveDoc {
  sn: string;
  title: string;
  category: string;
  fileName: string;
  kind: string;
  url: string;
  /** 제목 앞머리의 연도 (`2016 TQ-8-차량정보` → 2016) */
  year: number | null;
}

interface RawRow {
  mtrlSn: string;
  mtrlTitlSbc: string;
  category: string;
  atflPathNm: string;
  atflNm: string;
  atflId: string;
  atflKindVal: string;
  totalCount: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 자료실에서 낱말로 찾는다 */
export async function searchArchive(keyword: string, maxPages = 6): Promise<ArchiveDoc[]> {
  const out: ArchiveDoc[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const body = new URLSearchParams({
      keyword,
      search_type: "keyword",
      big_type: BIG_TYPE_DISCONTINUED,
      middle_type: "all",
      small_type: "all",
      pageNo: String(page),
    });
    let rows: RawRow[] = [];
    let total = 0;
    try {
      const r = await fetch(LIST_URL, {
        method: "POST",
        headers: {
          "user-agent": UA,
          "accept-language": "ko",
          referer: `${HOST}/kr/ko/digital-customer-support/helpdesk/download-center`,
          "x-requested-with": "XMLHttpRequest",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body,
      });
      if (!r.ok) break;
      const j = (await r.json()) as { data?: RawRow[] };
      rows = j.data ?? [];
      total = Number(rows[0]?.totalCount ?? 0);
    } catch {
      break;
    }
    if (!rows.length) break;
    for (const d of rows) {
      if (seen.has(d.mtrlSn)) continue;
      seen.add(d.mtrlSn);
      out.push(toDoc(d));
    }
    if (total && out.length >= total) break;
    await sleep(300);
  }
  return out;
}

function toDoc(d: RawRow): ArchiveDoc {
  const y = /(^|\D)(19|20)(\d{2})(\D|$)/.exec(d.mtrlTitlSbc);
  return {
    sn: d.mtrlSn,
    title: d.mtrlTitlSbc,
    category: d.category,
    fileName: d.atflNm,
    kind: d.atflKindVal,
    url: `${HOST}${d.atflPathNm}/${d.atflId}`,
    year: y ? Number(`${y[2]}${y[3]}`) : null,
  };
}

/** 「차량정보」 장인가 — 우리가 쓰는 표가 여기 있다 */
export function isSpecChapter(title: string): boolean {
  return /차량\s*정보/.test(title);
}

/** 제목에 이 코드가 **낱말로** 들어 있는가 (`RBK` 는 `BK` 가 아니다) */
export function titleHasCode(title: string, code: string): boolean {
  if (!code) return false;
  return new RegExp(`(^|[^A-Za-z0-9])${code}([^A-Za-z0-9]|$)`, "i").test(title);
}

/**
 * 이 세대에 맞는 문서 하나를 고른다.
 * 🔴 코드가 낱말로 든 「차량정보」 PDF 중 **가장 최신 연식**. 없으면 null.
 *    이름이 비슷하다는 이유로 다른 차 문서를 집지 않는다.
 */
export function pickSpecDoc(docs: ArchiveDoc[], projCode: string): ArchiveDoc | null {
  const hits = docs.filter(
    (d) => d.kind?.toUpperCase() === "PDF" && isSpecChapter(d.title) && titleHasCode(d.title, projCode),
  );
  if (!hits.length) return null;
  return hits.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0];
}

/** 한 세대의 문서를 찾는다 — 요청 두어 번 */
export async function findSpecDoc(projCode: string): Promise<ArchiveDoc | null> {
  const docs = await searchArchive(projCode);
  return pickSpecDoc(docs, projCode);
}

/* ------------------------------------------------------------------ */
/* PDF 받아 격자로                                                      */
/* ------------------------------------------------------------------ */

export async function downloadPdf(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ko" }, redirect: "follow" });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    /* 진짜 PDF 인지 앞머리로 확인 — 오류 쪽을 PDF 로 착각하지 않게 */
    const head = String.fromCharCode(...buf.slice(0, 5));
    return head === "%PDF-" ? buf : null;
  } catch {
    return null;
  }
}

export interface PdfPageGrids {
  page: number;
  grids: Grid[];
}

/**
 * PDF 를 쪽마다 격자로.
 * 🔴 `pdfjs-dist` 는 무겁고 Node 전용이라 **함수 안에서** 불러온다 —
 *    화면(Next) 쪽 꾸러미에 딸려 들어가지 않게.
 */
export async function pdfToGrids(data: Uint8Array): Promise<PdfPageGrids[]> {
  const [{ itemsFromTextContent, pageToGrids }, pdfjs] = await Promise.all([
    import("./spec-pdf"),
    import("pdfjs-dist/legacy/build/pdf.mjs"),
  ]);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const out: PdfPageGrids[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const grids = pageToGrids(itemsFromTextContent(tc as never));
    if (grids.length) out.push({ page: p, grids });
  }
  await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
  return out;
}

/** 저장할 원문 — 격자를 편 모습 그대로 (인용문이 이 안에 글자 그대로 있어야 한다) */
export function gridsToBodyText(pages: PdfPageGrids[]): string {
  return pages
    .map((p) => `[${p.page}쪽]\n${p.grids.map(gridToText).join("\n\n")}`)
    .join("\n\n");
}
