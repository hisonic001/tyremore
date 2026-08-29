/**
 * 콘티넨탈 품목 재정리 — 2026 목록을 기준으로 ⭐ (사장님 요청 2026-08-29)
 *
 *   npx tsx --env-file=.env.local scripts/conti-apply-20260829.ts [--apply] [--merge 흡수품번=대표품번,...]
 *
 * 사장님 지시: **「Material 번호를 기준으로 삼아 중복이 없도록」**
 *
 * 하는 일 (순서대로)
 *   ① 자재 마스터 저장            736줄 (여름·사계절 560 + 겨울 176, 겹침 0)
 *   ② 거래처 사전 등록            supplier_item_code('콘티넨탈', 자재번호) → 상품
 *   ③ 잇기·갱신                  기표가 · 이름 · 속성
 *   ④ 새로 만들기                2026 목록에 있는데 우리에게 없는 것
 *   ⑤ 되살리기                   전에 접어 뒀는데 2026 목록에 다시 들어온 것
 *   ⑥ 접기                       2026 목록에 없는 것
 *   ⑦ 사장님께 보여드릴 것         목록에 없는데 **재고·판매가 있는** 것 — 자동으로 안 건드린다
 *
 * 🔴 미리보기가 기본이다. `--apply` 없이는 아무것도 저장하지 않는다.
 * 🔴 **재고는 성역이다.** 재고가 있거나 재고 관리 중이거나 판 적 있는 상품은
 *    자동으로 접지도 합치지도 않는다 — ⑦ 로 뽑아 사장님이 고르신 뒤 `--merge` 로만.
 * 🔴 이름·가격은 바꾸기 **전** 값을 파일로 남긴다 (C:/dev/tyremore-data).
 * 🔴 `name_auto` 3단 논리 — 사장님이 손으로 고친 이름(display_name ≠ name_auto)은 건드리지 않는다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { readContiAll, type ContiRow } from "@/lib/conti-sheet";

const APPLY = process.argv.includes("--apply");
const MERGE = (() => {
  const i = process.argv.indexOf("--merge");
  if (i < 0 || !process.argv[i + 1]) return [] as { absorb: string; keep: string }[];
  return process.argv[i + 1]
    .split(",")
    .map((p) => p.split("="))
    .filter((p) => p.length === 2)
    .map(([absorb, keep]) => ({ absorb: absorb.trim(), keep: keep.trim() }));
})();
const BACKUP_DIR = "C:/dev/tyremore-data";
/** 접기 사유 — 🔴 제네럴은 **별개 브랜드**다. 사유 문구도 브랜드를 따라간다 (사장님 지적 2026-08-29) */
const HIDDEN_CO = "콘티넨탈 2026 목록에 없음";
const HIDDEN_GN = "제네럴 2026 목록에 없음";
const hiddenReason = (brand: string) => (brand === "GN" ? HIDDEN_GN : HIDDEN_CO);
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

type P = {
  id: number;
  mars_item_no: string;
  brand_code: string;
  display_name: string | null;
  name_auto: string | null;
  pattern: string | null;
  season: string | null;
  width: number | null;
  aspect_ratio: number | null;
  rim_inch: string | null;
  load_index: string | null;
  speed_rating: string | null;
  list_price: number | null;
  list_price_excl: number | null;
  is_runflat: boolean;
  is_acoustic: boolean;
  is_suv: boolean;
  ply_rating: number | null;
  oe_marks: string | null;
  is_active: boolean;
  hidden_reason: string | null;
  stock_tracked: boolean;
  attrs_override: unknown;
  qty: number;
  sold: number;
};

const won = (n: number | null) => (n === null ? "-" : n.toLocaleString("ko-KR"));

async function main() {
  const rows: ContiRow[] = readContiAll();
  const byItemNo = new Map(rows.map((r) => [r.itemNo, r]));
  console.log(`2026 목록 ${rows.length}줄 (겨울 ${rows.filter((r) => r.season === "겨울").length})\n`);

  const db0 = await db.execute<P>(sql`
    SELECT p.id, p.mars_item_no, p.brand_code, p.display_name, p.name_auto, p.pattern, p.season,
           p.width, p.aspect_ratio, p.rim_inch::text rim_inch, p.load_index, p.speed_rating,
           p.list_price, p.list_price_excl, p.is_runflat, p.is_acoustic, p.is_suv, p.ply_rating,
           p.oe_marks, p.is_active, p.hidden_reason, p.stock_tracked, p.attrs_override,
           (SELECT COALESCE(SUM(s.qty), 0) FROM stock_item s WHERE s.product_id = p.id AND s.status = '재고')::int qty,
           (SELECT count(*) FROM quote_item qi WHERE qi.product_id = p.id)::int sold
    FROM product p WHERE p.brand_code IN ('CO', 'GN')`);
  const byNo = new Map(db0.map((p) => [p.mars_item_no, p]));
  console.log(`DB 콘티넨탈 ${db0.length}품목 (활성 ${db0.filter((p) => p.is_active).length})`);

  /* ── 무엇을 할지 셈한다 ────────────────────────────────────── */
  const link: { p: P; r: ContiRow }[] = [];
  const create: ContiRow[] = [];
  for (const r of rows) {
    const p = byNo.get(r.itemNo);
    if (p) link.push({ p, r });
    else create.push(r);
  }
  /** 재고·판매 흔적 — 자동으로 건드리지 않는다 */
  const touched = (p: P) => p.qty > 0 || p.stock_tracked || p.sold > 0;
  const gone = db0.filter((p) => p.is_active && !byItemNo.has(p.mars_item_no));
  const show = gone.filter(touched);
  const hide = gone.filter((p) => !touched(p));
  const revive = db0.filter(
    (p) => !p.is_active && (p.hidden_reason === HIDDEN_CO || p.hidden_reason === HIDDEN_GN) && byItemNo.has(p.mars_item_no),
  );

  /* ── 무엇이 바뀌는지 (미리보기에서도 정확히 센다) ─────────────── */
  const priceChg: { p: P; r: ContiRow }[] = [];
  const nameChg: { p: P; r: ContiRow }[] = [];
  const nameKept: P[] = [];
  const attrChg: { p: P; r: ContiRow }[] = [];
  for (const { p, r } of link) {
    const incl = Math.round(r.priceExcl * 1.1);
    if (p.list_price_excl !== r.priceExcl || p.list_price !== incl) priceChg.push({ p, r });
    const cur = (p.display_name ?? "").trim();
    // 🔴 name_auto 3단 — 사장님이 손으로 고친 이름은 건드리지 않는다
    if (p.name_auto !== null && cur !== p.name_auto) nameKept.push(p);
    else if (cur !== r.parsed.name) nameChg.push({ p, r });
    const a = r.parsed;
    if (
      !p.attrs_override &&
      (p.is_runflat !== a.isRunflat ||
        p.is_acoustic !== a.isAcoustic ||
        p.is_suv !== a.isSuv ||
        (p.ply_rating ?? null) !== (a.plyRating ?? null) ||
        (p.oe_marks ?? null) !== (a.oeMarks ?? null) ||
        (p.season ?? null) !== r.season)
    ) {
      attrChg.push({ p, r });
    }
  }

  console.log("\n╔══ 할 일");
  console.log(`║ ③ 잇기·갱신          ${link.length}`);
  console.log(`║    · 기표가 바뀜      ${priceChg.length}`);
  console.log(`║    · 이름 바뀜        ${nameChg.length}  (사장님 손질이라 그대로 두는 것 ${nameKept.length})`);
  console.log(`║    · 속성 바뀜        ${attrChg.length}`);
  console.log(`║ ④ 새로 만들기        ${create.length}`);
  console.log(`║ ⑤ 되살리기           ${revive.length}`);
  console.log(`║ ⑥ 접기               ${hide.length}`);
  console.log(`║ ⑦ 보여드릴 것         ${show.length}  ← 목록에 없는데 재고·판매가 있다`);
  console.log("╚══");

  if (show.length > 0) {
    console.log("\n■ 사장님 확인이 필요한 것 — 2026 목록에 없는데 재고·판매가 있습니다");
    for (const p of show) {
      console.log(`\n  ${p.mars_item_no} [${p.season ?? "?"}] ${p.width}/${p.aspect_ratio}R${p.rim_inch} ${p.load_index ?? ""}${p.speed_rating ?? ""}`);
      console.log(`    지금 이름 「${p.display_name || p.pattern}」 · 재고 ${p.qty}본 · 판매 ${p.sold}회 · 기표 ${won(p.list_price_excl)}`);
      const cands = rows
        .filter((r) => r.parsed.width === p.width && r.parsed.aspectRatio === p.aspect_ratio && Math.round(r.parsed.rimInch ?? 0) === Math.round(Number(p.rim_inch)))
        .map((r) => {
          let s = 0;
          if (r.parsed.loadIndex === p.load_index) s += 2;
          if (r.parsed.speedRating === p.speed_rating) s += 2;
          const a = (p.display_name || p.pattern || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          const b = r.parsed.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (a && b.includes(a.slice(0, 12))) s += 5;
          else if (a && b.slice(0, 10) && a.includes(b.slice(0, 10))) s += 3;
          if (r.priceExcl === p.list_price_excl) s += 3;
          return { r, s };
        })
        .sort((x, y) => y.s - x.s)
        .slice(0, 3);
      if (cands.length === 0) console.log("    ↳ 같은 규격이 2026 목록에 없습니다");
      for (const [i, c] of cands.entries()) {
        console.log(`    ${i === 0 ? "▶" : " "} [점수 ${c.s}] ${c.r.itemNo} (${c.r.sourceLabel}) ${c.r.desc} · ${won(c.r.priceExcl)}`);
      }
      console.log(`    → 합치려면:  --merge ${p.mars_item_no}=${cands[0]?.r.itemNo ?? "<대표품번>"}`);
    }
  }

  if (!APPLY) {
    console.log("\n(미리보기입니다 — 반영하려면 --apply)");
    process.exit(0);
  }

  /* ── 백업 ─────────────────────────────────────────────────── */
  mkdirSync(BACKUP_DIR, { recursive: true });
  const backup = {
    stamp,
    prices: priceChg.map(({ p, r }) => ({ id: p.id, no: p.mars_item_no, wasExcl: p.list_price_excl, wasIncl: p.list_price, nowExcl: r.priceExcl })),
    names: nameChg.map(({ p, r }) => ({ id: p.id, no: p.mars_item_no, was: p.display_name, wasAuto: p.name_auto, now: r.parsed.name })),
    hidden: hide.map((p) => ({ id: p.id, no: p.mars_item_no, name: p.display_name })),
  };
  const file = `${BACKUP_DIR}/콘티넨탈-백업-${stamp}.json`;
  writeFileSync(file, JSON.stringify(backup, null, 1), "utf8");
  console.log(`\n백업: ${file}`);

  /* ── ② 거래처 사전 + ③ 잇기·갱신 ──────────────────────────── */
  let dict = 0;
  for (const { p, r } of link) {
    const ins = await db.execute<{ id: number }>(sql`
      INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, updated_at)
      VALUES ('콘티넨탈', ${r.code}, ${p.id}, ${r.desc}, '품번', now())
      ON CONFLICT (supplier, code) DO UPDATE SET product_id = EXCLUDED.product_id,
        supplier_name = EXCLUDED.supplier_name, updated_at = now()
      RETURNING id`);
    dict += ins.length;

    const a = r.parsed;
    const incl = Math.round(r.priceExcl * 1.1);
    const cur = (p.display_name ?? "").trim();
    const keepName = p.name_auto !== null && cur !== p.name_auto;
    const newName = keepName ? cur : a.name;
    const keepAttrs = !!p.attrs_override;
    await db.execute(sql`
      UPDATE product SET
        list_price_excl = ${r.priceExcl},
        list_price = ${incl},
        display_name = ${newName},
        name_auto = ${a.name},
        load_index = COALESCE(${a.loadIndex}, load_index),
        speed_rating = COALESCE(${a.speedRating}, speed_rating),
        width = COALESCE(width, ${a.width}),
        aspect_ratio = COALESCE(aspect_ratio, ${a.aspectRatio}),
        rim_inch = COALESCE(rim_inch, ${a.rimInch}),
        season      = CASE WHEN ${keepAttrs} THEN season      ELSE ${r.season} END,
        is_runflat  = CASE WHEN ${keepAttrs} THEN is_runflat  ELSE ${a.isRunflat} END,
        is_acoustic = CASE WHEN ${keepAttrs} THEN is_acoustic ELSE ${a.isAcoustic} END,
        is_suv      = CASE WHEN ${keepAttrs} THEN is_suv      ELSE ${a.isSuv} END,
        ply_rating  = CASE WHEN ${keepAttrs} THEN ply_rating  ELSE ${a.plyRating} END,
        oe_marks    = CASE WHEN ${keepAttrs} THEN oe_marks    ELSE ${a.oeMarks} END,
        spec_parsed = true,
        updated_at = now()
      WHERE id = ${p.id}`);
  }
  console.log(`③ 잇기·갱신 ${link.length} (사전 ${dict}줄)`);

  /* ── ④ 새로 만들기 ────────────────────────────────────────── */
  let made = 0;
  for (const r of create) {
    const a = r.parsed;
    const incl = Math.round(r.priceExcl * 1.1);
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
    if (!n) continue;
    made++;
    await db.execute(sql`
      INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, updated_at)
      VALUES ('콘티넨탈', ${r.code}, ${n.id}, ${r.desc}, '품번', now())
      ON CONFLICT (supplier, code) DO UPDATE SET product_id = EXCLUDED.product_id, updated_at = now()`);
  }
  console.log(`④ 새로 만듦 ${made}`);

  /* ── ⑤ 되살리기 ───────────────────────────────────────────── */
  if (revive.length > 0) {
    await db.execute(sql`
      UPDATE product SET is_active = true, hidden_reason = NULL, updated_at = now()
      WHERE id IN (${sql.join(revive.map((p) => sql`${p.id}`), sql`, `)})`);
  }
  console.log(`⑤ 되살림 ${revive.length}`);

  /* ── ⑥ 접기 ───────────────────────────────────────────────── */
  for (const brand of ["CO", "GN"]) {
    const ids = hide.filter((p) => p.brand_code === brand).map((p) => p.id);
    if (ids.length === 0) continue;
    await db.execute(sql`
      UPDATE product SET is_active = false, hidden_reason = ${hiddenReason(brand)}, updated_at = now()
      WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  }
  // 🔴 전에 콘티넨탈 문구로 접어 둔 제네럴 품목의 사유를 바로잡는다 (사장님 지적 2026-08-29)
  const fixed = await db.execute<{ id: number }>(sql`
    UPDATE product SET hidden_reason = ${HIDDEN_GN}
    WHERE brand_code = 'GN' AND NOT is_active AND hidden_reason = ${HIDDEN_CO} RETURNING id`);
  console.log(`⑥ 접음 ${hide.length}${fixed.length > 0 ? ` (제네럴 사유 문구 바로잡음 ${fixed.length})` : ""}`);

  /* ── ⑦ 사장님이 고르신 합치기 ─────────────────────────────── */
  if (MERGE.length > 0) {
    const { mergeProducts } = await import("@/lib/product-merge");
    for (const m of MERGE) {
      const a = byNo.get(m.absorb);
      const [k] = await db.execute<{ id: number }>(sql`SELECT id FROM product WHERE mars_item_no = ${m.keep}`);
      if (!a || !k) {
        console.log(`   ⚠ 합치기 건너뜀 — 품번을 못 찾음 (${m.absorb} → ${m.keep})`);
        continue;
      }
      /* 🔴 db.execute 는 bigint 를 **문자열**로 돌려준다 — 그대로 넘기면
            mergeProducts 안의 `p.id === keepId` 가 숫자 vs 글자라 안 맞아
            「대표 상품을 찾을 수 없습니다」로 조용히 거부된다 (2026-08-29 실측) */
      const res = await mergeProducts(Number(k.id), [Number(a.id)]);
      console.log(`   ${res.ok ? "✅" : "⚠"} 합치기 ${m.absorb} → ${m.keep}${res.ok ? "" : ` — ${res.error}`}`);
    }
  }

  /* ── 불변량 확인 ──────────────────────────────────────────── */
  const [inv] = await db.execute<{ stock: number; items: number; vat: number; hiddenstock: number; noname: number }>(sql`
    SELECT (SELECT COALESCE(SUM(s.qty), 0) FROM stock_item s JOIN product p ON p.id = s.product_id
              WHERE p.brand_code IN ('CO','GN') AND s.status = '재고')::int stock,
           (SELECT count(*) FROM product WHERE brand_code IN ('CO','GN'))::int items,
           (SELECT count(*) FROM product WHERE brand_code IN ('CO','GN')
              AND list_price_excl IS NOT NULL AND list_price IS DISTINCT FROM round(list_price_excl * 1.1))::int vat,
           (SELECT count(*) FROM product p WHERE p.brand_code IN ('CO','GN') AND NOT p.is_active
              AND EXISTS (SELECT 1 FROM stock_item s WHERE s.product_id = p.id AND s.status = '재고' AND s.qty > 0))::int hiddenstock,
           (SELECT count(*) FROM product WHERE brand_code IN ('CO','GN') AND is_active
              AND (display_name IS NULL OR display_name = ''))::int noname`);
  console.log(`\n■ 불변량 — 재고 ${inv.stock}본 · 품목 ${inv.items}개 · 부가세 어긋남 ${inv.vat} · 재고 있는데 접힌 것 ${inv.hiddenstock} · 이름 빈 것 ${inv.noname}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
