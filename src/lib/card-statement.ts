/**
 * ⭐ 법인카드 이용대금명세서(메일) → 법인카드 줄 (순수 함수 — DB 없음) (2026-11-17, D-41 보강)
 *
 *   사장님 결정(2026-11-17): 법인카드는 카드사가 매달 보내는 **명세서 메일**로 받는다. 비밀번호 = 사업자번호.
 *
 *   신한 `shinhancard_YYYYMMDD.htm` — 암호화 안 된 EUC-KR HTML.
 *     「카드이용내역」 표: [이용일자 YY.MM.DD, 가맹점(소재지/업종), …, 청구금액(5번째 칸), …] + 「총합계 N건 금액」.
 *     해외 상세표(칸 9개)는 같은 거래를 다시 적은 것이라 읽지 않는다.
 *   우리 `WooriCard.html` — VestMail 암호화(vestmail.ts 로 푼 HTML 을 받는다).
 *     표: [MM/DD, 이용가맹점, 이용금액, 해외현지금액, 할부, 청구금액, 수수료, …, 납부하실 금액(9번째 칸), …] + 「총 결제금액 N 원」.
 *
 * 🔴 **검산이 맞을 때만** 쓴다 — 읽은 줄 합계 = 명세서 총액(원 단위). 안 맞으면 ok=false(반영 안 함).
 * 🔴 금액은 **실제로 통장에서 나가는 돈**(신한 청구금액 · 우리 납부하실 금액, 해외 수수료 포함) — 결제일 통장 출금과 맞는다.
 *    승인 엑셀로 이미 들어간 줄과 겹침을 거를 때는 이용금액(수수료 전)도 함께 본다(matchAmounts).
 * 🔴 승인번호가 없다 — 중복 방지는 fin-ingest.dedupKeys 의 「카드|계정|일자|금액|가맹점|#n」(같은 명세서를 두 번 받아도 한 번).
 */
import type { FinParseResult, NormalizedCashTxn } from "./fin-sheet";

export interface StatementLine extends NormalizedCashTxn {
  /** 겹침 판정에 쓸 금액들 — [실제 청구액, 수수료 전 이용금액] */
  matchAmounts: number[];
}

export interface StatementParse extends Omit<FinParseResult, "rows"> {
  rows: StatementLine[];
  card: "신한" | "우리";
  /** 명세서에 적힌 총액 */
  statementTotal: number | null;
  /** 결제일 (출금 예정일) YYYY-MM-DD */
  payDate: string | null;
  /** 검산 통과 = 줄 합계와 총액이 원 단위로 같다 */
  ok: boolean;
  checks: string[];
}

const num = (s: string | undefined) => {
  const t = (s ?? "").replace(/[^\d-]/g, "");
  return t && t !== "-" ? Number(t) : 0;
};
const strip = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();

/** HTML 표 → 칸 글자 배열들 */
export function tableRows(html: string): string[][] {
  const out: string[][] = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    out.push([...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => strip(m[1])));
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

function finish(
  card: "신한" | "우리",
  formatName: string,
  rows: StatementLine[],
  statementTotal: number | null,
  periodFrom: string | null,
  periodTo: string | null,
  payDate: string | null,
  rawCsv: string,
): StatementParse {
  const sumOut = rows.reduce((s, r) => s + r.outAmount, 0);
  const sumIn = rows.reduce((s, r) => s + r.inAmount, 0);
  // 명세서 총액은 취소(마이너스)를 뺀 순액이다 (2026-11 우리 실물: 취소 1줄 145,000)
  const net = sumOut - sumIn;
  const checks: string[] = [];
  if (statementTotal == null) checks.push("명세서 총액을 찾지 못했습니다");
  else if (net !== statementTotal) checks.push(`줄 순합계 ${net.toLocaleString()}원 ≠ 명세서 총액 ${statementTotal.toLocaleString()}원`);
  if (rows.length === 0) checks.push("이용 내역 줄을 하나도 읽지 못했습니다");
  return {
    source: "법인카드",
    formatName,
    rows,
    skipped: [],
    rawCsv,
    periodFrom,
    periodTo,
    sumIn,
    sumOut,
    card,
    statementTotal,
    payDate,
    ok: checks.length === 0,
    checks,
  };
}

/* ------------------------------------------------------------------ */
/* 신한                                                                 */

/** EUC-KR 바이트 → 글자 (신한 명세서는 EUC-KR) */
export function decodeKorean(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

export function isShinhanStatement(html: string): boolean {
  return /신한카드/.test(html) && /카드이용내역/.test(html) && /이용대금/.test(html);
}

export function parseShinhanStatement(html: string): StatementParse {
  const rows = tableRows(html);
  const text = strip(html);
  const period = /카드\s*이용\s*기간\s*:?\s*(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})/.exec(text);
  const periodFrom = period ? `${period[1]}-${period[2]}-${period[3]}` : null;
  const periodTo = period ? `${period[4]}-${period[5]}-${period[6]}` : null;
  const pay = /결제일\s*:?\s*(\d{4})\.(\d{2})\.(\d{2})/.exec(text);
  const payDate = pay ? `${pay[1]}-${pay[2]}-${pay[3]}` : null;

  let statementTotal: number | null = null;
  const lines: StatementLine[] = [];
  const csv: string[] = [];
  for (const c of rows) {
    if (c[0] === "총합계") statementTotal = num(c.find((x, i) => i > 1 && /\d/.test(x)));
    // 이용 내역 줄 = 첫 칸이 YY.MM.DD 이고 칸이 7개 안팎 (해외 상세표는 칸 9개라 뺀다)
    const d = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(c[0] ?? "");
    if (!d || c.length >= 9) continue;
    const amount = num(c[5]);
    if (amount === 0) continue;
    const day = `20${d[1]}-${d[2]}-${d[3]}`;
    const merchant = (c[1] ?? "").replace(/\s*\(\s*\/\s*\)\s*$/, "").trim();
    lines.push({
      source: "법인카드",
      occurredAt: `${day} 00:00:00`,
      description: merchant,
      inAmount: amount < 0 ? -amount : 0,
      outAmount: amount > 0 ? amount : 0,
      balance: null,
      approvalNo: null,
      bizNo: null,
      installment: c[3] && /\d/.test(c[3]) ? `${c[3]}` : null,
      branch: null,
      payerCode: null,
      matchAmounts: [amount],
    });
    csv.push([day, merchant, amount].join(","));
  }
  return finish("신한", "신한카드 법인 이용대금명세서(메일)", lines, statementTotal, periodFrom, periodTo, payDate, csv.join("\n"));
}

/* ------------------------------------------------------------------ */
/* 우리 (VestMail 로 푼 HTML)                                           */

export function isWooriStatement(html: string): boolean {
  return /우리카드/.test(html) && /이용대금\s*명세서/.test(html) && /이용가맹점/.test(html);
}

export function parseWooriStatement(html: string): StatementParse {
  const text = strip(html);
  const period = /이용기간\s*일시불\s*\/\s*할부\s*:\s*(\d{4})년(\d{2})월(\d{2})일\s*~\s*(\d{4})년(\d{2})월(\d{2})일/.exec(text);
  const periodFrom = period ? `${period[1]}-${period[2]}-${period[3]}` : null;
  const periodTo = period ? `${period[4]}-${period[5]}-${period[6]}` : null;
  const pay = /결제일\s*(\d{4})년\s*(\d{2})월\s*(\d{2})일/.exec(text);
  const payDate = pay ? `${pay[1]}-${pay[2]}-${pay[3]}` : null;
  const tot = /총\s*결제금액\s*([\d,]+)\s*원/.exec(text);
  const statementTotal = tot ? num(tot[1]) : null;

  // 연도: 이용기간 끝을 넘는 달(예: 1월 명세서의 12월 줄)은 전년도
  const endY = Number(period?.[4] ?? payDate?.slice(0, 4) ?? new Date().getFullYear());
  const endMD = period ? `${period[5]}${period[6]}` : "1231";

  const lines: StatementLine[] = [];
  const csv: string[] = [];
  for (const c of tableRows(html)) {
    const d = /^(\d{2})\/(\d{2})$/.exec(c[0] ?? "");
    if (!d || c.length < 10) continue;
    const pay9 = num(c[9]);
    if (pay9 === 0) continue; // 「면제 0」 같은 안내 줄
    const year = `${d[1]}${d[2]}` > endMD ? endY - 1 : endY;
    const day = `${year}-${d[1]}-${d[2]}`;
    const used = num(c[2]) || num(c[5]);
    const inst = (c[4] ?? "").trim();
    lines.push({
      source: "법인카드",
      occurredAt: `${day} 00:00:00`,
      description: c[1] ?? "",
      inAmount: pay9 < 0 ? -pay9 : 0,
      outAmount: pay9 > 0 ? pay9 : 0,
      balance: null,
      approvalNo: null,
      bizNo: null,
      installment: inst && /\d/.test(inst) ? `${inst}개월` : null,
      branch: null,
      payerCode: null,
      matchAmounts: [...new Set([pay9, used].filter((x) => x !== 0))],
    });
    csv.push([day, c[1], used, pay9].join(","));
  }
  return finish("우리", "우리카드 이용대금명세서(메일)", lines, statementTotal, periodFrom, periodTo, payDate, csv.join("\n"));
}

/* ------------------------------------------------------------------ */
/* 겹침 거르기                                                          */

export interface ExistingCardLine {
  /** YYYY-MM-DD */
  day: string;
  outAmount: number;
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * 같은 계정에 이미 있는 줄(승인 엑셀 등)과 겹치는 명세서 줄을 뺀다 — 같은 날 ±1일 · 같은 금액.
 * 🔴 기존 줄 하나는 한 번만 짝을 쓴다(같은 날 같은 금액 두 번 결제도 둘 다 산다).
 */
export function filterStatementOverlap(
  lines: readonly StatementLine[],
  existing: readonly ExistingCardLine[],
): { keep: StatementLine[]; dropped: StatementLine[] } {
  const used = new Set<number>();
  const keep: StatementLine[] = [];
  const dropped: StatementLine[] = [];
  for (const l of lines) {
    const day = l.occurredAt.slice(0, 10);
    const hit = existing.findIndex(
      (e, i) => !used.has(i) && dayDiff(e.day, day) <= 1 && l.matchAmounts.includes(e.outAmount),
    );
    if (hit >= 0) {
      used.add(hit);
      dropped.push(l);
    } else keep.push(l);
  }
  return { keep, dropped };
}
