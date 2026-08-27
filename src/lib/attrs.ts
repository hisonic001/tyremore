"use server";

/**
 * 세부사항 고치기 — 계절 · 런플랫 · 흡음재 · SUV · OE 마킹
 *
 * 사장님 지적 (2026-08-01)
 *   "세부사항들은 수정이 안 되는데 어떻게 해야 할까? 런플랫, OE마킹, 잘못된 계절 기재 등등.
 *    실제로 현재도 맞지 않는 것들이 너무 많이 있음."
 *
 * 🔴 자동 판정에는 한계가 있다.
 *    MARS 상품명이 축약·누락투성이다 — 미쉐린 4,152건 중 OE 마킹이 적힌 것은 약 200건뿐이고,
 *    모델명도 `PILSP3`, `PRIM MXM4` 처럼 줄여 놓았다.
 *    이름에 없는 것을 이름에서 읽어낼 수는 없다.
 *
 * ⭐ 그래서 **사람이 고친 값을 따로 남기고, 재이관 뒤에 다시 덮어씌운다.**
 *    안 그러면 다음 이관 때 애써 고친 것이 전부 날아간다.
 *    display_name·바코드 연결과 같은 방식이다 (D-05: 쓰면서 채운다).
 */
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { product } from "@/db/schema";
import type { Season } from "./tire-attrs";

/** 요청 밖(이관 스크립트)에서 불러도 죽지 않게 감싼다 */
function refresh(...paths: string[]) {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 컨텍스트 밖 — 갱신할 화면이 없다 */
    }
  }
}

export interface EditableAttrs {
  season: Season | null;
  isRunflat: boolean;
  isAcoustic: boolean;
  isSuv: boolean;
  /** 콤마로 구분: 'MO,GRNX' */
  oeMarks: string | null;
  /** ⭐ 겹수(PR) — 이름에서 뺐으니 여기서 보고 고친다 (2026-08-27) */
  plyRating: number | null;
}

/** 고른 값으로 상품을 고친다 */
export async function saveAttrs(
  productId: number,
  attrs: Partial<EditableAttrs>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [cur] = await db
    .select({ override: product.attrsOverride })
    .from(product)
    .where(eq(product.id, productId))
    .limit(1);
  if (!cur) return { ok: false, error: "상품을 찾을 수 없습니다" };

  /**
   * 고친 것만 남긴다. 손대지 않은 항목은 자동 판정을 그대로 쓰게 둔다 —
   * 나중에 판정 규칙을 고치면 그쪽이 저절로 좋아진다.
   */
  const override = { ...(cur.override as Record<string, unknown> | null), ...attrs };

  await db
    .update(product)
    .set({
      ...attrs,
      attrsOverride: override,
      updatedAt: new Date(),
    })
    .where(eq(product.id, productId));

  refresh(`/stock/${productId}`, "/");
  return { ok: true };
}

/** 자동 판정으로 되돌린다 */
export async function resetAttrs(productId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const [p] = await db
    .select({ rawName: product.rawName, pattern: product.pattern })
    .from(product)
    .where(eq(product.id, productId))
    .limit(1);
  if (!p) return { ok: false, error: "상품을 찾을 수 없습니다" };

  const { parseTireAttrs } = await import("./tire-attrs");
  const a = parseTireAttrs(p.pattern, p.rawName);

  await db
    .update(product)
    .set({
      season: a.season,
      isRunflat: a.isRunflat,
      isAcoustic: a.isAcoustic,
      isSuv: a.isSuv,
      oeMarks: null,
      // 겹수는 자동 판정이 없다 — 되돌릴 값이 없으므로 그대로 둔다
      attrsOverride: null,
      updatedAt: new Date(),
    })
    .where(eq(product.id, productId));

  refresh(`/stock/${productId}`, "/");
  return { ok: true };
}

/**
 * ⭐ 재이관 뒤에 사람이 고친 값을 되살린다.
 * 이관 스크립트 마지막에 부른다. 이게 없으면 이관할 때마다 다시 고쳐야 한다.
 */
export async function reapplyOverrides(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    WITH u AS (
      UPDATE product SET
        season      = COALESCE(attrs_override->>'season', season),
        is_runflat  = COALESCE((attrs_override->>'isRunflat')::boolean, is_runflat),
        is_acoustic = COALESCE((attrs_override->>'isAcoustic')::boolean, is_acoustic),
        is_suv      = COALESCE((attrs_override->>'isSuv')::boolean, is_suv),
        oe_marks    = COALESCE(attrs_override->>'oeMarks', oe_marks),
        ply_rating  = COALESCE((attrs_override->>'plyRating')::int, ply_rating)
      WHERE attrs_override IS NOT NULL
      RETURNING 1
    ) SELECT count(*)::int n FROM u
  `);
  return rows[0]?.n ?? 0;
}
