/**
 * ⭐ 돈 관리 — 엑셀 파서 (ERP 1단계, 사장님 승인 2026-08-24)
 *
 *   은행·카드사에서 내려받은 엑셀을 읽어 「자금 움직임」 정규화 행으로 만든다.
 *   실파일 실측(2026-08-24, 통합자동화\회계 폴더) 기준:
 *     · 통장: 머리행 0행 — No·거래일시·적요·입금액·출금액·내용·잔액·거래점명·입금인코드
 *     · 신한카드 「법인 거래 확인서」: 머리행 ~12행, 병합 셀 — 거래일·카드번호·승인번호·
 *       상품구분·사업자번호·가맹점명·매출금액·공급가액·부가세
 *     · 우리카드 「거래내역(회원별)」: 머리행 ~10행 — 매출일자·이용카드·매출금액(원)·
 *       부가세(원)·매출종류·할부개월·가맹점명·사업자번호. 🔴 "2026년04월소계" 소계 행 끼어 있음
 *
 * 🔴 이 파일은 순수 계산(DB 없음) — stock-sheet.ts readSheet 계보. 나중에 팝빌 API 로
 *    승급해도 이 파일만 fin-popbill.ts 로 갈아끼우면 된다 (정규화 행 타입이 계약).
 * 🔴 "use server" 아님 — 미리보기(파싱만)와 확정(파싱+반영)이 같은 규칙을 쓴다.
 */
import * as XLSX from "xlsx";

/** 업로드 자료의 종류 — fin_upload.source 와 글자 그대로 같다 */
export type FinSource = "홈택스매출" | "홈택스매입" | "법인카드" | "통장" | "카드매출승인" | "카드매출입금" | "토스포스";

/** 자금 움직임 정규화 행 — cash_txn 한 줄이 된다 (팝빌 승급 시에도 이 타입이 계약) */
export interface NormalizedCashTxn {
  source: "법인카드" | "통장";
  /** KST "YYYY-MM-DD HH:mm:ss" (시각 없으면 00:00:00) */
  occurredAt: string;
  /** 가맹점명 / 「[적요] 내용」 원문 보존 */
  description: string;
  inAmount: number;
  outAmount: number;
  /** 통장만 — 거래 후 잔액 (중복 방지 키의 핵심) */
  balance: number | null;
  approvalNo: string | null;
  /** 가맹점 사업자번호 (KB 확인서에 있음 — 매입 대조용) */
  bizNo: string | null;
  installment: string | null;
  branch: string | null;
  /** 통장 입금인코드 — 카드 정산 식별용 */
  payerCode: string | null;
}

/**
 * ⭐ 줄 하나를 못 담은 사연 (2026-08-29)
 *   · expected 없음 = **못 읽은 줄** — 형식이 어긋나 담지 못했다. 사장님이 봐 주셔야 한다.
 *   · expected: true = **일부러 뺀 줄** — 까닭이 분명해 안 담은 것이다(예: 승인했다가 전액 취소).
 *     전엔 둘을 같이 「못 읽음」으로 세어, 정상인데 고장난 것처럼 보였다 (사장님 제보).
 */
export interface SheetSkip {
  line: number;
  reason: string;
  expected?: boolean;
}

export interface FinParseResult {
  source: "법인카드" | "통장";
  /** 어느 형식으로 읽었는지 — 화면에 "이렇게 읽었습니다"로 보여준다 */
  formatName: string;
  rows: NormalizedCashTxn[];
  skipped: SheetSkip[];
  /** 원본 보존용 CSV — fin_upload.raw_text (파서를 고쳐 다시 읽을 수 있게) */
  rawCsv: string;
  periodFrom: string | null;
  periodTo: string | null;
  sumIn: number;
  sumOut: number;
}

/* ------------------------------------------------------------------ */
/* 공용 도우미                                                          */

/** 칸 이름 정규화 — 공백·「(원)」 꼬리를 무시하고 견준다 (stock-sheet pick 의 확장) */
const normHead = (s: unknown): string =>
  String(s ?? "").replace(/\s/g, "").replace(/[（(]원[）)]/g, "");

/** 쉼표 든 숫자 → 정수 원. 빈 칸·못 읽음은 null */
function toWon(v: unknown): number | null {
  const s = String(v ?? "").replace(/[,\s원]/g, "").trim();
  if (s === "" || s === "-") return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s));
}

/** "2025.12.31 16:17:03" · "2026-01-02" · "2026/04/25" → "YYYY-MM-DD HH:mm:ss" */
function toKstDateTime(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(s);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss] = m;
  const p = (x: string | undefined, def = "00") => String(x ?? def).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)} ${p(hh)}:${p(mi)}:${p(ss)}`;
}

/** 행렬에서 「필요한 이름이 다 있는」 머리행을 찾는다 — 위쪽 요약·안내 행을 건너뛴다 */
function findHeader(rows: unknown[][], need: string[], scan = 20): { at: number; col: Map<string, number> } | null {
  for (let i = 0; i < Math.min(scan, rows.length); i++) {
    const col = new Map<string, number>();
    rows[i].forEach((c, j) => {
      const h = normHead(c);
      if (h && !col.has(h)) col.set(h, j);
    });
    if (need.every((n) => col.has(n))) return { at: i, col };
  }
  return null;
}

const cell = (row: unknown[], col: Map<string, number>, name: string): unknown => {
  const j = col.get(name);
  return j === undefined ? "" : row[j];
};

/* ------------------------------------------------------------------ */
/* 파서 본체                                                            */

/**
 * 엑셀 한 장을 읽어 자금 움직임 행으로.
 * 지원하지 않는 파일(세금계산서·여신협회 등)은 **무엇인지 알려주는 에러**를 던진다 —
 * "못 읽음"보다 "이건 ○단계 자료"가 사장님께 훨씬 낫다.
 */
export function parseFinFile(buf: Buffer, fileName?: string): FinParseResult {
  const wb = XLSX.read(buf, { type: "buffer" });
  const name = wb.SheetNames[0];
  if (!name) throw new Error("빈 파일입니다");
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
  const rawCsv = XLSX.utils.sheet_to_csv(ws);

  // ── 아직 다음 단계인 자료를 먼저 알아본다 (앞 10행의 글자로)
  const headText = rows.slice(0, 10).flat().map(normHead).join("|");
  if (headText.includes("세금계산서목록")) throw new Error("전자세금계산서 파일입니다 — 2단계(세금계산서 대조)에서 지원됩니다");
  if (headText.includes("일별승인내역")) throw new Error("여신협회 승인내역 파일입니다 — 3단계(카드 매출 대사)에서 지원됩니다");
  if (headText.includes("월별입금내역")) throw new Error("여신협회 입금내역 파일입니다 — 3단계(카드 매출 대사)에서 지원됩니다");
  if (headText.includes("부가세신고자료")) throw new Error("단말기 앱의 월 요약 파일입니다 — 업로드 대상이 아니라 검증 참고자료입니다");
  if (headText.includes("국외이용")) throw new Error("카드 국외이용 내역은 아직 지원하지 않습니다 — 건수가 적어 손으로 보시는 게 낫습니다");

  // ── 통장 거래내역 (실측: 신한 인터넷뱅킹 grid_exceldata)
  const bank = findHeader(rows, ["거래일시", "잔액"]);
  if (bank && (bank.col.has("입금액") || bank.col.has("출금액"))) {
    return parseBank(rows, bank, rawCsv);
  }

  // ── 신한카드 「법인 거래 확인서」 (사장님 확인 2026-08-25 — 파일명 「신한카드들」)
  const kb = findHeader(rows, ["거래일", "승인번호", "가맹점명"]);
  if (kb) return parseKbCard(rows, kb, rawCsv);

  // ── 우리카드 「거래내역(회원별)」
  const woori = findHeader(rows, ["매출일자", "매출금액", "가맹점명"]);
  if (woori) return parseWooriCard(rows, woori, rawCsv);

  // ── 신한카드 「법인이용내역(전체)」 (2026-08-25) — 국내·해외 통합, 음수 = 취소·환불
  const shinhan = findHeader(rows, ["이용일시", "승인번호", "가맹점명", "이용금액"]);
  if (shinhan) return parseShinhanCard(rows, shinhan, rawCsv);

  /* ── 우리카드 「승인 상세내역」(승인 기준) — 사장님 제보 2026-08-29 (report (3).xls 가 안 올라갔다).
     청구서와 달리 **연·시각·승인번호·사업자번호·부가세**가 다 있다. 앞선 분기와 안 부딪힌다:
     통장은 「거래일시+잔액」, KB는 「거래일」, 신한은 「이용일시+이용금액」을 요구하는데 여기엔 없다 */
  const wooriAppr = findHeader(rows, ["이용일자", "승인번호", "승인금액"]);
  if (wooriAppr) return parseWooriApproval(rows, wooriAppr, rawCsv);

  // ── 우리카드 「이용대금 상세내역」(청구서) — 연도가 파일 안에 없어 파일 이름에서 읽는다
  if (headText.includes("이용대금상세내역")) return parseWooriBill(rows, rawCsv, fileName);

  throw new Error(
    "어느 형식인지 알아보지 못했습니다 — 통장 거래내역·법인카드 이용내역(신한 확인서·신한 법인이용내역·" +
      "우리카드 승인 상세내역·우리카드 이용대금 상세내역) 엑셀만 지원합니다. " +
      "파일 첫 줄들을 알려주시면 형식을 추가하겠습니다",
  );
}

function finish(
  source: "법인카드" | "통장",
  formatName: string,
  out: NormalizedCashTxn[],
  skipped: SheetSkip[],
  rawCsv: string,
): FinParseResult {
  const dates = out.map((r) => r.occurredAt.slice(0, 10)).sort();
  return {
    source,
    formatName,
    rows: out,
    skipped,
    rawCsv,
    periodFrom: dates[0] ?? null,
    periodTo: dates[dates.length - 1] ?? null,
    sumIn: out.reduce((s, r) => s + r.inAmount, 0),
    sumOut: out.reduce((s, r) => s + r.outAmount, 0),
  };
}

function parseBank(rows: unknown[][], h: { at: number; col: Map<string, number> }, rawCsv: string): FinParseResult {
  const out: NormalizedCashTxn[] = [];
  const skipped: SheetSkip[] = [];
  for (let i = h.at + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every((c) => String(c ?? "").trim() === "")) continue;
    const when = toKstDateTime(cell(r, h.col, "거래일시"));
    if (!when) {
      // 아래 합계·안내 행일 수 있다 — 날짜가 없으면 조용히 넘기되 셈은 남긴다
      skipped.push({ line: i + 1, reason: "거래일시를 못 읽음" });
      continue;
    }
    const inAmt = toWon(cell(r, h.col, "입금액")) ?? 0;
    const outAmt = toWon(cell(r, h.col, "출금액")) ?? 0;
    const memo = String(cell(r, h.col, "적요") ?? "").trim();
    const body = String(cell(r, h.col, "내용") ?? "").trim();
    out.push({
      source: "통장",
      occurredAt: when,
      description: memo ? `[${memo}] ${body}`.trim() : body || "(내용 없음)",
      inAmount: inAmt,
      outAmount: outAmt,
      balance: toWon(cell(r, h.col, "잔액")),
      approvalNo: null,
      bizNo: null,
      installment: null,
      branch: String(cell(r, h.col, "거래점명") ?? "").trim() || null,
      payerCode: String(cell(r, h.col, "입금인코드") ?? "").trim() || null,
    });
  }
  return finish("통장", "은행 거래내역", out, skipped, rawCsv);
}

function parseKbCard(rows: unknown[][], h: { at: number; col: Map<string, number> }, rawCsv: string): FinParseResult {
  const out: NormalizedCashTxn[] = [];
  const skipped: SheetSkip[] = [];
  for (let i = h.at + 1; i < rows.length; i++) {
    const r = rows[i];
    const when = toKstDateTime(cell(r, h.col, "거래일"));
    if (!when) {
      // 🔴 감사 M12: 승인번호가 있는데 날짜를 못 읽으면 자료 줄이다 — 조용히 버리지 않는다
      if (String(cell(r, h.col, "승인번호") ?? "").trim()) skipped.push({ line: i + 1, reason: "거래일을 못 읽음" });
      continue; // 구역 제목·빈 줄
    }
    const amt = toWon(cell(r, h.col, "매출금액"));
    if (amt === null) {
      skipped.push({ line: i + 1, reason: "매출금액을 못 읽음" });
      continue;
    }
    const kind = String(cell(r, h.col, "상품구분") ?? "").trim();
    // 취소 줄은 마이너스로 — 금액이 이미 음수면 그대로 둔다
    const signed = kind.includes("취소") && amt > 0 ? -amt : amt;
    out.push({
      source: "법인카드",
      occurredAt: when,
      description: String(cell(r, h.col, "가맹점명") ?? "").trim() || "(가맹점 미상)",
      inAmount: 0,
      outAmount: signed,
      balance: null,
      approvalNo: String(cell(r, h.col, "승인번호") ?? "").trim() || null,
      bizNo: String(cell(r, h.col, "사업자번호") ?? "").replace(/\D/g, "") || null,
      installment: null,
      branch: null,
      payerCode: null,
    });
  }
  return finish("법인카드", "신한카드 법인 거래 확인서", out, skipped, rawCsv);
}

function parseWooriCard(rows: unknown[][], h: { at: number; col: Map<string, number> }, rawCsv: string): FinParseResult {
  const out: NormalizedCashTxn[] = [];
  const skipped: SheetSkip[] = [];
  for (let i = h.at + 1; i < rows.length; i++) {
    const r = rows[i];
    const dateRaw = String(cell(r, h.col, "매출일자") ?? "").trim();
    if (dateRaw === "") continue;
    // 🔴 "2026년04월소계" 같은 소계·합계 행을 걸러낸다 (실파일 실측)
    const when = toKstDateTime(dateRaw);
    if (!when) {
      if (!/소계|합계|총/.test(dateRaw)) skipped.push({ line: i + 1, reason: `매출일자 「${dateRaw}」를 못 읽음` });
      continue;
    }
    const amt = toWon(cell(r, h.col, "매출금액"));
    if (amt === null) {
      skipped.push({ line: i + 1, reason: "매출금액을 못 읽음" });
      continue;
    }
    const kind = String(cell(r, h.col, "매출종류") ?? "").trim();
    const signed = kind.includes("취소") && amt > 0 ? -amt : amt;
    const inst = String(cell(r, h.col, "할부개월") ?? "").trim();
    out.push({
      source: "법인카드",
      occurredAt: when,
      description: String(cell(r, h.col, "가맹점명") ?? "").trim() || "(가맹점 미상)",
      inAmount: 0,
      outAmount: signed,
      balance: null,
      approvalNo: null, // 이 형식에는 승인번호가 없다 — 중복 방지는 반영 쪽이 차례번호로 푼다
      bizNo: String(cell(r, h.col, "사업자번호") ?? "").replace(/\D/g, "") || null,
      installment: inst && inst !== "0" ? `${inst}개월` : null,
      branch: null,
      payerCode: null,
    });
  }
  return finish("법인카드", "우리카드 거래내역(회원별)", out, skipped, rawCsv);
}

/* ================================================================== */
/* ERP 2단계 — 홈택스 전자세금계산서 목록 (2026-08-24)                   */

export interface NormalizedTaxInvoice {
  direction: "매출" | "매입";
  approvalNo: string;
  /** 작성일자 YYYY-MM-DD */
  writeDate: string;
  issueDate: string | null;
  /** 상대방 사업자번호 — 숫자만 (매입=공급자, 매출=공급받는자) */
  counterBizNo: string;
  counterName: string;
  supplyAmount: number;
  vat: number;
  total: number;
  itemSummary: string | null;
}

export interface TaxParseResult {
  source: "홈택스매출" | "홈택스매입";
  formatName: string;
  rows: NormalizedTaxInvoice[];
  skipped: SheetSkip[];
  rawCsv: string;
  periodFrom: string | null;
  periodTo: string | null;
  sumTotal: number;
}

export type AnyFinParse =
  | ({ kind: "cash" } & FinParseResult)
  | ({ kind: "tax" } & TaxParseResult)
  | ({ kind: "cardday" } & CardDayParseResult)
  | ({ kind: "cardtxn" } & CardTxnParseResult)
  | ({ kind: "carddeposit" } & CardDepositParseResult)
  | ({ kind: "postxn" } & PosParseResult);

/**
 * 파일 종류를 가리지 않는 입구 — 업로드 화면은 이것만 부른다.
 * 홈택스 목록이면 세금계산서로, 아니면 자금 움직임(통장·법인카드)으로.
 */
export function parseAnyFin(buf: Buffer, myBizNo: string | null, fileName?: string): AnyFinParse {
  const wb = XLSX.read(buf, { type: "buffer" });
  // ⭐ 토스 포스 매출리포트 (2026-08-26) — 시트 이름으로 바로 알아본다
  const posSheet = wb.SheetNames.find((n) => normHead(n) === "결제상세내역");
  if (posSheet) return { kind: "postxn", ...parseTossPosSheet(wb, posSheet) };
  const name = wb.SheetNames.find((n) => normHead(n) === "세금계산서") ?? wb.SheetNames[0];
  if (name) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" });
    const headText = rows.slice(0, 10).flat().map(normHead).join("|");
    if (headText.includes("세금계산서목록")) {
      return { kind: "tax", ...parseHometaxSheet(wb.Sheets[name], rows, headText, myBizNo) };
    }
    // ERP 3단계 — 여신금융협회 카드매출 (실파일이 합계 형식)
    // 건별 세부내역이 일별 요약보다 먼저 — 제목에 「세부내역」이 들어간다 (2026-08-25)
    if (headText.includes("승인내역") && headText.includes("세부내역")) {
      return { kind: "cardtxn", ...parseCardTxnSheet(wb.Sheets[name], rows) };
    }
    if (headText.includes("일별승인내역")) {
      return { kind: "cardday", ...parseCardDaySheet(wb.Sheets[name], rows) };
    }
    if (headText.includes("월별입금내역")) {
      return { kind: "carddeposit", ...parseCardDepositSheet(wb.Sheets[name], rows) };
    }
  }
  return { kind: "cash", ...parseFinFile(buf, fileName) };
}

/**
 * 홈택스 「전자(수정) 세금계산서 목록」 시트.
 * 실측(2026-08-24): 머리행 5행 — 작성일자·승인번호·발급일자·전송일자·
 * 공급자사업자등록번호·상호·대표자명·주소·공급받는자사업자등록번호·상호(둘째)·…·
 * 합계금액·공급가액·세액. 「상호」가 두 번 나온다(공급자/공급받는자).
 * 방향은 **줄마다 사업자번호로 판정**한다 — 제목 문구는 확인용.
 */
function parseHometaxSheet(
  ws: XLSX.WorkSheet,
  rows: unknown[][],
  headText: string,
  myBizNo: string | null,
): TaxParseResult {
  const my = (myBizNo ?? "").replace(/\D/g, "");
  if (!my) {
    throw new Error("설정 → 가게 정보에 사업자등록번호가 없습니다 — 먼저 넣어 주셔야 매출/매입을 구분할 수 있습니다");
  }
  const h = findHeader(rows, ["작성일자", "승인번호", "공급자사업자등록번호", "합계금액"]);
  if (!h) throw new Error("홈택스 목록의 머리행을 찾지 못했습니다 — 「목록조회」 화면의 엑셀인지 확인해 주세요");

  // 「상호」·「대표자명」이 공급자/공급받는자 순으로 두 번 — 나온 자리 전부 모은다
  const nameCols: number[] = [];
  rows[h.at].forEach((c, j) => {
    if (normHead(c) === "상호") nameCols.push(j);
  });

  const titleSaysBuy = headText.includes("매입");
  const titleSaysSell = headText.includes("매출");

  const out: NormalizedTaxInvoice[] = [];
  const skipped: SheetSkip[] = [];
  for (let i = h.at + 1; i < rows.length; i++) {
    const r = rows[i];
    const approvalNo = String(cell(r, h.col, "승인번호") ?? "").trim();
    const writeDate = toKstDateTime(cell(r, h.col, "작성일자"))?.slice(0, 10) ?? null;
    if (!approvalNo || !writeDate) {
      if (r.some((c) => String(c ?? "").trim() !== "")) skipped.push({ line: i + 1, reason: "승인번호·작성일자를 못 읽음" });
      continue;
    }
    const sellerBiz = String(cell(r, h.col, "공급자사업자등록번호") ?? "").replace(/\D/g, "");
    const buyerBiz = String(cell(r, h.col, "공급받는자사업자등록번호") ?? "").replace(/\D/g, "");
    let direction: "매출" | "매입";
    if (sellerBiz === my) direction = "매출";
    else if (buyerBiz === my) direction = "매입";
    else {
      skipped.push({ line: i + 1, reason: "우리 사업자번호가 공급자에도 공급받는자에도 없음" });
      continue;
    }
    // 제목과 어긋나면 알린다 — 파일이 섞였을 수 있다
    if ((direction === "매입" && titleSaysSell && !titleSaysBuy) || (direction === "매출" && titleSaysBuy && !titleSaysSell)) {
      skipped.push({ line: i + 1, reason: `제목은 ${titleSaysBuy ? "매입" : "매출"}인데 이 줄은 ${direction}` });
      continue;
    }
    const total = toWon(cell(r, h.col, "합계금액"));
    const supply = toWon(cell(r, h.col, "공급가액"));
    if (total === null || supply === null) {
      skipped.push({ line: i + 1, reason: "금액을 못 읽음" });
      continue;
    }
    const vat = toWon(cell(r, h.col, "세액")) ?? total - supply;
    const counterIdx = direction === "매입" ? 0 : 1;
    out.push({
      direction,
      approvalNo,
      writeDate,
      issueDate: toKstDateTime(cell(r, h.col, "발급일자"))?.slice(0, 10) ?? null,
      counterBizNo: direction === "매입" ? sellerBiz : buyerBiz,
      counterName: String(r[nameCols[counterIdx] ?? -1] ?? "").trim() || "(상호 미상)",
      supplyAmount: supply,
      vat,
      total,
      itemSummary: String(cell(r, h.col, "품목명") ?? "").trim() || null,
    });
  }

  const buys = out.filter((r) => r.direction === "매입").length;
  const sells = out.length - buys;
  if (buys > 0 && sells > 0) {
    throw new Error(`한 파일에 매입 ${buys}건·매출 ${sells}건이 섞여 있습니다 — 홈택스에서 따로 내려받아 주세요`);
  }
  if (out.length === 0) throw new Error("읽을 수 있는 세금계산서 줄이 없습니다");
  const dates = out.map((r) => r.writeDate).sort();
  return {
    source: buys > 0 ? "홈택스매입" : "홈택스매출",
    formatName: `홈택스 전자세금계산서 목록 (${buys > 0 ? "매입" : "매출"})`,
    rows: out,
    skipped,
    rawCsv: XLSX.utils.sheet_to_csv(ws),
    periodFrom: dates[0] ?? null,
    periodTo: dates[dates.length - 1] ?? null,
    sumTotal: out.reduce((s, r) => s + r.total, 0),
  };
}

/* ================================================================== */
/* ERP 3단계 — 여신금융협회 카드 매출 (2026-08-24)                       */
/* 🔴 실파일 실측: 승인내역은 **일별 합계**, 입금내역은 **월별·카드사별 합계** */

export interface NormalizedCardDay {
  /** YYYY-MM-DD */
  date: string;
  totalAmount: number;
  totalCnt: number;
  approvedAmount: number;
  approvedCnt: number;
  /** 파일 그대로 — 취소는 음수 */
  cancelledAmount: number;
  cancelledCnt: number;
}

export interface CardDayParseResult {
  source: "카드매출승인";
  formatName: string;
  rows: NormalizedCardDay[];
  skipped: SheetSkip[];
  rawCsv: string;
  periodFrom: string | null;
  periodTo: string | null;
  sumTotal: number;
}

function parseCardDaySheet(ws: XLSX.WorkSheet, rows: unknown[][]): CardDayParseResult {
  const h = findHeader(rows, ["거래일자", "승인소계", "취소소계"]);
  if (!h) throw new Error("여신협회 승인내역의 머리행을 찾지 못했습니다");
  const toInt = (v: unknown) => toWon(v) ?? 0;
  const out: NormalizedCardDay[] = [];
  const skipped: SheetSkip[] = [];
  for (let i = h.at + 1; i < rows.length; i++) {
    const r = rows[i];
    const raw = String(cell(r, h.col, "거래일자") ?? "").trim();
    if (raw === "") continue;
    const date = toKstDateTime(raw)?.slice(0, 10) ?? null;
    if (!date) {
      if (!/합계|소계/.test(raw)) skipped.push({ line: i + 1, reason: `거래일자 「${raw}」를 못 읽음` });
      continue;
    }
    out.push({
      date,
      totalAmount: toInt(cell(r, h.col, "거래합계")),
      totalCnt: toInt(cell(r, h.col, "거래건수")),
      approvedAmount: toInt(cell(r, h.col, "승인소계")),
      approvedCnt: toInt(cell(r, h.col, "승인건수")),
      cancelledAmount: toInt(cell(r, h.col, "취소소계")),
      cancelledCnt: toInt(cell(r, h.col, "취소건수")),
    });
  }
  if (out.length === 0) throw new Error("읽을 수 있는 날짜 줄이 없습니다");
  const dates = out.map((r) => r.date).sort();
  return {
    source: "카드매출승인",
    formatName: "여신협회 일별 승인내역",
    rows: out,
    skipped,
    rawCsv: XLSX.utils.sheet_to_csv(ws),
    periodFrom: dates[0] ?? null,
    periodTo: dates[dates.length - 1] ?? null,
    sumTotal: out.reduce((s, r) => s + r.totalAmount, 0),
  };
}

export interface NormalizedCardDeposit {
  /** YYYY-MM */
  month: string;
  cardCo: string;
  saleCnt: number;
  saleAmount: number;
  vatAgency: number;
  depositAmount: number;
}

export interface CardDepositParseResult {
  source: "카드매출입금";
  formatName: string;
  rows: NormalizedCardDeposit[];
  skipped: SheetSkip[];
  rawCsv: string;
  periodFrom: string | null;
  periodTo: string | null;
  sumTotal: number;
}

function parseCardDepositSheet(ws: XLSX.WorkSheet, rows: unknown[][]): CardDepositParseResult {
  const h = findHeader(rows, ["월", "카드사", "입금합계"]);
  if (!h) throw new Error("여신협회 입금내역의 머리행을 찾지 못했습니다");
  const toInt = (v: unknown) => toWon(v) ?? 0;
  const out: NormalizedCardDeposit[] = [];
  const skipped: SheetSkip[] = [];
  for (let i = h.at + 1; i < rows.length; i++) {
    const r = rows[i];
    const month = String(cell(r, h.col, "월") ?? "").trim();
    const cardCo = String(cell(r, h.col, "카드사") ?? "").trim();
    if (month === "" && cardCo === "") continue;
    if (!/^\d{4}-\d{2}$/.test(month)) {
      if (!/합계|소계/.test(month + cardCo)) skipped.push({ line: i + 1, reason: `월 「${month}」을 못 읽음` });
      continue;
    }
    out.push({
      month,
      cardCo: cardCo || "(카드사 미상)",
      saleCnt: toInt(cell(r, h.col, "매출건수")),
      saleAmount: toInt(cell(r, h.col, "매출합계")),
      vatAgency: toInt(cell(r, h.col, "부가세대리납부금액")),
      depositAmount: toInt(cell(r, h.col, "입금합계")),
    });
  }
  if (out.length === 0) throw new Error("읽을 수 있는 월 줄이 없습니다");
  const months = out.map((r) => r.month).sort();
  return {
    source: "카드매출입금",
    formatName: "여신협회 월별 입금내역",
    rows: out,
    skipped,
    rawCsv: XLSX.utils.sheet_to_csv(ws),
    periodFrom: months[0] ? months[0] + "-01" : null,
    periodTo: months[months.length - 1] ? months[months.length - 1] + "-01" : null,
    sumTotal: out.reduce((s, r) => s + r.depositAmount, 0),
  };
}

/* ================================================================== */
/* 카드 매출 건별 승인 — 여신협회 「기간별 승인내역 - 세부내역」 (2026-08-25) */

export interface NormalizedCardTxn {
  /** KST "YYYY-MM-DD HH:mm:ss" */
  approvedAt: string;
  cardCo: string;
  cardNoMasked: string | null;
  approvalNo: string;
  /** 취소는 음수 (파일 그대로) */
  amount: number;
  isCancel: boolean;
  installment: string | null;
}

export interface CardTxnParseResult {
  source: "카드매출승인";
  formatName: string;
  rows: NormalizedCardTxn[];
  skipped: SheetSkip[];
  rawCsv: string;
  periodFrom: string | null;
  periodTo: string | null;
  sumTotal: number;
}

function parseCardTxnSheet(ws: XLSX.WorkSheet, rows: unknown[][]): CardTxnParseResult {
  const h = findHeader(rows, ["거래일자", "승인번호", "승인금액", "구분"]);
  if (!h) throw new Error("여신협회 세부 승인내역의 머리행을 찾지 못했습니다");
  const out: NormalizedCardTxn[] = [];
  const skipped: SheetSkip[] = [];
  for (let i = h.at + 1; i < rows.length; i++) {
    const r = rows[i];
    const kind = String(cell(r, h.col, "구분") ?? "").trim();
    if (kind !== "승인" && kind !== "취소") continue; // 위 요약·아래 합계 줄
    const date = toKstDateTime(cell(r, h.col, "거래일자"))?.slice(0, 10) ?? null;
    const approvalNo = String(cell(r, h.col, "승인번호") ?? "").trim();
    const amount = toWon(cell(r, h.col, "승인금액"));
    if (!date || !approvalNo || amount === null) {
      skipped.push({ line: i + 1, reason: "일자·승인번호·금액을 못 읽음" });
      continue;
    }
    const time = String(cell(r, h.col, "거래시간") ?? "").trim();
    const inst = String(cell(r, h.col, "할부기간") ?? "").trim();
    // 🔴 감사 M11(2026-08-25): 취소가 양수로 오는 파일 대비 — 다른 파서와 같은 부호 규칙
    const signed = kind === "취소" && amount > 0 ? -amount : amount;
    out.push({
      approvedAt: `${date} ${/^\d{1,2}:\d{2}(:\d{2})?$/.test(time) ? time.padStart(8, "0") : "00:00:00"}`,
      cardCo: String(cell(r, h.col, "카드사") ?? "").trim() || "(카드사 미상)",
      cardNoMasked: String(cell(r, h.col, "카드번호") ?? "").trim() || null,
      approvalNo,
      amount: signed,
      isCancel: kind === "취소",
      installment: inst && inst !== "일시불" && inst !== "0 개월" && inst !== "00개월" ? inst : null,
    });
  }
  if (out.length === 0) throw new Error("읽을 수 있는 승인 줄이 없습니다");
  const dates = out.map((r) => r.approvedAt.slice(0, 10)).sort();
  return {
    source: "카드매출승인",
    formatName: "여신협회 승인내역 세부(건별)",
    rows: out,
    skipped,
    rawCsv: XLSX.utils.sheet_to_csv(ws),
    periodFrom: dates[0] ?? null,
    periodTo: dates[dates.length - 1] ?? null,
    sumTotal: out.reduce((s, r) => s + r.amount, 0),
  };
}

/* ================================================================== */
/* 토스 포스 매출리포트 「결제 상세내역」 (사장님 요청 2026-08-26 — 카드 일마감)   */

export interface NormalizedPosTxn {
  /** 결제기준일자 YYYY-MM-DD */
  day: string;
  /** 결제시각 KST "YYYY-MM-DD HH:mm:ss" */
  paidAt: string;
  channel: string | null;
  orderNo: string | null;
  /** 카드·현금·QR결제·계좌이체·선불지급수단·기타 */
  method: string;
  cardCo: string | null;
  /** 취소는 음수 */
  amount: number;
  vat: number | null;
  isCancel: boolean;
  cancelAt: string | null;
}

export interface PosParseResult {
  source: "토스포스";
  formatName: string;
  rows: NormalizedPosTxn[];
  skipped: SheetSkip[];
  rawCsv: string;
  periodFrom: string | null;
  periodTo: string | null;
  /** 카드 결제 합 (취소 반영) */
  sumTotal: number;
}

/**
 * 실측(2026-08-26): 머리행 = 결제기준일자·결제시각·주문채널·주문번호·결제건수·결제금액·부가세·결제수단·
 * 매입사·결제상태·결제취소시각. 2행은 설명 행(주문번호 칸에 "결제가 포함된 주문의 주문번호").
 * 🔴 승인번호가 없다 — 건 식별은 결제시각(초)+금액+매입사+상태 (fin-ingest dedup).
 */
function parseTossPosSheet(wb: XLSX.WorkBook, sheetName: string): PosParseResult {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
  const h = findHeader(rows, ["결제기준일자", "결제시각", "결제금액", "결제수단", "결제상태"]);
  if (!h) throw new Error("토스 포스 매출리포트의 「결제 상세내역」 머리행을 찾지 못했습니다");
  const out: NormalizedPosTxn[] = [];
  const skipped: SheetSkip[] = [];
  for (let i = h.at + 1; i < rows.length; i++) {
    const r = rows[i];
    const day = toKstDateTime(cell(r, h.col, "결제기준일자"))?.slice(0, 10) ?? null;
    const paidAt = toKstDateTime(cell(r, h.col, "결제시각"));
    const amount = toWon(cell(r, h.col, "결제금액"));
    const status = String(cell(r, h.col, "결제상태") ?? "").trim();
    if (!day && !paidAt && amount === null) continue; // 설명 행·빈 행
    if (!day || !paidAt || amount === null) {
      skipped.push({ line: i + 1, reason: "일자·시각·금액을 못 읽음" });
      continue;
    }
    const isCancel = status.includes("취소");
    const signed = isCancel && amount > 0 ? -amount : amount;
    const cardCo = String(cell(r, h.col, "매입사") ?? "").trim();
    out.push({
      day,
      paidAt,
      channel: String(cell(r, h.col, "주문채널") ?? "").trim() || null,
      orderNo: String(cell(r, h.col, "주문번호") ?? "").trim() || null,
      method: String(cell(r, h.col, "결제수단") ?? "").trim() || "기타",
      cardCo: cardCo || null,
      amount: signed,
      vat: toWon(cell(r, h.col, "부가세")),
      isCancel,
      cancelAt: toKstDateTime(cell(r, h.col, "결제취소시각")),
    });
  }
  // 「결제 합계」 시트의 결제금액과 견줘 본다 — 다르면 못 읽은 줄이 있다는 뜻
  const sumSheet = wb.SheetNames.find((n) => normHead(n) === "결제합계");
  if (sumSheet) {
    const srows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sumSheet], { header: 1, raw: false, defval: "" });
    const sh = findHeader(srows, ["기간", "결제금액"], 5);
    if (sh) {
      let declared = 0;
      for (let i = sh.at + 1; i < srows.length; i++) declared += toWon(cell(srows[i], sh.col, "결제금액")) ?? 0;
      const got = out.filter((r) => !r.isCancel).reduce((s, r) => s + r.amount, 0) + out.filter((r) => r.isCancel).reduce((s, r) => s + r.amount, 0);
      if (declared > 0 && declared !== got) skipped.push({ line: 0, reason: `결제 합계 시트 ${declared.toLocaleString()}원과 상세 합 ${got.toLocaleString()}원이 다릅니다` });
    }
  }
  if (out.length === 0) throw new Error("읽을 수 있는 결제 줄이 없습니다 — 그 날 결제가 없었거나 다른 파일입니다");
  const days = out.map((r) => r.day).sort();
  return {
    source: "토스포스",
    formatName: "토스 포스 매출리포트 (결제 상세내역)",
    rows: out,
    skipped,
    rawCsv: XLSX.utils.sheet_to_csv(ws),
    periodFrom: days[0] ?? null,
    periodTo: days[days.length - 1] ?? null,
    sumTotal: out.filter((r) => r.method === "카드").reduce((s, r) => s + r.amount, 0),
  };
}

/* ================================================================== */
/* 법인카드 새 형식 2종 (2026-08-25 사장님 파일 갱신)                     */

/** 신한 「법인이용내역(전체)」 — 머리행 0행, 국내·해외 통합, 음수 = 취소·환불.
 *  🔴 같은 승인번호로 +/− 취소쌍이 온다 (실측) — 중복 키에 금액이 들어가야 한다 */
function parseShinhanCard(rows: unknown[][], h: { at: number; col: Map<string, number> }, rawCsv: string): FinParseResult {
  const out: NormalizedCashTxn[] = [];
  const skipped: SheetSkip[] = [];
  for (let i = h.at + 1; i < rows.length; i++) {
    const r = rows[i];
    const when = toKstDateTime(cell(r, h.col, "이용일시"));
    if (!when) continue;
    const amt = toWon(cell(r, h.col, "이용금액"));
    if (amt === null) {
      skipped.push({ line: i + 1, reason: "이용금액을 못 읽음" });
      continue;
    }
    if (amt === 0) continue; // 안내 수수료 0원 줄
    const inst = String(cell(r, h.col, "할부개월수") ?? "").trim();
    out.push({
      source: "법인카드",
      occurredAt: when,
      description: String(cell(r, h.col, "가맹점명") ?? "").trim() || "(가맹점 미상)",
      inAmount: 0,
      outAmount: amt,
      balance: null,
      approvalNo: String(cell(r, h.col, "승인번호") ?? "").trim() || null,
      bizNo: null,
      installment: inst && inst !== "0" ? `${inst}개월` : null,
      branch: String(cell(r, h.col, "이용지역") ?? "").trim() || null,
      payerCode: null,
    });
  }
  return finish("법인카드", "신한카드 법인이용내역(전체)", out, skipped, rawCsv);
}

/**
 * ⭐ 우리 「승인 상세내역」(승인 기준) — 사장님 제보 2026-08-29
 *
 *   실측(report (3).xls, 2026-08-01~08-27 80줄): 제목행 「승인 상세내역」, 머리행 3행 —
 *   이용일자(`2026.08.27 19:55`) · 승인번호 · 이용카드 · 이용가맹점(은행)명 · 가맹점 주소 ·
 *   연락처 · 업종 · 사업자번호 · 매출구분 · 할부개월 · 승인금액 · 부가세 · 취소금액.
 *
 *   청구서(이용대금 상세내역)보다 낫다 — 연·시각이 있어 파일 이름에 기대지 않고,
 *   승인번호가 있어 중복 방지가 튼튼하며(`카드|계정|승인번호|일자|금액`),
 *   사업자번호가 있어 나중에 매입세금계산서와 견줄 수 있다.
 *
 *   🔴 같은 기간을 청구서로도 올리면 **중복**이다 (승인번호 유무로 키 모양이 갈린다).
 *      fin-upload 의 미리보기가 겹치는 기간을 세어 경고한다.
 */
function parseWooriApproval(rows: unknown[][], h: { at: number; col: Map<string, number> }, rawCsv: string): FinParseResult {
  const merKey = [...h.col.keys()].find((k) => k.startsWith("이용가맹점")) ?? "이용가맹점(은행)명";
  const out: NormalizedCashTxn[] = [];
  const skipped: SheetSkip[] = [];
  for (let i = h.at + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every((c) => String(c ?? "").trim() === "")) continue;
    const when = toKstDateTime(cell(r, h.col, "이용일자"));
    if (!when) {
      const raw = String(cell(r, h.col, "이용일자") ?? "").trim();
      // 🔴 여러 쪽짜리 파일은 중간에 머리행이 되풀이된다 — 못 읽은 줄이 아니다 (실측 report(3).xls)
      if (raw !== "" && normHead(raw) !== "이용일자" && !/합계|소계|총/.test(raw)) {
        skipped.push({ line: i + 1, reason: `이용일자 「${raw}」를 못 읽음` });
      }
      continue;
    }
    const appr = toWon(cell(r, h.col, "승인금액"));
    if (appr === null) {
      skipped.push({ line: i + 1, reason: "승인금액을 못 읽음" });
      continue;
    }
    /* 취소금액이 붙어 오면 **순액**으로 적는다 — 합계가 그대로 맞고 줄이 늘지 않는다.
       (실측 파일은 취소금액이 전부 0이었다. 0이 아닌 날을 대비해 설명에 남긴다) */
    const cancel = toWon(cell(r, h.col, "취소금액")) ?? 0;
    const net = appr - Math.abs(cancel);
    if (net === 0) {
      // 취소가 승인과 같은 액이면 남은 돈이 0이다 — 못 읽은 게 아니라 넣을 것이 없는 줄이다
      if (appr !== 0) {
        skipped.push({ line: i + 1, reason: `승인 ${appr.toLocaleString()}원을 전액 취소 — 넣을 돈이 없습니다`, expected: true });
      }
      continue;
    }
    const inst = String(cell(r, h.col, "할부개월") ?? "").trim();
    const kind = String(cell(r, h.col, "매출구분") ?? "").trim();
    const merchant = String(cell(r, h.col, merKey) ?? "").trim() || "(가맹점 미상)";
    out.push({
      source: "법인카드",
      occurredAt: when,
      description: cancel !== 0 ? `${merchant} (취소 ${Math.abs(cancel).toLocaleString()}원 반영)` : merchant,
      inAmount: 0,
      outAmount: net,
      balance: null,
      approvalNo: String(cell(r, h.col, "승인번호") ?? "").trim() || null,
      bizNo: String(cell(r, h.col, "사업자번호") ?? "").replace(/\D/g, "") || null,
      installment: inst && inst !== "0" ? `${inst}개월` : kind && kind !== "일시불" ? kind : null,
      branch: String(cell(r, h.col, "업종") ?? "").trim() || null,
      payerCode: null,
    });
  }
  if (out.length === 0) throw new Error("읽을 수 있는 승인 줄이 없습니다");
  return finish("법인카드", "우리카드 승인 상세내역", out, skipped, rawCsv);
}

/** 우리 「이용대금 상세내역」(청구서) — 이용일자가 MM.DD 뿐이라 연도는 파일 이름(2026.8)에서.
 *  ⚠️ 승인번호가 없어 「거래내역(회원별)」·「승인 상세내역」과 같은 기간을 둘 다 올리면 중복이 된다 —
 *     우리카드는 한 형식만 쓰는 것이 안전하다 (중복 키가 서로 다른 글자라 못 걸러냄).
 *     fin-upload 미리보기가 겹치는 기간을 세어 경고한다 (2026-08-29) */
function parseWooriBill(rows: unknown[][], rawCsv: string, fileName?: string): FinParseResult {
  const m = /(20\d{2})[.\-년 ]*(\d{1,2})/.exec(fileName ?? "");
  if (!m) throw new Error("우리카드 청구서에는 연도가 없습니다 — 파일 이름에 「2026.8」처럼 연·월을 넣어 주세요");
  const billY = Number(m[1]);
  const billM = Number(m[2]);

  let at = -1;
  const col = new Map<string, number>();
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const c = new Map<string, number>();
    rows[i].forEach((v, j) => {
      const hh = normHead(v);
      if (hh && !c.has(hh)) c.set(hh, j);
    });
    if (c.has("이용일자") && [...c.keys()].some((k) => k.startsWith("이용금액"))) {
      at = i;
      c.forEach((v, k) => col.set(k, v));
      break;
    }
  }
  if (at < 0) throw new Error("우리카드 청구서의 머리행을 찾지 못했습니다");
  const amtKey = [...col.keys()].find((k) => k.startsWith("이용금액"))!;
  const merKey = [...col.keys()].find((k) => k.startsWith("이용가맹점")) ?? "이용가맹점(은행)명";

  const pad = (n: number) => String(n).padStart(2, "0");
  const out: NormalizedCashTxn[] = [];
  const skipped: SheetSkip[] = [];
  for (let i = at + 1; i < rows.length; i++) {
    const r = rows[i];
    const dateRaw = String(cell(r, col, "이용일자") ?? "").trim();
    const dm = /^(\d{1,2})[./](\d{1,2})$/.exec(dateRaw);
    if (!dm) {
      // 🔴 감사 M12: 값이 있는데 못 읽으면 기록한다 (빈 줄·합계·되풀이 머리행은 제외)
      if (dateRaw !== "" && normHead(dateRaw) !== "이용일자" && !/합계|소계|총/.test(dateRaw)) {
        skipped.push({ line: i + 1, reason: `이용일자 「${dateRaw}」를 못 읽음` });
      }
      continue;
    }
    const mm = Number(dm[1]);
    const dd = Number(dm[2]);
    const year = mm > billM ? billY - 1 : billY; // 1월 청구서의 12월 이용분
    const amt = toWon(cell(r, col, amtKey));
    if (amt === null || amt === 0) continue;
    const inst = String(cell(r, col, "할부개월") ?? "").trim();
    out.push({
      source: "법인카드",
      occurredAt: `${year}-${pad(mm)}-${pad(dd)} 00:00:00`,
      description: String(cell(r, col, merKey) ?? "").trim() || "(가맹점 미상)",
      inAmount: 0,
      outAmount: amt,
      balance: null,
      approvalNo: null,
      bizNo: null,
      installment: inst && inst !== "일시불" ? inst : null,
      branch: null,
      payerCode: null,
    });
  }
  if (out.length === 0) throw new Error("읽을 수 있는 이용 줄이 없습니다");
  return finish("법인카드", `우리카드 이용대금 상세내역 (${billY}.${billM} 청구분)`, out, skipped, rawCsv);
}
