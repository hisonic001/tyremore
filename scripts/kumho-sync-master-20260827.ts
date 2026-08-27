/**
 * 금호 — 기표가 Master 를 따라간다 (사장님 지시 2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/kumho-sync-master-20260827.ts [--apply]
 *
 *   "이어놓은건 이제 큰 의미가 없음. 중요한건 자재코드가 맞는지 안맞는지이며
 *    가장 정확한 기표가(26년7월).xlsx 을 따라가야함."
 *
 * 그래서 **자재 마스터가 정답**이다. 상품의 규격·하중지수·속도기호·겹수·흡음재·기표가를
 * 그 상품이 물고 있는 자재코드의 Master 줄에 맞춘다. 어긋나는 연결은 떼어 낸다.
 *
 * 🔴 어느 코드를 믿을 것인가 (한 상품에 코드가 여럿일 수 있다)
 *   ① 사장님이 직접 확인해 주신 코드 — 그 코드가 Master 에 없어도 **사장님 말이 정답**이다.
 *      이때 다른 코드가 Master 에서 다른 물건을 가리키면 그 연결이 틀린 것이다 (떼어 낸다).
 *   ② 유형 ④(미운영·중단)가 아니고 시점이 정상·운영인 코드 — 지금 파는 것
 *   ③ 유형 ④ 가 아닌 코드   ④ 그 외
 *
 * 🔴 재고는 건드리지 않는다. 상품도 지우지 않는다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { parseTireSpec } from "@/lib/tire-spec";
import { normalizeKumhoName } from "@/lib/kumho-master";
import { decodeKumhoLoad } from "@/lib/kumho-name";
import { PICK_MATERIAL_ORDER } from "@/lib/kumho-product";

const APPLY = process.argv.includes("--apply");

interface Link {
  [k: string]: unknown;
  code: string; how: string | null;
  mname: string | null; mli: string | null; mss: string | null; mprice: number | null;
  mtype: string | null; mstatus: string | null; mpat: string | null;
}
interface Prod {
  [k: string]: unknown;
  id: number; nm: string | null; w: number | null; ar: number | null; rim: string | null;
  li: string | null; ss: string | null; excl: number | null; price: number | null;
  ply: number | null; ac: boolean; stock: number;
}



async function main() {
  console.log(APPLY ? "실제 반영" : "미리보기");
  const prods = await db.execute<Prod>(sql`
    SELECT p.id, COALESCE(p.display_name, p.pattern) nm, p.width w, p.aspect_ratio ar, p.rim_inch::text rim,
           p.load_index li, p.speed_rating ss, p.list_price_excl excl, p.list_price price,
           p.ply_rating ply, p.is_acoustic ac,
           (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock
    FROM product p WHERE p.brand_code='KM' AND p.item_type='tire'
      AND EXISTS (SELECT 1 FROM supplier_item_code c WHERE c.product_id=p.id AND c.supplier='금호')
    ORDER BY p.id`);
  console.log(`자재코드가 붙은 금호 상품 ${prods.length}개\n`);

  const fixes: string[] = [];
  const drops: { code: string; pid: number; why: string }[] = [];
  let specFix = 0, liFix = 0, priceFix = 0, plyFix = 0, acFix = 0, noMaster = 0;

  for (const p of prods) {
    const links = await db.execute<Link>(sql`
      SELECT c.code, c.matched_by how, m.name mname, m.load_index mli, m.speed_rating mss,
             m.price_excl mprice, m.op_type mtype, m.op_status mstatus, m.pattern_code mpat
      FROM supplier_item_code c LEFT JOIN kumho_material m ON m.code = c.code
      WHERE c.supplier='금호' AND c.product_id = ${p.id}
      ORDER BY ${PICK_MATERIAL_ORDER}`);
    const sure = links.find((l) => l.how === "사장님확인");
    const inMaster = links.filter((l) => l.mname);

    /* ① 사장님이 확인한 코드가 Master 에 없다 — 사장님 말이 정답이니 다른 코드로 덮지 않는다 */
    if (sure && !sure.mname) {
      for (const l of inMaster) {
        const s = parseTireSpec(normalizeKumhoName(l.mname!));
        const liOk = !l.mli || !p.li || l.mli === String(p.li).split("/")[0];
        const specOk = (s.width === null || p.w === null || Number(s.width) === Number(p.w)) &&
                       (s.rimInch === null || p.rim === null || Number(s.rimInch) === Number(p.rim));
        if (!liOk || !specOk)
          drops.push({ code: l.code, pid: Number(p.id), why: `사장님확인 ${sure.code} 과 다른 물건 — 자재 ${l.mname}` });
      }
      continue;
    }

    // 질의가 이미 정본 순서(PICK_MATERIAL_ORDER)로 정렬해 온다 — 첫 번째가 정답
    const pick = inMaster[0];
    if (!pick) { noMaster++; continue; }

    const s = parseTireSpec(normalizeKumhoName(pick.mname!));
    const load = decodeKumhoLoad(pick.mname!, pick.mpat ?? "");
    const set: string[] = [];
    const note: string[] = [];

    if (s.width !== null && Number(s.width) !== Number(p.w)) { set.push(`width = ${s.width}`); note.push(`폭 ${p.w}→${s.width}`); specFix++; }
    if (s.rimInch !== null && Number(s.rimInch) !== Number(p.rim)) { set.push(`rim_inch = ${s.rimInch}`); note.push(`인치 ${p.rim}→${s.rimInch}`); specFix++; }
    if (s.aspectRatio !== null && Number(s.aspectRatio) !== Number(p.ar)) { set.push(`aspect_ratio = ${s.aspectRatio}`); note.push(`편평비 ${p.ar}→${s.aspectRatio}`); specFix++; }
    if (pick.mli && pick.mli !== String(p.li ?? "").split("/")[0]) { set.push(`load_index = '${pick.mli}'`); note.push(`하중 ${p.li}→${pick.mli}`); liFix++; }
    if (pick.mss && pick.mss.toUpperCase() !== String(p.ss ?? "").toUpperCase()) { set.push(`speed_rating = '${pick.mss}'`); note.push(`속도 ${p.ss}→${pick.mss}`); liFix++; }
    if (pick.mprice && Number(pick.mprice) > 0 && Number(pick.mprice) !== Number(p.excl ?? -1)) {
      set.push(`list_price_excl = ${pick.mprice}`, `list_price = ${Math.round(Number(pick.mprice) * 1.1)}`);
      note.push(`기표가 ${p.excl ?? "-"}→${pick.mprice}`);
      priceFix++;
    }
    if (load.ply !== null && load.ply !== p.ply) { set.push(`ply_rating = ${load.ply}`); note.push(`겹 ${p.ply ?? "-"}→${load.ply}`); plyFix++; }
    /* 🔴 흡음재는 자재 마스터가 **양방향으로** 정답이다 (2026-08-27).
       전엔 켜기만 하고 끄지 않았는데, 바코드 꼬리표(`KM2298342흡음`) 때문에 잘못 켜진 것이
       그대로 남았다 — #8946 은 사장님 확인 코드 2413032 가 `H04L`(끝 L)이라 흡음재가 아니다. */
    if (load.acoustic !== p.ac) {
      set.push(`is_acoustic = ${load.acoustic}`);
      note.push(load.acoustic ? "흡음재 켬" : "흡음재 끔");
      acFix++;
    }

    if (set.length === 0) continue;
    fixes.push(`  #${p.id} ${(p.nm ?? "").slice(0, 30)} 재고${p.stock} [${pick.code}] ${note.join(" · ")}`);
    if (APPLY)
      await db.execute(sql.raw(`UPDATE product SET ${set.join(", ")}, updated_at = now() WHERE id = ${p.id}`));
  }

  console.log(`고칠 상품 ${fixes.length} — 규격 ${specFix} · 하중속도 ${liFix} · 기표가 ${priceFix} · 겹수 ${plyFix} · 흡음재 ${acFix}`);
  console.log(`자재 마스터에 있는 코드가 하나도 없는 상품 ${noMaster} (옛 코드만 있음 — 그대로 둔다)\n`);
  for (const f of fixes.slice(0, 40)) console.log(f);
  if (fixes.length > 40) console.log(`  … 그 밖 ${fixes.length - 40}개`);

  console.log(`\n── 떼어 낼 잘못된 연결 ${drops.length} ──`);
  for (const d of drops) {
    console.log(`  ${d.code} ↮ #${d.pid} — ${d.why}`);
    if (APPLY) await db.execute(sql`DELETE FROM supplier_item_code WHERE supplier='금호' AND code=${d.code} AND product_id=${d.pid}`);
  }
  if (APPLY) console.log(`\n✔ 상품 ${fixes.length}개 고침 · 연결 ${drops.length}개 뗌`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
