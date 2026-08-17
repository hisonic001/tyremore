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
    n: number;
    last_at: string | null;
  }>(sql`
    SELECT s.id, s.name, s.phone, s.memo, s.is_active,
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
  /** 이름이 이미 있는 거래처와 겹칠 때, 합쳐도 된다고 확인했는가 */
  confirmMerge?: boolean;
}): Promise<{ ok: true; merged?: boolean } | { ok: false; error: string; needsMerge?: string }> {
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
      updatedAt: new Date(),
    })
    .where(eq(supplier.id, input.id));
  refresh();
  return { ok: true };
}

/** 거래를 끊었을 때 — 목록에서 감춘다. 매입 내역은 그대로 남는다 */
export async function setSupplierActive(id: number, active: boolean): Promise<Result> {
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
