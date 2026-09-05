"use server";

/**
 * 차종별 순정 제원 — 조회·검수 (D-04 3차 개정, 2026-09-03)
 *
 * 🔴 **틀리면 사람이 다치는 자료다.** 그래서 두 가지 규칙이 여기에 박혀 있다:
 *
 *   ① 승인 전에는 **위험 값의 숫자를 내보내지 않는다.** 휠너트 토크·엔진오일 용량은
 *      사장님이 원문과 나란히 보고 누르시기 전까지 화면에도 블로그에도 안 나간다.
 *      「검수 중」이라고만 보이고 숫자는 서버 응답에서 아예 빠진다.
 *   ② 승인은 **사람만** 한다. 표에도 `status <> '승인' OR verified_by IS NOT NULL` 로
 *      박아 두었다 — 프로그램이 스스로 승인 상태를 만들 수 없다.
 *
 * 🔴 질의는 순차로. (2026-08-11 풀 만석 사고 이후 Promise.all 안 쓴다)
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { bothUnits, specItem, type Risk } from "@/lib/spec-core";

function refresh() {
  for (const p of ["/settings/spec"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

/* ------------------------------------------------------------------ */
/* 목록                                                                */
/* ------------------------------------------------------------------ */

export interface SpecGenRow {
  variantKey: string;
  label: string;
  makerCode: string;
  manualUrl: string | null;
  cars: number;
  waiting: number;
  approved: number;
  /** 기계가 검산해 통과시킨 것 — 🔴 「사장님 확인」과 다르게 보여야 한다 */
  autoOk: number;
}

/** 어느 차종에 값이 얼마나 있고 몇 개가 검수를 기다리나 */
export async function listSpecGenerations(): Promise<SpecGenRow[]> {
  const rows = await db.execute<{
    variant_key: string;
    label: string;
    maker_code: string;
    manual_url: string | null;
    cars: number;
    waiting: number;
    approved: number;
    auto_ok: number;
  }>(sql`
    SELECT g.variant_key, g.label, m.maker_code, g.manual_url,
           (SELECT count(*)::int FROM vehicle v WHERE v.generation_id = g.id AND v.is_active) AS cars,
           count(*) FILTER (WHERE s.status = '검수대기')::int AS waiting,
           count(*) FILTER (WHERE s.status = '승인')::int     AS approved,
           count(*) FILTER (WHERE s.status = '자동확인')::int  AS auto_ok
    FROM vehicle_generation g
    JOIN vehicle_model m ON m.id = g.model_id
    JOIN vehicle_spec s  ON s.generation_id = g.id
    GROUP BY g.id, g.variant_key, g.label, m.maker_code, g.manual_url
    ORDER BY waiting DESC, cars DESC
    LIMIT 200`);
  return rows.map((r) => ({
    variantKey: r.variant_key,
    label: r.label,
    makerCode: r.maker_code,
    manualUrl: r.manual_url,
    cars: Number(r.cars),
    waiting: Number(r.waiting),
    approved: Number(r.approved),
    autoOk: Number(r.auto_ok),
  }));
}

/* ------------------------------------------------------------------ */
/* 검수 화면용 — 값과 원문을 나란히                                      */
/* ------------------------------------------------------------------ */

export interface SpecValueRow {
  id: number;
  item: string;
  label: string;
  /** 사람이 읽는 값 — 위험 값이 미승인이면 null 이다 (숫자를 아예 안 보낸다) */
  shown: string | null;
  hidden: boolean;
  risk: Risk;
  qualifier: string | null;
  groupNo: number;
  groupLabel: string | null;
  status: string;
  /** 원문에서 이 값이 나온 줄 (첫 번째 것 — 옛 화면 호환) */
  quote: string;
  /** 🔴 인용은 여럿일 수 있다 — 교차검증으로 두 번째 출처가 붙으면 늘어난다 */
  quotes: string[];
  sourceUrl: string;
  sourceTitle: string | null;
  fetchedOn: string;
  /** 🔴 출처도 여럿일 수 있다. 하나만 보여 주면 「두 곳에서 봤다」가 안 보인다 */
  sources: { url: string; title: string | null; fetchedOn: string }[];
  /** 자동 확인이라면 왜 통과했는지 — 사장님이 「왜 맞다고 됐지」 물으실 때 */
  autoNote: string | null;
}

export interface SpecReview {
  variantKey: string;
  label: string;
  manualUrl: string | null;
  note: string | null;
  cars: number;
  groups: { groupNo: number; groupLabel: string | null; rows: SpecValueRow[] }[];
}

/** 값 하나를 화면 글자로 — 🔴 미승인 위험 값은 숫자를 만들지 않는다 */
function shownValue(
  status: string,
  risk: Risk,
  numMin: string | null,
  numMax: string | null,
  unit: string | null,
  textValue: string | null,
): { shown: string | null; hidden: boolean } {
  /**
   * 🔴 위험 「높음」(휠너트 토크·엔진오일 용량)은 확인 전에는 숫자를 안 만든다.
   *    2026-09-05: 사장님이 「전부 자동으로」 정하셔서 **`자동확인` 도 열린다.**
   *    대신 화면이 「사장님 확인」과 **다른 배지**로 보여 주고,
   *    쓰기 전에 한 번 봐 달라는 말을 붙인다 — 값은 열되 출처는 숨기지 않는다.
   */
  if (risk === "높음" && status !== "승인" && status !== "자동확인") return { shown: null, hidden: true };
  if (textValue) return { shown: textValue, hidden: false };
  if (numMin === null || !unit) return { shown: null, hidden: false };
  return { shown: bothUnits(Number(numMin), numMax === null ? null : Number(numMax), unit), hidden: false };
}

export async function getSpecReview(variantKey: string): Promise<SpecReview | null> {
  const [gen] = await db.execute<{
    id: number;
    label: string;
    manual_url: string | null;
    note: string | null;
    cars: number;
  }>(sql`
    SELECT g.id, g.label, g.manual_url, g.note,
           (SELECT count(*)::int FROM vehicle v WHERE v.generation_id = g.id AND v.is_active) AS cars
    FROM vehicle_generation g WHERE g.variant_key = ${variantKey}`);
  if (!gen) return null;

  const rows = await db.execute<{
    id: number;
    item: string;
    group_no: number;
    group_label: string | null;
    qualifier: Record<string, string> | null;
    num_min: string | null;
    num_max: string | null;
    unit: string | null;
    text_value: string | null;
    status: string;
    risk: Risk;
    auto_note: string | null;
    quote: string;
    url: string;
    title: string | null;
    fetched_on: string;
  }>(sql`
    SELECT s.id, s.item, s.group_no, s.group_label, s.qualifier,
           s.num_min, s.num_max, s.unit, s.text_value, s.status, s.risk, s.auto_note,
           c.quote, src.url, src.title, to_char(src.fetched_on, 'YYYY-MM-DD') AS fetched_on
    FROM vehicle_spec s
    LEFT JOIN spec_citation c ON c.spec_id = s.id
    LEFT JOIN spec_source src ON src.id = c.source_id
    WHERE s.generation_id = ${gen.id} AND s.status <> '거절'
    ORDER BY s.group_no, s.id
    LIMIT 500`);

  const groups = new Map<number, { groupNo: number; groupLabel: string | null; rows: SpecValueRow[] }>();
  /**
   * 🔴 **값 하나에 인용이 여럿일 수 있다** (2026-09-05).
   *    지금까지는 값마다 인용이 하나뿐이라 안 드러났지만, 교차검증으로 두 번째 출처가
   *    붙는 순간 같은 값이 **두 줄로 뜨고** React key 가 겹친다.
   *    그래서 `s.id` 로 묶고, 출처는 그 값에 딸린 목록으로 모은다.
   */
  const seen = new Map<number, SpecValueRow>();
  for (const r of rows) {
    const already = seen.get(Number(r.id));
    if (already) {
      if (r.quote && !already.quotes.includes(r.quote)) already.quotes.push(r.quote);
      if (r.url && !already.sources.some((x) => x.url === r.url)) {
        already.sources.push({ url: r.url, title: r.title, fetchedOn: r.fetched_on ?? "" });
      }
      continue;
    }
    const def = specItem(r.item);
    const v = shownValue(r.status, r.risk, r.num_min, r.num_max, r.unit, r.text_value);
    const g = groups.get(r.group_no) ?? { groupNo: r.group_no, groupLabel: r.group_label, rows: [] };
    const made: SpecValueRow = {
      id: Number(r.id),
      item: r.item,
      label: def?.label ?? r.item,
      shown: v.shown,
      hidden: v.hidden,
      risk: r.risk,
      qualifier: r.qualifier ? Object.values(r.qualifier).join(" ") : null,
      groupNo: r.group_no,
      groupLabel: r.group_label,
      status: r.status,
      quote: r.quote ?? "",
      quotes: r.quote ? [r.quote] : [],
      sourceUrl: r.url ?? "",
      sourceTitle: r.title,
      fetchedOn: r.fetched_on ?? "",
      sources: r.url ? [{ url: r.url, title: r.title, fetchedOn: r.fetched_on ?? "" }] : [],
      autoNote: r.auto_note ?? null,
    };
    g.rows.push(made);
    seen.set(Number(r.id), made);
    groups.set(r.group_no, g);
  }

  return {
    variantKey,
    label: gen.label,
    manualUrl: gen.manual_url,
    note: gen.note,
    cars: Number(gen.cars),
    groups: [...groups.values()],
  };
}

/* ------------------------------------------------------------------ */
/* 검수                                                                */
/* ------------------------------------------------------------------ */

async function guard(): Promise<{ ok: true; uid: number } | { ok: false; error: string }> {
  if (!(await hasPerm("master"))) {
    return { ok: false, error: "제원 검수 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  }
  const s = await getSession();
  if (!s?.uid) return { ok: false, error: "다시 로그인해 주세요" };
  return { ok: true, uid: s.uid };
}

export type SpecResult = { ok: true; n: number } | { ok: false; error: string };

/**
 * 🔴 승인 — **사람이 원문과 나란히 보고 누른 것**만 여기로 온다.
 *    프로그램이 스스로 부르는 자리가 없어야 한다. 부르는 곳은 검수 화면 하나뿐이다.
 */
export async function approveSpecs(ids: number[]): Promise<SpecResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!ids.length) return { ok: true, n: 0 };
  const clean = ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  if (!clean.length) return { ok: true, n: 0 };
  const done = await db.execute<{ id: number }>(sql`
    UPDATE vehicle_spec
       SET status = '승인', verified_by = ${g.uid}, verified_at = now(), updated_at = now()
     WHERE id IN ${sql.raw(`(${clean.join(",")})`)} AND status IN ('검수대기','자동확인')
    RETURNING id`);
  refresh();
  return { ok: true, n: done.length };
}

/** 아니다 싶은 값 — 지우지 않고 「거절」로 둔다 (지우면 왜 뺐는지 남지 않는다) */
export async function rejectSpecs(ids: number[], note?: string): Promise<SpecResult> {
  const g = await guard();
  if (!g.ok) return g;
  const clean = ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  if (!clean.length) return { ok: true, n: 0 };
  const done = await db.execute<{ id: number }>(sql`
    UPDATE vehicle_spec
       SET status = '거절', verify_note = ${note ?? null}, verified_by = ${g.uid},
           verified_at = now(), updated_at = now()
     WHERE id IN ${sql.raw(`(${clean.join(",")})`)} AND status <> '승인'
    RETURNING id`);
  refresh();
  return { ok: true, n: done.length };
}

/* ------------------------------------------------------------------ */
/* 차량 화면에서 쓰기                                                   */
/* ------------------------------------------------------------------ */

export interface VehicleSpecBlock {
  /** 부품 잇기(lib/parts-fit)가 이 번호를 쓴다 */
  generationId: number;
  label: string;
  variantKey: string;
  manualUrl: string | null;
  /** 승인된 값만. 인치별로 한 벌씩 */
  groups: { groupLabel: string | null; rows: { label: string; shown: string; qualifier: string | null }[] }[];
  waiting: number;
}

/**
 * 세대 하나의 제원 — 정비 조회 화면용 (2026-09-04)
 *
 * 🔴 `confirmed` 는 **「이 차가 이 세대가 맞다」를 사람이 확인했는가**다.
 *    차대번호로 「제안」만 된 상태에서는 위험 값(휠너트 토크·엔진오일 용량)의 숫자를
 *    내보내지 않는다 — 세대를 잘못 짚으면 **다른 차의 토크가 뜬다.**
 *    승인된 값이라도 「어느 차의 값인지」가 안 정해졌으면 위험한 건 마찬가지다.
 */
export async function specsForGeneration(
  variantKey: string,
  opts?: { confirmed?: boolean },
): Promise<VehicleSpecBlock | null> {
  const [gen] = await db.execute<{ id: number; label: string; manual_url: string | null }>(sql`
    SELECT id, label, manual_url FROM vehicle_generation WHERE variant_key = ${variantKey}`);
  if (!gen) return null;

  const rows = await db.execute<{
    item: string;
    group_no: number;
    group_label: string | null;
    qualifier: Record<string, string> | null;
    num_min: string | null;
    num_max: string | null;
    unit: string | null;
    text_value: string | null;
    risk: Risk;
  }>(sql`
    SELECT item, group_no, group_label, qualifier, num_min, num_max, unit, text_value, risk
    FROM vehicle_spec
    WHERE generation_id = ${gen.id} AND status = '승인'
    ORDER BY group_no, id
    LIMIT 300`);

  const [w] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM vehicle_spec WHERE generation_id = ${gen.id} AND status = '검수대기'`);

  const groups = new Map<
    number,
    { groupLabel: string | null; rows: { label: string; shown: string; qualifier: string | null }[] }
  >();
  for (const r of rows) {
    const def = specItem(r.item);
    /* 🔴 세대가 아직 확인 안 됐으면 위험 값은 숫자를 만들지 않는다 */
    const hide = r.risk === "높음" && !opts?.confirmed;
    const shown = hide
      ? "차종을 확인하시면 보여드립니다"
      : r.text_value
        ? r.text_value
        : r.num_min !== null && r.unit
          ? bothUnits(Number(r.num_min), r.num_max === null ? null : Number(r.num_max), r.unit)
          : null;
    if (!shown) continue;
    const g = groups.get(r.group_no) ?? { groupLabel: r.group_label, rows: [] };
    g.rows.push({
      label: def?.label ?? r.item,
      shown,
      qualifier: r.qualifier ? Object.values(r.qualifier).join(" ") : null,
    });
    groups.set(r.group_no, g);
  }

  return {
    generationId: Number(gen.id),
    label: gen.label,
    variantKey,
    manualUrl: gen.manual_url,
    groups: [...groups.values()],
    waiting: Number(w?.n ?? 0),
  };
}

/**
 * ⭐ 차량의 세대 확정 (2026-09-05, /carinfo 도입 2단계 — 세대 미상이면 제원이 안 보인다)
 *
 *   차량 상세에서 사장님이 세대를 골라 확정하면 그 차에 제원·부품이 붙기 시작한다.
 * 🔴 이 차 한 대에만 적는다 — 「쏘렌토」라는 글자 전체에 세대를 학습시키지 않는다
 *    (같은 글자의 다른 세대 차가 잘못 물든다). 괄호코드 학습은 seed 스크립트 몫.
 */
export async function confirmVehicleGeneration(
  vehicleId: number,
  variantKey: string,
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  if (!(await hasPerm("sale_edit"))) return { ok: false, error: "권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const [gen] = await db.execute<{ id: number; label: string }>(sql`
    SELECT id, label FROM vehicle_generation WHERE variant_key = ${variantKey}`);
  if (!gen) return { ok: false, error: "그 세대를 찾을 수 없습니다" };
  const done = await db.execute<{ id: number }>(sql`
    UPDATE vehicle SET generation_id = ${Number(gen.id)} WHERE id = ${vehicleId} RETURNING id`);
  if (done.length === 0) return { ok: false, error: "차량을 찾을 수 없습니다" };
  try {
    revalidatePath(`/vehicle/${vehicleId}`);
  } catch {
    /* 요청 밖 */
  }
  return { ok: true, label: gen.label };
}

/**
 * 그 차의 제원 — 🔴 **승인된 값만** 내보낸다.
 *    세대를 모르는 차(그냥 「쏘렌토」)는 null 이다. 비슷한 차의 값을 빌려 오지 않는다.
 */
export async function specsForVehicle(vehicleId: number): Promise<VehicleSpecBlock | null> {
  const [gen] = await db.execute<{
    id: number;
    variant_key: string;
    label: string;
    manual_url: string | null;
  }>(sql`
    SELECT g.id, g.variant_key, g.label, g.manual_url
    FROM vehicle v JOIN vehicle_generation g ON g.id = v.generation_id
    WHERE v.id = ${vehicleId}`);
  if (!gen) return null;

  const rows = await db.execute<{
    item: string;
    group_no: number;
    group_label: string | null;
    qualifier: Record<string, string> | null;
    num_min: string | null;
    num_max: string | null;
    unit: string | null;
    text_value: string | null;
  }>(sql`
    SELECT item, group_no, group_label, qualifier, num_min, num_max, unit, text_value
    FROM vehicle_spec
    WHERE generation_id = ${gen.id} AND status = '승인'
    ORDER BY group_no, id
    LIMIT 300`);

  const [w] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM vehicle_spec WHERE generation_id = ${gen.id} AND status = '검수대기'`);

  const groups = new Map<number, { groupLabel: string | null; rows: { label: string; shown: string; qualifier: string | null }[] }>();
  for (const r of rows) {
    const def = specItem(r.item);
    const shown = r.text_value
      ? r.text_value
      : r.num_min !== null && r.unit
        ? bothUnits(Number(r.num_min), r.num_max === null ? null : Number(r.num_max), r.unit)
        : null;
    if (!shown) continue;
    const g = groups.get(r.group_no) ?? { groupLabel: r.group_label, rows: [] };
    g.rows.push({
      label: def?.label ?? r.item,
      shown,
      qualifier: r.qualifier ? Object.values(r.qualifier).join(" ") : null,
    });
    groups.set(r.group_no, g);
  }

  return {
    generationId: Number(gen.id),
    label: gen.label,
    variantKey: gen.variant_key,
    manualUrl: gen.manual_url,
    groups: [...groups.values()],
    waiting: Number(w?.n ?? 0),
  };
}
