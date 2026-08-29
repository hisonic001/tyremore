/**
 * 콘티넨탈 2026 목록 → 우리 카탈로그 (상품 목록 채우기 화면이 쓴다) ⭐ 2026-08-29
 *
 *   화면(`/settings/products` 「목록 채우기」)에서 거래처 「콘티넨탈」을 고르고
 *   운영 규격 엑셀이나 겨울 주문서를 올리면 여기로 온다.
 *   같은 일을 하는 스크립트가 `scripts/conti-apply-20260829.ts` 다 — **규칙은 이 파일 하나**.
 *
 * 🔴 **재고는 성역이다.** 여기서는 접지 않는다. 목록에 없는 것을 접는 일은
 *    스크립트가 사장님 확인을 거쳐서만 한다 (재고·판매가 있는 것을 화면 조작으로
 *    조용히 숨기면 창고에 있는 타이어가 안 보이게 된다).
 *
 * 🔴 이름은 `name_auto` 3단 논리 — 사장님이 손으로 고친 이름은 건드리지 않는다.
 *
 * 🔴 "use server" 아님 — product-list.ts 가 서버 액션이다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { ApplyResult, CatalogPlan, LinkKind, PlanLine } from "./kumho-sheet";
import {
  looksLikeContiSpec,
  looksLikeContiWinter,
  readContiSpec,
  readContiWinter,
  type ContiRow,
} from "./conti-sheet";

export { looksLikeContiSpec, looksLikeContiWinter };

/** 자재 마스터에 저장 — 무엇을 파는지의 정본 */
export async function saveContiMaterials(rows: ContiRow[]): Promise<{ inserted: number; updated: number }> {
  const before = await db.execute<{ code: string }>(sql`SELECT code FROM continental_material`);
  const had = new Set(before.map((r) => r.code));
  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO continental_material (code, brand_code, description, marketing_line, pattern_code, model_name,
                                        season, rim_inch, size_code, coc, price_excl, source_label, updated_at)
      VALUES (${r.code}, ${r.brandCode}, ${r.desc}, ${r.marketingLine}, ${r.patternCode}, ${r.parsed.name},
              ${r.season}, ${r.rimInch}, ${r.sizeCode}, ${r.coc}, ${r.priceExcl}, ${r.sourceLabel}, now())
      ON CONFLICT (code) DO UPDATE SET
        brand_code = EXCLUDED.brand_code, description = EXCLUDED.description,
        marketing_line = EXCLUDED.marketing_line, pattern_code = EXCLUDED.pattern_code,
        model_name = EXCLUDED.model_name, season = EXCLUDED.season, rim_inch = EXCLUDED.rim_inch,
        size_code = EXCLUDED.size_code, coc = EXCLUDED.coc, price_excl = EXCLUDED.price_excl,
        source_label = EXCLUDED.source_label, updated_at = now()`);
    if (had.has(r.code)) updated++;
    else inserted++;
  }
  return { inserted, updated };
}

type Row = {
  id: number;
  mars_item_no: string;
  display_name: string | null;
  name_auto: string | null;
  list_price: number | null;
  list_price_excl: number | null;
};

/** 우리 상품과 맞춰 본다 — 저장하지 않는다 */
export async function planConti(rows: ContiRow[], skipped: number): Promise<CatalogPlan> {
  const counts = { 이미연결: 0, 품번: 0, "규격+패턴": 0, 재코드: 0, 애매: 0, 신규: 0, 규격없음: 0 } as Record<LinkKind, number>;
  const lines: PlanLine[] = [];
  const diffs: number[] = [];
  let up = 0;
  let down = 0;
  let biggest = 0;

  const have =
    rows.length === 0
      ? []
      : await db.execute<Row>(sql`
          SELECT id, mars_item_no, display_name, name_auto, list_price, list_price_excl
          FROM product WHERE mars_item_no IN (${sql.join(rows.map((r) => sql`${r.itemNo}`), sql`, `)})`);
  const byNo = new Map(have.map((p) => [p.mars_item_no, p]));

  for (const r of rows) {
    const p = byNo.get(r.itemNo);
    const incl = Math.round(r.priceExcl * 1.1);
    const kind: LinkKind = !r.parsed.specParsed ? "규격없음" : p ? "품번" : "신규";
    counts[kind]++;
    const changes = !!p && p.list_price !== incl;
    if (p && changes && p.list_price) {
      const pct = ((incl - p.list_price) / p.list_price) * 100;
      diffs.push(Math.abs(pct));
      if (pct > 0) up++;
      else down++;
      if (Math.abs(pct) > Math.abs(biggest)) biggest = pct;
    }
    lines.push({
      row: {
        code: r.code,
        name: r.desc,
        patternCode: r.patternCode ?? "",
        loadIndex: r.parsed.loadIndex,
        speedRating: r.parsed.speedRating,
        listPrice: incl,
        width: r.parsed.width,
        aspectRatio: r.parsed.aspectRatio,
        rimInch: r.parsed.rimInch === null ? null : String(r.parsed.rimInch),
        model: r.parsed.name,
      },
      kind,
      productId: p ? Number(p.id) : null,
      productName: p?.display_name ?? null,
      ourItemNo: p?.mars_item_no ?? null,
      candidates: [],
      ourPrice: p?.list_price ?? null,
      priceChanges: changes,
    });
  }
  return {
    lines,
    counts,
    read: rows.length,
    skipped,
    priceDiffCount: diffs.length,
    priceDiffAvgPct: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0,
    priceUpCount: up,
    priceDownCount: down,
    priceBiggestPct: biggest,
  };
}

/** 반영 — 자재 마스터 저장 → 사전 등록 → 잇기·갱신 → (고르셨으면) 새로 만들기 */
export async function applyConti(
  rows: ContiRow[],
  opts: { updatePrices: boolean; createMissing: boolean },
): Promise<ApplyResult | { ok: false; error: string }> {
  if (rows.length === 0) return { ok: false, error: "읽을 수 있는 줄이 없습니다" };
  const materials = await saveContiMaterials(rows);

  const have = await db.execute<Row>(sql`
    SELECT id, mars_item_no, display_name, name_auto, list_price, list_price_excl
    FROM product WHERE mars_item_no IN (${sql.join(rows.map((r) => sql`${r.itemNo}`), sql`, `)})`);
  const byNo = new Map(have.map((p) => [p.mars_item_no, p]));

  let linked = 0;
  let created = 0;
  let priceUpdated = 0;
  let skipped = 0;

  for (const r of rows) {
    const a = r.parsed;
    const incl = Math.round(r.priceExcl * 1.1);
    const p = byNo.get(r.itemNo);

    if (!p) {
      if (!opts.createMissing || !a.specParsed) {
        skipped++;
        continue;
      }
      const [n] = await db.execute<{ id: number }>(sql`
        INSERT INTO product (mars_item_no, item_type, is_serialized, brand_code, pattern, raw_name,
                             display_name, name_auto, width, aspect_ratio, rim_inch, load_index, speed_rating,
                             season, is_runflat, is_acoustic, is_suv, ply_rating, oe_marks,
                             category, list_price, list_price_excl, spec_parsed, stock_tracked, is_active)
        VALUES (${r.itemNo}, 'tire', true, ${r.brandCode}, ${r.desc}, ${`Continental ${r.desc}`},
                ${a.name}, ${a.name}, ${a.width}, ${a.aspectRatio}, ${a.rimInch}, ${a.loadIndex}, ${a.speedRating},
                ${r.season}, ${a.isRunflat}, ${a.isAcoustic}, ${a.isSuv}, ${a.plyRating}, ${a.oeMarks},
                '10-TIRES', ${incl}, ${r.priceExcl}, true, false, true)
        ON CONFLICT (mars_item_no) DO NOTHING
        RETURNING id`);
      if (!n) {
        skipped++;
        continue;
      }
      created++;
      await db.execute(sql`
        INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, updated_at)
        VALUES ('콘티넨탈', ${r.code}, ${Number(n.id)}, ${r.desc}, '품번', now())
        ON CONFLICT (supplier, code) DO UPDATE SET product_id = EXCLUDED.product_id, updated_at = now()`);
      continue;
    }

    linked++;
    await db.execute(sql`
      INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, updated_at)
      VALUES ('콘티넨탈', ${r.code}, ${Number(p.id)}, ${r.desc}, '품번', now())
      ON CONFLICT (supplier, code) DO UPDATE SET product_id = EXCLUDED.product_id,
        supplier_name = EXCLUDED.supplier_name, updated_at = now()`);

    // 🔴 사장님이 손으로 고친 이름은 그대로 둔다
    const cur = (p.display_name ?? "").trim();
    const keepName = p.name_auto !== null && cur !== p.name_auto;
    const changed = p.list_price !== incl || p.list_price_excl !== r.priceExcl;
    await db.execute(sql`
      UPDATE product SET
        list_price_excl = CASE WHEN ${opts.updatePrices} THEN ${r.priceExcl} ELSE list_price_excl END,
        list_price      = CASE WHEN ${opts.updatePrices} THEN ${incl}        ELSE list_price END,
        display_name = ${keepName ? cur : a.name},
        name_auto = ${a.name},
        load_index = COALESCE(${a.loadIndex}, load_index),
        speed_rating = COALESCE(${a.speedRating}, speed_rating),
        width = COALESCE(width, ${a.width}),
        aspect_ratio = COALESCE(aspect_ratio, ${a.aspectRatio}),
        rim_inch = COALESCE(rim_inch, ${a.rimInch}),
        season = CASE WHEN attrs_override IS NULL THEN ${r.season} ELSE season END,
        is_runflat = CASE WHEN attrs_override IS NULL THEN ${a.isRunflat} ELSE is_runflat END,
        is_acoustic = CASE WHEN attrs_override IS NULL THEN ${a.isAcoustic} ELSE is_acoustic END,
        is_suv = CASE WHEN attrs_override IS NULL THEN ${a.isSuv} ELSE is_suv END,
        ply_rating = CASE WHEN attrs_override IS NULL THEN ${a.plyRating} ELSE ply_rating END,
        oe_marks = CASE WHEN attrs_override IS NULL THEN ${a.oeMarks} ELSE oe_marks END,
        spec_parsed = true,
        updated_at = now()
      WHERE id = ${Number(p.id)}`);
    if (opts.updatePrices && changed) priceUpdated++;
  }
  return { ok: true, linked, created, priceUpdated, skipped, materials };
}

/* ── 화면이 부르는 얼굴 ─────────────────────────────────────── */

export async function planContiSpec(rows: Record<string, unknown>[]): Promise<CatalogPlan> {
  const { rows: r, skipped } = readContiSpec(rows);
  return planConti(r, skipped);
}
export async function applyContiSpec(
  rows: Record<string, unknown>[],
  opts: { updatePrices: boolean; createMissing: boolean },
) {
  const { rows: r } = readContiSpec(rows);
  return applyConti(r, opts);
}
export async function planContiWinter(aoa: unknown[][]): Promise<CatalogPlan> {
  const { rows: r, skipped } = readContiWinter(aoa);
  return planConti(r, skipped);
}
export async function applyContiWinter(aoa: unknown[][], opts: { updatePrices: boolean; createMissing: boolean }) {
  const { rows: r } = readContiWinter(aoa);
  return applyConti(r, opts);
}
