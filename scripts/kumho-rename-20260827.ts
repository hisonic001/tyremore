/**
 * 금호 품목명 규칙 적용 (사장님 요청 2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/kumho-rename-20260827.ts          ← 미리보기
 *   npx tsx -r dotenv/config scripts/kumho-rename-20260827.ts --apply  ← 실제 적용
 *   … --force  ← 사장님이 손으로 고친 이름까지 덮어쓴다 (기본은 안 덮는다)
 *
 * 하는 일
 *   ① 이름   = 모델명 [+ 겹수(6겹 이상)] [+ (차종 주석)]  — `lib/kumho-name.ts` 규칙
 *   ② 세부사항 = 겹수(ply_rating) · 흡음재(is_acoustic) 를 **자재내역에서** 채운다
 *   ③ `name_auto` 에 규칙이 만든 이름을 함께 적어, 다음에 다시 돌릴 때
 *      사장님이 고친 것과 구분한다
 *
 * 🔴 모델명을 모르는 패턴(TBR·특수 코드)은 **이름을 바꾸지 않는다.** 목록으로 뽑아 드린다.
 * 🔴 재고·품목은 건드리지 않는다. 바꾸기 전 이름은 tyremore-data 에 백업한다.
 */
import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { readMaster, type MasterRow } from "@/lib/kumho-master";
import { buildKumhoName } from "@/lib/kumho-name";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const MASTER = "C:/Users/info/OneDrive/문서/통합자동화/금호 상품목록/금호타이어_기표가(26년7월).xlsx";
const BACKUP_DIR = "C:/dev/tyremore-data";

interface P {
  [k: string]: unknown;
  id: number;
  nm: string | null;
  auto: string | null;
  raw: string;
  pat: string | null;
  ply: number | null;
  ac: boolean;
  act: boolean;
  stock: number;
  codes: string | null;
  li: string | null;
  ss: string | null;
  sure: string | null;
  sureName: string | null;
}

/** 패턴코드를 알아낸다 — ①자재코드로 Master ②이름·원문에서 코드 모양 찾기 */
const PAT_RE = /\b([A-Z]{2,3}\d{2,3}|[A-Z]\d{3}|\d{3}[A-Z]?)\b/g;

async function main() {
  const wb = XLSX.readFile(MASTER);
  const { rows: cat } = readMaster(
    XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false }),
  );
  const byCode = new Map<string, MasterRow>(cat.map((r) => [r.code, r]));
  const knownPats = new Set(cat.map((r) => r.patternCode.toUpperCase()));
  console.log(`${APPLY ? "실제 반영" : "미리보기"}${FORCE ? " · 손질한 이름까지 덮어씀" : ""} · Master ${cat.length}줄`);

  const ps = await db.execute<P>(sql`
    SELECT p.id, p.display_name nm, p.name_auto auto, p.raw_name raw, p.pattern pat,
           p.ply_rating ply, p.is_acoustic ac, p.is_active act, p.load_index li, p.speed_rating ss,
           (SELECT string_agg(c.code, ',') FROM supplier_item_code c
             WHERE c.product_id=p.id AND c.supplier='금호' AND c.matched_by='사장님확인') sure,
           (SELECT c.supplier_name FROM supplier_item_code c
             WHERE c.product_id=p.id AND c.supplier='금호' AND c.matched_by='사장님확인'
             ORDER BY c.updated_at DESC LIMIT 1) "sureName",
           (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock,
           (SELECT string_agg(c.code, ',' ORDER BY c.code) FROM supplier_item_code c
             WHERE c.product_id=p.id AND c.supplier='금호') codes
    FROM product p WHERE p.brand_code='KM' AND p.item_type='tire' ORDER BY p.id`);
  console.log(`금호 타이어 ${ps.length}품목\n`);

  const changes: { id: number; from: string | null; to: string; stock: number }[] = [];
  const attrFix: { id: number; ply: number | null; ac: boolean }[] = [];
  const skippedEdited: P[] = [];
  const noModel = new Map<string, number>();
  let noPattern = 0;

  for (const p of ps) {
    /* 자재내역·패턴코드 찾기 — Master 에 있는 코드가 가장 확실하다 */
    /* 🔴 자재코드가 여럿일 때 아무거나 고르면 안 된다 (2026-08-27 미리보기에서 잡음).
       #1300 KC55 **12겹**(재고 50본)이 다른 코드를 물어 8겹이 될 뻔했다.
       ① 사장님이 직접 확인해 주신 코드 → ② 하중지수·속도기호가 맞는 코드 → ③ 그다음 */
    const codes = (p.codes ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    const sure = new Set((p.sure ?? "").split(",").map((c) => c.trim()).filter(Boolean));
    const cands = codes.map((c) => byCode.get(c)).filter((m): m is MasterRow => !!m);
    const fitsLi = (m: MasterRow) =>
      (p.li === null || m.loadIndex === null || m.loadIndex === String(p.li).split("/")[0]) &&
      (p.ss === null || m.speedRating === null || m.speedRating.toUpperCase() === String(p.ss).toUpperCase());
    const master =
      cands.find((m) => sure.has(m.code) && fitsLi(m)) ??
      cands.find((m) => sure.has(m.code)) ??
      cands.find(fitsLi) ??
      cands[0];
    /* 🔴 사장님이 확인해 주신 코드가 **Master 에 없는** 경우가 있다 (2420172 KC55 12겹 등 —
       금호 목록엔 없고 사장님이 값을 주신 것). 그때 자재내역은 사전(supplier_item_code.supplier_name)에
       적어 뒀으니 그것을 쓴다. 안 그러면 엉뚱한 코드를 물어 12겹이 8겹이 된다. */
    const sureName = String(p.sureName ?? "").trim();
    const sureIsMaterial = /^(KH|DS|MS|AS|AM|KB)\s/i.test(sureName);
    const materialName = sureIsMaterial
      ? sureName
      : (master?.name ?? (/^Kumho\s+(KH|DS|MS|AS|AM|KB)\s/i.test(p.raw) ? p.raw.replace(/^Kumho\s+/i, "") : ""));
    let patternCode = sureIsMaterial ? "" : (master?.patternCode ?? "");
    if (!patternCode && materialName) {
      // 자재내역에서 패턴코드를 직접 읽는다 — `KH 145 R13CR12L KC55 ;RC` → KC55
      for (const m of materialName.toUpperCase().matchAll(PAT_RE)) if (knownPats.has(m[1])) { patternCode = m[1]; break; }
    }
    if (!patternCode) {
      // Master 에 없으면 이름·원문에서 패턴코드 모양을 찾되, **금호가 실제로 쓰는 코드**만 인정한다
      const hay = `${p.nm ?? ""} ${p.pat ?? ""} ${p.raw}`.toUpperCase();
      for (const m of hay.matchAll(PAT_RE)) if (knownPats.has(m[1])) { patternCode = m[1]; break; }
    }
    if (!patternCode) { noPattern++; continue; }

    const r = buildKumhoName({ patternCode, materialName, currentName: p.nm });

    /* ② 세부사항 — 자재내역이 있을 때만 (없으면 판단 근거가 없다) */
    if (materialName) {
      const wantPly = r.load.ply;
      const wantAc = r.load.acoustic || p.ac; // 이미 흡음재로 표시된 것을 끄지는 않는다
      if ((wantPly !== null && wantPly !== p.ply) || wantAc !== p.ac) attrFix.push({ id: Number(p.id), ply: wantPly ?? p.ply, ac: wantAc });
    }

    if (!r.name) { noModel.set(patternCode, (noModel.get(patternCode) ?? 0) + 1); continue; }
    if (r.name === p.nm) continue;
    /* ③ 사장님이 손으로 고친 이름은 안 덮는다 — name_auto 와 다르면 손댄 것 */
    if (!FORCE && p.auto !== null && p.nm !== p.auto) { skippedEdited.push(p); continue; }
    changes.push({ id: Number(p.id), from: p.nm, to: r.name, stock: p.stock });
  }

  console.log(`이름 바뀜 ${changes.length} · 세부사항 채움 ${attrFix.length} · 모델명 몰라 그대로 ${[...noModel.values()].reduce((a, b) => a + b, 0)} · 패턴코드 못 찾음 ${noPattern} · 손질한 이름이라 건너뜀 ${skippedEdited.length}\n`);

  console.log("── 바뀌는 이름 (재고 많은 순) ──");
  for (const c of [...changes].sort((a, b) => b.stock - a.stock))
    console.log(`  #${c.id} ${c.stock > 0 ? `재고${c.stock}본 ` : ""}"${c.from}" → "${c.to}"`);

  console.log("\n── 모델명을 몰라 이름을 그대로 둔 패턴 (사장님이 알려주시면 채웁니다) ──");
  for (const [k, v] of [...noModel.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}품목`);

  if (!APPLY) { console.log("\n(미리보기입니다 — --apply 로 반영)"); process.exit(0); }

  /* 백업 */
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = process.env.STAMP ?? "20260827";
  const file = `${BACKUP_DIR}/금호-이름-백업-${stamp}.json`;
  writeFileSync(file, JSON.stringify(ps.map((p) => ({ id: Number(p.id), displayName: p.nm, nameAuto: p.auto, plyRating: p.ply, isAcoustic: p.ac })), null, 1), "utf8");
  console.log(`\n백업 ${file}`);

  for (const c of changes) {
    await db.execute(sql`UPDATE product SET display_name = ${c.to}, name_auto = ${c.to}, updated_at = now() WHERE id = ${c.id}`);
  }
  /* 이름이 그대로인 것도 name_auto 는 채워 둔다 — 다음 실행이 「손댄 것」과 구분할 수 있게 */
  for (const p of ps) {
    if (p.auto !== null) continue;
    const done = changes.find((c) => c.id === Number(p.id));
    if (!done && p.nm) await db.execute(sql`UPDATE product SET name_auto = ${p.nm} WHERE id = ${p.id} AND name_auto IS NULL`);
  }
  for (const a of attrFix) {
    await db.execute(sql`UPDATE product SET ply_rating = ${a.ply}, is_acoustic = ${a.ac}, updated_at = now() WHERE id = ${a.id}`);
  }
  console.log(`✔ 이름 ${changes.length}건 · 세부사항 ${attrFix.length}건 반영`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
