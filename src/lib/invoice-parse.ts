/**
 * 매입 인보이스 읽기
 *
 * 사장님 요청 (2026-08-01)
 *   발주해서 주문 처리된 상품을 올리면 「입고 예정」으로 잡아 두었다가,
 *   실물이 도착하면 재고로 확정한다.
 *
 * ⭐ 인보이스에는 재고보다 값진 것이 있다 — **매입 할인율과 실매입가**.
 *    D-05 에서 "매입 할인율은 사전 입력하지 않고 쓰면서 채운다"고 했는데,
 *    인보이스를 읽으면 **채우는 것조차 자동**이 된다.
 *
 * ⭐ **엑셀을 기본 경로로 삼는다** (2026-08-01 개정).
 *    세 브랜드 모두 엑셀을 내려받을 수 있다. 표가 그대로 들어 있어
 *    폰트·줄바꿈·CMap 같은 PDF 문제가 아예 없다.
 *    브랜드가 늘어도 **컬럼 이름만 추가**하면 된다.
 *    PDF 는 보조로 남긴다 (엑셀을 못 받는 경우 대비).
 *
 * ⚠️ 한 파일에 **인보이스가 여러 건** 들어온다. 문서번호로 나눠야 한다.
 *    안 나누면 서로 다른 주문이 한 덩어리가 되어 입고 대조가 불가능해진다.
 */

export interface InvoiceItem {
  /** 품번 — 미쉐린 CAI · 콘티넨탈 Article No · 금호 자재코드 */
  cai: string;
  description: string;
  qty: number;
  /** 기표가(VAT 미포함). 없는 브랜드는 0 → 우리 DB 값으로 역산한다 */
  unitListPrice: number;
  /** 매입 할인율 0.38 = 38% */
  discountRate: number;
  discountAmount: number;
  /** 공급가액 합계 (VAT 미포함) */
  supplyAmount: number;
  /** 본당 실매입가 */
  unitCost: number;
}

export interface ParsedInvoice {
  supplier: string;
  /** 중복 업로드를 막는 열쇠 */
  invoiceNo: string;
  orderNo: string | null;
  issuedAt: string | null;
  items: InvoiceItem[];
  totalQty: number | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  /** 검산·안내. 비어 있으면 깨끗하다 */
  checks: string[];
  ok: boolean;
}

const num = (v: unknown): number => {
  if (v instanceof Date) return 0;
  const n = Number(String(v ?? "").replace(/[,\s%]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/** 날짜를 'YYYY-MM-DD' 로 */
function toDate(v: unknown): string | null {
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = text(v);
  const m = /(\d{4})[-./]?(\d{2})[-./]?(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/* ============================================================
 * 브랜드별 컬럼 이름
 *
 * 새 브랜드가 생기면 여기에 한 줄 추가하면 된다. 파서는 손대지 않는다.
 * ========================================================== */
interface ColumnMap {
  supplier: string;
  /** 이 파일이 이 브랜드 것인지 알아보는 컬럼 (하나라도 있으면 채택) */
  signature: string[];
  docNo: string[];
  orderNo?: string[];
  date: string[];
  code: string[];
  name: string[];
  qty: string[];
  /** 본당 매입가 */
  unitCost?: string[];
  /** 공급가액 합계 */
  amount?: string[];
  listPrice?: string[];
  /** 할인율(%) */
  discountPct?: string[];
  /** 상품이 아닌 행 (배송비 등) */
  skipRow?: (row: Record<string, unknown>, get: (...n: string[]) => unknown) => string | null;
  /** 합계 행 판별 */
  isTotalRow?: (row: Record<string, unknown>, get: (...n: string[]) => unknown) => boolean;
  /** 문서번호가 첫 행에만 있고 이어지는 행은 비어 있는가 */
  carryDocNo?: boolean;
}

const COLUMN_MAPS: ColumnMap[] = [
  {
    // 미쉐린 — MyInvoicesExport. 기표가와 할인율까지 들어 있어 가장 완전하다
    supplier: "미쉐린",
    signature: ["CAI", "기표가"],
    docNo: ["문서 번호"],
    orderNo: ["주문 번호"],
    date: ["문서 발행일", "주문일"],
    code: ["CAI"],
    name: ["품명"],
    qty: ["수량"],
    unitCost: ["공급가"],
    amount: ["합계(부가세 제외)"],
    listPrice: ["기표가"],
    discountPct: ["할인율(%)"],
  },
  {
    // 콘티넨탈 — billing-report
    supplier: "콘티넨탈",
    signature: ["Article No", "Billed Qty"],
    docNo: ["문서 번호"],
    date: ["문서 날짜"],
    code: ["Article No"],
    name: ["Article Description"],
    qty: ["Billed Qty"],
    amount: ["Net Amount"],
    skipRow: (_r, get) => {
      const d = text(get("Article Description"));
      const kind = text(get("문서 종류"));
      // ⚠️ 배송비가 상품처럼 섞여 온다. 안 거르면 재고로 잡힌다
      return /FREIGHT|SHIPPING|CHARGE/i.test(d) || kind === "ZL6" ? d || "배송비" : null;
    },
  },
  {
    // 금호 — 발주내역조회
    supplier: "금호",
    signature: ["자재코드", "발주수량"],
    docNo: ["발주번호"],
    date: ["발주일"],
    code: ["자재코드"],
    name: ["자재명"],
    qty: ["발주수량"],
    amount: ["금액"],
    carryDocNo: true, // 발주번호가 첫 행에만 있다
    // ⚠️ 「합계」 행이 중간중간 섞여 있다. 안 거르면 수량이 두 배가 된다
    isTotalRow: (_r, get) => /합계/.test(text(get("인도처")) + text(get("발주번호"))),
  },
];

/** 컬럼 이름을 공백·대소문자 무시하고 찾는다 */
function makeGetter(row: Record<string, unknown>) {
  const keys = Object.keys(row);
  return (...names: string[]) => {
    for (const n of names) {
      const want = n.replace(/\s/g, "").toLowerCase();
      for (const k of keys) {
        if (k.replace(/\s/g, "").toLowerCase() === want) return row[k];
      }
    }
    return null;
  };
}

function detectMap(rows: Record<string, unknown>[]): ColumnMap | null {
  if (rows.length === 0) return null;
  const keys = Object.keys(rows[0]).map((k) => k.replace(/\s/g, "").toLowerCase());
  for (const m of COLUMN_MAPS) {
    const hit = m.signature.every((s) => keys.includes(s.replace(/\s/g, "").toLowerCase()));
    if (hit) return m;
  }
  return null;
}

/**
 * ⭐ **머리글만 보고** 어느 거래처 양식인지 (2026-08-29)
 *
 *   조회 기간에 자료가 없으면 머리글 한 줄짜리 빈 엑셀이 내려온다
 *   (실측: `billing-report-2026-08-22 (1).xlsx` — 콘티넨탈 머리글만 있고 0줄).
 *   그걸 「양식을 못 알아봤다」고 하면 사장님이 파일이 잘못된 줄 아신다.
 *   자료가 0줄일 때 무엇이 비었는지 짚어 주려고 쓴다.
 */
export function supplierOfHeader(header: unknown[]): string | null {
  const keys = header.map((k) => String(k ?? "").replace(/\s/g, "").toLowerCase());
  for (const m of COLUMN_MAPS) {
    if (m.signature.every((s) => keys.includes(s.replace(/\s/g, "").toLowerCase()))) return m.supplier;
  }
  return null;
}

/**
 * ⭐ 엑셀 인보이스 읽기 — 세 브랜드 공통.
 * 문서번호별로 나눠 **여러 건**을 돌려준다.
 */
export function parseInvoiceRows(rows: Record<string, unknown>[]): ParsedInvoice[] {
  const map = detectMap(rows);
  if (!map) return [];

  const groups = new Map<string, { date: string | null; orderNo: string | null; items: InvoiceItem[]; skipped: string[] }>();
  let lastDocNo = "";

  for (const row of rows) {
    const get = makeGetter(row);
    if (map.isTotalRow?.(row, get)) continue;

    const code = text(get(...map.code));
    const qty = num(get(...map.qty));
    if (!code || qty <= 0) continue;

    const docNo = text(get(...map.docNo)) || (map.carryDocNo ? lastDocNo : "");
    if (!docNo) continue;
    lastDocNo = docNo;

    const g =
      groups.get(docNo) ??
      groups.set(docNo, { date: null, orderNo: null, items: [], skipped: [] }).get(docNo)!;

    const skip = map.skipRow?.(row, get);
    if (skip) {
      g.skipped.push(skip);
      continue;
    }

    if (!g.date) g.date = toDate(get(...map.date));
    if (!g.orderNo && map.orderNo) g.orderNo = text(get(...map.orderNo)) || null;

    const listPrice = map.listPrice ? num(get(...map.listPrice)) : 0;
    const discountPct = map.discountPct ? num(get(...map.discountPct)) : 0;
    let unitCost = map.unitCost ? num(get(...map.unitCost)) : 0;
    let amount = map.amount ? num(get(...map.amount)) : 0;

    // 단가와 합계 중 하나만 있어도 나머지를 채운다
    if (!unitCost && amount) unitCost = Math.round(amount / qty);
    if (!amount && unitCost) amount = unitCost * qty;

    g.items.push({
      cai: code,
      description: text(get(...map.name)) || code,
      qty,
      unitListPrice: listPrice,
      discountRate: discountPct > 0 ? discountPct / 100 : 0,
      discountAmount: listPrice > 0 ? Math.round(listPrice * qty - amount) : 0,
      supplyAmount: amount,
      unitCost,
    });
  }

  const out: ParsedInvoice[] = [];
  for (const [docNo, g] of groups) {
    if (g.items.length === 0) continue;

    /** 검산 — 인보이스는 돈이다. 잘못 읽으면 매입원가가 통째로 틀어진다 */
    const checks: string[] = [];
    for (const it of g.items) {
      if (Math.abs(it.unitCost * it.qty - it.supplyAmount) > it.qty) {
        checks.push(`${it.cai} — 단가×수량이 금액과 다릅니다`);
      }
      if (it.unitListPrice > 0 && it.discountRate > 0) {
        const expect = Math.round(it.unitListPrice * (1 - it.discountRate));
        if (Math.abs(expect - it.unitCost) > 1) {
          checks.push(
            `${it.cai} — 할인 계산이 안 맞습니다 (계산 ${expect.toLocaleString()} vs 문서 ${it.unitCost.toLocaleString()})`,
          );
        }
      }
    }
    if (g.skipped.length) {
      checks.push(`상품이 아닌 행 ${g.skipped.length}건 제외 (${[...new Set(g.skipped)].join(", ")})`);
    }

    const subtotal = g.items.reduce((s, x) => s + x.supplyAmount, 0);
    out.push({
      supplier: map.supplier,
      invoiceNo: `${map.supplier === "미쉐린" ? "" : map.supplier === "콘티넨탈" ? "CO-" : "KM-"}${docNo}`,
      orderNo: g.orderNo ?? docNo,
      issuedAt: g.date,
      items: g.items,
      totalQty: g.items.reduce((s, x) => s + x.qty, 0),
      subtotal,
      vat: Math.round(subtotal * 0.1),
      total: Math.round(subtotal * 1.1),
      checks,
      // 「제외」 안내는 오류가 아니다
      ok: checks.every((c) => c.includes("제외")),
    });
  }
  // 최근 것이 위로
  return out.sort((a, b) => (b.issuedAt ?? "").localeCompare(a.issuedAt ?? ""));
}

/* ============================================================
 * PDF — 보조 경로
 *
 * 엑셀을 못 받는 경우를 위해 남겨 둔다. 미쉐린 양식만 읽는다.
 * ⚠️ 엑셀이 있으면 엑셀을 쓰는 것이 낫다 — PDF 는 양식이 조금만 바뀌어도 깨진다.
 * ========================================================== */

/** 라벨이 «발 행 번 호» 처럼 띄어져 있다. 공백을 지우고 찾는다 */
function findLabeled(t: string, label: string, pattern: string): string | null {
  const flat = t.replace(/[ \t]+/g, " ");
  const spaced = label.split("").join("[ ]*");
  return new RegExp(`${spaced}[ ]*(${pattern})`).exec(flat)?.[1]?.trim() ?? null;
}

export function parseMichelinInvoicePdf(t: string): ParsedInvoice[] {
  const checks: string[] = [];
  const invoiceNo = findLabeled(t, "발행번호", "[A-Z]{2}_[A-Z0-9+\\-=]+") ?? "";
  const orderNo = findLabeled(t, "주문번호", "[A-Z]{2}_[A-Z0-9]+");
  const issuedAt = toDate(findLabeled(t, "발행일자", "\\d{4}[/.-]\\d{2}[/.-]\\d{2}"));

  const body = t.split(/총[ ]*수[ ]*량/)[0];
  const startRe = /(^|\n)\s*(\d{6})\s/g;
  const starts: { cai: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(body)) !== null) starts.push({ cai: m[2], at: m.index + m[1].length });

  const items: InvoiceItem[] = [];
  for (let i = 0; i < starts.length; i++) {
    const chunk = body.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : undefined);
    const nums = /(\d+)\s+([\d,]+)\s+(\d+(?:\.\d+)?)\s*%\s+([\d,]+)\s+([\d,]+)\s*$/m.exec(chunk.trim());
    if (!nums) {
      checks.push(`CAI ${starts[i].cai} — 숫자를 읽지 못했습니다`);
      continue;
    }
    const qty = Number(nums[1]);
    const unitListPrice = num(nums[2]);
    const discountRate = Number(nums[3]) / 100;
    const supplyAmount = num(nums[5]);
    items.push({
      cai: starts[i].cai,
      description: chunk
        .replace(/^\s*\d{6}\s*/, "")
        .replace(/(\d+)\s+([\d,]+)\s+(\d+(?:\.\d+)?)\s*%\s+([\d,]+)\s+([\d,]+)\s*$/m, "")
        .replace(/\s+/g, " ")
        .trim(),
      qty,
      unitListPrice,
      discountRate,
      discountAmount: num(nums[4]),
      supplyAmount,
      unitCost: qty > 0 ? Math.round(supplyAmount / qty) : 0,
    });
  }

  const subtotal = findLabeled(t, "소계", "[\\d,]+");
  const sumSupply = items.reduce((s, x) => s + x.supplyAmount, 0);
  if (subtotal && Math.abs(sumSupply - num(subtotal)) > 1) {
    checks.push(`소계가 안 맞습니다 (합산 ${sumSupply.toLocaleString()} vs 문서 ${subtotal})`);
  }
  if (!invoiceNo) checks.push("발행번호를 찾지 못했습니다");
  if (items.length === 0) checks.push("품목을 하나도 읽지 못했습니다");

  return [
    {
      supplier: "미쉐린",
      invoiceNo,
      orderNo,
      issuedAt,
      items,
      totalQty: items.reduce((s, x) => s + x.qty, 0),
      subtotal: subtotal ? num(subtotal) : sumSupply,
      vat: num(findLabeled(t, "부가세", "[\\d,]+")) || Math.round(sumSupply * 0.1),
      total: num(findLabeled(t, "총합계", "[\\d,]+")) || Math.round(sumSupply * 1.1),
      checks,
      ok: checks.length === 0 && items.length > 0,
    },
  ];
}

/** PDF 텍스트 → 인보이스. 알아보지 못하면 빈 배열 */
export function parseInvoiceText(t: string): ParsedInvoice[] {
  if (/미쉐린|MICHELIN/i.test(t)) return parseMichelinInvoicePdf(t);
  return [];
}
