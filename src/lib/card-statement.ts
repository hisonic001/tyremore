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
  /** 해외 결제(영문 가맹점·해외현지금액) — 승인 때와 청구 때 원화가 환율로 달라 겹침을 느슨하게 본다 */
  foreign: boolean;
}

/** 가맹점 이름(괄호 앞)에 한글이 없으면 해외로 본다 — 「WWW.ALIEXPRESS」「ANTHROPIC* CLAUDE SUB (…/컴퓨터소프트웨어)」 */
const looksForeign = (merchant: string) => !/[가-힣]/.test(merchant.split("(")[0] ?? "") && /[A-Za-z]{3,}/.test(merchant);

export interface StatementParse extends Omit<FinParseResult, "rows"> {
  rows: StatementLine[];
  card: "신한" | "우리";
  /** 명세서에 적힌 총액 */
  statementTotal: number | null;
  /** 결제일 (출금 예정일) YYYY-MM-DD */
  payDate: string | null;
  /** 선결제(결제일 전에 미리 낸 카드값) 합계 — 장부 줄이 아니다(통장 출금으로 이미 있다). 검산에서만 뺀다 */
  prepaid: number;
  /** 검산 통과 = 줄 순합계 − 선결제 = 명세서 총액 (원 단위) */
  ok: boolean;
  checks: string[];
  /** 통과는 했지만 사람이 알아 둘 것 (예: 취소 줄 합과 전월 초과입금액의 10원 차이) */
  notes: string[];
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
  prepaid = 0,
  extra: { usageTotal?: number | null; tolerance?: number } = {},
): StatementParse {
  const sumOut = rows.reduce((s, r) => s + r.outAmount, 0);
  const sumIn = rows.reduce((s, r) => s + r.inAmount, 0);
  // 명세서 총액 = 이용 − 취소 − 선결제 (2026-11 우리 실물: 취소 1줄 145,000 · 8월분 선결제 47줄)
  const net = sumOut - sumIn - prepaid;
  const checks: string[] = [];
  const notes: string[] = [];
  // 이용 줄 합계는 언제나 엄격히 (신한: 「총합계」)
  if (extra.usageTotal != null && sumOut !== extra.usageTotal) {
    checks.push(`이용 줄 합계 ${sumOut.toLocaleString()}원 ≠ 명세서 총합계 ${extra.usageTotal.toLocaleString()}원`);
  }
  const gap = statementTotal == null ? 0 : net - statementTotal;
  if (statementTotal == null) checks.push("명세서 총액을 찾지 못했습니다");
  else if (gap !== 0 && Math.abs(gap) <= (extra.tolerance ?? 0)) {
    notes.push(`취소·환급 줄 합과 명세서의 전월 초과입금액이 ${gap.toLocaleString()}원 다릅니다(수수료 환급 등 작은 조정) — 이용 줄은 총합계와 일치`);
  } else if (gap !== 0) checks.push(`줄 순합계 ${net.toLocaleString()}원 ≠ 명세서 총액 ${statementTotal.toLocaleString()}원`);
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
    prepaid,
    ok: checks.length === 0,
    checks,
    notes,
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

  // 실제 출금액 = 「입금하실 금액 합계」(취소매출을 뺀 값). 없으면 「총합계」(2026-09 실물: 186,390 − 취소 6,072 = 180,318)
  const toPay = /입금하실\s*금액\s*합계\s*([\d,]+)\s*원/.exec(text);
  let statementTotal: number | null = toPay ? num(toPay[1]) : null;
  let usageTotal: number | null = null;
  const lines: StatementLine[] = [];
  const csv: string[] = [];
  for (const c of rows) {
    if (c[0] === "총합계") {
      usageTotal = num(c.find((x, i) => i > 1 && /\d/.test(x)));
      if (statementTotal == null) statementTotal = usageTotal;
    }
    const d = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(c[0] ?? "");
    if (!d) continue;
    const day = `20${d[1]}-${d[2]}-${d[3]}`;
    if (c.length === 7) {
      // 「카드이용내역」 줄 — 칸 정확히 7개, 청구금액은 5번째 (해외 상세표 9칸·취소매출 6칸과 갈린다)
      const amount = num(c[5]);
      if (amount === 0) continue;
      const merchant = (c[1] ?? "").replace(/\s*\(\s*\/\s*\)\s*$/, "").trim();
      lines.push({
        source: "법인카드", occurredAt: `${day} 00:00:00`, description: merchant,
        inAmount: amount < 0 ? -amount : 0, outAmount: amount > 0 ? amount : 0,
        balance: null, approvalNo: null, bizNo: null,
        installment: c[3] && /\d/.test(c[3]) ? `${c[3]}` : null, branch: null, payerCode: null,
        matchAmounts: [Math.abs(amount)], foreign: looksForeign(merchant),
      });
      csv.push([day, merchant, amount].join(","));
    } else if (c.length === 6 && num(c[3]) < 0) {
      // 「취소매출 상세내역(전월 명세서 발송 이후 건)」 — [취소일자, 가맹점, 카드, 취소금액(−), 원거래일자, 원거래금액]
      const refund = -num(c[3]);
      const merchant = `[취소] ${(c[1] ?? "").trim()} (원거래 ${c[4] ?? "?"})`;
      lines.push({
        source: "법인카드", occurredAt: `${day} 00:00:00`, description: merchant,
        inAmount: refund, outAmount: 0, balance: null, approvalNo: null, bizNo: null,
        installment: null, branch: null, payerCode: null, matchAmounts: [refund], foreign: looksForeign(c[1] ?? ""),
      });
      csv.push([day, merchant, -refund].join(","));
    }
  }
  // 이용 줄은 「총합계」와 엄격히, 순액은 「입금하실 금액」과 — 취소 줄 합과 전월 초과입금액은 100원 안 차이를 견딘다
  // (2026-09 실물: 취소 2,989+3,073=6,062 vs 전월 초과입금액 6,072 — 10원)
  return finish("신한", "신한카드 법인 이용대금명세서(메일)", lines, statementTotal, periodFrom, periodTo, payDate, csv.join("\n"), 0, {
    usageTotal,
    tolerance: lines.some((l) => l.inAmount > 0) ? 100 : 0,
  });
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
  let prepaid = 0;
  for (const c of tableRows(html)) {
    const d = /^(\d{2})\/(\d{2})$/.exec(c[0] ?? "");
    if (!d || c.length < 10) continue;
    const pay9 = num(c[9]);
    if (pay9 === 0) continue; // 「면제 0」 같은 안내 줄
    // 🔴 「선결제-…」 = 결제일 전에 미리 낸 카드값 — 환급이 아니다. 그 돈은 통장 출금(우리카드결제)으로 이미 장부에 있다.
    //    장부 줄로 넣지 않고 검산에서만 뺀다 (2026-08 실물: 08-18 선결제 47줄 · 06-10 20줄)
    if (/^선결제/.test((c[1] ?? "").trim())) {
      prepaid += -pay9;
      continue;
    }
    const year = `${d[1]}${d[2]}` > endMD ? endY - 1 : endY;
    const day = `${year}-${d[1]}-${d[2]}`;
    const used = num(c[2]) || num(c[5]);
    const inst = (c[4] ?? "").trim();
    const merchant = c[1] ?? "";
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
      matchAmounts: [...new Set([pay9, used].filter((x) => x !== 0).map(Math.abs))],
      foreign: !!(c[3] ?? "").trim() || looksForeign(merchant),
    });
    csv.push([day, c[1], used, pay9].join(","));
  }
  return finish("우리", "우리카드 이용대금명세서(메일)", lines, statementTotal, periodFrom, periodTo, payDate, csv.join("\n"), prepaid);
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
  const matched = new Set<number>();
  // ① 정확히 — 같은 날 ±1일 · 같은 금액 (모든 줄). 정확한 짝이 먼저 기존 줄을 차지한다
  lines.forEach((l, li) => {
    if (l.outAmount === 0) return; // 취소·환급 줄은 기존 지출 줄과 짝짓지 않는다
    const day = l.occurredAt.slice(0, 10);
    const hit = existing.findIndex((e, i) => !used.has(i) && dayDiff(e.day, day) <= 1 && l.matchAmounts.includes(e.outAmount));
    if (hit >= 0) {
      used.add(hit);
      matched.add(li);
    }
  });
  // ② 해외 줄만 느슨하게 — ±3일 · 금액 차이 5% 안 (승인 때 원화와 청구 때 원화가 환율로 다르다, 2026-07 알리익스프레스 실물)
  lines.forEach((l, li) => {
    if (matched.has(li) || !l.foreign || l.outAmount === 0) return;
    const day = l.occurredAt.slice(0, 10);
    let best = -1;
    let bestGap = Infinity;
    existing.forEach((e, i) => {
      if (used.has(i) || dayDiff(e.day, day) > 3 || e.outAmount <= 0) return;
      const gap = Math.abs(e.outAmount - l.outAmount) / l.outAmount;
      if (gap <= 0.05 && gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    });
    if (best >= 0) {
      used.add(best);
      matched.add(li);
    }
  });
  const keep: StatementLine[] = [];
  const dropped: StatementLine[] = [];
  lines.forEach((l, li) => (matched.has(li) ? dropped : keep).push(l));
  return { keep, dropped };
}
