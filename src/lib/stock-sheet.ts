/**
 * 재고를 엑셀로 내려받고 다시 올린다 (사장님 지시 2026-08-03)
 *
 *   "재고 기능을 전반적으로 수정해야할것 같아. 재고를 엑셀로 다운로드 & 업로드 하는 기능으로 수정."
 *
 * 왜 이렇게 바꾸나
 *   창고에서 한 줄씩 눌러 세는 것보다, 익숙한 엑셀에서 한꺼번에 고치는 편이 빠르다.
 *   MARS 도 재고를 엑셀로 주고받으므로 형식이 손에 익어 있다.
 *
 * ⭐ **엑셀이 정답이다** (사장님 선택 2026-08-03).
 *    올린 파일 내용으로 재고를 통째로 맞춘다. 파일에 없는 것은 0본이 된다.
 *    실사 결과를 통째로 반영할 때 맞는 방식이지만, 되돌리기 어려우므로
 *    **반드시 미리보기를 거친 뒤** 확정한다 (`diffStock` → `applyStock`).
 *
 * ⚠️ 엑셀은 `0426` 을 숫자 426 으로 바꿔 놓는다. DOT 는 항상 4자리로 되돌린다.
 *    이걸 안 하면 실사할 때마다 DOT 가 조용히 망가진다.
 */
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db";
import { isPlausibleDot, isValidDot } from "./normalize";
import { setDotQty } from "./stock";
import { parseTireName } from "./tire-name";

/**
 * 칸 이름. **내려받은 파일을 그대로 다시 올릴 수 있어야 한다** —
 * 사장님은 수량만 고쳐서 올리실 것이다.
 * 읽을 때 실제로 쓰는 것은 「품번 · DOT · 수량」 셋뿐이고 나머지는 눈으로 보시라고 넣는다.
 */
export const COL = {
  itemNo: "품번",
  spec: "규격",
  model: "모델",
  loadSpeed: "하중/속도",
  season: "계절",
  dot: "DOT",
  qty: "수량",
  /**
   * ⭐ 아래는 **거르고 훑어보시라고** 붙인 칸이다 (사장님 요청 2026-08-21 —
   *    "필터링이 가능하게 제조사 등의 정보들도 엑셀에 추가"). 읽을 때는 쓰지 않는다.
   *    엑셀에서 자동 필터로 제조사·인치·연식별로 좁혀 보시는 용도.
   */
  brand: "제조사",
  width: "폭",
  aspect: "편평비",
  rim: "인치",
  runflat: "런플랫",
  year: "연식",
  listPrice: "기표가",
  /** 🔴 아래 둘은 **사장님 계정에서 받을 때만** 들어간다 (D-05 5번 — 매입가는 사장님만) */
  cost: "매입가",
  amount: "재고금액",
} as const;

/** 올릴 때 실제로 읽는 칸 — 나머지는 있어도 없어도 그만이다 */
export const READ_COLS = [COL.itemNo, COL.dot, COL.qty] as const;

/** 내려받는 칸 차례. 앞의 일곱은 **예전 그대로** 둔다 — 손에 익은 자리를 흔들지 않는다 */
const HEADERS_BASE = [
  COL.itemNo, COL.spec, COL.model, COL.loadSpeed, COL.season, COL.dot, COL.qty,
  COL.brand, COL.width, COL.aspect, COL.rim, COL.runflat, COL.year, COL.listPrice,
] as const;
const HEADERS_OWNER = [...HEADERS_BASE, COL.cost, COL.amount] as const;

const SHEET_NAME = "재고";

export interface SheetRow {
  [COL.itemNo]: string;
  [COL.spec]: string;
  [COL.model]: string;
  [COL.loadSpeed]: string;
  [COL.season]: string;
  [COL.dot]: string;
  [COL.qty]: number;
  [COL.brand]: string;
  [COL.width]: number | "";
  [COL.aspect]: number | "";
  [COL.rim]: number | "";
  [COL.runflat]: string;
  [COL.year]: number | "";
  [COL.listPrice]: number | "";
  [COL.cost]?: number | "";
  [COL.amount]?: number | "";
}

/** 엑셀이 숫자로 바꿔 놓은 DOT 를 4자리로 되돌린다. 빈 값은 null */
function normalizeDot(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  if (!d) return null;
  return d.padStart(4, "0").slice(0, 4);
}

/** 품번은 숫자로만 된 것(미쉐린 CAI)이 있어 엑셀이 숫자로 만든다 */
function normalizeItemNo(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** 재고가 있는 타이어를 「상품 + DOT」 로 묶어 엑셀 줄로 만든다 */
export async function stockSheetRows(money = false): Promise<SheetRow[]> {
  const rows = await db.execute<{
    mars_item_no: string | null;
    raw_name: string;
    pattern: string | null;
    display_name: string | null;
    brand_code: string | null;
    brand_name: string | null;
    season: string | null;
    width: number | null;
    aspect_ratio: number | null;
    rim_inch: string | null;
    load_index: string | null;
    speed_rating: string | null;
    is_runflat: boolean | null;
    list_price: number | null;
    dot: string | null;
    qty: number;
    cost: number | null;
  }>(sql`
    SELECT p.mars_item_no, p.raw_name, p.pattern, p.display_name, p.brand_code, b.name_ko brand_name,
           p.season, p.width, p.aspect_ratio, p.rim_inch, p.load_index, p.speed_rating,
           p.is_runflat, p.list_price,
           s.dot, SUM(s.qty)::int qty,
           -- 이 로트의 본당 매입가 (없으면 상품 기본값). 사장님 파일에만 들어간다
           ROUND(AVG(COALESCE(s.purchase_price, p.purchase_price)))::int cost
    FROM stock_item s
    JOIN product p ON p.id = s.product_id
    LEFT JOIN brand b ON b.code = p.brand_code
    WHERE s.status = '재고' AND s.qty > 0 AND p.item_type = 'tire'
    GROUP BY p.id, p.mars_item_no, p.raw_name, p.pattern, p.display_name, p.brand_code, b.name_ko,
             p.season, p.width, p.aspect_ratio, p.rim_inch, p.load_index, p.speed_rating,
             p.is_runflat, p.list_price, s.dot
    ORDER BY p.rim_inch NULLS LAST, p.width NULLS LAST, p.aspect_ratio NULLS LAST, s.dot NULLS FIRST
  `);

  return rows.map((r) => {
    const n = parseTireName(r.raw_name, r.pattern, {
      width: r.width,
      aspectRatio: r.aspect_ratio,
      rimInch: r.rim_inch,
      brandCode: r.brand_code,
    });
    // DOT 는 WWYY (0426 = 4주 2026년) — 연식만 따로 뽑아 두면 오래된 재고를 거르기 쉽다
    const dot = r.dot ?? "";
    const year = /^\d{4}$/.test(dot) ? 2000 + Number(dot.slice(2)) : "";
    const qty = Number(r.qty);
    const cost = r.cost === null ? "" : Number(r.cost);
    return {
      [COL.itemNo]: r.mars_item_no ?? "",
      [COL.spec]: n.spec ?? "",
      [COL.model]: r.display_name?.trim() || n.model,
      [COL.loadSpeed]: n.loadSpeed ?? (r.load_index ? `${r.load_index}${r.speed_rating ?? ""}` : ""),
      [COL.season]: r.season ?? "",
      [COL.dot]: dot,
      [COL.qty]: qty,
      [COL.brand]: r.brand_name ?? r.brand_code ?? "",
      [COL.width]: r.width ?? "",
      [COL.aspect]: r.aspect_ratio ?? "",
      [COL.rim]: r.rim_inch === null ? "" : parseFloat(r.rim_inch),
      [COL.runflat]: r.is_runflat ? "런플랫" : "",
      [COL.year]: year,
      [COL.listPrice]: r.list_price ?? "",
      ...(money ? { [COL.cost]: cost, [COL.amount]: cost === "" ? "" : cost * qty } : {}),
    };
  });
}

/**
 * 내려받을 .xlsx 를 만든다.
 *
 * @param money 매입가·재고금액을 넣을지 — 화면이 `isOwner()` 로 판단해 넘긴다 (D-05 5번).
 *              서버에서 아예 빼고 내보낸다. 감추기가 아니라 안 담는 것이다.
 */
export async function buildStockWorkbook(money = false): Promise<Buffer> {
  const rows = await stockSheetRows(money);
  const header = [...(money ? HEADERS_OWNER : HEADERS_BASE)];
  const ws = XLSX.utils.json_to_sheet(rows, { header });
  ws["!cols"] = header.map((h) =>
    h === COL.model ? { wch: 28 } : h === COL.itemNo || h === COL.spec ? { wch: 14 } : { wch: 9 },
  );
  /**
   * 🔴 **품번과 DOT 는 글자로 못 박는다.**
   *    엑셀은 `0426` 을 426 으로, 미쉐린 품번 `015692` 를 15692 로 바꿔 놓는다.
   *    그대로 다시 올리면 앞의 0 이 사라져 「품번을 상품에서 못 찾았습니다」가 된다.
   *    (2026-08-21 실측 — 0 으로 시작하는 품번의 재고가 31줄 있다.)
   */
  const noCol = header.indexOf(COL.itemNo);
  const dotCol = header.indexOf(COL.dot);
  for (let i = 0; i < rows.length; i++) {
    for (const c of [noCol, dotCol]) {
      if (c < 0) continue;
      const cell = ws[XLSX.utils.encode_cell({ c, r: i + 1 })];
      if (cell) {
        cell.t = "s";
        cell.v = String(cell.v ?? "");
        cell.z = "@"; // 엑셀에서 고쳐도 글자로 남게
      }
    }
  }
  /** ⭐ 자동 필터를 켜 둔다 — 제조사·인치·연식으로 바로 걸러 보실 수 있게 */
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: header.length - 1, r: rows.length } }) };
  ws["!freeze"] = { xSplit: "0", ySplit: "1" };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export interface DiffLine {
  productId: number | null;
  itemNo: string;
  dot: string | null;
  model: string;
  spec: string;
  before: number;
  after: number;
  /** 같음 · 늘어남 · 줄어듦 · 새로 · 없어짐 · 오류 */
  kind: "같음" | "늘어남" | "줄어듦" | "새로" | "없어짐" | "오류";
  error?: string;
}

export interface StockDiff {
  lines: DiffLine[];
  beforeTotal: number;
  afterTotal: number;
  /** 파일에서 같은 「품번+DOT」 가 여러 줄이라 합친 횟수 */
  merged: number;
  errors: number;
  changed: number;
  /** 읽어들인 유효한 줄 수 — 0 이면 반영을 막는다 */
  readRows: number;
}

/** 엑셀 한 장을 읽어 「품번+DOT → 수량」 으로 만든다 */
function readSheet(buf: Buffer): { key: string; itemNo: string; dot: string | null; qty: number; error?: string }[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const name = wb.SheetNames.includes(SHEET_NAME) ? SHEET_NAME : wb.SheetNames[0];
  if (!name) return [];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: "" });

  /**
   * 🔴 **칸 이름을 너그럽게 찾는다** (2026-08-21 — 내려받는 칸이 늘면서).
   *    엑셀에서 만지다 보면 칸 이름에 공백이 붙거나 「수량 」이 되기도 한다.
   *    우리가 읽는 것은 「품번 · DOT · 수량」 셋뿐이고, 그 밖의 칸(제조사·인치·연식…)은
   *    **있어도 없어도 그만**이다 — 늘어난 칸 때문에 올리기가 깨지지 않는다.
   */
  const pick = (r: Record<string, unknown>, want: string): unknown => {
    if (want in r) return r[want];
    const flat = want.replace(/\s/g, "").toUpperCase();
    for (const k of Object.keys(r)) {
      if (k.replace(/\s/g, "").toUpperCase() === flat) return r[k];
    }
    return "";
  };

  return raw
    .map((r) => {
      const itemNo = normalizeItemNo(pick(r, COL.itemNo));
      const dot = normalizeDot(pick(r, COL.dot));
      /**
       * 🔴 수량은 **엄격하게** 읽는다. 숫자가 아닌 글자를 걸러내면
       *    「네본」 같은 오타가 조용히 0본이 되어 재고가 사라진다 (2026-08-03 시험 중 발견).
       *    쉼표만 봐준다 — 엑셀이 1,000 처럼 넣어 줄 때가 있다.
       */
      const qtyRaw = String(pick(r, COL.qty) ?? "").trim();
      const qs = qtyRaw.replace(/,/g, "");
      const qty = Number(qs);
      let error: string | undefined;
      if (!itemNo) error = "품번이 비어 있습니다";
      else if (qs === "") error = "수량이 비어 있습니다";
      else if (!/^\d+$/.test(qs)) error = `수량 「${qtyRaw}」 을(를) 숫자로 못 읽었습니다`;
      else if (dot && !isValidDot(dot)) error = `DOT ${dot} — 주차는 01~53입니다`;
      else if (dot && !isPlausibleDot(dot)) error = `DOT ${dot} — 연도를 확인해 주세요`;
      return { key: `${itemNo}|${dot ?? ""}`, itemNo, dot, qty, error };
    })
    .filter((r) => r.itemNo || r.error);
}

/**
 * 올린 파일과 지금 재고를 맞춰 본다. **아무것도 바꾸지 않는다.**
 * 되돌리기 어려운 작업이라 사장님이 눈으로 보고 확정하시게 한다.
 */
export async function diffStock(buf: Buffer): Promise<StockDiff> {
  const parsed = readSheet(buf);

  // 같은 「품번+DOT」 가 여러 줄이면 더한다 (사이즈별로 나눠 적으시는 경우가 있다)
  const wanted = new Map<string, { itemNo: string; dot: string | null; qty: number; error?: string }>();
  let merged = 0;
  for (const r of parsed) {
    const cur = wanted.get(r.key);
    if (cur && !r.error && !cur.error) {
      cur.qty += r.qty;
      merged++;
    } else if (!cur) {
      wanted.set(r.key, { itemNo: r.itemNo, dot: r.dot, qty: r.qty, error: r.error });
    }
  }

  const current = await stockSheetRows();
  const cur = new Map(current.map((r) => [`${r[COL.itemNo]}|${r[COL.dot]}`, r]));

  // 품번 → 상품. 엑셀에 새로 적어 넣은 품번도 찾아야 한다
  const nos = [...new Set([...wanted.values()].map((w) => w.itemNo).filter(Boolean))];
  const found = nos.length
    ? await db.execute<{
        id: number;
        mars_item_no: string;
        raw_name: string;
        pattern: string | null;
        display_name: string | null;
        brand_code: string | null;
        width: number | null;
        aspect_ratio: number | null;
        rim_inch: string | null;
      }>(sql`
        SELECT id, mars_item_no, raw_name, pattern, display_name, brand_code, width, aspect_ratio, rim_inch
        FROM product
        WHERE item_type = 'tire' AND mars_item_no = ANY(${sql.raw(
          `ARRAY[${nos.map((n) => `'${n.replace(/'/g, "''")}'`).join(",")}]::text[]`,
        )})
      `)
    : [];
  const byNo = new Map(found.map((p) => [p.mars_item_no, p]));

  const lines: DiffLine[] = [];
  let errors = 0;
  let readRows = 0;

  for (const [key, w] of wanted) {
    const before = cur.get(key)?.[COL.qty] ?? 0;
    const p = byNo.get(w.itemNo);
    const known = cur.get(key);
    const model =
      known?.[COL.model] ??
      (p
        ? p.display_name?.trim() ||
          parseTireName(p.raw_name, p.pattern, {
            width: p.width,
            aspectRatio: p.aspect_ratio,
            rimInch: p.rim_inch,
            brandCode: p.brand_code,
          }).model
        : "");
    const spec =
      known?.[COL.spec] ??
      (p
        ? (parseTireName(p.raw_name, p.pattern, {
            width: p.width,
            aspectRatio: p.aspect_ratio,
            rimInch: p.rim_inch,
            brandCode: p.brand_code,
          }).spec ?? "")
        : "");

    const error = w.error ?? (p ? undefined : `품번 「${w.itemNo}」 을(를) 상품에서 못 찾았습니다`);
    if (error) errors++;
    else readRows++;

    lines.push({
      productId: p ? Number(p.id) : null,
      itemNo: w.itemNo,
      dot: w.dot,
      model,
      spec,
      before,
      after: error ? before : w.qty,
      kind: error
        ? "오류"
        : w.qty === before
          ? "같음"
          : before === 0
            ? "새로"
            : w.qty === 0
              ? "없어짐"
              : w.qty > before
                ? "늘어남"
                : "줄어듦",
      error,
    });
  }

  /**
   * ⭐ 엑셀에 없는 재고는 **0본이 된다** (「엑셀이 정답」).
   *    이게 가장 위험한 부분이라 미리보기에 반드시 줄로 띄운다.
   *
   * 🔴 단, **오류 난 품번의 재고는 0본 처리를 보류한다** (코드 리뷰 2026-08-08).
   *    DOT 를 잘못 친 줄은 오류로 건너뛰는데, 그 바람에 원래 DOT 로트가
   *    「파일에 없음 → 0본」으로 잡혀 실물이 폐기됐다. 그 품번의 어느 줄에든
   *    오류가 있으면 이 파일이 그 품번을 제대로 세었다고 믿을 수 없다 —
   *    보류로 띄우고 사람이 파일을 고쳐 다시 올리게 한다.
   */
  const errorNos = new Set(lines.filter((l) => l.error).map((l) => l.itemNo));
  for (const [key, r] of cur) {
    if (wanted.has(key)) continue;
    if (errorNos.has(r[COL.itemNo])) {
      errors++;
      lines.push({
        productId: null,
        itemNo: r[COL.itemNo],
        dot: r[COL.dot] || null,
        model: r[COL.model],
        spec: r[COL.spec],
        before: r[COL.qty],
        after: r[COL.qty],
        kind: "오류",
        error: "이 품번의 다른 줄에 오류가 있어 0본 처리를 보류합니다 — 파일을 고쳐 다시 올려 주세요",
      });
      continue;
    }
    lines.push({
      productId: null,
      itemNo: r[COL.itemNo],
      dot: r[COL.dot] || null,
      model: r[COL.model],
      spec: r[COL.spec],
      before: r[COL.qty],
      after: 0,
      kind: "없어짐",
    });
  }

  const beforeTotal = current.reduce((s, r) => s + r[COL.qty], 0);
  const afterTotal = lines.reduce((s, l) => s + l.after, 0);

  // 눈에 걸려야 하는 것부터 — 오류 → 없어짐 → 줄어듦 → 늘어남 → 새로 → 같음
  const order: Record<DiffLine["kind"], number> = {
    오류: 0, 없어짐: 1, 줄어듦: 2, 늘어남: 3, 새로: 4, 같음: 5,
  };
  lines.sort((a, b) => order[a.kind] - order[b.kind] || a.spec.localeCompare(b.spec));

  return {
    lines,
    beforeTotal,
    afterTotal,
    merged,
    errors,
    changed: lines.filter((l) => l.kind !== "같음" && l.kind !== "오류").length,
    readRows,
  };
}

/**
 * 미리보기에서 본 그대로 반영한다.
 *
 * ⚠️ 오류가 있는 줄은 **건너뛴다** — 못 읽은 것을 0본으로 만들면 안 된다.
 * ⚠️ 읽어들인 줄이 하나도 없으면 아무것도 하지 않는다. 빈 파일이나 형식이 다른 파일을
 *    올렸을 때 재고가 통째로 사라지는 것을 막는다.
 */
export async function applyStock(buf: Buffer): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const d = await diffStock(buf);
  if (d.readRows === 0) {
    return { ok: false, error: "읽어들인 줄이 없습니다. 「품번 · DOT · 수량」 칸이 있는 파일인지 확인해 주세요" };
  }

  // 「없어짐」 은 productId 가 비어 있으므로 품번으로 다시 찾는다
  const nos = [...new Set(d.lines.filter((l) => !l.productId && !l.error).map((l) => l.itemNo))];
  const extra = nos.length
    ? await db.execute<{ id: number; mars_item_no: string }>(sql`
        SELECT id, mars_item_no FROM product
        WHERE mars_item_no = ANY(${sql.raw(
          `ARRAY[${nos.map((n) => `'${n.replace(/'/g, "''")}'`).join(",")}]::text[]`,
        )})
      `)
    : [];
  const byNo = new Map(extra.map((p) => [p.mars_item_no, Number(p.id)]));

  let changed = 0;
  for (const l of d.lines) {
    if (l.error || l.kind === "같음") continue;
    const pid = l.productId ?? byNo.get(l.itemNo);
    if (!pid) continue;
    const r = await setDotQty({ productId: pid, dot: l.dot, qty: l.after, reason: "엑셀 반영" });
    if (r.ok) changed++;
  }
  return { ok: true, changed };
}
