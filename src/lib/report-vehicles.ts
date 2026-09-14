/**
 * ⭐ 차량 리포트 자료 — `/reports/vehicles` (2026-09-14 사장님 요청)
 *
 *   보는 것: ① 제조사·차종 순위 ② 타이어 규격·인치 분포 ③ 연식·주행거리·연료·차체
 *
 * 모집단 = 「다녀간 차」: 보고 있는 달까지 최근 12개월 안에 성사 판매가 있는 차량.
 * 🔴 질의는 **고정 7개, 하나씩 차례로** — 접속 자리 3개 (D-30).
 * 🔴 규격·인치는 ITEM_DATA_START(2026-08-01)부터 — 그 전 판매는 품목 기록이 없다.
 * 🔴 연료·차체는 기록이 있는 차만 센다 — 비율을 꾸미지 않고 「몇 대 중」을 같이 돌려준다.
 *
 * 제조사: vehicle.maker_code → 없으면 vehicle_maker_alias(MARS 원문 표기) →
 *         없으면 「현대자동차」→「현대」처럼 이름으로. 그래도 못 맞추면 원문 그대로.
 * 차종:   vehicle_model_alias → vehicle_model.name_ko, 없으면 원문에서 괄호 세대코드를 떼고.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monthRange, ymAdd, kstToday } from "./ym";
import {
  AGE_BUCKETS,
  FUEL_FROM_MARS,
  FUEL_FROM_POWERTRAIN,
  ITEM_DATA_START,
  KM_BUCKETS,
  asOfDate,
  type Who,
} from "./report-cv-pure";
import { bucketCols, bucketVals, saleDate, whoSql } from "./report-cv-sql";
import { SPEC_SQL } from "./spec-sql";

const UNKNOWN = "모름";

export interface NamedCount {
  name: string;
  n: number;
}

export interface VehicleReport {
  ym: string;
  asOf: string;
  winStart: string;
  summary: {
    vehicles: number;
    thisMonth: number;
    firstThisMonth: number;
    domestic: number;
    imported: number;
    avgAge: number | null;
    withYear: number;
    avgKm: number | null;
    withKm: number;
    ages: number[];
    kms: number[];
  };
  makers: NamedCount[];
  models: NamedCount[];
  /** 제조사·차종을 모르는 차 (순위에서 뺀 대수) */
  unknownMaker: number;
  unknownModel: number;
  fuels: NamedCount[];
  bodies: NamedCount[];
  /** 규격 집계 기간 — 보고 있는 달이 8월 전이면 null */
  tireFrom: string | null;
  rims: { rim: number; qty: number }[];
  specs: NamedCount[];
}

export async function vehicleReportData(ym: string, who: Who): Promise<VehicleReport> {
  const { start, nextStart } = monthRange(ym);
  const winStart = `${ymAdd(ym, -11)}-01`;
  const asOf = asOfDate(ym, kstToday());
  const asOfYear = Number(asOf.slice(0, 4));
  const D = saleDate("q");

  /** 다녀간 차 + 그 차의 정규화된 제조사·차종·연료·차체 */
  const seen = sql`
    WITH h AS (
      SELECT q.vehicle_id,
             min(${D}) fd,
             max(${D}) ld,
             bool_or(${D} >= ${start}::date) tm
      FROM quote q
      WHERE q.status = '성사' AND q.vehicle_id IS NOT NULL AND ${whoSql(who, "q")}
        AND ${D} < ${nextStart}::date
      GROUP BY 1
    ),
    sv AS (
      SELECT h.fd, h.tm, v.year, v.mileage,
             COALESCE(m.name_ko, m2.name_ko, NULLIF(trim(v.maker_name), ''), ${UNKNOWN}) maker,
             COALESCE(m.is_imported, m2.is_imported) imported,
             COALESCE(vm.name_ko, NULLIF(trim(regexp_replace(v.model, '\\s*[\\(\\[].*$', '')), ''), ${UNKNOWN}) model,
             COALESCE(
               ${sql.raw(caseMap("v.fuel_type", FUEL_FROM_MARS))},
               ${sql.raw(caseMap("g.powertrain", FUEL_FROM_POWERTRAIN))}
             ) fuel,
             COALESCE(NULLIF(v.body_type, ''), g.body_type) body
      FROM h
      JOIN vehicle v ON v.id = h.vehicle_id
      LEFT JOIN vehicle_maker_alias ma ON ma.raw_name = v.maker_name
      LEFT JOIN vehicle_maker m ON m.code = COALESCE(v.maker_code, ma.code)
      LEFT JOIN vehicle_maker m2 ON m.code IS NULL
        AND m2.name_ko = regexp_replace(trim(v.maker_name), '\\s*자동차$', '')
      LEFT JOIN vehicle_model_alias mda ON mda.raw_model = v.model
      LEFT JOIN vehicle_model vm ON vm.id = mda.model_id
      LEFT JOIN vehicle_generation g ON g.id = COALESCE(v.generation_id, mda.generation_id)
      WHERE h.ld >= ${winStart}::date
    )`;

  const age = sql`(${asOfYear} - year)`;

  // ① 요약 + 연식·주행거리 구간
  const sumRows = await db.execute<Record<string, unknown>>(sql`
    ${seen}
    SELECT count(*)::int vehicles,
           count(*) FILTER (WHERE tm)::int this_month,
           count(*) FILTER (WHERE fd >= ${start}::date)::int first_this_month,
           count(*) FILTER (WHERE imported = false)::int domestic,
           count(*) FILTER (WHERE imported = true)::int imported,
           avg(${age}) FILTER (WHERE year IS NOT NULL)::float avg_age,
           count(year)::int with_year,
           avg(mileage) FILTER (WHERE mileage > 0)::float avg_km,
           count(*) FILTER (WHERE mileage > 0)::int with_km
    FROM sv`);
  const bucketRows = await db.execute<Record<string, unknown>>(sql`
    ${seen}
    SELECT ${bucketCols(sql`(CASE WHEN year IS NULL THEN NULL ELSE ${age} END)`, AGE_BUCKETS, "a")},
           ${bucketCols(sql`(CASE WHEN mileage > 0 THEN mileage END)`, KM_BUCKETS, "k")}
    FROM sv`);

  // ② 제조사 · ③ 차종 · ④ 연료 · ⑤ 차체 — 한 질의로 묶어 고정 개수를 지킨다
  const groupRows = await db.execute<{ kind: string; name: string; n: number }>(sql`
    ${seen}
    SELECT kind, name, n FROM (
      SELECT 'maker' kind, maker name, count(*)::int n FROM sv GROUP BY maker
      UNION ALL
      SELECT 'model', model, count(*)::int FROM sv GROUP BY model
      UNION ALL
      SELECT 'fuel', fuel, count(*)::int FROM sv WHERE fuel IS NOT NULL GROUP BY fuel
      UNION ALL
      SELECT 'body', body, count(*)::int FROM sv WHERE body IS NOT NULL GROUP BY body
    ) t
    ORDER BY kind, n DESC, name`);

  // ⑥ 타이어 규격·인치 — 8월부터, 보고 있는 달까지 누적
  const tireFrom = nextStart > ITEM_DATA_START ? (winStart > ITEM_DATA_START ? winStart : ITEM_DATA_START) : null;
  let rims: { rim: number; qty: number }[] = [];
  let specs: NamedCount[] = [];
  if (tireFrom) {
    const tireWhere = sql`
      FROM quote_item qi
      JOIN quote q ON q.id = qi.quote_id
      JOIN product p ON p.id = qi.product_id
      WHERE q.status = '성사' AND qi.line_type = 'tire' AND qi.qty > 0 AND ${whoSql(who, "q")}
        AND ${D} >= ${tireFrom}::date AND ${D} < ${nextStart}::date`;
    const rimRows = await db.execute<{ rim: string; qty: number }>(sql`
      SELECT p.rim_inch::text rim, SUM(qi.qty)::int qty ${tireWhere} AND p.rim_inch IS NOT NULL
      GROUP BY p.rim_inch ORDER BY p.rim_inch`);
    const specRows = await db.execute<{ name: string; qty: number }>(sql`
      SELECT ${SPEC_SQL} name, SUM(qi.qty)::int qty ${tireWhere} AND p.width IS NOT NULL AND p.rim_inch IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`);
    rims = rimRows.map((r) => ({ rim: Number(r.rim), qty: Number(r.qty) }));
    specs = specRows.map((r) => ({ name: r.name, n: Number(r.qty) }));
  }

  const s = sumRows[0];
  const b = bucketRows[0];
  /** 순위에는 「모름」을 넣지 않는다 — 대수는 따로 돌려준다 */
  const pick = (kind: string, limit: number) =>
    groupRows
      .filter((r) => r.kind === kind && r.name !== UNKNOWN)
      .slice(0, limit)
      .map((r) => ({ name: r.name, n: Number(r.n) }));
  const unknownOf = (kind: string) => Number(groupRows.find((r) => r.kind === kind && r.name === UNKNOWN)?.n ?? 0);
  const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  return {
    ym,
    asOf,
    winStart,
    summary: {
      vehicles: Number(s?.vehicles ?? 0),
      thisMonth: Number(s?.this_month ?? 0),
      firstThisMonth: Number(s?.first_this_month ?? 0),
      domestic: Number(s?.domestic ?? 0),
      imported: Number(s?.imported ?? 0),
      avgAge: numOrNull(s?.avg_age),
      withYear: Number(s?.with_year ?? 0),
      avgKm: numOrNull(s?.avg_km),
      withKm: Number(s?.with_km ?? 0),
      ages: bucketVals(b, AGE_BUCKETS, "a"),
      kms: bucketVals(b, KM_BUCKETS, "k"),
    },
    makers: pick("maker", 10),
    models: pick("model", 15),
    unknownMaker: unknownOf("maker"),
    unknownModel: unknownOf("model"),
    fuels: pick("fuel", 10),
    bodies: pick("body", 10),
    tireFrom,
    rims,
    specs,
  };
}

/** 표기 매핑표 → SQL CASE (값은 우리 상수라 raw 로 넣어도 안전 — 따옴표만 막는다) */
function caseMap(col: string, map: Record<string, string>): string {
  const esc = (s: string) => s.replace(/'/g, "''");
  const whens = Object.entries(map)
    .map(([k, v]) => `WHEN '${esc(k)}' THEN '${esc(v)}'`)
    .join(" ");
  return `(CASE ${col} ${whens} END)`;
}
