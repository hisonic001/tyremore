"use server";

/**
 * 차대번호로 세대를 **제안**한다 — 우리 차로 배운 지도 (2026-09-04)
 *
 * 🔴 **해독이 아니라 제안이다.** 2026-09-04 에 실측으로 확인한 것:
 *    · 앞 9자리(제작사군+자동차특성군)로 세대를 맞히면 **처음 보는 차의 48%에만 답하고,
 *      답하면 97% 맞다.** 「94% 정확」이 아니다 — 절반은 아예 답을 못 한다.
 *    · 훈련 자료를 5배(31→148대) 늘려도 덮힘률이 32%→40% 였다. 앞자리가 트림·안전장치까지
 *      담아 조합이 너무 많아서, **더 모아도 크게 안 는다.**
 *    · 🔴 르노 SM5(2007~2014)와 SM6(2016~2019)가 **진짜로 같은 앞 9자리를 쓴다.**
 *      번호를 재사용한 것이라 자동 적용은 절대 안 된다.
 *
 * 그래서 규칙은 하나다 — **하나로 딱 떨어질 때만 제안하고, 사람이 확인해야 붙는다.**
 * 세대가 틀리면 다른 차의 휠너트 토크가 뜬다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { vinModelKey } from "@/lib/vin";

export interface VinGuess {
  variantKey: string;
  label: string;
  /** 이 앞자리를 쓰는 우리 차가 몇 대나 있었나 — 뒷받침이 두터울수록 믿을 만하다 */
  support: number;
  /** 제원이 실제로 들어와 있는 세대인가 */
  hasSpec: boolean;
}

/**
 * 앞 9자리가 같은 우리 차들이 **모두 한 세대**일 때만 제안한다.
 * 갈리면 null — 짐작하지 않는다.
 */
export async function guessGenerationByVin(vin: string): Promise<VinGuess | null> {
  const key = vinModelKey(vin);
  if (!key) return null;

  const rows = await db.execute<{
    variant_key: string;
    label: string;
    n: number;
    has_spec: boolean;
  }>(sql`
    SELECT g.variant_key, g.label, count(*)::int AS n,
           EXISTS (SELECT 1 FROM vehicle_spec s WHERE s.generation_id = g.id) AS has_spec
    FROM vehicle v
    JOIN vehicle_generation g ON g.id = v.generation_id
    WHERE v.is_active AND length(btrim(v.vin)) = 17
      AND upper(left(btrim(v.vin), ${key.length})) = ${key}
    GROUP BY g.id, g.variant_key, g.label
    ORDER BY n DESC
    LIMIT 5`);

  /* 🔴 두 세대 이상이면 답하지 않는다 (SM5/SM6 같은 경우) */
  if (rows.length !== 1) return null;
  const r = rows[0];
  return {
    variantKey: r.variant_key,
    label: r.label,
    support: Number(r.n),
    hasSpec: r.has_spec === true,
  };
}

/**
 * 적힌 세대코드가 차대번호와 어긋나는 차 — **오타 잡기**.
 * 실측으로 2건 나왔다: 2024 「포터2(HR)」가 실은 EV, 2017 「싼타페(TM)」가 실은 DM.
 * 🔴 고치지 않는다. 목록만 낸다 — 어느 쪽이 맞는지는 사람이 판단할 일이다.
 */
export interface VinMismatch {
  vehicleId: number;
  plateNo: string;
  model: string | null;
  year: number | null;
  labelled: string;
  /** 같은 앞자리를 쓰는 다른 차들의 세대 */
  siblings: string;
  siblingCars: number;
}

export async function findVinMismatches(): Promise<VinMismatch[]> {
  const rows = await db.execute<{
    id: number;
    plate_no: string;
    model: string | null;
    year: number | null;
    labelled: string;
    siblings: string;
    sibling_cars: number;
  }>(sql`
    WITH labelled AS (
      SELECT v.id, v.plate_no, v.model, v.year,
             upper(left(btrim(v.vin), 9)) AS k, g.variant_key
      FROM vehicle v JOIN vehicle_generation g ON g.id = v.generation_id
      WHERE v.is_active AND length(btrim(v.vin)) = 17
    ),
    mixed AS (
      SELECT k FROM labelled GROUP BY k HAVING count(DISTINCT variant_key) > 1
    )
    SELECT a.id, a.plate_no, a.model, a.year, a.variant_key AS labelled,
           (SELECT string_agg(DISTINCT b.variant_key, ', ')
              FROM labelled b WHERE b.k = a.k AND b.variant_key <> a.variant_key) AS siblings,
           (SELECT count(*)::int FROM labelled c WHERE c.k = a.k AND c.variant_key <> a.variant_key) AS sibling_cars
    FROM labelled a
    WHERE a.k IN (SELECT k FROM mixed)
    ORDER BY a.k, a.id
    LIMIT 100`);
  return rows.map((r) => ({
    vehicleId: Number(r.id),
    plateNo: r.plate_no,
    model: r.model,
    year: r.year === null ? null : Number(r.year),
    labelled: r.labelled,
    siblings: r.siblings ?? "",
    siblingCars: Number(r.sibling_cars ?? 0),
  }));
}
