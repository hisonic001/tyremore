/**
 * ⭐ 발행 대행 메일 → 「계산서 도착 알림」 (순수 함수 — DB 없음) (2026-11-17, D-41 보강)
 *
 *   팝빌·bill36524(WEHAGO)·스마트빌·바로빌·이카운트 메일에는 **국세청 승인번호가 없다**(상세는 「보기」 링크 너머,
 *   그 화면은 브라우저 스크립트로만 뜬다 — 서버에서 열면 빈 틀). 그래서 장부(tax_invoice)에는 넣지 않고,
 *   홈택스 목록 엑셀(정본)과 맞춰 **빠진 계산서**를 찾는 데 쓴다(사장님 결정 2026-11-17).
 *
 *   공급자 이름은 **제목**이 가장 일정하다:
 *     팝빌      「[미쉐린코리아(주)]에서 전자세금계산서가 발행 되었습니다.」
 *     스마트빌  「[전자세금계산서 정발행] 한국타이어 티스테이션 양양점 ▶ 주식회사 싸이오토모티브」
 *     bill36524 「[(주)트랜스코스모스코리아 박순미님]으로부터 발행 세금계산서가 도착했습니다.」
 *     바로빌    「진양윤활유님으로부터 전자세금계산서가 발급되었습니다.」
 *     이카운트  「[주식회사 딜러타이어](으)로부터 [전자(세금)계산서](이)가 도착했습니다.」
 *   날짜·금액은 본문 글자에서 라벨 옆 값을 읽는다(구글 스크립트가 HTML 본문을 보내고 태그를 지운 글자).
 */

export type NoticeVendor = "팝빌" | "bill36524" | "스마트빌" | "바로빌" | "이카운트";

export interface TaxMailNotice {
  vendor: NoticeVendor;
  /** 매입 = 상대가 우리에게 발행 · 매출 = 우리가 발행 · 역발행요청 = 상대가 우리에게 발행을 요청 */
  kind: "매입" | "매출" | "역발행요청";
  supplier: string;
  /** 작성일자 YYYY-MM-DD (이카운트는 발행일자) */
  writeDate: string | null;
  /** 이카운트처럼 작성일자가 아니라 발행일자만 있으면 false — 대조 때 날짜 폭을 넓힌다 */
  exactDate: boolean;
  supplyAmount: number | null;
  vat: number | null;
  item: string | null;
  /** 대행사 자체 관리번호(bill36524) · 조회코드(바로빌) */
  ref: string | null;
}

const OUR_NAMES = /싸이오토|타이어모어|psi\s*auto/i;

export function vendorOf(sender: string): NoticeVendor | null {
  const s = sender.toLowerCase();
  if (s.includes("popbill.com")) return "팝빌";
  if (s.includes("bill36524.com") || s.includes("wehago.com")) return "bill36524";
  if (s.includes("businesson.co.kr") || s.includes("smartbill.co.kr")) return "스마트빌";
  if (s.includes("barobill.co.kr")) return "바로빌";
  if (s.includes("ecount.com")) return "이카운트";
  return null;
}

/** HTML 본문 → 「라벨 | 값」 모양의 한 줄 글자 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, " ");
}

const ymd = (s: string | undefined) => {
  const m = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(s ?? "");
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
};
/** 라벨 바로 뒤(구분자 「|」「:」 공백 건너) 값 */
function after(text: string, label: RegExp, value: RegExp): string | null {
  const m = new RegExp(`(?:${label.source})\\s*[|:]*\\s*(${value.source})`).exec(text);
  return m ? m[1] : null;
}
const money = (s: string | null) => (s == null ? null : Number(s.replace(/[^\d-]/g, "")) || 0);

function supplierFromSubject(vendor: NoticeVendor, subject: string): string | null {
  const s = subject.trim();
  let m: RegExpExecArray | null = null;
  if (vendor === "팝빌") m = /^\[(.+?)\]\s*에서/.exec(s);
  else if (vendor === "스마트빌") m = /\]\s*(.+?)\s*▶/.exec(s);
  else if (vendor === "bill36524") {
    m = /^\[(.+?)\]\s*으로부터/.exec(s);
    if (m) return m[1].replace(/\s+\S+님$/, "").trim();
  } else if (vendor === "바로빌") m = /^(.+?)님으로부터/.exec(s);
  else if (vendor === "이카운트") m = /^\[(.+?)\]\s*\(으\)로부터/.exec(s);
  return m ? m[1].trim() : null;
}

/** 메일 하나 → 도착 알림. 계산서 메일이 아니면 null */
export function parseTaxMailNotice(sender: string, subject: string, bodyText: string): TaxMailNotice | null {
  const vendor = vendorOf(sender);
  if (!vendor) return null;
  if (!/계산서/.test(subject + bodyText)) return null;
  const t = bodyText.replace(/\s+/g, " ");

  const supplier = supplierFromSubject(vendor, subject);
  if (!supplier) return null;

  const kind: TaxMailNotice["kind"] = /역발행/.test(subject) && !/정발행/.test(subject)
    ? "역발행요청"
    : OUR_NAMES.test(supplier)
      ? "매출"
      : "매입";

  const wd = after(t, /작성일자/, /\d{4}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2}/);
  const issued = after(t, /발행일자/, /\d{4}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2}/);
  const supply = money(after(t, /공급가액/, /-?[\d,]+/));
  const vat = money(after(t, /부가세액|세액/, /-?[\d,]+/));
  const item = after(t, /품목/, /[^|]{1,80}/)?.trim() ?? null;
  const ref = after(t, /관리번호|조회코드/, /[A-Za-z0-9-]{6,40}/);

  return {
    vendor,
    kind,
    supplier,
    writeDate: ymd(wd ?? issued ?? undefined),
    exactDate: !!wd,
    supplyAmount: supply,
    vat,
    item,
    ref,
  };
}

/* ------------------------------------------------------------------ */
/* 홈택스 목록(tax_invoice)과 대조                                       */

export interface TaxInvoiceLite {
  id: number;
  approvalNo: string;
  direction: "매입" | "매출";
  writeDate: string;
  counterName: string;
  supplyAmount: number;
}

/** 기본 이름 비교 — 실제 보고서는 recon-data.samePartyName(정본)을 넘긴다 */
export function looseSameName(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\s|[()\[\]·.,-]/g, "").toLowerCase();
  const x = n(a);
  const y = n(b);
  if (x.length < 2 || y.length < 2) return false;
  return x === y || (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x)));
}

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * 알림 하나에 맞는 홈택스 계산서. 이름이 같고, 날짜가 같고(발행일자뿐이면 ±7일), 금액이 있으면 공급가액도 같아야 한다.
 * 후보가 여럿이면 금액·날짜가 가장 잘 맞는 하나, 그래도 갈리지 않으면 null(사람이 본다).
 */
export function matchNoticeToTaxInvoice(
  n: TaxMailNotice,
  invoices: readonly TaxInvoiceLite[],
  sameName: (a: string, b: string) => boolean = looseSameName,
): TaxInvoiceLite | null {
  if (n.kind === "역발행요청" || !n.writeDate) return null;
  const dir = n.kind === "매출" ? "매출" : "매입";
  const win = n.exactDate ? 0 : 7;
  const cands = invoices.filter(
    (i) =>
      i.direction === dir &&
      days(i.writeDate, n.writeDate!) <= win &&
      (n.supplyAmount == null || i.supplyAmount === n.supplyAmount) &&
      sameName(n.supplier, i.counterName),
  );
  if (cands.length <= 1) return cands[0] ?? null;
  const exactDay = cands.filter((i) => i.writeDate === n.writeDate);
  return exactDay.length === 1 ? exactDay[0] : null;
}

/* ------------------------------------------------------------------ */
/* 메일 「속보」 계산서 (2026-11-25 사장님 결정 — 매일 반영)                */
/*
 *   통장 폰 알림(「알림|」 dedup_key)과 같은 꼴이다:
 *     메일이 오면 → tax_invoice 에 승인번호 자리에 「알림|mail:<메일ID>」를 넣은 **속보 줄**
 *     홈택스 엑셀(또는 홈택스 보안메일)이 오면 → fin-ingest 가 그 줄을 **진짜 내용으로 덮는다**
 *       (새 줄을 더 만들지 않는다 → 이중 계상 없음, 이미 걸린 대조도 산다)
 *
 *   🔴 금액이 메일에 있는 대행사만 — 팝빌·bill36524. 스마트빌·이카운트·바로빌 메일에는 금액이 **없다**
 *      (2026-11-25 실물 87통: 팝빌 48·bill36524 9 는 공급가·세액 있음, 스마트빌 24·이카운트 5·바로빌 1 은 없음).
 *      금액 모르는 계산서를 0원으로 넣으면 장부·부가세 합계가 틀어진다 → 그것들은 지금처럼 도착 알림만.
 */

export const TAX_NOTICE_KEY_PREFIX = "알림|";

/** 속보 줄의 승인번호 자리 — 메일 하나에 한 줄 (같은 메일이 두 번 와도 한 줄) */
export function noticeApprovalKey(messageId: string): string {
  return `${TAX_NOTICE_KEY_PREFIX}mail:${messageId}`;
}

export function isNoticeKey(approvalNo: string | null | undefined): boolean {
  return !!approvalNo && approvalNo.startsWith(TAX_NOTICE_KEY_PREFIX);
}

/** 속보로 넣을 수 있나 — 못 넣으면 까닭 */
export function provisionBlocker(n: TaxMailNotice): string | null {
  if (n.kind === "역발행요청") return "역발행 요청 — 아직 발행 전이라 장부에 넣지 않음";
  if (!n.writeDate || !n.exactDate) return "메일에 작성일자가 없어 장부에 넣지 않음";
  if (n.supplyAmount == null || n.vat == null) return "메일에 금액이 없어 장부에 넣지 않음(홈택스 엑셀이 올라오면 들어감)";
  if (n.supplyAmount === 0 && n.vat === 0) return "금액 0원 — 장부에 넣지 않음";
  return null;
}

export interface TaxRowLite {
  direction: "매입" | "매출";
  writeDate: string;
  counterName: string;
  supplyAmount: number;
}

/**
 * 홈택스 줄 ↔ 속보 줄 짝짓기 (fin-ingest 가 부른다). 두 번 돈다:
 *   1차 — 같은 구분·같은 작성일·같은 공급가·같은 상대 이름. 후보가 정확히 하나일 때만.
 *   2차 — 1차에 안 붙은 것끼리, 같은 구분·작성일·이름 후보가 **정확히 하나**면(금액 정정) 붙인다.
 *   애매하면 짝짓지 않는다 → 속보 줄이 남아 「엑셀에 없는 속보」로 드러난다(사람이 본다).
 * 반환: 홈택스 줄 순번 → 속보 줄 id
 */
export function pairStatementToNotices(
  rows: readonly TaxRowLite[],
  notices: readonly TaxInvoiceLite[],
  sameName: (a: string, b: string) => boolean = looseSameName,
): Map<number, number> {
  const out = new Map<number, number>();
  const taken = new Set<number>();
  const cand = (r: TaxRowLite, withAmount: boolean) =>
    notices.filter(
      (p) =>
        !taken.has(p.id) &&
        p.direction === r.direction &&
        p.writeDate === r.writeDate &&
        (!withAmount || p.supplyAmount === r.supplyAmount) &&
        sameName(r.counterName, p.counterName),
    );
  for (const withAmount of [true, false]) {
    rows.forEach((r, i) => {
      if (out.has(i)) return;
      const c = cand(r, withAmount);
      if (c.length !== 1) return;
      // 2차: 같은 날 같은 상대의 홈택스 줄이 둘 이상 남아 있으면 어느 것인지 모른다
      if (!withAmount) {
        const rivals = rows.filter((x, j) => !out.has(j) && x.direction === r.direction && x.writeDate === r.writeDate && sameName(x.counterName, c[0].counterName));
        if (rivals.length !== 1) return;
      }
      out.set(i, c[0].id);
      taken.add(c[0].id);
    });
  }
  return out;
}
