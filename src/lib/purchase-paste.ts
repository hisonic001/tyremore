/**
 * ⭐ 붙여넣기로 매입 등록 (사장님 요청 2026-08-15)
 *
 *   "나이스 오토파츠 … 웹사이트에서 복사 붙여넣기 하는 방법도 하나의 방법으로
 *    추가되었으면 좋겠으며 다른 거래처에서 매입하는 방식도 대응가능했으면 좋겠음"
 *
 * 부품 매입이 앱에 안 쌓여서 안전재고 계산의 절반(부품 소비량)을 못 만들고 있다.
 * 인보이스 파일을 만들어 주지 않는 거래처가 많으니, **주문서 화면을 그대로 복사**해
 * 붙여넣으면 읽어 들이게 한다.
 *
 * 형식은 셋으로 나눠 받는다 — 어느 것이든 마지막엔 (품번·수량·단가)로 모인다.
 *   ① 나이스 오토파츠  「나이스번호 : MBB-023」이 있는 형식 (2026-08-15 실물로 검증)
 *   ② 표 붙여넣기      엑셀·웹 표를 복사한 것 (탭/여러 칸으로 나뉜 줄)
 *   ③ 자유 형식        줄마다 「품번 … 수량 … 단가」가 섞여 있는 것
 *
 * 🔴 품번을 못 알아본 줄은 **버리지 않는다.** 미리보기에 남겨 사장님이 상품을 한 번
 *    골라 주면 `supplier_item_code`(거래처 품번 사전)에 적어 두고, 다음부터 그
 *    거래처의 같은 코드는 저절로 이어진다. 금호 인보이스에서 이미 쓰는 방식이다.
 */

export interface PastedLine {
  /** 거래처가 부르는 품번 — 나이스번호·자재코드 등 */
  code: string;
  /** 거래처 상품명 (있으면) */
  name: string;
  /** 제조사 품번들 (있으면) — 상품을 찾는 두 번째 열쇠 */
  oemNos: string[];
  qty: number;
  /** 단가 (VAT 별도로 본다 — 나이스는 공급가 표기) */
  unitCost: number | null;
  /** 붙여넣은 원문 줄 — 못 이었을 때 사장님이 보고 판단한다 */
  raw: string;
}

export interface PasteResult {
  format: "나이스" | "표" | "자유";
  lines: PastedLine[];
  /** 읽지 못한 덩어리 — 화면에 그대로 보여 준다 */
  skipped: string[];
}

const won = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;

/* ============================================================
 * ① 나이스 오토파츠
 *    [분류]상품명
 *    품번 : 26320-2F000,26320-2F100
 *    나이스번호 : MBB-023
 *    5    2,750원    13,750원    선불
 * ========================================================== */
function parseNice(text: string): PastedLine[] {
  const out: PastedLine[] = [];
  // 「[오일 필터]」처럼 대괄호 분류로 시작하는 덩어리로 나눈다
  for (const raw of text.split(/(?=\[[^\]\n]{1,14}\])/g)) {
    const block = raw.trim();
    if (!block) continue;
    const mCode = /나이스번호\s*[:：]\s*([A-Za-z0-9가-힣._\-]+)/.exec(block);
    if (!mCode) continue;
    const mName = /\[([^\]]+)\]\s*([\s\S]*?)(?:\n|품번\s*[:：])/.exec(block);
    const mOem = /품번\s*[:：]\s*([^\n]+)/.exec(block);
    /**
     * 수량·단가·금액은 나이스번호 **뒤에** 온다. 앞에서 찾으면 상품명 속 연식
     * (「('14.08~)」)을 수량으로 잘못 읽는다.
     */
    const after = block.slice(block.indexOf(mCode[0]) + mCode[0].length);
    const mQty = /(\d[\d,]*)\s+([\d,]+)\s*원\s+([\d,]+)\s*원/.exec(after);
    if (!mQty) continue;
    const category = (mName?.[1] ?? "").replace(/\s/g, "");
    const body = (mName?.[2] ?? "").replace(/\^/g, " · ").replace(/\s+/g, " ").trim();
    out.push({
      code: mCode[1].trim(),
      name: category ? `[${category}] ${body}` : body,
      oemNos: (mOem?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      qty: won(mQty[1]),
      unitCost: won(mQty[2]),
      raw: block.replace(/\s+/g, " ").slice(0, 200),
    });
  }
  return out;
}

/* ============================================================
 * ② 표 붙여넣기 — 엑셀·웹 표를 복사하면 칸이 탭이나 여러 칸으로 나뉜다
 * ========================================================== */
function parseTable(text: string): PastedLine[] {
  const out: PastedLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const cells = t.split(/\t|\s{2,}|\s*\|\s*/).map((c) => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    // 머리글 줄은 건너뛴다
    if (/품\s*번|품목|상품|수량|단가|금액|합계/.test(cells.slice(0, 2).join(" ")) && !/\d/.test(cells[0])) continue;
    /** 품번 같은 칸 — 글자와 숫자가 섞였거나 하이픈이 든 것 */
    const codeIdx = cells.findIndex((c) => /^[A-Za-z0-9][A-Za-z0-9._\-/]{3,}$/.test(c) && /[A-Za-z\-]/.test(c));
    if (codeIdx < 0) continue;
    /** 뒤쪽 숫자 칸들 — 보통 수량 · 단가 · 금액 순 */
    const nums = cells
      .map((c, i) => ({ i, v: won(c), isNum: /^[\d,]+원?$/.test(c) }))
      .filter((x) => x.isNum && x.i > codeIdx && x.v > 0);
    if (nums.length < 2) continue;
    const qty = nums[0].v;
    const unit = nums[1].v;
    if (qty > 9999) continue; // 수량 자리에 금액이 온 줄 — 못 믿는다
    out.push({
      code: cells[codeIdx],
      name: cells.filter((_, i) => i !== codeIdx && !/^[\d,]+원?$/.test(cells[i])).join(" ").slice(0, 90),
      oemNos: [],
      qty,
      unitCost: unit,
      raw: t.slice(0, 200),
    });
  }
  return out;
}

/* ============================================================
 * ③ 자유 형식 — 줄 하나에 품번과 숫자 두엇이 섞여 있는 것
 * ========================================================== */
function parseFree(text: string): PastedLine[] {
  const out: PastedLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.length < 5) continue;
    const mCode = /\b([A-Za-z]{2,4}[-_][A-Za-z0-9._\-]{2,}|\d{5}-[A-Za-z0-9]{4,})\b/.exec(t);
    if (!mCode) continue;
    const nums = [...t.matchAll(/([\d,]{1,9})\s*(개|EA|ea)?/g)]
      .map((m) => ({ v: won(m[1]), unit: m[2] }))
      .filter((x) => x.v > 0);
    if (nums.length === 0) continue;
    const qtyHit = nums.find((n) => n.unit) ?? nums.find((n) => n.v <= 99);
    const priceHit = [...nums].reverse().find((n) => n.v >= 100);
    out.push({
      code: mCode[1],
      name: t.replace(mCode[1], "").replace(/[\d,]+원?/g, "").replace(/\s+/g, " ").trim().slice(0, 90),
      oemNos: [],
      qty: qtyHit?.v ?? 1,
      unitCost: priceHit?.v ?? null,
      raw: t.slice(0, 200),
    });
  }
  return out;
}

/** 붙여넣은 글을 읽는다 — 형식은 알아서 고른다 */
export function parsePastedPurchase(text: string): PasteResult {
  const t = (text ?? "").replace(/ /g, " ").trim();
  if (!t) return { format: "자유", lines: [], skipped: [] };

  if (/나이스번호\s*[:：]/.test(t)) {
    const lines = parseNice(t);
    if (lines.length > 0) {
      /** 읽은 덩어리 수와 「나이스번호」 수가 다르면 놓친 것이 있다는 뜻 */
      const total = (t.match(/나이스번호\s*[:：]/g) ?? []).length;
      const skipped =
        total > lines.length ? [`${total - lines.length}줄은 수량·단가를 못 찾아 건너뛰었습니다`] : [];
      return { format: "나이스", lines, skipped };
    }
  }
  const tbl = parseTable(t);
  const free = parseFree(t);
  // 더 많이 읽어낸 쪽을 쓴다
  return tbl.length >= free.length
    ? { format: "표", lines: tbl, skipped: [] }
    : { format: "자유", lines: free, skipped: [] };
}
