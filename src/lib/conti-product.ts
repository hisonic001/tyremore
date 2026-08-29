/**
 * 콘티넨탈 자재번호 → 우리 상품 ⭐ (2026-08-29)
 *
 *   매입(인보이스)과 목록 올리기가 **같은 한 벌**을 쓰게 한다.
 *   두 벌이 되면 같은 타이어가 두 상품으로 갈라지고 이름도 달라진다 —
 *   금호 때 가장 크게 데인 자리다 (커밋 `ddedbce`: "인보이스와 목록이 다른 이름을 냈다").
 *
 *   찾는 순서 (금호 `resolveKumhoProduct` 와 같은 얼개)
 *     ① 거래처 사전 supplier_item_code('콘티넨탈', 자재번호) — 사람이 확인해 이어 둔 것이 가장 세다
 *     ② 품번 `CO`/`GN` + 자재번호 — 우리 DB 는 이미 이 형식이라 여기서 거의 다 풀린다
 *     ③ 자재 마스터의 규격 + 모델명으로 딱 하나
 *     ④ 그래도 없으면 만든다 — **자재 마스터에 있을 때만**
 *
 * 🔴 자재 마스터에 없는 번호로는 만들지 않는다 — 이름·규격·기표가가 전부 추측이 된다.
 *    사장님께 「최신 운영 규격을 올려 주세요」라고 알린다.
 * 🔴 `learn` 기본 **off** — 금호 때 미리보기가 DB 를 고쳤다 (`kumho-product.ts:163`).
 *    인보이스 미리보기만 돌려도 사전이 채워지면 「미리보기 11건 → 반영 0건」 같은 일이 생긴다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface ContiMaterial {
  code: string;
  brandCode: string;
  description: string;
  modelName: string;
  season: string | null;
  priceExcl: number;
}

/** 자재 마스터에서 한 줄 */
export async function contiMaterial(code: string): Promise<ContiMaterial | null> {
  const c = code.trim().replace(/^(CO|GN)/i, "");
  const [m] = await db.execute<{
    code: string; brand_code: string; description: string; model_name: string; season: string | null; price_excl: number;
  }>(sql`
    SELECT code, brand_code, description, model_name, season, price_excl
    FROM continental_material WHERE code = ${c}`);
  return m
    ? {
        code: m.code,
        brandCode: m.brand_code,
        description: m.description,
        modelName: m.model_name,
        season: m.season,
        priceExcl: Number(m.price_excl),
      }
    : null;
}

export type ContiResolve =
  | { ok: true; productId: number; via: "사전" | "품번" | "규격+모델" | "새로 만듦" }
  | { ok: false; message: string };

export async function resolveContinentalProduct(
  codeRaw: string,
  opts: { create?: boolean; learn?: boolean } = {},
): Promise<ContiResolve> {
  const code = codeRaw.trim().replace(/^(CO|GN)/i, "");
  if (!/^\d{11}$/.test(code)) return { ok: false, message: `콘티넨탈 자재번호 형식이 아닙니다 (${codeRaw})` };
  const remember = opts.learn ?? opts.create ?? false;

  // ① 사전
  const [dict] = await db.execute<{ product_id: number }>(sql`
    SELECT product_id FROM supplier_item_code WHERE supplier = '콘티넨탈' AND code = ${code} LIMIT 1`);
  if (dict) return { ok: true, productId: Number(dict.product_id), via: "사전" };

  const m = await contiMaterial(code);

  // ② 품번 — 우리 DB 는 CO/GN + 자재번호 형식이다
  const [byNo] = await db.execute<{ id: number }>(sql`
    SELECT id FROM product WHERE mars_item_no IN (${"CO" + code}, ${"GN" + code}) LIMIT 1`);
  if (byNo) {
    if (remember) await learn(code, Number(byNo.id), m?.description ?? null, "품번");
    return { ok: true, productId: Number(byNo.id), via: "품번" };
  }

  if (!m) {
    return {
      ok: false,
      message: `콘티넨탈 자재 ${code} 을(를) 목록에서 못 찾았습니다 — 설정 > 상품 「목록 채우기」에서 최신 운영 규격을 올려 주세요`,
    };
  }

  // ③ 자재 마스터의 규격 + 모델명으로 딱 하나
  const { parseContiDesc } = await import("./conti-name");
  const a = parseContiDesc(m.description, null);
  if (a.specParsed && a.width !== null && a.rimInch !== null) {
    const cand = await db.execute<{ id: number }>(sql`
      SELECT p.id FROM product p
      WHERE p.brand_code = ${m.brandCode} AND p.item_type = 'tire'
        AND p.width = ${a.width} AND p.rim_inch = ${a.rimInch}
        AND p.aspect_ratio IS NOT DISTINCT FROM ${a.aspectRatio}
        AND (${a.loadIndex}::text IS NULL OR p.load_index IS NULL OR p.load_index = ${a.loadIndex})
        AND (${a.speedRating}::text IS NULL OR p.speed_rating IS NULL OR p.speed_rating = ${a.speedRating})
        AND lower(replace(COALESCE(p.display_name, p.pattern, ''), ' ', '')) = ${m.modelName.toLowerCase().replace(/ /g, "")}
      LIMIT 2`);
    if (cand.length === 1) {
      if (remember) await learn(code, Number(cand[0].id), m.description, "규격+패턴");
      return { ok: true, productId: Number(cand[0].id), via: "규격+모델" };
    }
  }

  // ④ 만들기 — 자재 마스터에 있으니 이름·규격·기표가에 근거가 있다
  if (!opts.create) return { ok: false, message: `콘티넨탈 자재 ${code} 에 맞는 상품이 없습니다` };
  const incl = Math.round(m.priceExcl * 1.1);
  const [n] = await db.execute<{ id: number }>(sql`
    INSERT INTO product (mars_item_no, item_type, is_serialized, brand_code, pattern, raw_name,
                         display_name, name_auto, width, aspect_ratio, rim_inch, load_index, speed_rating,
                         season, is_runflat, is_acoustic, is_suv, ply_rating, oe_marks,
                         category, list_price, list_price_excl, spec_parsed, stock_tracked, is_active)
    VALUES (${m.brandCode + code}, 'tire', true, ${m.brandCode}, ${m.description}, ${`Continental ${m.description}`},
            ${a.name}, ${a.name}, ${a.width}, ${a.aspectRatio}, ${a.rimInch}, ${a.loadIndex}, ${a.speedRating},
            ${m.season}, ${a.isRunflat}, ${a.isAcoustic}, ${a.isSuv}, ${a.plyRating}, ${a.oeMarks},
            '10-TIRES', ${incl}, ${m.priceExcl}, ${a.specParsed}, false, true)
    ON CONFLICT (mars_item_no) DO NOTHING
    RETURNING id`);
  if (!n) return { ok: false, message: `콘티넨탈 자재 ${code} 상품을 만들지 못했습니다` };
  await learn(code, Number(n.id), m.description, "품번");
  return { ok: true, productId: Number(n.id), via: "새로 만듦" };
}

/** 「이 거래처는 이 상품을 이렇게 부른다」를 적어 둔다. 옛 코드 줄은 지우지 않는다 */
async function learn(code: string, productId: number, name: string | null, how: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, updated_at)
    VALUES ('콘티넨탈', ${code}, ${productId}, ${name}, ${how}, now())
    ON CONFLICT (supplier, code) DO UPDATE SET product_id = EXCLUDED.product_id, updated_at = now()`);
}
