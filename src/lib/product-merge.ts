"use server";

/**
 * ⭐ 중복 상품 합치기 (사장님 승인 2026-08-05 — 품목 정리 ②)
 *
 * 같은 타이어가 상품 두세 개로 갈라져 있는 것을 하나로 모은다.
 * 전수 조사(2026-08-05) 결과 실사용 상품 770개 중 42묶음 93개가 중복이었다 —
 * 대부분 금호: MARS 원본 코드와 자재검색으로 만든 코드가 따로 산 경우.
 *
 * 거래처 합치기(`supplier.ts` confirmMerge)와 같은 태도로 만든다:
 *   · 미리보기(무엇이 어디로 가는지)를 보여주고 **사람이 확인한 뒤에만** 합친다
 *   · 재고·판매·매입·사전을 대표 상품으로 옮긴다 — 이력은 하나도 잃지 않는다
 *   · 흡수된 품번은 거래처 사전에 남겨 다음 인보이스·카탈로그가 **다시 만들지 않게** 한다
 *
 * 🔴 흡수된 상품 행은 지운다. 남겨 두면 품번 검색(mars_item_no)이 다시 그 행을
 *    물어 와 중복이 부활한다. 지우기 전에 참조를 전부 옮기므로, 남은 참조가
 *    있으면 DB 외래키가 삭제를 막아 준다 (그게 마지막 안전장치다).
 */

import { inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { product } from "@/db/schema";

function refresh(...paths: string[]) {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

export interface DupProduct {
  id: number;
  marsItemNo: string | null;
  name: string;
  listPrice: number | null;
  stockQty: number;
  saleCount: number;
  purchaseCount: number;
  dictCount: number;
  isActive: boolean;
  /** 대표로 추천 — 재고·이력이 가장 많은 것 */
  suggested: boolean;
}

export interface DupGroup {
  /** 화면 표시용 — 「KM 255/40R18 99W Majesty X Solus TA92」 */
  label: string;
  products: DupProduct[];
}

/**
 * 실사용 상품 중, 브랜드·규격·하중/속도·모델명(기호 무시)까지 같은 묶음.
 * 🔴 실사용(재고·판매·매입·사전에 걸린 것)만 본다 — 안 쓰는 마스터끼리의 중복은
 *    합칠 이유가 없다 (기본 검색에서 이미 안 보인다, 품목 정리 ①).
 */
export async function duplicateGroups(): Promise<DupGroup[]> {
  const rows = await db.execute<{
    gkey: string;
    label: string;
    id: number;
    mars_item_no: string | null;
    name: string;
    list_price: number | null;
    stock_qty: number;
    sale_count: number;
    purchase_count: number;
    dict_count: number;
    is_active: boolean;
  }>(sql`
    WITH used AS (
      SELECT DISTINCT product_id AS id FROM stock_item WHERE product_id IS NOT NULL
      UNION SELECT DISTINCT product_id FROM quote_item WHERE product_id IS NOT NULL
      UNION SELECT DISTINCT product_id FROM purchase_invoice_item WHERE product_id IS NOT NULL
      UNION SELECT DISTINCT product_id FROM supplier_item_code WHERE product_id IS NOT NULL
    ),
    t AS (
      SELECT p.id, p.mars_item_no, p.is_active, p.list_price,
             COALESCE(p.display_name, p.pattern, '') AS name,
             p.brand_code || '|' || p.width || '|' || COALESCE(p.aspect_ratio::text,'') || '|' ||
               COALESCE(p.rim_inch::text,'') || '|' || COALESCE(p.load_index::text,'') || '|' ||
               COALESCE(p.speed_rating::text,'') || '|' ||
               lower(regexp_replace(COALESCE(p.display_name, p.pattern, ''), '[^a-zA-Z0-9가-힣]', '', 'g')) AS gkey,
             p.brand_code || ' ' || p.width || '/' || COALESCE(p.aspect_ratio::text,'') || 'R' ||
               COALESCE(p.rim_inch::text,'') || ' ' || COALESCE(p.load_index::text,'') || COALESCE(p.speed_rating::text,'') AS label
      FROM product p JOIN used u ON u.id = p.id
      WHERE p.item_type = 'tire' AND p.width IS NOT NULL
    ),
    g AS (SELECT gkey FROM t GROUP BY gkey HAVING count(*) > 1)
    SELECT t.gkey, t.label, t.id, t.mars_item_no, t.name, t.list_price, t.is_active,
      (SELECT COALESCE(SUM(s.qty), 0) FROM stock_item s WHERE s.product_id = t.id AND s.status = '재고')::int AS stock_qty,
      (SELECT count(*) FROM quote_item qi WHERE qi.product_id = t.id)::int AS sale_count,
      (SELECT count(*) FROM purchase_invoice_item ii WHERE ii.product_id = t.id)::int AS purchase_count,
      (SELECT count(*) FROM supplier_item_code sc WHERE sc.product_id = t.id)::int AS dict_count
    FROM t JOIN g ON g.gkey = t.gkey
    ORDER BY t.label, t.id
  `);

  const byKey = new Map<string, DupGroup & { key: string }>();
  for (const r of rows) {
    const g = byKey.get(r.gkey) ?? { key: r.gkey, label: `${r.label} ${r.name}`.trim(), products: [] };
    byKey.set(r.gkey, g);
    g.products.push({
      id: Number(r.id),
      marsItemNo: r.mars_item_no,
      name: r.name,
      listPrice: r.list_price === null ? null : Number(r.list_price),
      stockQty: Number(r.stock_qty),
      saleCount: Number(r.sale_count),
      purchaseCount: Number(r.purchase_count),
      dictCount: Number(r.dict_count),
      isActive: r.is_active,
      suggested: false,
    });
  }

  const groups = [...byKey.values()];
  for (const g of groups) {
    /** 대표 추천 — 재고 > 판매 > 매입 > 사전 순으로 많은 것. 같으면 먼저 만든 것 */
    const best = [...g.products].sort(
      (a, b) =>
        b.stockQty - a.stockQty ||
        b.saleCount - a.saleCount ||
        b.purchaseCount - a.purchaseCount ||
        b.dictCount - a.dictCount ||
        a.id - b.id,
    )[0];
    best.suggested = true;
  }
  return groups;
}

/**
 * 합치기 실행 — absorbIds 의 재고·판매·매입·사전을 keepId 로 옮기고 행을 지운다.
 *
 * 🔴 안전장치:
 *   ① 대표와 흡수 대상이 **같은 브랜드·규격**이어야 한다 (엉뚱한 상품을 못 합치게)
 *   ② 참조 이동 → 삭제를 **한 트랜잭션**으로 — 중간에 죽으면 아무 일도 없던 것이 된다
 *   ③ 흡수된 품번(KM자재코드 등)은 거래처 사전에 대표를 가리키게 남긴다 —
 *      다음 금호 인보이스·자재검색이 그 코드를 만나도 대표에 붙는다
 */
export async function mergeProducts(
  keepId: number,
  absorbIds: number[],
): Promise<{ ok: true; moved: string } | { ok: false; error: string }> {
  const ids = [...new Set(absorbIds)].filter((x) => x !== keepId);
  if (ids.length === 0) return { ok: false, error: "합칠 상품이 없습니다" };

  const all = await db
    .select({
      id: product.id,
      brandCode: product.brandCode,
      width: product.width,
      aspectRatio: product.aspectRatio,
      rimInch: product.rimInch,
      marsItemNo: product.marsItemNo,
      rawName: product.rawName,
      pattern: product.pattern,
    })
    .from(product)
    .where(inArray(product.id, [keepId, ...ids]));

  const keep = all.find((p) => p.id === keepId);
  if (!keep) return { ok: false, error: "대표 상품을 찾을 수 없습니다" };
  if (all.length !== ids.length + 1) return { ok: false, error: "이미 합쳐졌거나 없는 상품이 섞여 있습니다" };
  for (const p of all) {
    if (
      p.brandCode !== keep.brandCode ||
      p.width !== keep.width ||
      p.aspectRatio !== keep.aspectRatio ||
      p.rimInch !== keep.rimInch
    ) {
      return { ok: false, error: `브랜드·규격이 다른 상품은 합칠 수 없습니다 (#${p.id})` };
    }
  }

  const absorbed = all.filter((p) => p.id !== keepId);

  try {
    // drizzle 의 sql 템플릿은 배열을 IN 목록으로 못 편다 — 직접 잇는다 (2026-08-04 배운 것)
    const idList = sql.join(ids.map((i) => sql`${i}`), sql`, `);
    const summary = await db.transaction(async (tx) => {
      const st = await tx.execute<{ count: string }>(
        sql`WITH m AS (UPDATE stock_item SET product_id = ${keepId} WHERE product_id IN (${idList}) RETURNING 1) SELECT count(*) FROM m`,
      );
      const qi = await tx.execute<{ count: string }>(
        sql`WITH m AS (UPDATE quote_item SET product_id = ${keepId} WHERE product_id IN (${idList}) RETURNING 1) SELECT count(*) FROM m`,
      );
      const ii = await tx.execute<{ count: string }>(
        sql`WITH m AS (UPDATE purchase_invoice_item SET product_id = ${keepId} WHERE product_id IN (${idList}) RETURNING 1) SELECT count(*) FROM m`,
      );
      await tx.execute(sql`UPDATE product_barcode SET product_id = ${keepId} WHERE product_id IN (${idList})`);
      /**
       * 사전 이동 — (거래처, 품번) 이 이미 대표를 가리키고 있으면 흡수분은 지운다.
       * uq_supplier_item_code(supplier, code) 때문에 그냥 UPDATE 하면 충돌난다.
       */
      const sc = await tx.execute<{ count: string }>(sql`
        WITH m AS (
          UPDATE supplier_item_code sc SET product_id = ${keepId}
          WHERE sc.product_id IN (${idList})
          RETURNING 1
        ) SELECT count(*) FROM m
      `);

      /** 흡수된 품번을 사전에 남긴다 — 금호 KM자재코드는 맨숫자 코드도 함께 */
      for (const p of absorbed) {
        const no = p.marsItemNo?.trim();
        if (!no) continue;
        const codes = [no];
        const m = /^KM(\d{7,8})$/.exec(no);
        if (m) codes.push(m[1]);
        for (const code of codes) {
          await tx.execute(sql`
            INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by)
            VALUES ('금호', ${code}, ${keepId}, ${p.rawName ?? p.pattern ?? null}, '합치기')
            ON CONFLICT (supplier, code) DO NOTHING
          `);
        }
      }

      /** 참조가 하나라도 남았으면 여기서 외래키가 막는다 — 그래야 안전하다 */
      await tx.execute(sql`DELETE FROM product WHERE id IN (${idList})`);

      return `재고 ${st[0]?.count ?? 0}건 · 판매 ${qi[0]?.count ?? 0}건 · 매입 ${ii[0]?.count ?? 0}건 · 사전 ${sc[0]?.count ?? 0}건`;
    });

    refresh("/", "/settings/products", "/stock", "/sale");
    return { ok: true, moved: summary };
  } catch (e) {
    return { ok: false, error: `합치지 못했습니다: ${(e as Error).message.slice(0, 160)}` };
  }
}
