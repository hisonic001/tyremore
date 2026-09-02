"use server";

/**
 * 거래처 관리 — 추가 · 수정 · 삭제 (사장님 요청 2026-08-03)
 *
 *   "설정에 거래처 추가 수정 삭제가 가능한 기능도 추가해줘"
 *
 * 그동안 거래처는 매입 인보이스에 **글자로만** 있었다. 그래서
 *   · 아직 거래한 적 없는 곳을 미리 넣어 둘 수 없었고
 *   · 「쌍성」·「쌍성 타이어」처럼 갈라진 이름을 합칠 방법이 없었다
 *
 * ⚠️ 이름을 바꾸면 **인보이스의 거래처 이름도 같이 바꾼다.** 안 그러면 매입 내역이
 *    옛 이름에 남아 갈라진다. 이게 이 화면의 존재 이유다.
 * ⚠️ 매입 내역이 있는 거래처는 지우지 않고 **숨긴다.** 지우면 옛 인보이스가
 *    어디서 온 물건인지 알 수 없게 된다.
 */
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { purchaseInvoice, supplier } from "@/db/schema";

function refresh() {
  for (const p of ["/settings/suppliers", "/receiving"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

/** 공백·대소문자를 지운 비교용 이름 — 「쌍성 타이어」 = 「쌍성타이어」 */
function key(name: string): string {
  return name.replace(/\s/g, "").toLowerCase();
}

export interface SupplierRow {
  id: number;
  name: string;
  phone: string | null;
  memo: string | null;
  isActive: boolean;
  /** 이 거래처로 등록된 매입 장부 수 — 지울 수 있는지 판단한다 */
  invoiceCount: number;
  lastAt: string | null;
  /** ⭐ 청구서 부가세 방식 (월 정산, 2026-09-01) — '포함' | '별도' */
  vatMode: string;
  /** ⭐ 사업자번호 (2026-09-02) — 채우면 계산서 자동확정·원장이 정확해진다. 숫자 10자리 */
  bizNo: string | null;
}

/**
 * 거래처 목록.
 *
 * ⭐ 인보이스에만 있고 거래처 표에는 없는 이름을 **먼저 끌어온다.**
 *    이 기능을 만들기 전에 쓰던 거래처들이 그대로 살아 있어야 한다.
 */
export async function listSuppliers(): Promise<SupplierRow[]> {
  await db.execute(sql`
    INSERT INTO supplier (name, name_key)
    SELECT DISTINCT ON (replace(lower(i.supplier), ' ', '')) i.supplier,
           replace(lower(i.supplier), ' ', '')
    FROM purchase_invoice i
    WHERE btrim(i.supplier) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM supplier s WHERE s.name_key = replace(lower(i.supplier), ' ', '')
      )
    ORDER BY replace(lower(i.supplier), ' ', ''), i.created_at DESC
    ON CONFLICT (name_key) DO NOTHING
  `);

  const rows = await db.execute<{
    id: number;
    name: string;
    phone: string | null;
    memo: string | null;
    is_active: boolean;
    vat_mode: string;
    biz_no: string | null;
    n: number;
    last_at: string | null;
  }>(sql`
    SELECT s.id, s.name, s.phone, s.memo, s.is_active, s.vat_mode, s.biz_no,
           (SELECT count(*)::int FROM purchase_invoice i
             WHERE replace(lower(i.supplier),' ','') = s.name_key) n,
           (SELECT max(i.issued_at) FROM purchase_invoice i
             WHERE replace(lower(i.supplier),' ','') = s.name_key) last_at
    FROM supplier s
    ORDER BY s.is_active DESC, n DESC, s.name
  `);

  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    phone: r.phone,
    memo: r.memo,
    isActive: r.is_active,
    invoiceCount: Number(r.n),
    lastAt: r.last_at,
    vatMode: r.vat_mode,
    bizNo: r.biz_no,
  }));
}

type Result = { ok: true } | { ok: false; error: string };

function checkName(name: string): string | null {
  const n = name.trim();
  if (!n) return "거래처 이름을 입력해 주세요";
  if (n.length > 60) return "이름이 너무 깁니다";
  /**
   * 바코드가 거래처 칸에 딸려 들어온 것을 막는다.
   * 실제로 `오픈링크8808563590301` 같은 거래처가 만들어졌다 (2026-08-02).
   */
  if (/\d{8,}$/.test(n)) return "이름에 바코드가 섞였습니다. 숫자를 지워 주세요";
  return null;
}

export async function addSupplier(input: {
  name: string;
  phone?: string;
  memo?: string;
}): Promise<Result> {
  if (!(await (await import("./auth")).hasPerm("master"))) return { ok: false, error: "상품·가격·거래처 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const err = checkName(input.name);
  if (err) return { ok: false, error: err };
  const name = input.name.trim();

  const [dup] = await db
    .select({ name: supplier.name })
    .from(supplier)
    .where(eq(supplier.nameKey, key(name)))
    .limit(1);
  if (dup) return { ok: false, error: `이미 있습니다 — 「${dup.name}」` };

  await db.insert(supplier).values([
    {
      name,
      nameKey: key(name),
      phone: input.phone?.trim() || null,
      memo: input.memo?.trim() || null,
    },
  ]);
  refresh();
  return { ok: true };
}

/**
 * 이름·연락처·메모를 고친다.
 *
 * 🔴 이름이 바뀌면 **인보이스의 거래처 이름도 같이 바꾼다.** 안 하면 옛 이름으로 등록된
 *    매입 내역이 이 거래처와 이어지지 않는다.
 * ⭐ 이미 있는 이름으로 바꾸면 **합치기**다 (「쌍성」 → 「쌍성 타이어」).
 *    이게 이 화면을 만든 가장 큰 이유라 막지 않고, 화면에서 한 번 더 묻는다.
 */
export async function updateSupplier(input: {
  id: number;
  name: string;
  phone?: string;
  memo?: string;
  /** ⭐ 청구서 부가세 방식 (월 정산) — '포함' | '별도'. 안 주면 안 건드린다 */
  vatMode?: string;
  /** ⭐ 사업자번호 (2026-09-02) — 숫자 10자리. 빈 글자면 지운다. 안 주면 안 건드린다 */
  bizNo?: string;
  /** 이름이 이미 있는 거래처와 겹칠 때, 합쳐도 된다고 확인했는가 */
  confirmMerge?: boolean;
}): Promise<{ ok: true; merged?: boolean } | { ok: false; error: string; needsMerge?: string }> {
  if (!(await (await import("./auth")).hasPerm("master"))) return { ok: false, error: "상품·가격·거래처 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const err = checkName(input.name);
  if (err) return { ok: false, error: err };
  const name = input.name.trim();
  const k = key(name);

  const [cur] = await db.select().from(supplier).where(eq(supplier.id, input.id)).limit(1);
  if (!cur) return { ok: false, error: "거래처를 찾지 못했습니다" };

  const [other] = await db
    .select({ id: supplier.id, name: supplier.name, phone: supplier.phone, memo: supplier.memo })
    .from(supplier)
    .where(eq(supplier.nameKey, k))
    .limit(1);

  const merging = other && Number(other.id) !== Number(input.id);
  if (merging && !input.confirmMerge) {
    return {
      ok: false,
      error: `「${other.name}」 이(가) 이미 있습니다`,
      needsMerge: other.name,
    };
  }

  // 옛 이름으로 등록된 인보이스를 새 이름으로 옮긴다 (매입 내역이 갈라지지 않게)
  if (cur.nameKey !== k) {
    await db.execute(sql`
      UPDATE purchase_invoice SET supplier = ${name}, updated_at = now()
      WHERE replace(lower(supplier), ' ', '') = ${cur.nameKey}
    `);
    /**
     * ⭐ 거래처 **판매**도 같이 옮긴다 (2026-08-17).
     *    안 옮기면 외상 장부에서 「쌍성」과 「쌍성 타이어」가 두 거래처로 갈려
     *    잔액이 나뉜다 — 매입 내역을 옮기는 것과 똑같은 이유다.
     */
    await db.execute(sql`
      UPDATE quote SET supplier_name = ${name}, updated_at = now()
      WHERE supplier_name IS NOT NULL
        AND replace(lower(supplier_name), ' ', '') = ${cur.nameKey}
    `);
    // ⭐ 월 정산 회차도 같은 이유로 같이 옮긴다 (2026-09-01)
    await db.execute(sql`
      UPDATE settlement_run SET supplier_name = ${name}, updated_at = now()
      WHERE replace(lower(supplier_name), ' ', '') = ${cur.nameKey}
    `);
  }

  if (merging) {
    /**
     * 합칠 상대에 정보를 남기고, 이쪽 줄은 지운다.
     * ⚠️ 빈 칸으로 **덮어쓰지 않는다.** 「쌍성」(연락처 없음)을 연락처가 있는
     *    「쌍성 타이어」에 합치면서 연락처를 지운 적이 있다 (2026-08-03 시험 중 발견).
     *    적은 값 → 이쪽 값 → 상대 값 순으로 살린다.
     */
    await db
      .update(supplier)
      .set({
        name,
        phone: input.phone?.trim() || cur.phone || other.phone,
        memo: input.memo?.trim() || cur.memo || other.memo,
        updatedAt: new Date(),
      })
      .where(eq(supplier.id, Number(other.id)));
    await db.delete(supplier).where(eq(supplier.id, input.id));
    refresh();
    return { ok: true, merged: true };
  }

  await db
    .update(supplier)
    .set({
      name,
      nameKey: k,
      phone: input.phone?.trim() || null,
      memo: input.memo?.trim() || null,
      ...(input.vatMode === "포함" || input.vatMode === "별도" ? { vatMode: input.vatMode } : {}),
      updatedAt: new Date(),
    })
    .where(eq(supplier.id, input.id));
  // ⭐ 사업자번호 — Drizzle 정의에 없는 칸이라 raw SQL (부분 유니크가 중복을 막는다)
  if (input.bizNo !== undefined) {
    const digits = input.bizNo.replace(/\D/g, "");
    if (digits && digits.length !== 10) return { ok: false, error: "사업자번호는 숫자 10자리입니다" };
    try {
      await db.execute(sql`
        UPDATE supplier SET biz_no = ${digits || null}, updated_at = now() WHERE id = ${input.id}
      `);
    } catch {
      return { ok: false, error: "그 사업자번호는 다른 거래처에 이미 붙어 있습니다" };
    }
  }
  refresh();
  return { ok: true };
}

/** 거래를 끊었을 때 — 목록에서 감춘다. 매입 내역은 그대로 남는다 */
export async function setSupplierActive(id: number, active: boolean): Promise<Result> {
  if (!(await (await import("./auth")).hasPerm("master"))) return { ok: false, error: "상품·가격·거래처 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  await db.update(supplier).set({ isActive: active, updatedAt: new Date() }).where(eq(supplier.id, id));
  refresh();
  return { ok: true };
}

/**
 * 지우기.
 *
 * ⚠️ 매입 내역이 있으면 **지우지 않는다.** 지우면 옛 인보이스가 어디서 온 물건인지
 *    알 수 없게 된다. 대신 숨기기를 권한다.
 */
export async function deleteSupplier(id: number): Promise<Result> {
  if (!(await (await import("./auth")).hasPerm("master"))) return { ok: false, error: "상품·가격·거래처 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const [s] = await db.select().from(supplier).where(eq(supplier.id, id)).limit(1);
  if (!s) return { ok: false, error: "거래처를 찾지 못했습니다" };

  const [c] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM purchase_invoice
    WHERE replace(lower(supplier), ' ', '') = ${s.nameKey}
  `);
  /**
   * ⭐ 판매도 센다 (2026-08-17). 이 거래처로 판 기록(외상 잔액까지)이 있는데 지우면
   *    외상 장부에서 그 이름이 떠돌게 된다 — 매입 내역과 같은 이유로 막는다.
   */
  const [sc] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM quote
    WHERE supplier_name IS NOT NULL
      AND replace(lower(supplier_name), ' ', '') = ${s.nameKey}
  `);
  const buys = Number(c?.n ?? 0);
  const sells = Number(sc?.n ?? 0);
  if (buys > 0 || sells > 0) {
    const what = [buys > 0 ? `매입 내역 ${buys}건` : null, sells > 0 ? `판매 내역 ${sells}건` : null]
      .filter(Boolean)
      .join(" · ");
    return {
      ok: false,
      error: `${what}이 있어 지울 수 없습니다. 「숨기기」를 쓰시면 목록에서만 사라집니다`,
    };
  }

  await db.delete(supplier).where(eq(supplier.id, id));
  refresh();
  return { ok: true };
}

/* ============================================================
 * ⭐ 거래처 한 장 — 연동 묶음 (사장님 요청 2026-09-02)
 *   별명·차고 차량·돈 요약·월정산 규칙·사업자번호 제안을 한 번에.
 * 🔴 돈이 섞여 있어 **사장님 전용** — 직원 화면은 기본 정보만 받는다.
 *    질의는 순차 · LIMIT (2026-08-11 마비 관례).
 * ========================================================== */
export interface SupplierExtras {
  /** 이름 → 외상·미지급 잔액 */
  money: Record<string, { receivable: number; payable: number }>;
  /** 이름 → 통장 이름 짝 */
  aliases: Record<string, { key: string; raw: string }[]>;
  /** 이름 → 차고 차량 */
  garage: Record<string, { vehicleId: number; plateNo: string; model: string | null; lastVisit: string | null }[]>;
  /** 이름 → 계산서에서 찾은 사업자번호 제안 (biz_no 없는 곳만) */
  bizSuggest: Record<string, { bizNo: string; nameRaw: string; n: number }>;
  /** 이름 → 월정산 규칙 kind (biz_no 로 이어진 것만) */
  rule: Record<string, string>;
}

export async function supplierExtras(): Promise<SupplierExtras | null> {
  const { hasPerm } = await import("./auth");
  if (!(await hasPerm("finance"))) return null;
  const { partyListData } = await import("./party-ledger");
  const { normName, samePartyName } = await import("./recon-data");

  const money: SupplierExtras["money"] = {};
  for (const p of await partyListData()) {
    money[p.name] = { receivable: p.receivableRemain, payable: p.payableRemain };
  }

  const aliases: SupplierExtras["aliases"] = {};
  const aliasByKey = new Map<string, string>(); // normName(별명) → 거래처 이름
  const aRows = await db.execute<{ alias_key: string; alias_raw: string; party_key: string }>(sql`
    SELECT alias_key, alias_raw, party_key FROM party_alias WHERE party_key LIKE 'S:%' LIMIT 500
  `);
  for (const a of aRows) {
    const name = a.party_key.slice(2);
    (aliases[name] ??= []).push({ key: a.alias_key, raw: a.alias_raw });
    aliasByKey.set(a.alias_key, name);
  }

  const garage: SupplierExtras["garage"] = {};
  const gRows = await db.execute<{ supplier_name: string; id: number; plate_no: string; model: string | null; last: string | null }>(sql`
    SELECT c.supplier_name, v.id, v.plate_no, v.model,
           to_char(v.last_visit_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') last
    FROM vehicle v JOIN customer c ON c.id = v.customer_id
    WHERE c.supplier_name IS NOT NULL
    ORDER BY v.id DESC LIMIT 300
  `);
  for (const g of gRows) {
    (garage[g.supplier_name] ??= []).push({
      vehicleId: Number(g.id),
      plateNo: g.plate_no,
      model: g.model,
      lastVisit: g.last,
    });
  }

  /* 사업자번호 제안 — 이미 올린 계산서의 상대 상호를 별명·이름으로 대조 (자동 저장 안 함) */
  const noBiz = await db.execute<{ name: string }>(sql`
    SELECT name FROM supplier WHERE is_active AND biz_no IS NULL LIMIT 100
  `);
  const usedBiz = await db.execute<{ biz_no: string }>(sql`
    SELECT biz_no FROM supplier WHERE biz_no IS NOT NULL
  `);
  const used = new Set(usedBiz.map((r) => r.biz_no));
  const counters = await db.execute<{ biz: string; nm: string; n: number }>(sql`
    SELECT counterparty_biz_no biz, max(counterparty_name) nm, count(*)::int n
    FROM tax_invoice
    WHERE is_active AND counterparty_biz_no IS NOT NULL AND COALESCE(counterparty_name, '') <> ''
    GROUP BY 1 ORDER BY 3 DESC LIMIT 400
  `);
  const bizSuggest: SupplierExtras["bizSuggest"] = {};
  for (const s of noBiz) {
    let best: { bizNo: string; nameRaw: string; n: number } | null = null;
    for (const c of counters) {
      if (used.has(c.biz)) continue;
      const hit = aliasByKey.get(normName(c.nm)) === s.name || samePartyName(c.nm, s.name);
      if (hit && (!best || Number(c.n) > best.n)) best = { bizNo: c.biz, nameRaw: c.nm, n: Number(c.n) };
    }
    if (best) bizSuggest[s.name] = best;
  }

  const rule: SupplierExtras["rule"] = {};
  const rRows = await db.execute<{ name: string; kind: string }>(sql`
    SELECT s.name, r.kind FROM supplier s JOIN tax_party_rule r ON r.biz_no = s.biz_no
    WHERE s.biz_no IS NOT NULL LIMIT 200
  `);
  for (const r of rRows) rule[r.name] = r.kind;

  return { money, aliases, garage, bizSuggest, rule };
}

/** ⭐ 최근 매입 5건 — 카드 펼칠 때 지연 로딩 (사장님 전용 — 매입가는 D-05) */
export async function recentPurchases(
  name: string,
): Promise<{ ok: true; rows: { id: number; d: string; total: number | null; status: string; items: number }[] } | { ok: false; error: string }> {
  const { hasPerm } = await import("./auth");
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const rows = await db.execute<{ id: number; d: string; total: number | null; status: string; items: number }>(sql`
    SELECT i.id, to_char(i.issued_at, 'YYYY-MM-DD') d, i.total, i.status,
           (SELECT count(*)::int FROM purchase_invoice_item x WHERE x.invoice_id = i.id) items
    FROM purchase_invoice i
    WHERE replace(lower(i.supplier), ' ', '') = ${name.replace(/\s/g, "").toLowerCase()}
    ORDER BY i.issued_at DESC NULLS LAST, i.id DESC LIMIT 5
  `);
  return {
    ok: true,
    rows: rows.map((r) => ({ id: Number(r.id), d: r.d, total: r.total === null ? null : Number(r.total), status: r.status, items: Number(r.items) })),
  };
}

