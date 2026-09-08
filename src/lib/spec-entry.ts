"use server";

/**
 * 사장님이 제원을 **직접 넣는 길** (2026-09-08, 사장님 지시)
 *
 * 「니가 폼을 만들어주면 내가 찾아서 넣어볼게.」
 *
 * 🔴 **왜 넣는 길이 필요한가** — 설명서를 인터넷에서 받을 수 있는 차종이 다 떨어졌다.
 *    기아는 현행 연식만 올리고, 현대 자료실에는 제원 없는 120세대 중 둘뿐이며,
 *    현대·기아 통합 설명서는 딜러 로그인이 필요하다 (2026-09-07·08 실측).
 *
 * 🔴 **사장님이 넣은 값은 곧바로 「승인」이다.** 사람이 보고 넣은 값이 맞으니 정직한 상태이고,
 *    `vs_verified` 제약(사람 없는 승인 금지)도 그대로 지켜진다 — `verified_by` 가 사장님이다.
 *
 * 🔴 **덮어쓰지 않는다.** 이미 값이 있으면 「지금 값과 다릅니다」를 돌려주고 사장님이 고르신다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { canonical, cleanPattern } from "@/lib/spec-format-core";
import { specItem } from "@/lib/spec-core";

/** 어디서 보고 넣으셨나 — 근거로 남는다 */
export type SpecOrigin = "취급설명서" | "문틀 라벨" | "부품상" | "인터넷" | "차에서 확인";

export interface SpecEntryLine {
  item: string;
  /** 사장님이 친 글자 */
  raw: string;
  /** 숫자 항목에서 고르신 단위 */
  unit?: string | null;
  /** 앞/뒤·운전석/조수석 같은 조건 */
  qualifier?: string | null;
  /** 타이어를 우리 상품에서 고르셨다면 그 상품 번호 */
  productId?: number | null;
}

export interface SpecEntryResult {
  ok: boolean;
  saved: number;
  /** 값이 이미 있어 손대지 않은 것 — 사장님이 고르셔야 한다 */
  clashes: { item: string; label: string; 지금: string; 넣으신것: string }[];
  /** 형식이 안 맞아 못 넣은 것 */
  rejected: { item: string; label: string; raw: string; why: string }[];
  error?: string;
}

/**
 * 미리 보기 — 저장하지 않고 **무엇이 어떻게 저장될지**만 돌려준다.
 * 화면이 글자를 칠 때마다 부른다.
 */
export async function previewSpecEntry(
  variantKey: string,
  lines: SpecEntryLine[],
): Promise<{ item: string; ok: boolean; display: string | null; why: string | null }[]> {
  const bodyType = await bodyTypeOf(variantKey);
  return lines.map((l) => {
    const r = canonical(l.item, l.raw, l.unit, { bodyType });
    return { item: l.item, ok: r.ok, display: r.display, why: r.why };
  });
}

/**
 * 실제로 넣는다.
 * 🔴 질의는 **순차로** — `Promise.all` 로 묶으면 풀이 만석이 된다 (2026-08-11 사고).
 */
export async function saveSpecByOwner(input: {
  variantKey: string;
  origin: SpecOrigin;
  /** 인터넷이면 주소, 부품상이면 가게 이름 등 */
  originNote?: string | null;
  lines: SpecEntryLine[];
  /** 이미 있는 값을 사장님이 「바꿉니다」로 고르신 항목 */
  replace?: string[];
}): Promise<SpecEntryResult> {
  const empty: SpecEntryResult = { ok: false, saved: 0, clashes: [], rejected: [] };
  if (!(await hasPerm("master"))) return { ...empty, error: "제원 입력은 사장님 계정에서만 됩니다" };
  const session = await getSession();
  const uid = session?.uid;
  if (!uid) return { ...empty, error: "다시 로그인해 주세요" };

  const [gen] = await db.execute<{ id: number; label: string }>(sql`
    SELECT id, label FROM vehicle_generation WHERE variant_key = ${input.variantKey}`);
  if (!gen) return { ...empty, error: `「${input.variantKey}」 차종을 못 찾았습니다` };

  const bodyType = await bodyTypeOf(input.variantKey);
  const replace = new Set(input.replace ?? []);

  /* ── 먼저 전부 정본으로 바꿔 본다. 하나라도 형식이 틀리면 그것만 빼고 나머지는 넣는다 ── */
  const good: { line: SpecEntryLine; made: ReturnType<typeof canonical> }[] = [];
  const rejected: SpecEntryResult["rejected"] = [];
  for (const line of input.lines) {
    if (!String(line.raw ?? "").trim()) continue;
    const made = canonical(line.item, line.raw, line.unit, { bodyType });
    const label = specItem(line.item)?.label ?? line.item;
    if (!made.ok) {
      rejected.push({ item: line.item, label, raw: line.raw, why: made.why ?? "넣을 수 없습니다" });
      continue;
    }
    good.push({ line, made });
  }
  if (good.length === 0) return { ok: rejected.length === 0, saved: 0, clashes: [], rejected };

  /* ── 근거 한 줄 ── */
  const today = new Date().toISOString().slice(0, 10);
  const url = input.origin === "인터넷" && input.originNote ? input.originNote : `사장님입력:${input.origin}`;
  const bodyText = good
    .map((g) => `${specItem(g.line.item)?.label ?? g.line.item} ${g.made.display}`)
    .join("\n");
  const [src] = await db.execute<{ id: number }>(sql`
    INSERT INTO spec_source (generation_id, url, host, kind, trust_rank, independence_key,
                             title, body_text, requested_by, fetched_on)
    VALUES (${gen.id}, ${url}, ${"사장님"}, ${"사장님입력"}, 2, ${`owner:${input.origin}`},
            ${`사장님이 ${input.origin}에서 보고 넣음`}, ${bodyText}, ${uid}, ${today})
    ON CONFLICT (url, fetched_on) DO UPDATE SET body_text = EXCLUDED.body_text
    RETURNING id`);
  if (!src) return { ...empty, error: "근거를 저장하지 못했습니다", rejected };

  /* ── 한 줄씩 넣는다 ── */
  let saved = 0;
  const clashes: SpecEntryResult["clashes"] = [];
  for (const { line, made } of good) {
    const label = specItem(line.item)?.label ?? line.item;
    const qual = line.qualifier ? JSON.stringify({ 위치: line.qualifier }) : null;

    /* 같은 항목·같은 조건에 이미 값이 있나 */
    const [now] = await db.execute<{ id: number; text_value: string | null; num_min: string | null; unit: string | null }>(sql`
      SELECT id, text_value, num_min::text AS num_min, unit
      FROM vehicle_spec
      WHERE generation_id = ${gen.id} AND item = ${line.item} AND status <> '거절'
        AND COALESCE(qualifier->>'위치', '') = COALESCE(${line.qualifier ?? null}, '')
      LIMIT 1`);

    if (now && !replace.has(line.item)) {
      const 지금 = now.text_value ?? `${now.num_min ?? ""} ${now.unit ?? ""}`.trim();
      if (지금 !== (made.textValue ?? `${made.numMin} ${made.unit}`)) {
        clashes.push({ item: line.item, label, 지금, 넣으신것: made.display ?? "" });
        continue;
      }
    }

    if (now) {
      await db.execute(sql`
        UPDATE vehicle_spec
        SET text_value = ${made.textValue}, num_min = ${made.numMin}, num_max = ${made.numMax},
            unit = ${made.unit}, status = '승인', verified_by = ${uid}, verified_at = now(),
            created_by = ${"사장님입력"}, updated_at = now()
        WHERE id = ${now.id}`);
      await addCitation(now.id, src.id, made.display ?? "", input.origin, bodyText);
      saved++;
      continue;
    }

    const [made2] = await db.execute<{ id: number }>(sql`
      INSERT INTO vehicle_spec
        (generation_id, group_no, group_label, item, qualifier, text_value, num_min, num_max, unit,
         status, risk, created_by, verified_by, verified_at)
      VALUES (${gen.id}, ${groupNoFor(line.item)}, NULL, ${line.item},
              ${qual === null ? null : sql`${qual}::jsonb`},
              ${made.textValue}, ${made.numMin}, ${made.numMax}, ${made.unit},
              '승인', ${specItem(line.item)?.risk ?? "보통"}, ${"사장님입력"}, ${uid}, now())
      RETURNING id`);
    if (!made2) continue;
    await addCitation(made2.id, src.id, made.display ?? "", input.origin, bodyText);
    saved++;
  }

  return { ok: true, saved, clashes, rejected };
}

async function addCitation(specId: number, sourceId: number, value: string, origin: SpecOrigin, bodyText: string) {
  /* 🔴 인용은 원문에 실제로 있어야 한다 — body_text 를 그대로 만들었으니 그 줄을 쓴다 */
  const line = bodyText.split("\n").find((l) => l.includes(value)) ?? value;
  await db.execute(sql`
    INSERT INTO spec_citation (spec_id, source_id, quote, quote_pos)
    VALUES (${specId}, ${sourceId}, ${`사장님이 ${origin}에서 보고 넣음 — ${line}`},
            ${Math.max(0, bodyText.indexOf(line))})
    ON CONFLICT (spec_id, source_id) DO UPDATE SET quote = EXCLUDED.quote`);
}

/**
 * 벌 번호 — 타이어 쪽만 벌을 따진다.
 * 🔴 화면(`spec-sheet-core`)이 타이어 말고는 `group_no` 를 무시하므로 여기서 크게 신경 쓸 것이 없다.
 *    다만 타이어 벌과 겹치지 않게 **90번대**를 쓴다.
 */
function groupNoFor(item: string): number {
  return item === "tire_size" || item === "wheel_size" || item === "tire_pressure" || item === "wheel_nut_torque"
    ? 1
    : 90;
}

async function bodyTypeOf(variantKey: string): Promise<string | null> {
  const [g] = await db.execute<{ body_type: string | null }>(sql`
    SELECT body_type FROM vehicle_generation WHERE variant_key = ${variantKey}`);
  return g?.body_type ?? null;
}

/**
 * 🔴 **세대 149개의 차체가 전부 비어 있다** (2026-09-08 실측).
 *    차체를 모르면 휠너트 토크 범위가 승용 8~20 이 아니라 넓은 6~70 으로 열려서,
 *    승용차에 `50 kgf·m` 을 넣어도 안 막힌다. 폼에서 차체를 먼저 정하는 이유다.
 *
 * 손님 차에 적힌 차체로 **짐작만** 해서 내놓는다 — 정하는 건 사장님이다.
 */
export async function suggestBodyType(
  variantKey: string,
): Promise<{ now: string | null; guess: string | null; from: number }> {
  const [g] = await db.execute<{ id: number; body_type: string | null }>(sql`
    SELECT id, body_type FROM vehicle_generation WHERE variant_key = ${variantKey}`);
  if (!g) return { now: null, guess: null, from: 0 };
  if (g.body_type) return { now: g.body_type, guess: null, from: 0 };

  const rows = await db.execute<{ body_type: string; n: number }>(sql`
    SELECT body_type, count(*)::int AS n
    FROM vehicle
    WHERE generation_id = ${g.id} AND body_type IS NOT NULL AND btrim(body_type) <> ''
    GROUP BY 1 ORDER BY n DESC LIMIT 1`);
  const top = rows[0];
  return { now: null, guess: top ? normalizeBody(top.body_type) : null, from: Number(top?.n ?? 0) };
}

/** 손님 차에는 「밴/소형버스」로, 제원 범위표에는 「밴·소형버스」로 적혀 있다 — 맞춰 준다 */
function normalizeBody(v: string): string | null {
  const s = v.trim();
  if (s === "승용" || s === "SUV" || s === "소형트럭" || s === "대형") return s;
  if (/밴|소형버스/.test(s)) return "밴·소형버스";
  return null;
}

/** 사장님이 고르신 차체를 세대에 적어 둔다 — 다음부터 범위 검사가 제대로 돈다 */
export async function setGenerationBodyType(variantKey: string, bodyType: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await hasPerm("master"))) return { ok: false, error: "사장님 계정에서만 됩니다" };
  const allowed = ["승용", "SUV", "소형트럭", "밴·소형버스", "대형"];
  if (!allowed.includes(bodyType)) return { ok: false, error: `${allowed.join(" · ")} 중에서 골라 주세요` };
  await db.execute(sql`
    UPDATE vehicle_generation SET body_type = ${bodyType} WHERE variant_key = ${variantKey}`);
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────
 * 순정 타이어를 **우리 상품에서 고르기** (2026-09-08, 사장님 지시)
 *
 * 「oem 타이어가 현재 db에 있는 제품이라면 고를 수 있도록 해줘.
 *  그렇게 고르면 자동으로 타이어 사이즈도 입력되어야하고.」
 *
 * 🔴 고르면 **브랜드·패턴·규격 셋이 한꺼번에** 맞아 들어온다. 설명서에는 패턴명이 아예 없어서
 *    이 길이 패턴을 넣을 수 있는 유일한 길이다.
 * ──────────────────────────────────────────────────────────────────── */

export interface OeTireChoice {
  productId: number;
  /** 「미쉐린 (Michelin)」 — 정본 브랜드 */
  brand: string;
  /** 「PILOT SPORT 4 SUV」 */
  pattern: string | null;
  /** 「235/60R18」 — 정본 규격 */
  size: string;
  /** 지금 창고에 있는 수량 */
  stock: number;
}

/**
 * 규격으로 우리 상품을 찾는다. 규격을 모르면 브랜드·이름으로도 찾는다.
 * 🔴 **없으면 빈 목록이다.** 없는 것을 지어내지 않는다 — 그때는 사장님이 직접 치신다.
 */
export async function findOeTires(q: { size?: string | null; text?: string | null }): Promise<OeTireChoice[]> {
  const size = (q.size ?? "").toUpperCase().replace(/\s/g, "");
  const m = /(\d{3})\/(\d{2})[RZ](\d{2})/.exec(size);
  const text = (q.text ?? "").trim();
  if (!m && text.length < 2) return [];

  const rows = await db.execute<{
    id: number;
    name_ko: string | null;
    name_en: string | null;
    pattern: string | null;
    width: number | null;
    aspect_ratio: number | null;
    rim_inch: string | null;
    stock: number;
  }>(sql`
    SELECT p.id, b.name_ko, b.name_en, p.pattern, p.width, p.aspect_ratio, p.rim_inch::text AS rim_inch,
           COALESCE((SELECT sum(s.qty)::int FROM stock_item s
                      WHERE s.product_id = p.id AND s.status = '재고'), 0) AS stock
    FROM product p
    LEFT JOIN brand b ON b.code = p.brand_code
    WHERE p.is_active AND p.item_type = 'tire' AND p.spec_parsed
      ${m ? sql`AND p.width = ${Number(m[1])} AND p.aspect_ratio = ${Number(m[2])} AND p.rim_inch = ${Number(m[3])}` : sql``}
      ${text ? sql`AND (p.pattern ILIKE ${`%${text}%`} OR b.name_ko ILIKE ${`%${text}%`} OR b.name_en ILIKE ${`%${text}%`})` : sql``}
    ORDER BY stock DESC, b.sort_order, p.pattern
    LIMIT 40`);

  const seen = new Set<string>();
  const out: OeTireChoice[] = [];
  for (const r of rows) {
    if (r.width === null || r.aspect_ratio === null || r.rim_inch === null) continue;
    const inch = Math.round(Number(r.rim_inch));
    const madeSize = `${r.width}/${r.aspect_ratio}R${inch}`;
    const brand = r.name_ko ? (r.name_en ? `${r.name_ko} (${r.name_en})` : r.name_ko) : "기타";
    /* 같은 브랜드·패턴·규격은 한 줄로 — 값만 다른 같은 물건이 여럿이다 */
    const key = `${brand}|${cleanPattern(r.pattern) ?? ""}|${madeSize}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      productId: Number(r.id),
      brand,
      pattern: cleanPattern(r.pattern),
      size: madeSize,
      stock: Number(r.stock ?? 0),
    });
    if (out.length >= 12) break;
  }
  return out;
}
