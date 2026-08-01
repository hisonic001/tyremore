/**
 * 매입 인보이스 읽기 (미쉐린)
 *
 * 사장님 요청 (2026-08-01)
 *   발주해서 주문 처리된 상품을 PDF/엑셀로 올리면 인식해 두었다가,
 *   실물이 도착해 바코드를 찍으면 재고로 확정된다.
 *
 * ⭐ 인보이스에는 재고보다 값진 것이 들어 있다 — **매입 할인율과 실매입가**.
 *    D-05에서 "매입 할인율은 사전 입력하지 않고 쓰면서 채운다"고 했는데,
 *    인보이스를 읽으면 **채우는 것조차 자동이 된다.**
 *
 * 미쉐린 양식 (2026-07-31 실물 확인)
 *   CAI    사이즈 및 패턴                          수량 기준단가 총할인율 총할인금액 공급가액
 *   267623 245/45 R19 102Y XL TL CROSSCLIMATE 3      2  380,000    38%   288,800   471,200
 *          SPORT MI                                       ← 설명이 줄바꿈될 수 있다
 *
 * ⚠️ 브랜드마다 양식이 다르다. 지금은 미쉐린만 읽는다.
 *    금호·콘티넨탈 인보이스를 받으면 그 양식을 보고 추가한다.
 */

export interface InvoiceItem {
  /** 미쉐린 고유번호 = MARS 품번 */
  cai: string;
  description: string;
  qty: number;
  /** 기준단가 — 우리 list_price_excl(공장도가, VAT 미포함)과 같은 값 */
  unitListPrice: number;
  /** 총할인율 0.38 = 38% — ⭐ 이것이 매입 할인율이다 */
  discountRate: number;
  discountAmount: number;
  /** 공급가액 (VAT 미포함) */
  supplyAmount: number;
  /** 본당 실매입가 = 공급가액 ÷ 수량 */
  unitCost: number;
}

export interface ParsedInvoice {
  supplier: string;
  /** 발행번호 — 중복 업로드를 막는 열쇠 */
  invoiceNo: string;
  orderNo: string | null;
  issuedAt: string | null;
  items: InvoiceItem[];
  totalQty: number | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  /** 검산 결과 — 금액이 안 맞으면 사람이 봐야 한다 */
  checks: string[];
  ok: boolean;
}

const num = (s: string) => Number(String(s).replace(/[,\s]/g, ""));

/** 라벨이 «발 행 번 호» 처럼 띄어져 있다. 공백을 지우고 찾는다 */
function findLabeled(text: string, label: string, pattern: string): string | null {
  const flat = text.replace(/[ \t]+/g, " ");
  const spaced = label.split("").join("[ ]*");
  const re = new RegExp(`${spaced}[ ]*(${pattern})`);
  return re.exec(flat)?.[1]?.trim() ?? null;
}

export function parseMichelinInvoice(text: string): ParsedInvoice {
  const checks: string[] = [];

  const invoiceNo = findLabeled(text, "발행번호", "[A-Z]{2}_[A-Z0-9+\\-=]+") ?? "";
  const orderNo = findLabeled(text, "주문번호", "[A-Z]{2}_[A-Z0-9]+");
  const issuedRaw = findLabeled(text, "발행일자", "\\d{4}[/.-]\\d{2}[/.-]\\d{2}");
  const issuedAt = issuedRaw ? issuedRaw.replace(/[./]/g, "-") : null;

  /**
   * 품목 — CAI(6자리)로 시작해 다음 CAI 또는 「총 수 량」 앞까지가 한 덩어리.
   * 덩어리 끝에 «수량 기준단가 할인율% 할인금액 공급가액» 다섯 숫자가 온다.
   */
  const body = text.split(/총[ ]*수[ ]*량/)[0];
  const startRe = /(^|\n)\s*(\d{6})\s/g;
  const starts: { cai: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(body)) !== null) {
    starts.push({ cai: m[2], at: m.index + m[1].length });
  }

  const items: InvoiceItem[] = [];
  for (let i = 0; i < starts.length; i++) {
    const chunk = body.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : undefined);
    const nums =
      /(\d+)\s+([\d,]+)\s+(\d+(?:\.\d+)?)\s*%\s+([\d,]+)\s+([\d,]+)\s*$/m.exec(chunk.trim());
    if (!nums) {
      checks.push(`CAI ${starts[i].cai} — 숫자를 읽지 못했습니다`);
      continue;
    }
    const qty = Number(nums[1]);
    const unitListPrice = num(nums[2]);
    const discountRate = Number(nums[3]) / 100;
    const discountAmount = num(nums[4]);
    const supplyAmount = num(nums[5]);

    // 설명 = 덩어리에서 CAI와 숫자 부분을 뺀 나머지
    const description = chunk
      .replace(/^\s*\d{6}\s*/, "")
      .replace(/(\d+)\s+([\d,]+)\s+(\d+(?:\.\d+)?)\s*%\s+([\d,]+)\s+([\d,]+)\s*$/m, "")
      .replace(/\s+/g, " ")
      .trim();

    items.push({
      cai: starts[i].cai,
      description,
      qty,
      unitListPrice,
      discountRate,
      discountAmount,
      supplyAmount,
      unitCost: qty > 0 ? Math.round(supplyAmount / qty) : 0,
    });
  }

  const totalQty = findLabeled(text, "총수량", "[\\d,]+");
  const subtotal = findLabeled(text, "소계", "[\\d,]+");
  const vat = findLabeled(text, "부가세", "[\\d,]+");
  const total = findLabeled(text, "총합계", "[\\d,]+");

  /**
   * ⭐ 검산 — 인보이스는 돈이다. 잘못 읽으면 매입원가가 통째로 틀어진다.
   * 세 가지를 맞춰 본다. 하나라도 어긋나면 사람이 확인해야 한다.
   */
  for (const it of items) {
    const expect = Math.round(it.unitListPrice * it.qty * (1 - it.discountRate));
    if (Math.abs(expect - it.supplyAmount) > 1) {
      checks.push(
        `CAI ${it.cai} — 공급가액이 안 맞습니다 (계산 ${expect.toLocaleString()} vs 문서 ${it.supplyAmount.toLocaleString()})`,
      );
    }
  }
  const sumQty = items.reduce((s, x) => s + x.qty, 0);
  if (totalQty && sumQty !== num(totalQty)) {
    checks.push(`총수량이 안 맞습니다 (합산 ${sumQty} vs 문서 ${totalQty})`);
  }
  const sumSupply = items.reduce((s, x) => s + x.supplyAmount, 0);
  if (subtotal && Math.abs(sumSupply - num(subtotal)) > 1) {
    checks.push(`소계가 안 맞습니다 (합산 ${sumSupply.toLocaleString()} vs 문서 ${subtotal})`);
  }

  if (!invoiceNo) checks.push("발행번호를 찾지 못했습니다");
  if (items.length === 0) checks.push("품목을 하나도 읽지 못했습니다");

  return {
    supplier: "미쉐린",
    invoiceNo,
    orderNo,
    issuedAt,
    items,
    totalQty: totalQty ? num(totalQty) : null,
    subtotal: subtotal ? num(subtotal) : null,
    vat: vat ? num(vat) : null,
    total: total ? num(total) : null,
    checks,
    ok: checks.length === 0 && items.length > 0,
  };
}

/** 어느 브랜드 인보이스인지 알아내 알맞은 파서로 보낸다 */
export function parseInvoice(text: string): ParsedInvoice {
  if (/미쉐린|MICHELIN/i.test(text)) return parseMichelinInvoice(text);
  return {
    supplier: "(알 수 없음)",
    invoiceNo: "",
    orderNo: null,
    issuedAt: null,
    items: [],
    totalQty: null,
    subtotal: null,
    vat: null,
    total: null,
    checks: [
      "미쉐린 인보이스가 아닌 것 같습니다. 지금은 미쉐린 양식만 읽습니다.",
      "다른 브랜드 인보이스를 주시면 그 양식을 보고 추가하겠습니다.",
    ],
    ok: false,
  };
}
