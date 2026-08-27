/**
 * ⭐ 금호 자재코드 → 상품 (사장님 요청 2026-08-27)
 *
 *   "매입에서도 invoice를 올리던 직접매입을 하던 같은 규칙에 맞춰서 잘 매입이 되어야함.
 *    금호는 이제 자재코드가 있으므로 딱딱 들어맞아야함.
 *    새로운 자재코드가 들어오면 검증 후에 같은 규칙으로 새 상품도 만들어져야함.
 *    미쉐린이 cai 가 있는것과 같은 이치임."
 *
 * 미쉐린은 MARS 마스터(품번=CAI)가 DB 에 있어 인보이스의 새 CAI 도 대조가 된다.
 * 금호는 `kumho_material`(기표가 Master 를 올리면 채워짐)이 그 자리다.
 *
 * 🔴 **여기 없는 자재코드로는 상품을 만들지 않는다.** 근거 없이 만들면 이름·규격·기표가가
 *    전부 추측이 된다 — 인보이스 한 줄로 만든 상품이 카탈로그를 오염시킨 적이 있다.
 *    대신 「최신 기표가 목록을 올려 주세요」라고 알린다.
 *
 * 이름·겹수·흡음재 규칙은 `kumho-name.ts` 한 벌을 쓴다 — 스크립트·인보이스·목록 업로드가 모두 같다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildKumhoName, decodeKumhoLoad, showPly } from "./kumho-name";
import { KUMHO_SEASON } from "./invoice-desc";
import { formatSpec, parseTireSpec } from "./tire-spec";
import { normalizeKumhoName } from "./kumho-master";
import { parseTireAttrs } from "./tire-attrs";

export const SUPPLIER = "금호";

export interface KumhoMaterial {
  code: string;
  name: string;
  patternCode: string;
  productGroup: string | null;
  opType: string | null;
  opStatus: string | null;
  loadIndex: string | null;
  speedRating: string | null;
  priceExcl: number | null;
}

/** 자재코드 한 줄 */
export async function kumhoMaterial(code: string): Promise<KumhoMaterial | null> {
  const c = String(code ?? "").trim();
  if (!c) return null;
  const [r] = await db.execute<{
    code: string; name: string; pattern_code: string; product_group: string | null;
    op_type: string | null; op_status: string | null; load_index: string | null;
    speed_rating: string | null; price_excl: number | null;
  }>(sql`
    SELECT code, name, pattern_code, product_group, op_type, op_status, load_index, speed_rating, price_excl
    FROM kumho_material WHERE code = ${c}`);
  if (!r) return null;
  return {
    code: r.code, name: r.name, patternCode: r.pattern_code, productGroup: r.product_group,
    opType: r.op_type, opStatus: r.op_status, loadIndex: r.load_index, speedRating: r.speed_rating,
    priceExcl: r.price_excl === null ? null : Number(r.price_excl),
  };
}

/** 상품 한 개를 만들 재료 — 이름·규격·세부사항·기표가가 모두 같은 규칙에서 나온다 */
export interface KumhoProductFields {
  marsItemNo: string;
  brandCode: "KM";
  /** 검색에 걸리는 한 줄 `225/60R17 Crugen Premium KL33 99H` */
  pattern: string;
  displayName: string | null;
  rawName: string;
  width: number | null;
  aspectRatio: number | null;
  rimInch: string | null;
  loadIndex: string | null;
  speedRating: string | null;
  plyRating: number | null;
  isAcoustic: boolean;
  isRunflat: boolean;
  isSuv: boolean;
  season: string | null;
  listPriceExcl: number | null;
  listPrice: number | null;
  /** 트럭·특수는 숨겨서 만든다 (사장님 결정 2026-08-27) */
  isActive: boolean;
}

const isPassengerGroup = (g: string | null) => g === "PCR" || g === "LTR" || g === null;

/** 자재 한 줄 → 상품 필드. 스크립트·인보이스·목록 업로드가 이 한 벌을 쓴다 */
export function kumhoProductFields(m: KumhoMaterial, currentName?: string | null): KumhoProductFields {
  const spec = parseTireSpec(normalizeKumhoName(m.name));
  const load = decodeKumhoLoad(m.name, m.patternCode);
  const built = buildKumhoName({ patternCode: m.patternCode, materialName: m.name, currentName });
  const model = built.model ?? m.patternCode;
  const attrs = parseTireAttrs(model, m.name);
  const label = [
    spec.width !== null && spec.rimInch !== null
      ? formatSpec({ width: spec.width, aspectRatio: spec.aspectRatio, rimInch: spec.rimInch })
      : "",
    model,
    `${m.loadIndex ?? ""}${m.speedRating ?? ""}`,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const excl = m.priceExcl && m.priceExcl > 0 ? m.priceExcl : null;
  return {
    marsItemNo: `KM${m.code}`,
    brandCode: "KM",
    pattern: label || m.name,
    // 이름 규칙이 모델명을 모르면(표에 없는 패턴) 이름을 비워 둔다 — 화면이 자동 이름을 만든다
    displayName: built.name,
    rawName: `Kumho ${m.name}`,
    width: spec.width,
    aspectRatio: spec.aspectRatio,
    rimInch: spec.rimInch === null ? null : String(spec.rimInch),
    loadIndex: m.loadIndex,
    speedRating: m.speedRating,
    plyRating: load.ply,
    isAcoustic: load.acoustic || attrs.isAcoustic,
    isRunflat: attrs.isRunflat,
    isSuv: attrs.isSuv,
    season: attrs.season ?? KUMHO_SEASON[m.patternCode.toUpperCase()] ?? null,
    listPriceExcl: excl,
    listPrice: excl === null ? null : Math.round(excl * 1.1),
    isActive: isPassengerGroup(m.productGroup),
  };
}

export type KumhoResolve =
  | { ok: true; productId: number; via: "사전" | "품번" | "규격+패턴" | "새로 만듦"; name: string | null }
  | { ok: false; reason: "자재코드없음" | "애매함"; message: string };

/**
 * 금호 자재코드로 상품을 찾거나 만든다 — 매입의 모든 길이 이걸 쓴다.
 *
 *   ① 사전(supplier_item_code) — 사람이 확인해 이어 둔 것이 가장 세다
 *   ② 품번 `KM<코드>`
 *   ③ 자재 마스터의 규격+패턴+하중속도로 **딱 하나** — 금호가 코드를 새로 매긴 경우다.
 *      찾으면 사전에 코드를 더해 둔다(옛 코드도 남는다)
 *   ④ 그래도 없으면 새로 만든다 — **자재 마스터에 있을 때만**
 */
export async function resolveKumhoProduct(
  code: string,
  opts: { create?: boolean; uidLabel?: string } = {},
): Promise<KumhoResolve> {
  const c = String(code ?? "").trim();
  if (!c) return { ok: false, reason: "자재코드없음", message: "자재코드가 없습니다" };

  const [dict] = await db.execute<{ id: number; nm: string | null }>(sql`
    SELECT p.id, COALESCE(p.display_name, p.pattern) nm
    FROM supplier_item_code s JOIN product p ON p.id = s.product_id
    WHERE s.supplier = ${SUPPLIER} AND s.code = ${c} LIMIT 1`);
  if (dict) return { ok: true, productId: Number(dict.id), via: "사전", name: dict.nm };

  const [byNo] = await db.execute<{ id: number; nm: string | null }>(sql`
    SELECT id, COALESCE(display_name, pattern) nm FROM product WHERE mars_item_no = ${"KM" + c} LIMIT 1`);
  if (byNo) {
    await learn(c, Number(byNo.id), null, "품번");
    return { ok: true, productId: Number(byNo.id), via: "품번", name: byNo.nm };
  }

  const m = await kumhoMaterial(c);
  if (!m) {
    return {
      ok: false,
      reason: "자재코드없음",
      message: `금호 자재 ${c} 를 목록에서 찾을 수 없습니다 — 설정 > 상품에서 최신 「기표가 목록」을 올려 주세요`,
    };
  }

  /* ③ 금호가 코드를 새로 매긴 경우 — 규격+패턴+하중속도가 딱 맞는 상품이 하나뿐일 때만 */
  const f = kumhoProductFields(m);
  if (f.width !== null && f.rimInch !== null) {
    const cands = await db.execute<{ id: number; nm: string | null }>(sql`
      SELECT p.id, COALESCE(p.display_name, p.pattern) nm FROM product p
      WHERE p.brand_code = 'KM' AND p.item_type = 'tire'
        AND p.width = ${f.width} AND p.rim_inch = ${f.rimInch}
        AND p.aspect_ratio IS NOT DISTINCT FROM ${f.aspectRatio}
        AND (p.pattern ILIKE ${"%" + m.patternCode + "%"} OR p.raw_name ILIKE ${"%" + m.patternCode + "%"}
             OR p.display_name ILIKE ${"%" + m.patternCode + "%"})
        AND (${m.loadIndex}::text IS NULL OR p.load_index IS NULL OR p.load_index = ${m.loadIndex})
        AND (${m.speedRating}::text IS NULL OR p.speed_rating IS NULL OR upper(p.speed_rating) = ${m.speedRating})
      LIMIT 3`);
    if (cands.length === 1) {
      await learn(c, Number(cands[0].id), m.name, "규격+패턴");
      return { ok: true, productId: Number(cands[0].id), via: "규격+패턴", name: cands[0].nm };
    }
    if (cands.length > 1)
      return { ok: false, reason: "애매함", message: `같은 규격·패턴 상품이 ${cands.length}개라 고르지 않았습니다 — 손으로 이어 주세요` };
  }

  if (!opts.create) return { ok: false, reason: "자재코드없음", message: "우리 상품에 없습니다" };

  /* ④ 자재 마스터에 있으니 같은 규칙으로 만든다 */
  const [ins] = await db.execute<{ id: number }>(sql`
    INSERT INTO product (
      mars_item_no, item_type, is_serialized, brand_code, pattern, display_name, raw_name,
      width, aspect_ratio, rim_inch, load_index, speed_rating, ply_rating, season,
      is_runflat, is_acoustic, is_suv, list_price, list_price_excl, name_auto,
      category, spec_parsed, is_active, hidden_reason, created_at, updated_at
    ) VALUES (
      ${f.marsItemNo}, 'tire', true, 'KM', ${f.pattern}, ${f.displayName}, ${f.rawName},
      ${f.width}, ${f.aspectRatio}, ${f.rimInch}, ${f.loadIndex}, ${f.speedRating}, ${f.plyRating}, ${f.season},
      ${f.isRunflat}, ${f.isAcoustic}, ${f.isSuv}, ${f.listPrice}, ${f.listPriceExcl}, ${f.displayName},
      '10-TIRES', ${f.width !== null}, ${f.isActive},
      ${f.isActive ? null : "트럭·특수 — 사장님 요청으로 숨김(2026-08-27)"}, now(), now()
    )
    ON CONFLICT (mars_item_no) DO NOTHING
    RETURNING id`);
  if (!ins) {
    const [again] = await db.execute<{ id: number; nm: string | null }>(sql`
      SELECT id, COALESCE(display_name, pattern) nm FROM product WHERE mars_item_no = ${f.marsItemNo} LIMIT 1`);
    if (!again) return { ok: false, reason: "애매함", message: "상품을 만들지 못했습니다" };
    await learn(c, Number(again.id), m.name, "품번");
    return { ok: true, productId: Number(again.id), via: "품번", name: again.nm };
  }
  await learn(c, Number(ins.id), m.name, "신규");
  return { ok: true, productId: Number(ins.id), via: "새로 만듦", name: f.displayName };
}

/** 사전에 적어 둔다 — 다음부터 같은 코드는 바로 찾아진다 (옛 코드 줄은 지우지 않는다) */
async function learn(code: string, productId: number, supplierName: string | null, how: string) {
  try {
    await db.execute(sql`
      INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, created_at, updated_at)
      VALUES (${SUPPLIER}, ${code}, ${productId}, ${supplierName}, ${how}, now(), now())
      ON CONFLICT (supplier, code) DO NOTHING`);
  } catch {
    /* 사전 등록 실패가 매입을 막지는 않는다 */
  }
}

/** 겹수를 이름에 쓰는가 — 화면 안내용 */
export { showPly };
