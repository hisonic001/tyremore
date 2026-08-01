"use server";

/**
 * 바코드로 상품 찾기 — 여러 경로를 순서대로 시도한다
 *
 * 🔴 브랜드마다 바코드 체계가 다르고, MARS 데이터에는 **실제 라벨 바코드가 없다**.
 *    그래서 한 가지 규칙으로는 절대 못 맞춘다. 찾는 방법을 여러 개 두고,
 *    그래도 못 찾으면 **사람이 한 번 이어 주면 그다음부터 자동**이 되게 한다.
 *
 * 확인된 체계 (2026-08-01)
 *   미쉐린     441358261D590A  → 앞 6자리가 CAI. 뒤 8자리는 본마다 다르다(개별 식별자)
 *   한국타이어 8808563590301   → EAN-13. 품번(HK1033085)과 연결고리가 없다
 */
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { product, productBarcode } from "@/db/schema";
import { parseTireBarcode } from "./barcode";

export interface BarcodeHit {
  productId: number;
  marsItemNo: string | null;
  model: string | null;
  spec: string | null;
  /** 어떻게 찾았는지 — 화면에 알려 주면 사장님이 신뢰할 수 있다 */
  via: "등록된 바코드" | "품번 일치" | "앞자리 일치";
  /** 라벨 뒤쪽 개별 식별자 */
  serial: string | null;
}

export async function lookupBarcode(raw: string): Promise<BarcodeHit | null> {
  const scanned = parseTireBarcode(raw);
  const code = scanned.raw;

  /** ① 사장님이 이어 준 바코드가 최우선 — 배운 것이 규칙을 이긴다 */
  const [learned] = await db.execute<{
    id: number;
    mars_item_no: string | null;
    pattern: string | null;
    w: number | null;
    a: number | null;
    r: string | null;
    kind: string;
    matched: string;
  }>(sql`
    SELECT p.id, p.mars_item_no, COALESCE(p.display_name, p.pattern) pattern,
           p.width w, p.aspect_ratio a, p.rim_inch r, b.kind, b.code matched
    FROM product_barcode b JOIN product p ON p.id = b.product_id
    WHERE (b.kind = 'exact'  AND b.code = ${code})
       OR (b.kind = 'prefix' AND ${code} LIKE b.code || '%')
    ORDER BY b.kind = 'exact' DESC, length(b.code) DESC
    LIMIT 1
  `);
  if (learned) {
    return {
      productId: learned.id,
      marsItemNo: learned.mars_item_no,
      model: learned.pattern,
      spec: fmt(learned.w, learned.a, learned.r),
      via: "등록된 바코드",
      /**
       * ⚠️ `exact` 는 개별 식별자가 없다. EAN-13(8808563590301)은 **상품 고유 번호**라
       *    같은 상품 여러 본이 전부 같은 값이다. 여기서 뒷자리를 떼어 개별번호처럼
       *    쓰면 서로 다른 본이 같은 번호를 갖게 된다.
       *    개별 식별이 되는 것은 `prefix` (미쉐린처럼 뒤가 본마다 다른 경우)뿐이다.
       */
      serial: learned.kind === "prefix" ? code.slice(learned.matched.length) || null : null,
    };
  }

  /** ② 품번을 그대로 찍은 경우 */
  const [exact] = await db.execute<{
    id: number;
    mars_item_no: string | null;
    pattern: string | null;
    w: number | null;
    a: number | null;
    r: string | null;
  }>(sql`
    SELECT id, mars_item_no, COALESCE(display_name, pattern) pattern, width w, aspect_ratio a, rim_inch r
    FROM product WHERE mars_item_no = ${code} OR barcode = ${code} LIMIT 1
  `);
  if (exact) {
    return {
      productId: exact.id,
      marsItemNo: exact.mars_item_no,
      model: exact.pattern,
      spec: fmt(exact.w, exact.a, exact.r),
      via: "품번 일치",
      serial: null,
    };
  }

  /** ③ 미쉐린식 — 앞 6자리가 품번 */
  if (scanned.kind === "label") {
    const [pre] = await db.execute<{
      id: number;
      mars_item_no: string | null;
      pattern: string | null;
      w: number | null;
      a: number | null;
      r: string | null;
    }>(sql`
      SELECT id, mars_item_no, COALESCE(display_name, pattern) pattern, width w, aspect_ratio a, rim_inch r
      FROM product WHERE mars_item_no = ${scanned.code} LIMIT 1
    `);
    if (pre) {
      return {
        productId: pre.id,
        marsItemNo: pre.mars_item_no,
        model: pre.pattern,
        spec: fmt(pre.w, pre.a, pre.r),
        via: "앞자리 일치",
        serial: scanned.serial,
      };
    }
  }

  return null;
}

function fmt(w: number | null, a: number | null, r: string | null): string | null {
  return w && a && r ? `${w}/${a}R${Number(r)}` : null;
}

/**
 * ⭐ 못 찾은 바코드를 상품에 이어 준다. 한 번만 하면 그다음부터 자동이다.
 *
 * @param kind exact  — 이 바코드가 곧 그 상품 (EAN-13 처럼 상품마다 고정)
 *             prefix — 앞부분만 같고 뒤에 개별번호가 붙는 경우 (미쉐린식)
 */
export async function linkBarcode(input: {
  code: string;
  productId: number;
  kind?: "exact" | "prefix";
  userId?: number;
}): Promise<{ ok: true; kind: string } | { ok: false; error: string }> {
  const code = String(input.code ?? "").trim().toUpperCase();
  if (code.length < 4) return { ok: false, error: "바코드가 너무 짧습니다" };

  const [p] = await db.select({ id: product.id }).from(product).where(eq(product.id, input.productId));
  if (!p) return { ok: false, error: "상품을 찾을 수 없습니다" };

  const kind = input.kind ?? "exact";
  try {
    await db.insert(productBarcode).values([
      { code, productId: input.productId, kind, createdBy: input.userId ?? null },
    ]);
  } catch {
    // 이미 있으면 상품만 바꿔 준다 (잘못 이어 놨을 때 고칠 수 있어야 한다)
    await db
      .update(productBarcode)
      .set({ productId: input.productId, kind })
      .where(eq(productBarcode.code, code));
  }

  try {
    revalidatePath("/receiving");
  } catch {
    /* 요청 밖 */
  }
  return { ok: true, kind };
}
