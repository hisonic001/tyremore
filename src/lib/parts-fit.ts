"use server";

/**
 * 「이 차에 맞는 부품」 — 우리 상품의 적용 차종 글자로 잇는다 (2026-09-04)
 *
 * 상품 자료에 **적용 차종이 1,636건** 채워져 있다. 실제 모양:
 *   배터리 HK74DL   … 호환 CMF57412 DIN74L … 쏘나타DN8, 코나(디젤), 더뉴K3(디젤) …
 *   브레이크패드     … 싼타페12년형(DM) ('12.04~) 맥스크루즈 … G70 17", 18" …
 * 세대코드(DN8·DM·MD·CN7…)가 그대로 적혀 있어서, 그걸 열쇠로 쓴다.
 *
 * 🔴 **세대코드가 낱말로 일치할 때만 그 차 것으로 내놓는다.**
 *    이름이 비슷하다고 붙이지 않는다 — `RBK`(투싼) 문서를 `BK`(제네시스 쿠페)로
 *    잘못 집었던 것과 같은 함정이다. **틀린 품번은 맞는 품번보다 위험하다.**
 *
 * 🔴 **왜 걸렸는지 적용 차종 글자를 그대로 함께 보여 준다.** 제원 검수 화면이
 *    원문 줄을 보여 주는 것과 같은 이치다 — 정비사가 눈으로 확인할 수 있어야 한다.
 *
 * 🔴 **여기서 세 가지를 더 한다** (2026-09-05, 사장님 지시로 실제 오탐을 찾은 뒤):
 *    ① 코드 언저리에 남의 제조사가 있으면 버린다 — 모닝 `JA` 에 재규어 `XE(JA)` 가 붙었다
 *    ② 순정 품번을 꺼낸다 — 화면의 `part_no` 는 우리 상품코드지 주문 번호가 아니다
 *    ③ 어느 엔진·어느 축·몇 인치 것인지 읽는다. **못 읽으면 null 로 두고 짐작하지 않는다**
 *
 * 새 표를 만들지 않는다. 조회할 때 계산한다 (적용 차종 1,636건 × 세대 하나 = 가볍다).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  codeWordPattern,
  fitConditions,
  foreignNear,
  oemPartNos,
  partDedupeKey,
  whySnippet,
} from "@/lib/parts-fit-core";

export interface FitPart {
  productId: number;
  category: string | null;
  name: string;
  /** 우리 상품코드 — 순정 품번이 아니다 */
  partNo: string | null;
  /** 🔴 순정 품번 — 사장님이 부품상에 주문할 때 부르는 번호 */
  oemNos: string[];
  /** 이 부품이 어느 조건용인지. 못 읽으면 null — 짐작하지 않는다 */
  engine: string | null;
  axle: "앞" | "뒤" | null;
  inch: number | null;
  /** 왜 이 차 것으로 걸렸는지 — 적용 차종 글자에서 코드 언저리를 잘라 보여 준다 */
  why: string;
  listPrice: number | null;
  /** 지금 창고에 있는 수량 */
  stock: number;
}

/**
 * 이 세대에 맞는 부품.
 * 🔴 `proj_code` 가 없는 세대(괄호코드를 못 읽은 차)에는 **아무것도 내놓지 않는다.**
 */
export async function partsForGeneration(generationId: number): Promise<FitPart[]> {
  const [gen] = await db.execute<{ proj_code: string | null; maker: string | null }>(sql`
    SELECT g.proj_code, mk.name_ko AS maker
    FROM vehicle_generation g
    JOIN vehicle_model mo ON mo.id = g.model_id
    JOIN vehicle_maker mk ON mk.code = mo.maker_code
    WHERE g.id = ${generationId}`);
  const code = gen?.proj_code?.trim();
  if (!code || code.length < 2) return [];
  const maker = gen?.maker ?? null;

  /* 낱말 경계까지 SQL 로 본다 (`~*` 는 대소문자 무시 정규식) */
  const pattern = codeWordPattern(code);
  const rows = await db.execute<{
    id: number;
    category: string | null;
    name: string;
    part_no: string | null;
    fitment: string;
    list_price: number | null;
    stock: number;
  }>(sql`
    SELECT p.id, p.category,
           COALESCE(NULLIF(btrim(p.display_name), ''), p.raw_name) AS name,
           p.part_no, p.fitment, p.list_price,
           COALESCE((SELECT sum(s.qty)::int FROM stock_item s
                      WHERE s.product_id = p.id AND s.status = '재고'), 0) AS stock
    FROM product p
    WHERE p.is_active
      AND p.item_type = 'part'   -- 타이어는 규격으로 고르지 부품표로 고르지 않는다
      AND p.fitment IS NOT NULL AND btrim(p.fitment) <> ''
      AND p.fitment ~* ${pattern}
    ORDER BY (p.category = '오일필터') DESC, p.category, name
    LIMIT 60`);

  const out: FitPart[] = [];
  /* 🔴 `(순정부품)` 접두사만 다른 짝이 243묶음 있다 — 합치지 않으면 목록이 두 배가 된다 */
  const seen = new Set<string>();

  for (const r of rows) {
    /* ① 남의 차 부품은 버린다. 우리 차가 수입차면 그 제조사는 남이 아니다 */
    if (foreignNear(r.fitment, code, maker)) continue;

    const oemNos = oemPartNos(r.fitment);
    const key = partDedupeKey(r.category, oemNos, r.name);
    if (seen.has(key)) continue;
    seen.add(key);

    const cond = fitConditions(r.fitment, code);
    out.push({
      productId: Number(r.id),
      category: r.category,
      name: r.name,
      partNo: r.part_no,
      oemNos,
      engine: cond.engine,
      axle: cond.axle,
      inch: cond.inch,
      why: whySnippet(r.fitment, code),
      listPrice: r.list_price === null ? null : Number(r.list_price),
      stock: Number(r.stock ?? 0),
    });
  }
  return out;
}
