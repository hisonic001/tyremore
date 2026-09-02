/**
 * 「이번 주 쓸 글」 — 실제 자료로 글감을 고른다 (D단계, 2026-09-02)
 *
 * 근거 네 가지를 우선순위 순으로 본다:
 *   ① **밀린 사진 폴더** — 사진이 이미 있으니 가장 센 글감. `(미업로드)` 가 맨 위
 *   ② **원고 없는 최근 시공** — 폴더도 원고도 없는 건
 *   ③ **정보성 글감** — 「차종별 순정 제원」. 시공이 없어도 쓸 수 있어 **글감이 마르지 않는다.**
 *      게다가 앱에 「속초에서 이 차종 N대에 이 규격을 넣었다」가 있어 남이 못 쓰는 근거가 된다
 *   ④ **계절** — 속초 특유의 각도(미시령 고갯길·관광객)
 *
 * 🔴 카테고리는 사장님 블로그에 실제로 있는 12개 그대로다 (blog-topics-core.ts).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { inferCategory, seasonTopic, type Topic } from "./blog-topics-core";

/** 정보성 글감의 근거 — 이 매장에서 실제로 이 차종에 넣은 규격 */
export interface ModelStat {
  maker: string;
  model: string;
  builds: number;
  spec: string | null;
}

export async function modelStats(minBuilds = 3, limit = 12): Promise<ModelStat[]> {
  const rows = await db.execute<{
    maker: string | null;
    model: string;
    builds: number;
    width: number | string | null;
    aspect: number | string | null;
    rim: number | string | null;
  }>(sql`
    SELECT COALESCE(mk.name_ko, v.maker_name) AS maker, v.model,
           count(DISTINCT q.id)::int AS builds,
           mode() WITHIN GROUP (ORDER BY p.width)        AS width,
           mode() WITHIN GROUP (ORDER BY p.aspect_ratio) AS aspect,
           mode() WITHIN GROUP (ORDER BY p.rim_inch)     AS rim
    FROM quote q
    JOIN quote_item qi ON qi.quote_id = q.id AND qi.line_type = 'tire'
    JOIN vehicle v ON v.id = q.vehicle_id
    LEFT JOIN vehicle_maker mk ON mk.code = v.maker_code
    LEFT JOIN product p ON p.id = qi.product_id
    WHERE q.status = '성사' AND v.model IS NOT NULL AND p.width IS NOT NULL
    GROUP BY 1, 2
    HAVING count(DISTINCT q.id) >= ${minBuilds}
    ORDER BY 3 DESC
    LIMIT ${limit}`);

  return rows.map((r) => {
    // 규격 조립은 sale-history 와 같은 규칙 — 편평비 80(밴) 생략, 인치 17.0 → 17
    const rim = r.rim === null ? null : String(Number(r.rim));
    const spec =
      r.width && rim
        ? `${r.width}${r.aspect && Number(r.aspect) !== 80 ? `/${r.aspect}` : ""}R${rim}`
        : null;
    return { maker: r.maker ?? "", model: r.model, builds: Number(r.builds), spec };
  });
}

/** 이미 쓴 차종 — 정보성 글감이 겹치지 않게 */
async function writtenModels(): Promise<Set<string>> {
  const rows = await db.execute<{ facts: string }>(sql`
    SELECT facts FROM blog_draft WHERE status <> '버림'`);
  const s = new Set<string>();
  for (const r of rows) {
    const m = /차량:\s*([^\n,]+)/.exec(r.facts ?? "");
    if (m) s.add(m[1].trim());
  }
  return s;
}

/**
 * 이번 주 쓸 글 — 최대 `take` 개.
 * 🔴 한 화면에 서너 개면 충분하다. 열 개를 늘어놓으면 아무것도 안 고르시게 된다.
 */
export async function suggestTopics(take = 4): Promise<Topic[]> {
  const out: Topic[] = [];

  /* ① 밀린 사진 폴더 — 사진이 이미 있으니 가장 센 글감 */
  const folders = await db.execute<{
    id: number;
    label: string;
    is_pending: boolean;
    photo_count: number;
    quote_id: number | null;
    maker: string | null;
    model: string | null;
    has_tire: boolean;
    services: string | null;
  }>(sql`
    SELECT f.id, f.label, f.is_pending, f.photo_count, f.quote_id,
           COALESCE(mk.name_ko, v.maker_name) AS maker, v.model,
           EXISTS (SELECT 1 FROM quote_item qi WHERE qi.quote_id = f.quote_id AND qi.line_type = 'tire') AS has_tire,
           (SELECT STRING_AGG(qi.description, ' ') FROM quote_item qi
             WHERE qi.quote_id = f.quote_id AND qi.line_type IN ('service','custom')) AS services
    FROM blog_folder f
    LEFT JOIN vehicle v ON v.id = f.vehicle_id
    LEFT JOIN vehicle_maker mk ON mk.code = v.maker_code
    WHERE f.is_gone = false
      AND NOT EXISTS (SELECT 1 FROM blog_draft b WHERE b.folder_id = f.id AND b.status <> '버림')
    ORDER BY f.is_pending DESC, f.folder_mtime DESC NULLS LAST
    LIMIT 4`);

  for (const f of folders) {
    if (out.length >= take) break;
    const cat = inferCategory({
      maker: f.maker,
      model: f.model,
      hasTire: !!f.has_tire,
      services: (f.services ?? "").split(" ").filter(Boolean),
    });
    out.push({
      key: `folder-${f.id}`,
      kind: "밀린사진",
      title: `${f.label} — 사진 ${f.photo_count}장`,
      why: f.is_pending
        ? "아직 안 올리신 건입니다. 사진이 이미 있어 바로 쓸 수 있습니다."
        : "사진은 있는데 아직 원고가 없습니다.",
      category: cat,
      href: `/marketing/photos/${f.id}`,
    });
  }

  /* ② 원고도 폴더도 없는 최근 시공 */
  if (out.length < take) {
    const sales = await db.execute<{
      quote_id: number;
      car: string | null;
      work_date: string;
      maker: string | null;
      model: string | null;
      has_tire: boolean;
      services: string | null;
    }>(sql`
      SELECT q.id AS quote_id, q.work_date::text AS work_date,
             NULLIF(TRIM(CONCAT_WS(' ', COALESCE(mk.name_ko, v.maker_name), v.model)), '') AS car,
             COALESCE(mk.name_ko, v.maker_name) AS maker, v.model,
             EXISTS (SELECT 1 FROM quote_item qi WHERE qi.quote_id = q.id AND qi.line_type='tire') AS has_tire,
             (SELECT STRING_AGG(qi.description, ' ') FROM quote_item qi
               WHERE qi.quote_id = q.id AND qi.line_type IN ('service','custom')) AS services
      FROM quote q
      LEFT JOIN vehicle v ON v.id = q.vehicle_id
      LEFT JOIN vehicle_maker mk ON mk.code = v.maker_code
      WHERE q.status = '성사' AND q.supplier_name IS NULL
        AND COALESCE(q.payment_method,'') <> '서비스' AND q.total_amount > 0
        AND q.work_date >= (now() AT TIME ZONE 'Asia/Seoul')::date - 21
        AND NOT EXISTS (SELECT 1 FROM blog_draft b WHERE b.quote_id = q.id AND b.status <> '버림')
        AND NOT EXISTS (SELECT 1 FROM blog_folder f WHERE f.quote_id = q.id AND f.is_gone = false)
      ORDER BY q.work_date DESC, q.id DESC
      LIMIT 3`);

    for (const s of sales) {
      if (out.length >= take) break;
      out.push({
        key: `sale-${s.quote_id}`,
        kind: "안쓴시공",
        title: `${s.car ?? "차종 미상"} — ${s.work_date}`,
        why: "최근 시공인데 아직 글이 없습니다. 기억이 남아 있을 때 쓰시는 게 좋습니다.",
        category: inferCategory({
          maker: s.maker,
          model: s.model,
          hasTire: !!s.has_tire,
          services: (s.services ?? "").split(" ").filter(Boolean),
        }),
        href: "/marketing/write",
      });
    }
  }

  /* ③ 정보성 글감 — 시공이 없어도 쓸 수 있어 글감이 마르지 않는다 */
  if (out.length < take) {
    const stats = await modelStats(3, 10);
    const already = await writtenModels();
    for (const m of stats) {
      if (out.length >= take) break;
      const car = `${m.maker} ${m.model}`.trim();
      if ([...already].some((a) => a.includes(m.model))) continue;
      out.push({
        key: `info-${m.model}`,
        kind: "정보성",
        title: `${m.model} 타이어 규격 — 속초에서 실제로 나가는 사이즈`,
        why: `이 매장에서 ${m.model} ${m.builds}대에 시공했습니다. 남이 못 쓰는 근거이고, 시공이 없어도 쓸 수 있어 글감이 마르지 않습니다.`,
        category: "차종별 순정 제원",
        href: "/marketing/topics",
        material: [
          `차종: ${car}`,
          `이 매장 시공 건수: ${m.builds}건`,
          m.spec ? `가장 많이 나간 규격: ${m.spec}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      });
    }
  }

  /* ④ 계절 — 속초 특유의 각도 */
  if (out.length < take) {
    const month = Number(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(5, 7));
    const s = seasonTopic(month);
    if (s) {
      out.push({
        key: `season-${month}`,
        kind: "계절",
        title: s.title,
        why: s.why,
        category: "차량 관리팁",
        href: "/marketing/topics",
        material: `계절: ${month}월\n매장: 강원 속초 (미시령·한계령 고갯길, 설악산·해수욕장 관광객 많음)`,
      });
    }
  }

  return out.slice(0, take);
}
