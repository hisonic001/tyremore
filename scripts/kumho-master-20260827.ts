/**
 * 금호 기표가 Master 반영 (사장님 결정 2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/kumho-master-20260827.ts [--apply]
 *
 * 사장님이 정한 것:
 *   ① 트럭·버스·특수(TBR·TBR(S)·SPECIALTY·Racing) — 만들되 **전부 숨김**
 *   ② 유형 ④(미운영·중단 59) · 시점 「비정상」(85) · 기표가 0원(33)만 빼고 만든다
 *      🔴 처음엔 「시점=정상·운영」만 살아 있다고 봤는데 틀렸다 — 운영 여부는 「유형」 칸이다
 *   ③ DB 안 중복은 기존 「중복 상품 합치기」 도구로 (여기서는 목록만 뽑는다)
 *   ④ 기표가는 전부 목록 값으로 — **부가세 미포함가는 list_price_excl, 화면가는 ×1.1**
 *   ⑤ 목록에 없고 재고 0·판 적 없는 품목은 검색에서 숨김
 *   ⑥ 새 자재코드는 사전에 등록하고, 옛 코드는 지우지 않고 남긴다
 *
 * 🔴 재고(stock_item)는 한 줄도 건드리지 않는다. 품목을 지우지도 않는다.
 */
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { formatSpec } from "@/lib/tire-spec";
import { KUMHO_SEASON } from "@/lib/invoice-desc";
import { SUPPLIER, isDead, isMakeable, isPassenger, planRows, type PlanLine } from "@/lib/kumho-sheet";
import { readMaster, type MasterRow } from "@/lib/kumho-master";

const FILE = "C:/Users/info/OneDrive/문서/통합자동화/금호 상품목록/금호타이어_기표가(26년7월).xlsx";
const OUT = "C:/Users/info/.claude/jobs/efcb0a01/tmp/kumho-master-report.json";
const APPLY = process.argv.includes("--apply");

const won = (n: number | null) => (n === null ? "-" : n.toLocaleString());

async function main() {
  const wb = XLSX.readFile(FILE);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false });
  const { rows: cat, skipped } = readMaster(aoa);
  const byCode = new Map(cat.map((r) => [r.code, r]));
  console.log(`Master ${cat.length}줄 (건너뜀 ${skipped}) · ${APPLY ? "실제 반영" : "미리보기"}`);

  const plan = await planRows(cat as unknown as MasterRow[], skipped);
  console.log("대조:", JSON.stringify(plan.counts));

  const M = (l: PlanLine) => byCode.get(l.row.code)!;
  let linked = 0, created = 0, priced = 0, hidden = 0, skippedN = 0;
  const createdIds: number[] = [];
  const priceChanges: { id: number; name: string; from: number | null; to: number }[] = [];
  const notMade: MasterRow[] = [];

  const { parseTireAttrs } = await import("@/lib/tire-attrs");
  const { parseTireName, cleanTireName } = await import("@/lib/tire-name");

  for (const line of plan.lines) {
    const r = M(line);

    if (line.kind === "신규") {
      // ② 유형 ④·비정상·가격 0원은 안 만든다
      if (!isMakeable(r)) { notMade.push(r); skippedN++; continue; }
      // ① 트럭·특수는 숨겨서 만든다
      const active = isPassenger(r.group);
      const attrs = parseTireAttrs(r.model, r.name);
      const season = attrs.season ?? KUMHO_SEASON[r.patternCode] ?? null;
      const label = [
        r.width !== null && r.rimInch !== null ? formatSpec({ width: r.width, aspectRatio: r.aspectRatio, rimInch: Number(r.rimInch) }) : "",
        r.model,
        `${r.loadIndex ?? ""}${r.speedRating ?? ""}`,
      ].filter(Boolean).join(" ").trim();
      const displayName = cleanTireName(
        parseTireName(`Kumho ${r.name}`, r.model, { width: r.width, aspectRatio: r.aspectRatio, rimInch: r.rimInch, brandCode: "KM" }),
      ) || r.model || null;
      if (!APPLY) { created++; continue; }
      const [ins] = await db.execute<{ id: number }>(sql`
        INSERT INTO product (
          mars_item_no, item_type, is_serialized, brand_code, pattern, display_name, raw_name,
          width, aspect_ratio, rim_inch, load_index, speed_rating, season,
          is_runflat, is_acoustic, is_suv, list_price, list_price_excl,
          category, spec_parsed, is_active, hidden_reason, created_at, updated_at
        ) VALUES (
          ${"KM" + r.code}, 'tire', true, 'KM', ${label || r.name}, ${displayName}, ${`Kumho ${r.name}`},
          ${r.width}, ${r.aspectRatio}, ${r.rimInch}, ${r.loadIndex}, ${r.speedRating}, ${season},
          ${attrs.isRunflat}, ${attrs.isAcoustic}, ${attrs.isSuv},
          ${r.priceExcl === null ? null : Math.round(r.priceExcl * 1.1)}, ${r.priceExcl},
          '10-TIRES', ${r.width !== null}, ${active}, ${active ? null : "트럭·특수 — 사장님 요청으로 숨김(2026-08-27)"}, now(), now()
        )
        ON CONFLICT (mars_item_no) DO NOTHING
        RETURNING id`);
      if (!ins) { skippedN++; continue; }
      created++; createdIds.push(Number(ins.id));
      await db.execute(sql`
        INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, created_at, updated_at)
        VALUES (${SUPPLIER}, ${r.code}, ${Number(ins.id)}, ${r.name}, '신규', now(), now())
        ON CONFLICT (supplier, code) DO NOTHING`);
      linked++;
      continue;
    }

    if (line.productId === null) { skippedN++; continue; }

    // ⑥ 사전에 새 자재코드를 적어 둔다 (옛 코드 줄은 지우지 않는다)
    if (line.kind !== "이미연결") {
      linked++;
      if (APPLY) await db.execute(sql`
        INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, created_at, updated_at)
        VALUES (${SUPPLIER}, ${r.code}, ${line.productId}, ${r.name}, ${line.kind}, now(), now())
        ON CONFLICT (supplier, code) DO UPDATE
          SET product_id = EXCLUDED.product_id, supplier_name = EXCLUDED.supplier_name, updated_at = now()`);
    }

    // ④ 기표가 — 부가세 미포함 원본을 excl 에, 화면가는 ×1.1
    if (r.priceExcl !== null) {
      const [cur] = await db.execute<{ excl: number | null; price: number | null; nm: string | null }>(sql`
        SELECT list_price_excl excl, list_price price, COALESCE(display_name, pattern) nm FROM product WHERE id = ${line.productId}`);
      const needs = cur && (Number(cur.excl ?? -1) !== r.priceExcl || Number(cur.price ?? -1) !== Math.round(r.priceExcl * 1.1));
      if (needs) {
        priced++;
        priceChanges.push({ id: line.productId, name: `${cur.nm ?? ""} ${r.name}`.trim(), from: cur.excl === null ? null : Number(cur.excl), to: r.priceExcl });
        if (APPLY) await db.execute(sql`
          UPDATE product SET list_price_excl = ${r.priceExcl}, list_price = ${Math.round(r.priceExcl * 1.1)}, updated_at = now()
          WHERE id = ${line.productId}`);
      }
    }
  }

  /* ⑤ 목록에 없는 금호 품목 — 재고 0 · 판 적 없음만 숨긴다 */
  const linkedIds = new Set(plan.lines.filter((l) => l.productId).map((l) => Number(l.productId)));
  for (const id of createdIds) linkedIds.add(id);
  const codeIds = await db.execute<{ product_id: number }>(sql`SELECT product_id FROM supplier_item_code WHERE supplier = ${SUPPLIER} AND code IN ${sql.raw("(" + cat.map((c) => `'${c.code}'`).join(",") + ")")}`);
  for (const c of codeIds) linkedIds.add(Number(c.product_id));

  const all = await db.execute<{ id: number; nm: string | null; raw: string; w: number | null; ar: number | null; rim: string | null; li: string | null; ss: string | null; excl: number | null; act: boolean; stock: number; sold: number }>(sql`
    SELECT p.id, COALESCE(p.display_name, p.pattern) nm, p.raw_name raw, p.width w, p.aspect_ratio ar, p.rim_inch::text rim,
           p.load_index li, p.speed_rating ss, p.list_price_excl excl, p.is_active act,
           (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock,
           (SELECT count(*)::int FROM quote_item qi WHERE qi.product_id=p.id) sold
    FROM product p WHERE p.brand_code='KM' AND p.item_type='tire'`);
  const orphans = all.filter((p) => !linkedIds.has(Number(p.id)));
  const toHide = orphans.filter((p) => p.stock === 0 && p.sold === 0 && p.act);
  const keepStock = orphans.filter((p) => p.stock > 0);
  const keepSold = orphans.filter((p) => p.stock === 0 && p.sold > 0);
  hidden = toHide.length;
  if (APPLY && toHide.length) {
    for (let i = 0; i < toHide.length; i += 200) {
      const ids = toHide.slice(i, i + 200).map((p) => Number(p.id));
      await db.execute(sql`UPDATE product SET is_active = false, hidden_reason = '금호 26.07 목록에 없음', updated_at = now()
                           WHERE id IN ${sql.raw("(" + ids.join(",") + ")")}`);
    }
  }

  /* ③ DB 안 중복 — 목록만 (합치기는 화면에서) */
  const dupRows = await db.execute<{ k: string; ids: string; stocks: string }>(sql`
    SELECT p.width || '/' || p.aspect_ratio || 'R' || p.rim_inch || ' ' || COALESCE(p.load_index,'') || COALESCE(p.speed_rating,'') || ' ' || COALESCE(p.display_name,'') k,
           string_agg(p.id::text, ',' ORDER BY p.id) ids, count(*)::text stocks
    FROM product p WHERE p.brand_code='KM' AND p.item_type='tire' AND p.is_active AND p.width IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1`);

  console.log(`\n잇기 ${linked} · 새로 만듦 ${created} · 기표가 고침 ${priced} · 숨김 ${hidden} · 건너뜀 ${skippedN}`);
  const why = (r: MasterRow) => (isDead(r) ? "미운영·중단" : r.status === "비정상" ? "비정상" : "기표가 없음");
  console.log(`안 만든 것 ${notMade.length}:`, JSON.stringify(notMade.reduce((a: Record<string, number>, r) => { a[why(r)] = (a[why(r)] ?? 0) + 1; return a; }, {})));
  const deadLinked = plan.lines.filter((l) => l.productId && isDead(M(l)));
  console.log(`목록엔 있으나 미운영·중단이라 표시된 우리 품목: ${deadLinked.length}건 (재고 확인 후 따로 정하실 것)`);
  console.log(`목록에 없는 금호 품목 ${orphans.length} — 숨김 대상 ${toHide.length} · 재고 있어 유지 ${keepStock.length}(${keepStock.reduce((a, p) => a + p.stock, 0)}본) · 판 적 있어 유지 ${keepSold.length}`);
  console.log(`이름까지 같은 중복 묶음 ${dupRows.length}`);

  console.log(`\n▼ 목록에 없는데 재고가 있는 ${keepStock.length}품목 — 사장님이 개별로 정하실 것`);
  for (const p of keepStock.sort((a, b) => b.stock - a.stock))
    console.log(`  #${p.id} ${p.w}/${p.ar}R${p.rim} ${p.li ?? ""}${p.ss ?? ""} ${(p.nm ?? p.raw).slice(0, 36)} · 재고 ${p.stock}본 · ${won(p.excl === null ? null : Number(p.excl))}원`);

  writeFileSync(OUT, JSON.stringify({
    applied: APPLY, counts: plan.counts, linked, created, priced, hidden, skippedN,
    notMade: notMade.map((r) => ({ code: r.code, name: r.name, group: r.group, type: r.type, status: r.status, price: r.priceExcl, why: why(r) })),
    deadLinked: deadLinked.map((l) => ({ code: l.row.code, productId: l.productId, name: l.productName, status: M(l).status })),
    priceChanges, createdIds,
    keepStock: keepStock.map((p) => ({ id: Number(p.id), name: p.nm ?? p.raw, spec: `${p.w}/${p.ar}R${p.rim}`, li: `${p.li ?? ""}${p.ss ?? ""}`, stock: p.stock, excl: p.excl })),
    keepSold: keepSold.map((p) => ({ id: Number(p.id), name: p.nm ?? p.raw, sold: p.sold })),
    hiddenIds: toHide.map((p) => Number(p.id)),
    dups: dupRows.map((d) => ({ k: d.k, ids: d.ids })),
  }, null, 1), "utf8");
  console.log(`\n보고 ${OUT}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
