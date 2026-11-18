/**
 * ⭐ 타이어 보관 — 읽기 정본 (D-42, 2026-11-17)
 *
 *   목록·검색·상세·차량 화면·스티커·연락 명단이 같은 SELECT 를 쓴다.
 *   🔴 "use server" 아님 — 화면(서버 컴포넌트)·라우트가 권한을 본 뒤 부른다.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { findVehicles, guessMode } from "./search";
import { parseSpecQuery } from "./tire-spec";
import { isPlaceholderCustomerName, isPlaceholderPhone } from "./normalize";
import { describeSet, parseStorageNoQuery, STORAGE_FEE_SERVICE_NO, type ContactRow, type StorageStatus } from "./tire-storage-pure";
import { locationText } from "./storage-plan-pure";

export interface StorageRow {
  id: number;
  no: number | null;
  status: StorageStatus;
  kind: string | null;
  brand: string | null;
  size: string | null;
  qty: number;
  dot: string | null;
  memo: string | null;
  storedOn: string;
  releasedOn: string | null;
  releaseNote: string | null;
  customerId: number;
  customerName: string;
  supplierName: string | null;
  phone: string | null;
  vehicleId: number | null;
  plateNo: string | null;
  model: string | null;
  /** 이 차에 지난번 끼운 규격 — 「규격 바로 고르기」 */
  lastFittedSize: string | null;
  sourceText: string | null;
  storedQuoteId: number | null;
  releasedQuoteId: number | null;
  origin: string;
  /** ⭐ 위치 (2026-11-18 3차) — 구역 › 자리 › 더미. 자리 이름은 도면에서 읽는다(이름 바꾸면 어디서나 바뀜) */
  areaId: number | null;
  areaName: string | null;
  slotId: string | null;
  slotLabel: string | null;
  stackNo: number | null;
  /** 「흰색 창고 › 안쪽 2」 · 「위치 없음」 (더미는 2026-11-18 화면에서 뺐다) */
  location: string;
  /** 스티커·목록에 쓰는 「주인 이름」 — 거래처 차량이면 거래처 이름 */
  ownerName: string;
  describe: string;
}

type Raw = {
  id: number;
  storage_no: number | null;
  status: StorageStatus;
  kind: string | null;
  brand: string | null;
  size: string | null;
  qty: number;
  dot: string | null;
  memo: string | null;
  stored_on: string;
  released_on: string | null;
  release_note: string | null;
  customer_id: number;
  customer_name: string;
  supplier_name: string | null;
  phone: string | null;
  vehicle_id: number | null;
  plate_no: string | null;
  model: string | null;
  last_fitted_size: string | null;
  source_text: string | null;
  stored_quote_id: number | null;
  released_quote_id: number | null;
  origin: string;
  area_id: number | null;
  area_name: string | null;
  slot_id: string | null;
  slot_label: string | null;
  stack_no: number | null;
};

const BASE = sql`
  SELECT s.id, s.storage_no, s.status, s.kind, s.brand, s.size, s.qty, s.dot, s.memo,
         to_char(s.stored_on, 'YYYY-MM-DD') stored_on, to_char(s.released_on, 'YYYY-MM-DD') released_on, s.release_note,
         s.customer_id, c.name customer_name, c.supplier_name, c.phone,
         s.vehicle_id, v.plate_no, v.model, v.last_fitted_size, s.source_text, s.stored_quote_id, s.released_quote_id,
         s.origin, s.area_id, a.name AS area_name, s.slot_id, s.stack_no,
         -- 자리 이름은 도면에서 (비면 「칸」, 지워졌으면 「지워진 자리」 — 화면 정본은 storage-plan-pure.slotLabel)
         CASE WHEN s.slot_id IS NULL THEN NULL
              ELSE COALESCE((SELECT NULLIF(btrim(e->>'label'), '') FROM jsonb_array_elements(a.plan->'shapes') e
                             WHERE e->>'id' = s.slot_id AND e->>'kind' = 'block' LIMIT 1),
                            CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(a.plan->'shapes') e WHERE e->>'id' = s.slot_id)
                                 THEN '칸' ELSE '지워진 자리' END) END AS slot_label
  FROM tire_storage s
  JOIN customer c ON c.id = s.customer_id
  LEFT JOIN vehicle v ON v.id = s.vehicle_id
  LEFT JOIN storage_area a ON a.id = s.area_id`;

function toRow(r: Raw): StorageRow {
  const qty = Number(r.qty);
  return {
    id: Number(r.id),
    no: r.storage_no == null ? null : Number(r.storage_no),
    status: r.status,
    kind: r.kind,
    brand: r.brand,
    size: r.size,
    qty,
    dot: r.dot,
    memo: r.memo,
    storedOn: r.stored_on,
    releasedOn: r.released_on,
    releaseNote: r.release_note,
    customerId: Number(r.customer_id),
    customerName: r.customer_name,
    supplierName: r.supplier_name,
    phone: r.phone,
    vehicleId: r.vehicle_id == null ? null : Number(r.vehicle_id),
    plateNo: r.plate_no,
    model: r.model,
    lastFittedSize: r.last_fitted_size,
    sourceText: r.source_text,
    storedQuoteId: r.stored_quote_id == null ? null : Number(r.stored_quote_id),
    releasedQuoteId: r.released_quote_id == null ? null : Number(r.released_quote_id),
    origin: r.origin,
    areaId: r.area_id == null ? null : Number(r.area_id),
    areaName: r.area_name,
    slotId: r.slot_id,
    slotLabel: r.slot_label,
    stackNo: r.stack_no == null ? null : Number(r.stack_no),
    location: locationText({ areaName: r.area_name, slotLabel: r.slot_label, stackNo: r.stack_no == null ? null : Number(r.stack_no) }),
    ownerName: r.supplier_name ?? r.customer_name,
    describe: describeSet({ brand: r.brand, kind: r.kind, size: r.size, qty }),
  };
}

export type StorageView = "보관중" | "지난" | "확인대기" | "위치없음";


const VIEW_WHERE: Record<StorageView, SQL> = {
  보관중: sql`s.status = '보관중'`,
  지난: sql`s.status IN ('찾아감','폐기','제외')`,
  확인대기: sql`s.status = '확인대기'`,
  위치없음: sql`s.status = '보관중' AND s.area_id IS NULL`,
};

const LIMIT = 300;

/**
 * 목록 + 검색. 검색어는 홈 검색과 같은 규칙(번호판·끝 4자리·전화·이름) + 보관번호 + 규격.
 * 4자리 숫자는 번호판 끝일 수도, 보관번호일 수도 있다 — 둘 다 보여 준다.
 */
export async function listStorage(o: { q?: string; view: StorageView }): Promise<{ rows: StorageRow[]; more: boolean }> {
  const q = (o.q ?? "").trim();
  const conds: SQL[] = [VIEW_WHERE[o.view]];
  if (q) {
    const any: SQL[] = [];
    const no = parseStorageNoQuery(q);
    if (no != null) any.push(sql`s.storage_no = ${no}`);
    const spec = guessMode(q) === "product" ? parseSpecQuery(q) : null;
    if (spec) {
      const digits = `${spec.width}${spec.aspectRatio ?? ""}${String(spec.rimInch).replace(".", "")}`;
      any.push(sql`regexp_replace(COALESCE(s.size, ''), '[^0-9]', '', 'g') LIKE ${"%" + digits + "%"}`);
    } else if (!/^#/.test(q)) {
      const hits = await findVehicles(q);
      const vIds = [...new Set(hits.map((h) => h.vehicleId))];
      const cIds = [...new Set(hits.map((h) => h.customerId))];
      if (vIds.length) any.push(sql`s.vehicle_id IN (${sql.join(vIds.map((v) => sql`${v}`), sql`, `)})`);
      if (cIds.length) any.push(sql`s.customer_id IN (${sql.join(cIds.map((c) => sql`${c}`), sql`, `)})`);
      any.push(sql`(c.supplier_name ILIKE ${"%" + q + "%"} OR s.brand ILIKE ${"%" + q + "%"})`);
    }
    if (!any.length) return { rows: [], more: false };
    conds.push(sql`(${sql.join(any, sql` OR `)})`);
  }
  const order =
    o.view === "지난"
      ? sql`s.released_on DESC NULLS LAST, s.id DESC`
      : o.view === "확인대기"
        ? sql`s.stored_on, s.id`
        : o.view === "위치없음"
          ? sql`s.storage_no`
          : sql`s.storage_no DESC`;
  const raw = await db.execute<Raw>(sql`${BASE} WHERE ${sql.join(conds, sql` AND `)} ORDER BY ${order} LIMIT ${LIMIT + 1}`);
  return { rows: raw.slice(0, LIMIT).map(toRow), more: raw.length > LIMIT };
}

export async function storageCounts(): Promise<Record<StorageStatus, number>> {
  const rows = await db.execute<{ status: StorageStatus; n: number }>(sql`SELECT status, count(*)::int n FROM tire_storage GROUP BY 1`);
  const out = { 확인대기: 0, 보관중: 0, 찾아감: 0, 폐기: 0, 제외: 0 } as Record<StorageStatus, number>;
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

export interface StorageDetail extends StorageRow {
  storedQuote: { no: string; workDate: string; fee: boolean } | null;
  releasedQuote: { no: string; workDate: string; fee: boolean } | null;
  createdByName: string | null;
  releasedByName: string | null;
  /** 같은 손님의 다른 세트(거래처 차고 손님이면 같은 차량만) */
  others: StorageRow[];
}

export async function storageDetail(id: number): Promise<StorageDetail | null> {
  const [r] = await db.execute<Raw>(sql`${BASE} WHERE s.id = ${id}`);
  if (!r) return null;
  const row = toRow(r);
  const [extra] = await db.execute<{ created_by_name: string | null; released_by_name: string | null }>(sql`
    SELECT (SELECT name FROM app_user u WHERE u.id = s.created_by) created_by_name,
           (SELECT name FROM app_user u WHERE u.id = s.released_by) released_by_name
    FROM tire_storage s WHERE s.id = ${id}`);
  const quoteInfo = async (qid: number | null) => {
    if (qid == null) return null;
    const [q] = await db.execute<{ quote_no: string; work_date: string; fee: boolean }>(sql`
      SELECT q.quote_no, to_char(q.work_date, 'YYYY-MM-DD') work_date,
             EXISTS (SELECT 1 FROM quote_item qi JOIN service_item si ON si.id = qi.service_item_id
                     WHERE qi.quote_id = q.id AND si.mars_service_no = ${STORAGE_FEE_SERVICE_NO}) fee
      FROM quote q WHERE q.id = ${qid}`);
    return q ? { no: q.quote_no, workDate: q.work_date, fee: !!q.fee } : null;
  };
  const storedQuote = await quoteInfo(row.storedQuoteId);
  const releasedQuote = await quoteInfo(row.releasedQuoteId);
  const others = (
    await db.execute<Raw>(sql`${BASE}
      WHERE s.id <> ${id} AND s.status IN ('보관중','찾아감','폐기')
        AND (${row.supplierName == null ? sql`s.customer_id = ${row.customerId}` : sql`s.vehicle_id = ${row.vehicleId ?? 0}`})
      ORDER BY s.stored_on DESC LIMIT 10`)
  ).map(toRow);
  return {
    ...row,
    storedQuote,
    releasedQuote,
    createdByName: extra?.created_by_name ?? null,
    releasedByName: extra?.released_by_name ?? null,
    others,
  };
}

/**
 * 차량 화면·판매 화면 — 이 차(또는 이 손님)의 보관 세트.
 * 거래처 차고 손님은 차가 여러 대라 손님으로 넓히지 않는다(남의 차 세트가 뜬다).
 */
export async function storageForVehicle(vehicleId: number | null, customerId: number | null, withPast = false, withCandidates = false): Promise<StorageRow[]> {
  if (vehicleId == null && customerId == null) return [];
  const who = sql`(s.vehicle_id = ${vehicleId ?? 0} OR (s.customer_id = ${customerId ?? 0} AND c.supplier_name IS NULL))`;
  const status = withPast
    ? sql`s.status IN ('보관중','확인대기','찾아감','폐기')`
    : withCandidates
      ? sql`s.status IN ('보관중','확인대기')`
      : sql`s.status = '보관중'`;
  const raw = await db.execute<Raw>(sql`${BASE} WHERE ${who} AND ${status}
    ORDER BY (s.status = '보관중') DESC, s.stored_on DESC LIMIT 12`);
  return raw.map(toRow);
}

/** 스티커 — 번호 범위로 (보관중만) */
export async function labelRowsByRange(from: number, to: number): Promise<StorageRow[]> {
  const lo = Math.max(1, Math.min(from, to));
  const hi = Math.min(lo + 400, Math.max(from, to));
  const raw = await db.execute<Raw>(sql`${BASE}
    WHERE s.status = '보관중' AND s.storage_no BETWEEN ${lo} AND ${hi} ORDER BY s.storage_no`);
  return raw.map(toRow);
}

/** 스티커 — 번호가 있는 것만 */
export async function labelRows(ids: number[]): Promise<StorageRow[]> {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
  if (!clean.length) return [];
  const raw = await db.execute<Raw>(sql`${BASE}
    WHERE s.id IN (${sql.join(clean.map((n) => sql`${n}`), sql`, `)}) AND s.storage_no IS NOT NULL
    ORDER BY s.storage_no`);
  return raw.map(toRow);
}

/**
 * 연락 명단 재료 — 보관중 세트 전부. 자리표시 손님·더미 전화는 뺀다(normalize.ts 정본).
 */
export async function contactRows(): Promise<ContactRow[]> {
  const raw = await db.execute<Raw & { consent_marketing: boolean | null }>(sql`
    SELECT x.*, c2.consent_marketing FROM (${BASE} WHERE s.status = '보관중') x
    JOIN customer c2 ON c2.id = x.customer_id`);
  return raw
    .filter((r) => !isPlaceholderCustomerName(r.customer_name))
    .map((r) => {
      const row = toRow(r);
      return {
        storageNo: row.no,
        kind: row.kind,
        customerId: row.customerId,
        customerName: row.customerName,
        supplierName: row.supplierName,
        phone: row.phone && !isPlaceholderPhone(row.phone) ? row.phone : null,
        plateNo: row.plateNo,
        storedOn: row.storedOn,
        describe: row.describe,
        consentMarketing: r.consent_marketing,
      };
    });
}

/** 정비 내역 카드 — 이 판매로 맡긴 세트 · 이 판매로 찾아간 세트 */
export async function storageForSale(quoteId: number): Promise<{ stored: StorageRow[]; released: StorageRow[] }> {
  const raw = await db.execute<Raw>(sql`${BASE}
    WHERE (s.stored_quote_id = ${quoteId} OR s.released_quote_id = ${quoteId}) AND s.status <> '제외'
    ORDER BY s.storage_no`);
  const rows = raw.map(toRow);
  return { stored: rows.filter((r) => r.storedQuoteId === quoteId), released: rows.filter((r) => r.releasedQuoteId === quoteId) };
}

/* ------------------------------------------------------------------
 * ⭐ 구역 도면 · 점 (2026-11-18)
 * ---------------------------------------------------------------- */

export interface AreaInfo {
  id: number;
  name: string;
  isSite: boolean;
  plan: unknown;
  hasImage: boolean;
  /** 그림 캐시 열쇠 — 바뀌면 새로 받는다 */
  ver: number;
  sort: number;
}

export async function listAreas(): Promise<AreaInfo[]> {
  const rows = await db.execute<{ id: number; name: string; is_site: boolean; plan: unknown; has_image: boolean; ver: number; sort: number }>(sql`
    SELECT id, name, is_site, plan, (image IS NOT NULL) AS has_image,
           floor(extract(epoch FROM updated_at))::bigint AS ver, sort
    FROM storage_area WHERE is_active ORDER BY is_site DESC, sort, id`);
  return rows.map((r) => ({ id: Number(r.id), name: r.name, isSite: !!r.is_site, plan: r.plan, hasImage: !!r.has_image, ver: Number(r.ver), sort: Number(r.sort) }));
}

/** 같은 더미 세트들 (찾기 화면 — 「이 더미: #0012 4본 + #0031 2본」) */
export async function stackMates(areaId: number, slotId: string, stackNo: number): Promise<StorageRow[]> {
  const raw = await db.execute<Raw>(sql`${BASE}
    WHERE s.status IN ('보관중','확인대기') AND s.area_id = ${areaId} AND s.slot_id = ${slotId} AND s.stack_no = ${stackNo}
    ORDER BY s.storage_no NULLS LAST`);
  return raw.map(toRow);
}

/** 자리마다 세트 수 — 도면 배지 · 편집기(세트 든 자리는 못 지움) */
export async function slotCounts(): Promise<{ areaId: number; slotId: string; sets: number; stacks: number }[]> {
  const rows = await db.execute<{ area_id: number; slot_id: string; sets: number; stacks: number }>(sql`
    SELECT area_id, slot_id, count(*)::int AS sets, count(DISTINCT stack_no)::int AS stacks
    FROM tire_storage WHERE status IN ('보관중','확인대기') AND slot_id IS NOT NULL GROUP BY 1, 2`);
  return rows.map((r) => ({ areaId: Number(r.area_id), slotId: r.slot_id, sets: Number(r.sets), stacks: Number(r.stacks) }));
}

export async function areaImage(id: number): Promise<string | null> {
  const [r] = await db.execute<{ image: string | null }>(sql`SELECT image FROM storage_area WHERE id = ${id}`);
  return r?.image ?? null;
}

/** ⭐ 창고 실사 화면 — 보관중 + 실사 전 전부 (매장 규모 수백 세트라 한 번에 넘겨 화면에서 거른다) */
export async function countSets(): Promise<StorageRow[]> {
  const raw = await db.execute<Raw>(sql`${BASE} WHERE s.status IN ('보관중','확인대기') ORDER BY s.storage_no NULLS LAST, s.stored_on LIMIT 1500`);
  return raw.map(toRow);
}
