/**
 * ⭐ 거래처 월 청구서 엑셀 (사장님 요청 2026-09-01 · **실제 양식 반영 2026-09-10**)
 *
 *   수기 「9월 렌트카 수리비.xlsx」를 읽어 보니 **양식이 거래처마다 달랐다**:
 *     쏘카     번호 | 차량번호 | 점검내용 | 정비금액 | 최종금액 | 승인금액 | 등록
 *     AJ       차량번호 | 점검내용 | 정비금액 | 최종승인금액 | 정비완료 | 결제승인 | VAT포함금액
 *     레드캡   차량번호 | 점검내용 | 점검비 | 최종금액 | 정비완료 | 팀장승인
 *     현대캐피탈 차량번호 | 점검내용 | 공급가격(VAT 별도) | 공급가격(VAT포함) | 승인
 *   한 차량(=판매 한 건)이 여러 줄이고 차량번호·번호·체크 칸은 **병합**돼 있다.
 *   그래서 열 구성을 **자료(InvoiceFormat)로** 두고, 정의가 없는 거래처는 예전
 *   공용 양식 그대로 나간다.
 *
 * 🔴 **관제비 역산의 근거** — 「최종금액」은 카랑 관제 수수료(사장님 말씀:
 *    "관제비라고 카랑에서 받는 수수료")를 뺀 뒤 금액이고, **앱 DB에는 이미
 *    그 차감 후 금액이 들어 있다**. 실측: 194허9782 엔진오일 quote_item.final_price
 *    = 48,545 = 엑셀 「최종금액」, 엑셀 「정비금액」 = 51,100. 그러니 청구서의
 *    정가 칸은 저장값을 **÷(1−관제비율)로 역산**해서 만든다 (쏘카 5% —
 *    51,100·16,000·11,000 처럼 딱 떨어지는 것을 실측으로 확인).
 *    ⚠️ 거꾸로, 회신에서 읽은 승인금액은 **차감 후 기준**이라야 우리 청구액과
 *    비교된다 — 거래처가 정가를 그대로 적어 오면 다시 차감해 맞춘다.
 *
 * ⭐ 체크 칸(등록·결제승인·팀장승인)은 **사장님이 직접 체크**하신다 — 거래처
 *    승인을 확인하고 본인 진행 표시로 쓰신다. 그래서 빈 FALSE 로 내보내고,
 *    다시 올릴 때 그 체크를 「그대로 승인」의 신호로 읽는다.
 * ⭐ 관리번호(Q26-…)는 회신 대조용이라 **맨 끝 열**에 좁게 둔다 (눈에 안 거슬리게).
 * 🔴 "use server" 아님 — export route 가 쓴다.
 */
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db";
import { normalizePlate } from "./normalize";
import { settlementLedger } from "./settlement-data";
import { monthRange } from "./ym";
import { parseReplyText, type ReplyRow } from "./settlement-core";

/* ============================================================
 * ① 거래처별 양식 정의 — 자료
 * ========================================================== */
export type InvoiceColKey =
  | "번호"
  | "차량번호"
  | "점검내용"
  | "정가"
  | "최종금액"
  | "승인금액"
  | "체크"
  | "정비완료"
  | "vat합계"
  | "수량"
  | "비고"
  | "관리번호";

export interface InvoiceColumn {
  key: InvoiceColKey;
  /** 거래처가 부르는 이름 그대로 (쏘카 「정비금액」 · AJ 「최종승인금액」) */
  label: string;
  width?: number;
  /** 한 차량(판매 한 건)에 걸쳐 칸을 합칠지 — 사장님 엑셀의 병합 그대로.
   *  병합 칸은 **건 단위 값**(합계·차량번호·체크), 아닌 칸은 줄 단위 값이다 */
  merge?: boolean;
}

export interface InvoiceFormat {
  /** 관제비율 — 카랑 관제 수수료. 쏘카 0.05 (실측 51,100 → 48,545) */
  controlFeeRate: number;
  columns: InvoiceColumn[];
  /** 시트 이름 — 사장님 파일은 거래처 이름이 시트 이름이다 */
  sheetName?: string | null;
  /** 머리글 아래 한 줄 안내 */
  note?: string | null;
}

const COL = {
  번호: { key: "번호", label: "번호", width: 6, merge: true },
  차량번호: { key: "차량번호", label: "차량번호", width: 14, merge: true },
  점검내용: { key: "점검내용", label: "점검내용", width: 34 },
  관리번호: { key: "관리번호", label: "관리번호", width: 13 },
} as const satisfies Record<string, InvoiceColumn>;

/**
 * 실측 양식 (「9월 렌트카 수리비.xlsx」 2026-09-10 판독).
 * 이름은 조금씩 달리 적히므로 별칭으로 찾는다 — 「오픈링크[AJ렌트카]」처럼.
 */
const BUILT_IN: { aliases: string[]; format: InvoiceFormat }[] = [
  {
    aliases: ["쏘카", "소카", "SOCAR"],
    format: {
      controlFeeRate: 0.05, // 카랑 관제비 5% (실측)
      sheetName: "쏘카",
      columns: [
        COL.번호,
        COL.차량번호,
        COL.점검내용,
        { key: "정가", label: "정비금액", width: 11 },
        { key: "최종금액", label: "최종금액", width: 11 },
        { key: "승인금액", label: "승인금액", width: 11 },
        { key: "체크", label: "등록", width: 8, merge: true },
        COL.관리번호,
      ],
    },
  },
  {
    aliases: ["AJ", "AJ렌트카", "AJ렌터카", "오픈링크"],
    format: {
      controlFeeRate: 0, // AJ 는 관제비 차감이 없다 (실측 — 정비금액 그대로)
      sheetName: "AJ",
      columns: [
        COL.차량번호,
        COL.점검내용,
        { key: "정가", label: "정비금액", width: 11 },
        { key: "승인금액", label: "최종승인금액", width: 13 },
        { key: "정비완료", label: "정비완료", width: 10, merge: true },
        { key: "체크", label: "결제승인", width: 9, merge: true },
        { key: "vat합계", label: "VAT포함금액", width: 12, merge: true },
        COL.관리번호,
      ],
      note: "금액은 부가세 별도입니다 — 「VAT포함금액」이 실제 청구액입니다.",
    },
  },
  {
    aliases: ["레드캡", "레드캡투어"],
    format: {
      controlFeeRate: 0,
      sheetName: "레드캡",
      columns: [
        COL.차량번호,
        COL.점검내용,
        { key: "정가", label: "점검비", width: 11 },
        { key: "최종금액", label: "최종금액", width: 11 },
        { key: "정비완료", label: "정비완료", width: 10, merge: true },
        { key: "체크", label: "팀장승인", width: 9, merge: true },
        COL.관리번호,
      ],
    },
  },
  {
    aliases: ["현대캐피탈", "현대캐피탈렌터카"],
    format: {
      controlFeeRate: 0,
      sheetName: "현대캐피탈",
      columns: [
        COL.차량번호,
        COL.점검내용,
        { key: "정가", label: "공급가격(VAT 별도)", width: 14 },
        { key: "vat합계", label: "공급가격(VAT포함)", width: 14 },
        { key: "체크", label: "승인", width: 8, merge: true },
        COL.관리번호,
      ],
    },
  },
];

const nameKey = (s: string) => s.replace(/[\s()[\]·.\-_]/g, "").toUpperCase();

/** 이름으로 실측 양식 찾기 — 없으면 null (공용 양식으로 나간다) */
export function builtInFormat(supplier: string): InvoiceFormat | null {
  const k = nameKey(supplier);
  for (const f of BUILT_IN) {
    if (f.aliases.some((a) => k.includes(nameKey(a)))) return f.format;
  }
  return null;
}

/**
 * 양식 불러오기 — DB 에 settlement_format 표가 있으면 **그쪽이 정본**,
 * 없으면 실측 기본값, 그것도 없으면 null(공용 양식).
 *
 * 🔴 표는 scripts/add-settle-format.ts 로 만든다. 아직 안 만들었어도 여기서
 *    터지면 안 되므로 to_regclass 로 먼저 확인한다.
 */
export async function loadInvoiceFormat(supplier: string): Promise<InvoiceFormat | null> {
  try {
    const [t] = await db.execute<{ t: string | null }>(sql`SELECT to_regclass('settlement_format')::text t`);
    if (t?.t) {
      const [row] = await db.execute<{ control_fee_rate: string; columns: InvoiceColumn[]; sheet_name: string | null; note: string | null }>(sql`
        SELECT control_fee_rate, columns, sheet_name, note
        FROM settlement_format WHERE supplier_name = ${supplier} LIMIT 1
      `);
      if (row && Array.isArray(row.columns) && row.columns.length > 0) {
        return {
          controlFeeRate: Number(row.control_fee_rate) || 0,
          columns: row.columns,
          sheetName: row.sheet_name,
          note: row.note,
        };
      }
    }
  } catch {
    /* 표가 없거나 읽기 실패 — 실측 기본값으로 */
  }
  return builtInFormat(supplier);
}

/**
 * 관제비 역산 — **앱에 든 금액은 이미 차감 후**라서 정가는 나누기로 되살린다.
 * (사장님 엑셀의 「정비금액」 칸. 실측: 48,545 ÷ 0.95 = 51,100)
 */
export function grossFromNet(net: number, rate: number): number {
  if (!rate || rate <= 0 || rate >= 1) return net;
  return Math.round(net / (1 - rate));
}

/** 거꾸로 — 거래처가 정가로 적어 온 승인금액을 우리 기준(차감 후)으로 */
export function netFromGross(gross: number, rate: number): number {
  if (!rate || rate <= 0 || rate >= 1) return gross;
  return Math.round(gross * (1 - rate));
}

/* ============================================================
 * ② 청구서 만들기
 * ========================================================== */
interface SheetRow {
  /** db.execute<T> 가 Record<string, unknown> 를 요구한다 */
  [k: string]: unknown;
  quote_no: string;
  work_date: string;
  plate_no: string | null;
  model: string | null;
  description: string;
  qty: number;
  amount: number;
}

interface Group {
  quoteNo: string;
  workDate: string;
  plateNo: string | null;
  model: string | null;
  rows: SheetRow[];
  /** 우리 청구액 (관제비 차감 후 — 저장값 그대로) */
  net: number;
}

export async function buildInvoiceWorkbook(
  supplier: string,
  ym: string,
): Promise<{ buf: Buffer; total: number; count: number; vatMode: "포함" | "별도" }> {
  const { start, nextStart } = monthRange(ym);
  const [sup] = await db.execute<{ vat_mode: string }>(sql`
    SELECT vat_mode FROM supplier WHERE name = ${supplier} LIMIT 1
  `);
  const vatMode = (sup?.vat_mode === "별도" ? "별도" : "포함") as "포함" | "별도";

  const rows = await db.execute<SheetRow>(sql`
    SELECT q.quote_no,
           COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)::text work_date,
           v.plate_no, v.model, i.description, i.qty, (i.qty * i.final_price)::int amount
    FROM quote q
    JOIN quote_item i ON i.quote_id = q.id
    LEFT JOIN vehicle v ON v.id = q.vehicle_id
    WHERE q.status = '성사' AND q.payment_method = '외상'
      AND COALESCE(q.supplier_name, q.claim_party) = ${supplier}
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}::date
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
    ORDER BY work_date ASC, q.id ASC, i.id ASC
    LIMIT 2000
  `);

  const quotes = new Set(rows.map((r) => r.quote_no));
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  const format = await loadInvoiceFormat(supplier);
  const wb = XLSX.utils.book_new();
  if (format) {
    const groups = groupByQuote(rows);
    XLSX.utils.book_append_sheet(wb, formattedSheet(supplier, ym, groups, format), sheetName(format, supplier));
  } else {
    XLSX.utils.book_append_sheet(wb, commonSheet(supplier, ym, rows, vatMode, quotes.size, total), "청구내역");
  }
  // ⭐ 관리대장 한 장 더 — 수기 「렌트카_거래처_청구입금_관리대장.xlsx」 자리
  XLSX.utils.book_append_sheet(wb, await ledgerSheet(), "관리대장");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { buf, total, count: quotes.size, vatMode };
}

function sheetName(format: InvoiceFormat, supplier: string): string {
  // 엑셀 시트 이름은 31자·일부 기호 금지
  const n = (format.sheetName || supplier).replace(/[\\/?*[\]:]/g, " ").slice(0, 28).trim();
  return n || "청구내역";
}

function groupByQuote(rows: SheetRow[]): Group[] {
  const out: Group[] = [];
  const by = new Map<string, Group>();
  for (const r of rows) {
    let g = by.get(r.quote_no);
    if (!g) {
      g = { quoteNo: r.quote_no, workDate: r.work_date, plateNo: r.plate_no, model: r.model, rows: [], net: 0 };
      by.set(r.quote_no, g);
      out.push(g);
    }
    g.rows.push(r);
    g.net += Number(r.amount);
  }
  return out;
}

/** 「09-03」 → 「9/3」 (사장님이 점검내용에 적어 오시는 꼴) */
const shortDay = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** ⭐ 사장님 양식대로 — 차량 단위 병합·정가(역산)·최종금액·승인금액·체크 칸 */
function formattedSheet(supplier: string, ym: string, groups: Group[], format: InvoiceFormat): XLSX.WorkSheet {
  const cols = format.columns;
  const rate = format.controlFeeRate;
  const head = cols.map((c) => c.label);

  const HEAD_ROW = format.note ? 2 : 1;
  const aoa: (string | number | boolean | null)[][] = [
    [`${Number(ym.slice(5, 7))}월 ${supplier} 렌터카 정비`],
    ...(format.note ? [[format.note]] : []),
    head,
  ];

  const merges: XLSX.Range[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 } }];
  let sumGross = 0;
  let sumNet = 0;
  let sumVat = 0;

  groups.forEach((g, gi) => {
    const first = aoa.length;
    const gross = grossFromNet(g.net, rate);
    const vat = Math.round(g.net * 1.1);
    sumGross += gross;
    sumNet += g.net;
    sumVat += vat;

    g.rows.forEach((r, ri) => {
      const top = ri === 0;
      const net = Number(r.amount);
      const line = cols.map((c): string | number | boolean | null => {
        switch (c.key) {
          case "번호":
            return top ? gi + 1 : "";
          case "차량번호":
            return top ? [g.plateNo ?? "", g.model ?? ""].filter(Boolean).join("\n") : "";
          case "점검내용":
            // 사장님 표기 그대로 — 첫 줄에만 [9/3] 처럼 날짜를 붙인다
            return top ? `${r.description}[${shortDay(g.workDate)}]` : r.description;
          case "정가":
            // 🔴 저장값은 관제비 차감 후 — 정가는 역산해 되살린다
            return c.merge ? (top ? gross : "") : grossFromNet(net, rate);
          case "최종금액":
            return c.merge ? (top ? g.net : "") : net;
          case "승인금액":
            return ""; // 거래처가 채워 돌려주는 칸
          case "체크":
            // 사장님이 직접 체크하시는 칸 — 엑셀 TRUE/FALSE
            return top ? false : "";
          case "정비완료":
            return top ? g.workDate.slice(5) : "";
          case "vat합계":
            return c.merge ? (top ? vat : "") : Math.round(net * 1.1);
          case "수량":
            return Number(r.qty);
          case "비고":
            return "";
          case "관리번호":
            return g.quoteNo;
          default:
            return "";
        }
      });
      aoa.push(line);
    });

    if (g.rows.length > 1) {
      const last = first + g.rows.length - 1;
      cols.forEach((c, ci) => {
        if (c.merge) merges.push({ s: { r: first, c: ci }, e: { r: last, c: ci } });
      });
    }
  });

  // 합계 줄 — 사장님 파일의 「최종 금액」 줄과 같은 자리
  const sumRow = cols.map((c, i): string | number => {
    if (i === 0) return "최종 금액";
    switch (c.key) {
      case "정가":
        return sumGross;
      case "최종금액":
        return sumNet;
      case "vat합계":
        return sumVat;
      case "점검내용":
        return `${groups.length}건`;
      default:
        return "";
    }
  });
  aoa.push([]);
  aoa.push(sumRow);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  ws["!cols"] = cols.map((c) => ({ wch: c.width ?? 11 }));
  // 금액 칸은 천 단위 쉼표로 — 사장님 파일과 같은 눈맛
  const money: InvoiceColKey[] = ["정가", "최종금액", "승인금액", "vat합계"];
  for (let r = HEAD_ROW + 1; r < aoa.length; r++) {
    cols.forEach((c, ci) => {
      if (!money.includes(c.key)) return;
      const cell = ws[XLSX.utils.encode_cell({ r, c: ci })];
      if (cell && cell.t === "n") cell.z = "#,##0";
    });
  }
  return ws;
}

/** 정의가 없는 거래처 — 지금까지 쓰던 공용 양식 그대로 */
function commonSheet(
  supplier: string,
  ym: string,
  rows: SheetRow[],
  vatMode: "포함" | "별도",
  count: number,
  total: number,
): XLSX.WorkSheet {
  const head =
    vatMode === "별도"
      ? ["관리번호", "작업일", "차량번호", "차종", "점검내용", "수량", "공급가액", "부가세", "합계", "승인금액", "승인", "비고"]
      : ["관리번호", "작업일", "차량번호", "차종", "점검내용", "수량", "금액", "승인금액", "승인", "비고"];

  const body: (string | number)[][] = rows.map((r) => {
    const amt = Number(r.amount);
    const common = [r.quote_no, r.work_date, r.plate_no ?? "", r.model ?? "", r.description, Number(r.qty)];
    return vatMode === "별도"
      ? [...common, amt, Math.round(amt * 0.1), Math.round(amt * 1.1), "", "", ""]
      : [...common, amt, "", "", ""];
  });
  const sumRow =
    vatMode === "별도"
      ? ["합계", "", "", "", `${count}건`, "", total, Math.round(total * 0.1), Math.round(total * 1.1), "", "", ""]
      : ["합계", "", "", "", `${count}건`, "", total, "", "", ""];

  const ws = XLSX.utils.aoa_to_sheet([
    [`${ym} ${supplier} 정비 청구 내역 — 타이어모어 속초점`],
    vatMode === "별도"
      ? ["금액은 부가세 별도이며 「합계」가 청구액입니다. 승인금액·승인 칸을 채워 회신해 주세요."]
      : ["승인금액·승인 칸을 채워 회신해 주세요."],
    head,
    ...body,
    sumRow,
  ]);
  ws["!cols"] = head.map((h) => ({ wch: h === "점검내용" ? 34 : h === "차량번호" || h === "관리번호" ? 13 : 10 }));
  return ws;
}

/**
 * ⭐ 관리대장 시트 — 수기 「렌트카_거래처_청구입금_관리대장.xlsx」 의 「거래내역」과
 *    같은 칸(No./청구일/거래처/내용/청구금액/입금일/입금금액/미수금/상태/비고).
 *    자료는 앱의 정산 회차(settlement_run) 라서 손으로 옮겨 적을 일이 없다.
 */
async function ledgerSheet(): Promise<XLSX.WorkSheet> {
  const head = ["No.", "청구일", "거래처", "내용", "청구금액", "입금일", "입금금액", "미수금", "상태", "비고"];
  let rows: Awaited<ReturnType<typeof settlementLedger>> = [];
  try {
    rows = await settlementLedger();
  } catch {
    /* 대장을 못 읽어도 청구서는 나가야 한다 */
  }
  const body = rows.map((r, i) => {
    const billed = r.billed ?? null;
    const paid = r.deposited ?? null;
    const remain = billed == null ? "" : billed - (paid ?? 0);
    const status =
      billed == null ? r.status : (paid ?? 0) >= billed ? "입금완료" : (paid ?? 0) > 0 ? "일부입금" : "미입금";
    return [
      i + 1,
      r.billedOn ?? "",
      r.supplierName,
      `${r.ym} 차량 수리비`,
      billed ?? "",
      r.depositedOn ?? "",
      paid ?? "",
      remain,
      status,
      r.memo ?? "",
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([
    ["렌트카 거래처 청구 · 입금 관리대장"],
    ["앱의 정산 회차에서 자동으로 만든 표입니다 — 손으로 적던 대장과 같은 칸입니다."],
    [],
    head,
    ...body,
  ]);
  ws["!cols"] = [
    { wch: 5 },
    { wch: 12 },
    { wch: 16 },
    { wch: 26 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 18 },
  ];
  return ws;
}

/* ============================================================
 * ③ 다시 올리기 — 우리가 내보낸 양식을 그대로 읽는다
 *
 *   관리번호로 잇는 게 정석이고, 관리번호가 지워졌으면 차량번호+금액으로
 *   **후보만** 낸다 (자동 확정 금지 — 사람이 확인한다: settlement-paste.ts).
 * ========================================================== */
export interface InvoiceReplyGroup {
  quoteNo: string | null;
  plateRaw: string | null;
  plateNorm: string | null;
  desc: string;
  /** 회신 파일에서 읽은 우리 청구액(관제비 차감 후) 합 — 대조용 */
  net: number | null;
  /** 정가 합 */
  gross: number | null;
  /** 거래처가 적어 온 승인금액 합 (빈칸이면 null) */
  approved: number | null;
  /** 사장님이 체크하신 칸 (등록·결제승인·팀장승인) */
  checked: boolean;
  /** 승인금액 0 이나 비고의 「반려」 표시 */
  rejected: boolean;
  memo: string;
  raw: string;
}

const HEADER_HINT = /차량번호|관리번호|점검내용|정비금액|최종금액|승인금액/;
const PLATE_RE = /(\d{2,3}[가-힣]\s?\d{4})/;
const QUOTE_NO_RE = /(Q\d{2}-\d{4}-\d{3})/;

/** 머리글 이름 → 우리가 아는 열 */
function colKeyOf(label: string): InvoiceColKey | null {
  const s = label.replace(/\s/g, "");
  if (!s) return null;
  if (/관리번호/.test(s)) return "관리번호";
  if (/차량번호|차량/.test(s)) return "차량번호";
  if (/점검내용|정비내역|내용/.test(s)) return "점검내용";
  // 「최종승인금액」·「승인금액」 = 거래처가 채우는 칸. 「팀장승인」·「결제승인」·「등록」 = 체크
  if (/승인/.test(s) && /금액|가/.test(s)) return "승인금액";
  if (/승인|등록|확인|체크|완료여부/.test(s)) return "체크";
  // 현대캐피탈은 「공급가격(VAT 별도)」·「공급가격(VAT포함)」 두 칸이라 별도가 먼저다
  if (/별도|공급가액/.test(s) && !/포함/.test(s)) return "정가";
  if (/VAT|부가|포함금액/i.test(s)) return "vat합계";
  // 사장님 개인 시트의 「관제비 뺀 금액」 = 우리가 말하는 최종금액
  if (/최종|관제비/.test(s)) return "최종금액";
  if (/정비금액|점검비|청구금액|공급가|금액|단가/.test(s)) return "정가";
  if (/정비완료|작업일|일자|날짜/.test(s)) return "정비완료";
  if (/수량/.test(s)) return "수량";
  if (/비고|메모/.test(s)) return "비고";
  return null;
}

const numOf = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v ?? "").replace(/[^\d.-]/g, "");
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
};

const boolOf = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toUpperCase();
  return ["TRUE", "O", "V", "Y", "YES", "1", "예", "완료", "체크", "승인"].includes(s);
};

/**
 * 우리 양식(또는 사장님 양식)을 열 단위로 읽는다.
 * 병합 칸은 아래 줄이 빈칸으로 오므로 **위 값을 이어받아** 한 차량으로 묶는다.
 * 못 알아보면 빈 배열 — 부르는 쪽이 글 해석(parseReplyText)으로 넘어간다.
 */
export function parseInvoiceReplySheets(buf: Buffer | ArrayBuffer): InvoiceReplyGroup[] {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? "array" : "buffer" });
  const out: InvoiceReplyGroup[] = [];

  for (const name of wb.SheetNames) {
    if (name === "관리대장") continue; // 우리가 같이 넣어 보낸 대장은 청구 줄이 아니다
    const sheet = wb.Sheets[name];
    const grid = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
      header: 1,
      raw: true,
      defval: "",
    });

    /* 머리글 줄 찾기 — 위에서 다섯 줄 안 */
    let headAt = -1;
    let map: (InvoiceColKey | null)[] = [];
    for (let r = 0; r < Math.min(grid.length, 6); r++) {
      const cells = grid[r].map((c) => String(c ?? "").trim());
      if (!cells.some((c) => HEADER_HINT.test(c))) continue;
      const m = cells.map(colKeyOf);
      if (m.filter(Boolean).length >= 3) {
        headAt = r;
        map = m;
        break;
      }
    }
    if (headAt < 0) continue;

    /* 병합으로 빈 칸이 된 값을 이어받는다 */
    let carry: InvoiceReplyGroup | null = null;
    let carryPlate: string | null = null;
    let carryChecked: boolean = false;
    for (let r = headAt + 1; r < grid.length; r++) {
      const cells = grid[r];
      const texts = cells.map((c) => String(c ?? "").trim());
      if (texts.every((c) => !c)) continue;
      const joined = texts.join(" ");
      if (/^최종\s*금액|^합계/.test(texts[0] ?? "")) continue; // 합계 줄

      const pick = (key: InvoiceColKey): unknown => {
        const i = map.indexOf(key);
        return i < 0 ? "" : cells[i];
      };
      const quoteNo = QUOTE_NO_RE.exec(String(pick("관리번호") || joined))?.[1] ?? null;
      const plateCell = String(pick("차량번호") ?? "");
      const plate = PLATE_RE.exec(plateCell)?.[1] ?? null;
      if (plate) carryPlate = plate;
      const checkedCell = pick("체크");
      const checked: boolean = String(checkedCell ?? "") === "" ? carryChecked : boolOf(checkedCell);
      if (String(checkedCell ?? "") !== "") carryChecked = checked;

      const gross = numOf(pick("정가"));
      const net = numOf(pick("최종금액")) ?? gross;
      const approved = numOf(pick("승인금액"));
      const desc = String(pick("점검내용") ?? "").replace(/\s+/g, " ").trim();
      const memo = String(pick("비고") ?? "").trim();
      /**
       * 🔴 줄 하나의 승인금액이 0 이라고 **건 전체가 반려는 아니다** — 다섯 줄 중
       *    브레이크오일만 0 이면 그건 「부분 조정」이다. 반려는 아래에서 건 단위로
       *    (승인금액 합이 0) 판정한다. 여기서는 글로 적힌 반려만 본다.
       */
      const rejected = /반려|불가|거절|부결/.test(`${desc} ${memo}`);

      /* 새 차량(=새 건)인지 이어지는 품목 줄인지 */
      const isNew = !carry || (quoteNo ? quoteNo !== carry.quoteNo : plate !== null);
      if (isNew) {
        carry = {
          quoteNo,
          plateRaw: plate ?? carryPlate,
          plateNorm: (plate ?? carryPlate) ? normalizePlate((plate ?? carryPlate)!) : null,
          desc,
          net: net,
          gross: gross,
          approved,
          checked,
          rejected,
          memo,
          raw: texts.filter(Boolean).join(" ").slice(0, 200),
        };
        out.push(carry);
        carryChecked = checked;
      } else {
        if (quoteNo && !carry!.quoteNo) carry!.quoteNo = quoteNo;
        if (net != null) carry!.net = (carry!.net ?? 0) + net;
        if (gross != null) carry!.gross = (carry!.gross ?? 0) + gross;
        if (approved != null) carry!.approved = (carry!.approved ?? 0) + approved;
        if (checked) carry!.checked = true;
        if (rejected) carry!.rejected = true;
        if (desc) carry!.desc = `${carry!.desc} · ${desc}`.slice(0, 200);
        if (memo) carry!.memo = `${carry!.memo} ${memo}`.trim().slice(0, 200);
      }
    }
  }
  /* 건 단위 반려 — 승인금액을 적기는 했는데 합이 0 이면 거래처가 통째로 물린 것 */
  for (const g of out) {
    if (g.approved === 0) g.rejected = true;
  }
  // 차량번호도 관리번호도 금액도 없는 줄(빈 서식·메모 시트)은 버린다
  return out.filter((g) => g.quoteNo || g.plateNorm || g.net != null || g.approved != null);
}

/**
 * 회신 엑셀 읽기 — 열을 못 알아본 파일(거래처 자체 양식)은 시트의 칸을 탭으로
 * 이어 **글 회신과 같은 길**(parseReplyText)로 보낸다.
 */
export function parseReplyWorkbook(buf: Buffer | ArrayBuffer): ReplyRow[] {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? "array" : "buffer" });
  const lines: string[] = [];
  for (const name of wb.SheetNames) {
    if (name === "관리대장") continue;
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, { header: 1, raw: true, defval: "" });
    for (const row of rows) {
      const cells = row.map((c) => String(c ?? "").replace(/\r?\n/g, " ").trim());
      if (cells.every((c) => !c)) continue;
      lines.push(cells.join("\t"));
    }
  }
  return parseReplyText(lines.join("\n"));
}
