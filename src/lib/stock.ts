"use server";

/**
 * 재고 조작 — 입고 · 수량 수정 · DOT 보완
 *
 * 원칙 (docs/09 3-6)
 *   재고가 실물과 어긋났을 때 "언제 누가 무엇을 했는지" 를 되짚을 수 있어야 한다.
 *   그래서 모든 변경은 stock_movement 에 남긴다. 이 이력이 없으면 원인을 영원히 못 찾는다.
 *
 * 타이어는 1본 1행(is_serialized). 수량을 늘리면 행이 늘고, 줄이면 행이 사라진다.
 * 부품은 1행에 수량. 숫자만 바뀐다.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { product, stockItem, stockMovement } from "@/db/schema";
import { getSession } from "./auth";
import { isPlausibleDot, isValidDot } from "./normalize";
import { ageAnchorSql, ymdKst } from "./tire-age";
import { parseTireName, type Badge } from "./tire-name";

/**
 * 화면 갱신. 웹 요청 밖(이관 스크립트·실사 배치)에서 호출되면 갱신할 화면이 없으므로
 * 조용히 넘어간다. 이게 없으면 스크립트에서 재고를 고칠 수 없다.
 */
function refresh(...paths: string[]) {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 컨텍스트 밖 — 무시 */
    }
  }
}

export interface DotGroup {
  dot: string | null;
  qty: number;
  /**
   * ⭐ 이 묶음이 **들어온 날** (사장님 지시 2026-08-27)
   *
   *   "dot를 붙이면 가장 좋지만 못할때도 많으니 매입한 날짜도 dot와 함께"
   *
   * DOT 를 대신하는 값이 **아니다** — DOT 는 만든 때, 입고일은 받은 때다.
   * 오늘 받은 타이어가 2년 전에 만들어졌을 수 있으니 둘을 나란히 보여준다.
   * 여러 날에 걸쳐 들어왔으면 `firstIn`~`lastIn` 이 벌어진다. `YYYY-MM-DD` (KST).
   */
  firstIn: string | null;
  lastIn: string | null;
}

/**
 * ⭐ 창고 실사용 한 줄 — 「상품 + DOT」 한 묶음 (사장님 요청 2026-08-03)
 *
 *   "한눈에 현 재고들을 전부 파악하고 싶은데" → "창고 실사용 화면으로 간편하게. 타이어만."
 *
 * 타이어는 1본 1행이라 재고 295본이 stock_item 295줄이다. 그대로 늘어놓으면
 * 창고에서 못 쓴다. 실제로 세는 단위인 **같은 상품·같은 DOT** 로 묶는다.
 */
export interface StockLot {
  productId: number;
  model: string;
  spec: string | null;
  loadSpeed: string | null;
  season: string | null;
  /** 인치별로 갈라 보여주기 위해 따로 둔다 — 창고가 인치로 정리돼 있다 */
  rimInch: number | null;
  width: number | null;
  aspectRatio: number | null;
  dot: string | null;
  /** 장부상 수량 */
  qty: number;
  /** 마지막으로 실물을 확인한 때. null 이면 한 번도 안 셌다 */
  verifiedAt: string | null;
  /** 제조 후 지난 햇수 — 오래된 것부터 팔아야 한다 */
  ageYears: number | null;
}

/**
 * 재고가 있는 타이어를 전부 가져온다. **인치 → 폭 → 편평비 → DOT** 순.
 * 창고를 도는 순서와 같게 놓아야 눈이 화면과 선반 사이를 왔다 갔다 하지 않는다.
 */
export async function stockLots(): Promise<StockLot[]> {
  const rows = await db.execute<{
    product_id: number;
    raw_name: string;
    pattern: string | null;
    display_name: string | null;
    brand_code: string | null;
    season: string | null;
    width: number | null;
    aspect_ratio: number | null;
    rim_inch: string | null;
    load_index: string | null;
    speed_rating: string | null;
    dot: string | null;
    qty: number;
    verified_at: Date | null;
  }>(sql`
    SELECT p.id product_id, p.raw_name, p.pattern, p.display_name, p.brand_code, p.season,
           p.width, p.aspect_ratio, p.rim_inch, p.load_index, p.speed_rating,
           s.dot, SUM(s.qty)::int qty, MAX(s.verified_at) verified_at
    FROM stock_item s JOIN product p ON p.id = s.product_id
    WHERE s.status = '재고' AND s.qty > 0 AND p.item_type = 'tire'
    GROUP BY p.id, p.raw_name, p.pattern, p.display_name, p.brand_code, p.season,
             p.width, p.aspect_ratio, p.rim_inch, p.load_index, p.speed_rating, s.dot
    ORDER BY p.rim_inch NULLS LAST, p.width NULLS LAST, p.aspect_ratio NULLS LAST,
             ${sql.raw(`MIN(${ageAnchorSql("s.dot", "s.received_at")})`)}
  `);

  const thisYear = new Date().getFullYear();
  return rows.map((r) => {
    const n = parseTireName(r.raw_name, r.pattern, {
      width: r.width,
      aspectRatio: r.aspect_ratio,
      rimInch: r.rim_inch,
      brandCode: r.brand_code,
    });
    /** DOT 뒤 두 자리가 제조 연도다 — `0426` = 2026년 4주차 */
    const made = r.dot && /^\d{4}$/.test(r.dot) ? 2000 + Number(r.dot.slice(2, 4)) : null;
    return {
      productId: Number(r.product_id),
      model: r.display_name?.trim() || n.model,
      spec: n.spec,
      loadSpeed: n.loadSpeed ?? (r.load_index ? `${r.load_index}${r.speed_rating ?? ""}` : null),
      season: r.season,
      rimInch: r.rim_inch === null ? null : Number(r.rim_inch),
      width: r.width,
      aspectRatio: r.aspect_ratio,
      dot: r.dot,
      qty: Number(r.qty),
      verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
      ageYears: made === null ? null : Math.max(0, thisYear - made),
    };
  });
}

export interface StockDetail {
  productId: number;
  /** CAI — 미쉐린 고유번호 (MARS 품번) */
  cai: string | null;
  /** 화면용 모델명 (사장님이 정한 이름이 있으면 그것) */
  model: string;
  /** 자동 생성 이름 — 되돌리기 기준 */
  autoModel: string;
  /** 사장님이 직접 넣은 이름. 없으면 null */
  displayName: string | null;
  badges: Badge[];
  unknown: string[];
  /** 고칠 수 있는 세부사항 — 자동 판정 결과 또는 사람이 고친 값 */
  attrs: {
    season: string | null;
    isRunflat: boolean;
    isAcoustic: boolean;
    isSuv: boolean;
    oeMarks: string | null;
    plyRating: number | null;
  };
  /** 사람이 고친 적이 있는가 */
  attrsEdited: boolean;
  /** ⚠️ MARS 입력용 원본 — 화면 정리와 무관하게 유지 (D-08) */
  marsName: string;
  /** 미쉐린 주문 사이트 표기 — 주문할 때 대조용 */
  orderName: string;
  loadSpeed: string | null;
  pattern: string | null;
  brandName: string | null;
  spec: string | null;
  itemType: string;
  isSerialized: boolean;
  stockTracked: boolean;
  isActive: boolean;
  listPrice: number | null;
  total: number;
  verified: boolean;
  verifiedAt: Date | null;
  groups: DotGroup[];
}

/** 다음 재고번호. 'S26-000123' */
async function nextStockNo(): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(2);
  const [r] = await db.execute<{ n: number }>(sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(stock_no, '^S\\d{2}-', ''), '')::bigint), 0)::int + 1 AS n
    FROM stock_item WHERE stock_no LIKE ${"S" + yy + "-%"}
  `);
  return `S${yy}-${String(r?.n ?? 1).padStart(6, "0")}`;
}

export async function getStockDetail(productId: number): Promise<StockDetail | null> {
  const [p] = await db.execute<{
    id: number;
    mars_item_no: string | null;
    raw_name: string;
    display_name: string | null;
    pattern: string | null;
    brand_name: string | null;
    width: number | null;
    aspect_ratio: number | null;
    rim_inch: string | null;
    item_type: string;
    is_serialized: boolean;
    stock_tracked: boolean;
    is_active: boolean;
    list_price: number | null;
    season: string | null;
    is_runflat: boolean;
    is_acoustic: boolean;
    is_suv: boolean;
    oe_marks: string | null;
    ply_rating: number | null;
    attrs_edited: boolean;
    brand_code: string | null;
  }>(sql`
    SELECT p.id, p.mars_item_no, p.raw_name, p.display_name, p.pattern, b.name_ko AS brand_name,
           p.brand_code,
           p.width, p.aspect_ratio, p.rim_inch, p.item_type, p.is_serialized,
           p.stock_tracked, p.is_active, p.list_price,
           p.season, p.is_runflat, p.is_acoustic, p.is_suv, p.oe_marks, p.ply_rating,
           (p.attrs_override IS NOT NULL) AS attrs_edited
    FROM product p LEFT JOIN brand b ON b.code = p.brand_code
    WHERE p.id = ${productId}
  `);
  if (!p) return null;

  /**
   * 🔴 **DOT 글자순으로 세우지 않는다** (2026-08-27).
   *    `WWYY` 는 글자 순서가 시간 순서가 아니다 — `0926`(26년 9주) 이
   *    `4825`(25년 48주) 보다 앞에 오면 화면이 거짓말을 한다.
   *    화면 위의 "오래된 것부터 나갑니다" 가 참이 되려면 판매(`sellFromStock`)와
   *    **같은 축**으로 세워야 한다.
   */
  const groups = await db.execute<{
    dot: string | null;
    qty: number;
    first_in: Date | null;
    last_in: Date | null;
  }>(sql`
    SELECT dot, SUM(qty)::int AS qty,
           MIN(received_at) AS first_in, MAX(received_at) AS last_in
    FROM stock_item
    WHERE product_id = ${productId} AND status = '재고'
    GROUP BY dot
    ORDER BY ${sql.raw(`MIN(${ageAnchorSql("dot", "received_at")})`)}
  `);

  const [v] = await db.execute<{ verified_at: Date | null }>(sql`
    SELECT MAX(verified_at) AS verified_at FROM stock_item
    WHERE product_id = ${productId} AND status = '재고'
  `);

  const n = parseTireName(p.raw_name, p.pattern, {
    width: p.width,
    aspectRatio: p.aspect_ratio,
    rimInch: p.rim_inch,
    brandCode: p.brand_code,
  });
  return {
    productId: p.id,
    cai: p.mars_item_no && /^\d+$/.test(p.mars_item_no) ? p.mars_item_no : null,
    model: p.display_name?.trim() || n.model,
    /** 자동으로 만든 이름 — 사장님이 고칠 때 되돌릴 기준 */
    autoModel: n.model,
    displayName: p.display_name,
    attrs: {
      season: p.season,
      isRunflat: p.is_runflat,
      isAcoustic: p.is_acoustic,
      isSuv: p.is_suv,
      oeMarks: p.oe_marks,
      plyRating: p.ply_rating === null ? null : Number(p.ply_rating),
    },
    attrsEdited: p.attrs_edited,
    badges: n.badges,
    unknown: n.unknown,
    marsName: n.marsName,
    orderName: n.orderName,
    loadSpeed: n.loadSpeed,
    pattern: p.pattern,
    // 상품명 접미(GO=BFGoodrich)가 brand_code 보다 정확하다
    brandName: n.brandHint ?? p.brand_name,
    spec: n.spec,
    itemType: p.item_type,
    isSerialized: p.is_serialized,
    stockTracked: p.stock_tracked,
    isActive: p.is_active,
    listPrice: p.list_price,
    total: groups.reduce((s, g) => s + Number(g.qty), 0),
    verified: v?.verified_at !== null && v?.verified_at !== undefined,
    verifiedAt: v?.verified_at ?? null,
    groups: groups.map((g) => ({
      dot: g.dot,
      qty: Number(g.qty),
      firstIn: g.first_in ? ymdKst(g.first_in) : null,
      lastIn: g.last_in ? ymdKst(g.last_in) : null,
    })),
  };
}

/** DOT 값 검사 — 화면과 서버가 같은 규칙을 쓴다 */
export async function validateDot(dot: string): Promise<string | null> {
  if (!dot) return null; // 비워도 된다 (D-02)
  if (!/^\d{4}$/.test(dot)) return "DOT는 숫자 4자리입니다. 예: 1826 (2026년 18주)";
  if (!isValidDot(dot)) return `${dot.slice(0, 2)}주는 없습니다. 주차는 01~53입니다`;
  if (!isPlausibleDot(dot)) return `${2000 + Number(dot.slice(2, 4))}년산이 됩니다. 연도를 확인해 주세요`;
  return null;
}

/**
 * 특정 DOT의 재고를 지정 수량으로 맞춘다.
 * 실사에서 "이 DOT는 8본이더라" 를 그대로 반영하는 동작.
 */
export async function setDotQty(input: {
  productId: number;
  dot: string | null;
  qty: number;
  reason: string;
  userId?: number;
}): Promise<{ ok: true; delta: number } | { ok: false; error: string }> {
  const { productId, qty, reason } = input;
  const dot = input.dot?.trim() || null;

  if (!Number.isInteger(qty) || qty < 0) return { ok: false, error: "수량은 0 이상의 정수여야 합니다" };
  if (dot) {
    const err = await validateDot(dot);
    if (err) return { ok: false, error: err };
  }

  const [p] = await db.select({ isSerialized: product.isSerialized }).from(product).where(eq(product.id, productId));
  if (!p) return { ok: false, error: "상품을 찾을 수 없습니다" };

  const dotCond = dot === null ? isNull(stockItem.dot) : eq(stockItem.dot, dot);
  const rows = await db
    .select({ id: stockItem.id, qty: stockItem.qty })
    .from(stockItem)
    .where(and(eq(stockItem.productId, productId), eq(stockItem.status, "재고"), dotCond))
    .orderBy(desc(stockItem.receivedAt));

  const current = rows.reduce((s, r) => s + r.qty, 0);
  const delta = qty - current;
  const now = new Date();

  if (p.isSerialized) {
    // 타이어 — 행을 늘리거나 줄인다
    if (delta > 0) {
      const base = await nextStockNo();
      const seq = Number(base.split("-")[1]);
      const yy = base.slice(1, 3);
      const values = Array.from({ length: delta }, (_, i) => ({
        stockNo: `S${yy}-${String(seq + i).padStart(6, "0")}`,
        productId,
        qty: 1,
        status: "재고",
        dot,
        verifiedAt: now,
      }));
      const inserted = await db.insert(stockItem).values(values).returning({ id: stockItem.id });
      await db.insert(stockMovement).values(
        inserted.map((r) => ({
          stockItemId: r.id,
          type: "입고",
          reason,
          qtyDelta: 1,
          createdBy: input.userId ?? null,
        })),
      );
    } else if (delta < 0) {
      // 최근 입고분부터 뺀다 (오래된 것은 선입선출로 팔려야 하므로 남긴다)
      const victims = rows.slice(0, -delta);
      for (const v of victims) {
        await db.insert(stockMovement).values({
          stockItemId: v.id,
          type: "조정",
          reason,
          qtyDelta: -v.qty,
          createdBy: input.userId ?? null,
        });
      }
      await db
        .update(stockItem)
        .set({ status: "폐기", verifiedAt: now })
        .where(sql`${stockItem.id} IN ${sql.raw(`(${victims.map((v) => v.id).join(",") || "NULL"})`)}`);
    } else {
      // 수량이 같아도 "확인했다"는 사실은 남긴다 — 이게 실사다
      await db
        .update(stockItem)
        .set({ verifiedAt: now })
        .where(and(eq(stockItem.productId, productId), eq(stockItem.status, "재고"), dotCond));
    }
  } else {
    // 부품 — 한 행의 수량만 바꾼다
    if (rows.length === 0) {
      const [ins] = await db
        .insert(stockItem)
        .values({ stockNo: await nextStockNo(), productId, qty, status: "재고", dot, verifiedAt: now })
        .returning({ id: stockItem.id });
      await db.insert(stockMovement).values({
        stockItemId: ins.id,
        type: "입고",
        reason,
        qtyDelta: qty,
        createdBy: input.userId ?? null,
      });
    } else {
      const target = rows[0];
      await db.update(stockItem).set({ qty, verifiedAt: now }).where(eq(stockItem.id, target.id));
      // 여러 행으로 흩어져 있었다면 나머지는 0으로 정리한다
      for (const r of rows.slice(1)) {
        await db.update(stockItem).set({ qty: 0, verifiedAt: now }).where(eq(stockItem.id, r.id));
      }
      await db.insert(stockMovement).values({
        stockItemId: target.id,
        type: "조정",
        reason,
        qtyDelta: delta,
        createdBy: input.userId ?? null,
      });
    }
  }

  // ⭐ 재고를 한 번이라도 넣었으면 「미등록」이 아니다 (D-12 6번)
  if (qty > 0) {
    await db.update(product).set({ stockTracked: true }).where(eq(product.id, productId));
  }

  refresh(`/stock/${productId}`, "/stock", "/");
  return { ok: true, delta };
}

/**
 * ⭐ 입고일 고치기 (사장님 지시 2026-08-27)
 *
 *   "매입한 날짜도 dot와 함께 붙여주었으면 좋겠음."
 *
 * 🔴 왜 고칠 수 있어야 하는가 — 지금 `received_at` 은 **실제로 받은 날이 아니라
 *    「앱에 넣은 날」** 이다. 2026-08 재고 실사로 1,233본을 한꺼번에 넣은 탓에
 *    재고 2,007본이 전부 "최근 3개월 입고" 로 보인다. 고칠 길이 없으면 이 값은
 *    영영 거짓이고, 그 위에 세운 선입선출·묵은 재고 경고도 같이 거짓이 된다.
 *
 * 묶음(같은 상품·같은 DOT) 단위로 한 날에 맞춘다 — 창고에서 세는 단위가 그것이다.
 * `created_at` 은 그대로 남으므로 "언제 앱에 넣었나" 는 잃지 않는다.
 */
export async function setLotReceivedDate(input: {
  productId: number;
  dot: string | null;
  /** `YYYY-MM-DD` (KST) */
  date: string;
}): Promise<{ ok: true; n: number } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "다시 로그인해 주세요" };

  const { productId, date } = input;
  const dot = input.dot?.trim() || null;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return { ok: false, error: "날짜를 확인해 주세요" };

  const today = ymdKst(new Date());
  if (date > today) return { ok: false, error: "앞으로 올 날짜는 입고일이 될 수 없습니다" };
  if (Number(date.slice(0, 4)) < new Date().getFullYear() - 15)
    return { ok: false, error: `${date.slice(0, 4)}년이 됩니다. 연도를 확인해 주세요` };

  /**
   * 하루의 어느 시각으로 둘 것인가 — **KST 09:00**.
   * 자정으로 두면 시차 계산이 하루 앞뒤로 미끄러져 화면에 전날이 찍힌다.
   */
  const at = new Date(`${date}T09:00:00+09:00`);

  const dotCond = dot === null ? isNull(stockItem.dot) : eq(stockItem.dot, dot);
  const rows = await db
    .select({ id: stockItem.id, receivedAt: stockItem.receivedAt })
    .from(stockItem)
    .where(and(eq(stockItem.productId, productId), eq(stockItem.status, "재고"), dotCond));
  if (rows.length === 0) return { ok: false, error: "그 묶음에 재고가 없습니다" };

  await db
    .update(stockItem)
    .set({ receivedAt: at })
    .where(sql`${stockItem.id} IN ${sql.raw(`(${rows.map((r) => r.id).join(",")})`)}`);

  /* 수량은 그대로다 — 그래도 "누가 언제 무엇을 바꿨나" 는 남긴다 (docs/09 3-6) */
  const before = rows[0].receivedAt ? ymdKst(rows[0].receivedAt) : "없음";
  await db.insert(stockMovement).values(
    rows.map((r) => ({
      stockItemId: r.id,
      type: "조정" as const,
      reason: "입고일 수정",
      qtyDelta: 0,
      memo: `${before} → ${date}`,
      createdBy: session.uid,
    })),
  );

  refresh(`/stock/${productId}`, "/stock", "/");
  return { ok: true, n: rows.length };
}

/**
 * 🔴 `changeDot`(DOT 직접 수정)은 지웠다 (2026-08-03).
 *    그 버튼이 있던 화면을 걷어내서 부르는 곳이 없고,
 *    "use server" 파일의 export 는 그대로 열려 있는 서버 엔드포인트가 된다.
 *    DOT 가 틀렸으면 재고 엑셀에서 그 줄을 0본으로 두고,
 *    맞는 DOT 로 새 줄을 적으면 된다.
 */

/** 새 상품 등록 — MARS 마스터에 없는 신모델·새 부품용 */
export async function createProduct(input: {
  brandCode: string;
  pattern: string;
  width: number | null;
  aspectRatio: number | null;
  rimInch: number | null;
  loadIndex?: string | null;
  speedRating?: string | null;
  listPrice?: number | null;
  itemType?: "tire" | "part";
  partNo?: string | null;
  fitment?: string | null;
  /**
   * ⭐ 부품 전용 (2026-08-14 — 사장님 "새로운 부품이 생겼을때 어떻게 등록해야할지").
   *    분류는 재고 화면의 묶음이 되고, 매입가는 마진 계산의 바탕이 된다.
   *    부품은 기표가(손님 가격) 대신 매입가를 넣는다 — 판매할 때 값을 친다.
   */
  category?: string | null;
  purchasePrice?: number | null;
  minQty?: number | null;
}): Promise<{ ok: true; productId: number } | { ok: false; error: string }> {
  const itemType = input.itemType ?? "tire";
  if (!input.pattern?.trim()) {
    return { ok: false, error: itemType === "part" ? "부품 이름을 입력해 주세요" : "모델명을 입력해 주세요" };
  }
  if (itemType === "tire" && (!input.width || !input.aspectRatio || !input.rimInch)) {
    return { ok: false, error: "규격(폭/편평비/인치)을 모두 입력해 주세요" };
  }

  /**
   * ⚠️ 같은 품번이 이미 있으면 막는다 — 부품이 갈라지면 재고가 두 곳으로 나뉜다.
   *    (타이어는 같은 규격 여러 모델이 정상이라 경고만 하고 막지 않는다)
   */
  const partNo = input.partNo?.trim() || null;
  if (itemType === "part" && partNo) {
    const [dup] = await db
      .select({ id: product.id, name: product.rawName })
      .from(product)
      .where(and(eq(product.itemType, "part"), eq(product.partNo, partNo)))
      .limit(1);
    if (dup) return { ok: false, error: `품번 ${partNo} 은(는) 이미 있습니다 — 「${dup.name}」` };
  }

  const spec = itemType === "tire" ? `${input.width}/${input.aspectRatio}R${input.rimInch}` : (partNo ?? "");
  const rawName = `${input.pattern.trim()} ${spec}`.trim();

  // MARS 품번이 없는 자체 등록품은 접두로 구분한다
  const marsItemNo = `NEW-${Date.now().toString(36).toUpperCase()}`;

  const [row] = await db
    .insert(product)
    .values({
      marsItemNo,
      itemType,
      isSerialized: itemType === "tire",
      // 🔴 기본 판매 할인율 25% 는 category='10-TIRES' 규칙에 걸려 있다 (2026-08-09
      //    사장님 버그 제보 — 새 상품이 검색에서 「할인율 미설정」으로 나왔다)
      category: itemType === "tire" ? "10-TIRES" : (input.category?.trim() || null),
      brandCode: input.brandCode || null,
      pattern: input.pattern.trim(),
      // 손 등록은 사장님이 친 이름 그대로가 표시 이름이다 (2026-08-08 품목명 통일)
      displayName: input.pattern.trim(),
      rawName,
      width: input.width,
      aspectRatio: input.aspectRatio,
      rimInch: input.rimInch !== null ? String(input.rimInch) : null,
      loadIndex: input.loadIndex ?? null,
      speedRating: input.speedRating ?? null,
      listPrice: input.listPrice ?? null,
      purchasePrice: input.purchasePrice ?? null,
      minQty: input.minQty ?? null,
      partNo,
      fitment: input.fitment?.trim() || null,
      specParsed: true,
      stockTracked: false,
    })
    .returning({ id: product.id });

  refresh("/", "/stock");
  return { ok: true, productId: row.id };
}
