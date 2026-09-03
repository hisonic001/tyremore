/**
 * 제조사 취급설명서 받아 오기 (2026-09-03)
 *
 * 🔴 **모델에게 웹 도구를 주지 않는다.** 우리가 Node 로 페이지를 직접 받는다.
 *    그래야 ⓐ 어느 주소를 읽었는지 우리가 확실히 알고 ⓑ 원문을 보관해 나중에
 *    대조할 수 있고 ⓒ 모델이 딴 데로 갈 수 없다. `--tools WebFetch` 로 맡기면 셋 다 잃는다.
 *
 * 🔴 **긁지 않는다.** 사장님이 차종 하나를 고르실 때 그 차종의 목차 한 장 +
 *    제원 쪽 두어 장만 받는다. 한 번 실행에 다섯 장 안팎이고, 사이에 쉰다.
 *    `spec_source.requested_by` 가 NOT NULL 인 것이 그 약속을 표에 박아 둔 것이다.
 *
 * 제조사마다 사이트 만든 방식이 다르다 (실측 2026-09-03):
 *   기아  Oxygen WebHelp — `toc.html` 에 `<a href="topics/tNNNNN.html">제목</a>`
 *   현대  textree        — `data/tocData.json` 에 `var tocData = {…}`
 */
import { createHash } from "node:crypto";
import { bodyTextOf, cellText, pageTitle, parseTables, topicBody } from "./spec-html";
import { harvestGrids, type HarvestedSpec, SPEC_TOPIC_RE } from "./spec-manual";

export interface ManualSite {
  host: string;
  /** 목차를 어떻게 읽나 */
  toc: "kia-webhelp" | "hyundai-textree";
}

/** 🔴 이 목록에 없는 제조사는 **하지 않는다.** 아무 사이트나 받아 오지 않는다 */
export const MANUAL_SITES: Record<string, ManualSite> = {
  KIA: { host: "ownersmanual.kia.com", toc: "kia-webhelp" },
  HYUNDAI: { host: "ownersmanual.hyundai.com", toc: "hyundai-textree" },
  GENESIS: { host: "ownersmanual.genesis.com", toc: "hyundai-textree" },
};

export function manualBase(maker: string, proj: string, year: number): string | null {
  const site = MANUAL_SITES[maker];
  if (!site) return null;
  return `https://${site.host}/full_webhelp/${encodeURIComponent(proj)}/${year}/ko_KR/`;
}

/* ------------------------------------------------------------------ */
/* 받아 오기                                                            */
/* ------------------------------------------------------------------ */

export interface Fetched {
  url: string;
  status: number;
  html: string;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TyremoreSpec/1.0";

/** 한 장씩, 사이에 쉬면서 */
export async function fetchDoc(url: string, timeoutMs = 20_000): Promise<Fetched> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ko" }, signal: ctl.signal });
    const html = r.ok ? await r.text() : "";
    return { url, status: r.status, html };
  } catch {
    return { url, status: 0, html: "" };
  } finally {
    clearTimeout(t);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* 목차 읽기                                                            */
/* ------------------------------------------------------------------ */

export interface TocEntry {
  title: string;
  href: string;
}

/**
 * 기아 — `toc.html` 안의 링크.
 *
 * 🔴 기아는 연식에 따라 주소 짓는 법이 두 가지다 (실측 2026-09-03):
 *      2022 쏘렌토 MQ4 : `topics/t01115.html`        제목이 <a> 안에 바로
 *      2025 레이 TAM   : `./topics/chapter7_6.html`  제목이 <a><h2> 안에
 *    앞의 `./` 를 안 받아 주면 새 설명서에서 목차를 12줄만 읽고 「제원 쪽이 없다」고 만다.
 *    그래서 상대 주소면 무엇이든 받고, 제목은 태그를 걷어 내고 읽는다.
 */
export function parseKiaToc(html: string): TocEntry[] {
  const out: TocEntry[] = [];
  for (const m of html.matchAll(/href="([^"]*\.html)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = m[1];
    if (/^(?:https?:)?\/\//.test(href)) continue; // 바깥 사이트로 나가지 않는다
    if (/(^|\/)index\.html$/.test(href)) continue;
    const title = cellText(m[2]);
    if (title) out.push({ title, href });
  }
  return out;
}

/**
 * 현대 — `data/tocData.json` 은 `var tocData = { "0": [제목, 주소, 자식|"null"], … }`.
 * 자식까지 파고든다. 현대는 「추천 오일 및 용량」의 표가 **자식 쪽에** 있는 경우가 있다
 * (그랜저 GN7 2026 은 부모 쪽에 표가 없고 「가솔린/LPI 엔진」 자식에 있다).
 */
export function parseHyundaiToc(js: string): TocEntry[] {
  const start = js.indexOf("{");
  if (start < 0) return [];
  let json: unknown;
  try {
    json = JSON.parse(js.slice(start).replace(/;\s*$/, ""));
  } catch {
    return [];
  }
  const out: TocEntry[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      const [title, href, kids] = node as [unknown, unknown, unknown];
      if (typeof title === "string" && typeof href === "string" && href.endsWith(".html")) {
        out.push({ title, href });
      }
      if (kids && typeof kids === "object") walk(kids);
      return;
    }
    if (node && typeof node === "object") for (const v of Object.values(node)) walk(v);
  };
  walk(json);
  return out;
}

/** 목차를 받아 온다 — 실행마다 딱 한 번 */
export async function fetchToc(base: string, kind: ManualSite["toc"]): Promise<{ entries: TocEntry[]; url: string; status: number }> {
  const url = base + (kind === "kia-webhelp" ? "toc.html" : "data/tocData.json");
  const doc = await fetchDoc(url);
  if (doc.status !== 200) return { entries: [], url, status: doc.status };
  const entries = kind === "kia-webhelp" ? parseKiaToc(doc.html) : parseHyundaiToc(doc.html);
  return { entries, url, status: doc.status };
}

/**
 * 제원이 있는 쪽만 고른다.
 * 🔴 「타이어 및 휠 **점검**」 같은 정비 안내 쪽은 값이 없다. 제목을 좁게 본다.
 *    현대는 자식 제목이 「가솔린/LPI 엔진」 처럼 항목 이름이라, 부모가 걸리면 자식도 데려간다.
 */
export function pickSpecTopics(entries: TocEntry[]): TocEntry[] {
  const hit = new Map<string, TocEntry>();
  entries.forEach((e, i) => {
    if (!SPEC_TOPIC_RE.test(e.title)) return;
    hit.set(e.href, e);
    /* 바로 뒤에 붙는 자식 두 개까지 — 표가 자식 쪽에 있는 경우가 있다 */
    for (let k = 1; k <= 2; k++) {
      const nxt = entries[i + k];
      if (!nxt || SPEC_TOPIC_RE.test(nxt.title)) continue;
      if (/엔진|가솔린|디젤|LPI|하이브리드|전기/.test(nxt.title)) hit.set(nxt.href, nxt);
    }
  });
  return [...hit.values()];
}

/* ------------------------------------------------------------------ */
/* 한 장을 값으로                                                       */
/* ------------------------------------------------------------------ */

export interface HarvestedPage {
  url: string;
  status: number;
  title: string;
  bodyText: string;
  sha256: string;
  specs: HarvestedSpec[];
}

export function harvestHtml(url: string, html: string, status: number): HarvestedPage {
  const title = pageTitle(html) ?? "";
  const body = topicBody(html);
  const bodyText = bodyTextOf(html);
  /* 🔴 제목이 아니라 목차 제목으로 고른 쪽이므로, 표 종류는 제목 글자로 다시 정한다 */
  const specs = harvestGrids(title, parseTables(body));
  return {
    url,
    status,
    title,
    bodyText,
    sha256: createHash("sha256").update(bodyText, "utf8").digest("hex"),
    specs,
  };
}

/** 목차 제목이 페이지 제목과 다를 때(현대는 `2026 그랜저(GN7) 타이어 및 휠`) 둘 다 본다 */
export function harvestHtmlWithHint(url: string, html: string, status: number, tocTitle: string): HarvestedPage {
  const p = harvestHtml(url, html, status);
  if (p.specs.length) return p;
  const specs = harvestGrids(tocTitle, parseTables(topicBody(html)));
  return { ...p, specs };
}

/** 주소를 합친다 — 목차의 href 는 base 기준 상대 주소다 */
export function joinUrl(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return base + href;
  }
}
