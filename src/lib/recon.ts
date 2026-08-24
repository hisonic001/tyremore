"use server";

/**
 * ⭐ 세금계산서 대조 — 확정·되돌리기·무시 (ERP 2단계, 2026-08-24)
 *
 *   후보 계산은 recon-data.ts(순수 조회) — 여기는 **쓰기만**.
 *   recon_match 의 ref_table/ref_id 는 FK 가 없으므로 (import_issue 전례)
 *   확정 전에 코드로 존재를 검증한다.
 *
 * 🔴 전부 사장님 전용. 질의 순차.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, isOwner } from "@/lib/auth";
import { normName } from "./recon-data";
import { TAX_APP_START, taxReconV2 } from "./tax-recon";

export interface MatchRef {
  table: "purchase_invoice" | "quote";
  id: number;
  amount: number;
}

async function guard(): Promise<{ ok: true; uid: number | null } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const s = await getSession();
  return { ok: true, uid: s?.uid ?? null };
}

/** 세금계산서 한 건을 매입/판매 기록과 잇는다 (월합계면 refs 여러 개) */
export async function confirmTaxMatch(input: {
  taxInvoiceId: number;
  refs: MatchRef[];
  method: "자동" | "수동";
  /** 확정하면서 이 거래처에 사업자번호를 기억시킨다 (매입만) */
  learnSupplierId?: number | null;
}): Promise<{ ok: true; warning: string | null } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const refs = (input.refs ?? []).filter((r) => Number.isInteger(r.id) && r.id > 0).slice(0, 30);
  if (refs.length === 0) return { ok: false, error: "이을 기록을 골라 주세요" };

  const [inv] = await db.execute<{
    id: number; direction: string; recon_status: string; counterparty_biz_no: string;
    counterparty_name: string; total: number;
  }>(sql`
    SELECT id, direction, recon_status, counterparty_biz_no, counterparty_name, total FROM tax_invoice
    WHERE id = ${input.taxInvoiceId} AND is_active
  `);
  if (!inv) return { ok: false, error: "세금계산서를 찾을 수 없습니다" };
  if (inv.recon_status === "확정") return { ok: false, error: "이미 확정된 계산서입니다 — 먼저 되돌려 주세요" };

  // ref 존재 검증 — FK 가 없으니 여기서 (kind 별로)
  for (const r of refs) {
    if (inv.direction === "매입" && r.table !== "purchase_invoice")
      return { ok: false, error: "매입 계산서는 매입 기록과만 이을 수 있습니다" };
    if (inv.direction === "매출" && r.table !== "quote")
      return { ok: false, error: "매출 계산서는 판매 기록과만 이을 수 있습니다" };
    const found =
      r.table === "purchase_invoice"
        ? await db.execute<{ id: number }>(sql`SELECT id FROM purchase_invoice WHERE id = ${r.id} AND status <> '취소'`)
        : await db.execute<{ id: number }>(sql`SELECT id FROM quote WHERE id = ${r.id} AND status = '성사'`);
    if (found.length === 0) return { ok: false, error: `기록 ${r.table}#${r.id} 을(를) 찾을 수 없습니다` };
  }

  const kind = inv.direction === "매입" ? "매입계산서" : "매출계산서";
  await db.transaction(async (tx) => {
    for (const r of refs) {
      await tx.execute(sql`
        INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount,
                                 status, confidence, method, confirmed_by, confirmed_at)
        VALUES (${kind}, 'tax_invoice', ${input.taxInvoiceId}, ${r.table}, ${r.id}, ${r.amount},
                '확정', ${input.method === "자동" ? "높음" : null}, ${input.method}, ${g.uid}, now())
      `);
    }
    await tx.execute(sql`UPDATE tax_invoice SET recon_status = '확정' WHERE id = ${input.taxInvoiceId}`);
  });

  // 사업자번호 학습 — 다음부터는 이 상대를 자동으로 알아본다 (supplier_item_code 철학)
  let warning: string | null = null;
  if (input.learnSupplierId && inv.direction === "매입") {
    try {
      const done = await db.execute<{ id: number }>(sql`
        UPDATE supplier SET biz_no = ${inv.counterparty_biz_no}
        WHERE id = ${input.learnSupplierId} AND biz_no IS NULL RETURNING id
      `);
      if (done.length === 0) warning = "거래처에 이미 다른 사업자번호가 있어 기억하지 않았습니다";
    } catch {
      warning = "그 사업자번호는 이미 다른 거래처에 기억되어 있습니다";
    }
  }

  /**
   * ⭐ 이름 별명 학습 (사장님 요청 2026-08-24) — 계산서 상호(미쉐린코리아(주))가
   *    앱 이름(미쉐린)과 달라도, 한 번 이어주면 다음부터 확실한 상대로 알아본다.
   */
  try {
    let partyKey: string | null = null;
    let partyLabel = "";
    if (inv.direction === "매입") {
      const [pi] = await db.execute<{ supplier: string }>(sql`
        SELECT supplier FROM purchase_invoice WHERE id = ${refs[0].id}
      `);
      if (pi?.supplier) {
        partyKey = `S:${pi.supplier}`;
        partyLabel = `거래처 ${pi.supplier}`;
      }
    } else {
      const [q] = await db.execute<{ supplier_name: string | null }>(sql`
        SELECT supplier_name FROM quote WHERE id = ${refs[0].id}
      `);
      if (q?.supplier_name) {
        partyKey = `S:${q.supplier_name}`;
        partyLabel = `거래처 ${q.supplier_name}`;
      }
    }
    const aliasKey = normName(inv.counterparty_name);
    if (partyKey && aliasKey.length >= 2) {
      await db.execute(sql`
        INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
        VALUES (${aliasKey}, ${inv.counterparty_name}, ${partyKey}, ${partyLabel})
        ON CONFLICT (alias_key) DO UPDATE SET party_key = EXCLUDED.party_key,
          party_label = EXCLUDED.party_label, updated_at = now()
      `);
    }
  } catch {
    // 별명 학습 실패는 확정 자체를 막지 않는다
  }

  revalidatePath("/finance/tax");
  revalidatePath("/finance");
  return { ok: true, warning };
}

/**
 * ⭐ 거래처 직접 지정 (사장님 제보 2026-08-25 — "앱 거래처 이름이 달라 매칭이 안 됨").
 *    계산서 상호와 앱 거래처 이름이 아예 달라도, 한 번 지정하면
 *    사업자번호(매입)·별명을 기억해 다음부터 후보·자동확정에 잡힌다.
 */
export async function linkCounterpartyToSupplier(
  taxInvoiceId: number,
  supplierId: number,
): Promise<{ ok: true; learned: string; warning: string | null } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const [inv] = await db.execute<{ id: number; direction: string; counterparty_biz_no: string; counterparty_name: string }>(sql`
    SELECT id, direction, counterparty_biz_no, counterparty_name FROM tax_invoice
    WHERE id = ${taxInvoiceId} AND is_active
  `);
  if (!inv) return { ok: false, error: "세금계산서를 찾을 수 없습니다" };
  const [sup] = await db.execute<{ id: number; name: string; biz_no: string | null }>(sql`
    SELECT id, name, biz_no FROM supplier WHERE id = ${supplierId} AND is_active
  `);
  if (!sup) return { ok: false, error: "거래처를 찾을 수 없습니다" };

  let warning: string | null = null;
  if (inv.direction === "매입" && !sup.biz_no) {
    try {
      await db.execute(sql`
        UPDATE supplier SET biz_no = ${inv.counterparty_biz_no} WHERE id = ${sup.id} AND biz_no IS NULL
      `);
    } catch {
      warning = "그 사업자번호는 이미 다른 거래처에 기억되어 있어 별명만 기억했습니다";
    }
  }
  const aliasKey = normName(inv.counterparty_name);
  if (aliasKey.length >= 2) {
    await db.execute(sql`
      INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
      VALUES (${aliasKey}, ${inv.counterparty_name}, ${"S:" + sup.name}, ${"거래처 " + sup.name})
      ON CONFLICT (alias_key) DO UPDATE SET party_key = EXCLUDED.party_key,
        party_label = EXCLUDED.party_label, updated_at = now()
    `);
  }
  revalidatePath("/finance/tax");
  return { ok: true, learned: sup.name, warning };
}

/** 자동확정 가능한 것(정확 일치·유일·사업자번호 확실)을 서버가 다시 계산해 한꺼번에 확정 */
export async function autoConfirmTax(): Promise<{ ok: true; confirmed: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  // 🔴 화면이 보낸 목록을 믿지 않는다 — 서버가 같은 규칙으로 다시 계산한다
  const data = await taxReconV2();
  let confirmed = 0;
  for (const s of data.groups.flatMap((g) => g.items)) {
    if (!s.auto) continue;
    const r = await confirmTaxMatch({
      taxInvoiceId: s.inv.id,
      refs: [{ table: s.auto.table, id: s.auto.id, amount: s.auto.amount }],
      method: "자동",
      learnSupplierId: s.learnable ? s.supplierId : null,
    });
    if (r.ok) confirmed++;
  }
  revalidatePath("/finance/tax");
  return { ok: true, confirmed };
}

/** 확정 되돌리기 — 연결을 지우고 미대조로 */
export async function undoTaxMatch(
  taxInvoiceId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  // 입금과 이어져 있었다면 그 입금도 미대조로 되돌린다 (v2 — 입금 직접 연결)
  const gone = await db.execute<{ ref_table: string; ref_id: number }>(sql`
    DELETE FROM recon_match WHERE src_table = 'tax_invoice' AND src_id = ${taxInvoiceId}
      AND kind IN ('매입계산서', '매출계산서')
    RETURNING ref_table, ref_id
  `);
  for (const g of gone) {
    if (g.ref_table === "cash_txn") {
      await db.execute(sql`UPDATE cash_txn SET recon_status = '미대조' WHERE id = ${g.ref_id}`);
    }
  }
  await db.execute(sql`UPDATE tax_invoice SET recon_status = '미대조', recon_reason = NULL WHERE id = ${taxInvoiceId}`);
  revalidatePath("/finance/tax");
  return { ok: true };
}

/** 무시 — 앱과 이을 상대가 없는 계산서 (광고비·수수료 등). 지우지 않고 접는다 */
export async function ignoreTaxInvoice(
  taxInvoiceId: number,
  back = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  await db.execute(sql`
    UPDATE tax_invoice SET recon_status = ${back ? "미대조" : "무시"},
           recon_reason = ${back ? null : "직접"}
    WHERE id = ${taxInvoiceId} AND recon_status <> '확정'
  `);
  revalidatePath("/finance/tax");
  return { ok: true };
}

/* ================================================================== */
/* 대조 v2 — 상대 유형·과거분·입금 연결 (사장님 승인 2026-08-25)          */

/**
 * 상대(사업자번호) 유형 지정 — 한 번 정하면 과거·미래 계산서가 계속 자동 처리된다.
 * '경비'·'무시' = 열린 계산서를 전부 무시(사유 포함), '대행정산' = 라벨만 (입금 연결로 확정).
 */
export async function setTaxPartyRule(input: {
  bizNo: string;
  nameRaw: string;
  kind: "경비" | "대행정산" | "무시";
}): Promise<{ ok: true; applied: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const bizNo = input.bizNo.replace(/\D/g, "");
  if (bizNo.length < 5) return { ok: false, error: "사업자번호가 올바르지 않습니다" };
  await db.execute(sql`
    INSERT INTO tax_party_rule (biz_no, name_raw, kind)
    VALUES (${bizNo}, ${input.nameRaw}, ${input.kind})
    ON CONFLICT (biz_no) DO UPDATE SET kind = EXCLUDED.kind, name_raw = EXCLUDED.name_raw, updated_at = now()
  `);
  let applied = 0;
  if (input.kind !== "대행정산") {
    const rows = await db.execute<{ id: number }>(sql`
      UPDATE tax_invoice SET recon_status = '무시', recon_reason = ${input.kind}
      WHERE is_active AND recon_status IN ('미대조', '제안') AND counterparty_biz_no = ${bizNo}
      RETURNING id
    `);
    applied = rows.length;
  }
  revalidatePath("/finance/tax");
  revalidatePath("/finance");
  return { ok: true, applied };
}

/** 과거분(앱 도입 전) 일괄 처리 — 재업로드로 되살아난 것 포함 */
export async function markPastTax(): Promise<{ ok: true; applied: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const rows = await db.execute<{ id: number }>(sql`
    UPDATE tax_invoice SET recon_status = '무시', recon_reason = '과거분'
    WHERE is_active AND recon_status IN ('미대조', '제안') AND write_date < ${TAX_APP_START}::date
    RETURNING id
  `);
  revalidatePath("/finance/tax");
  return { ok: true, applied: rows.length };
}

/**
 * 매출 계산서 ↔ 통장 입금 직접 연결 (대행 정산사의 실질 — "이 월합계 계산서 = 이 입금").
 * 판매 개별 건과 억지로 잇지 않는다. 입금 대조 화면에서도 그 입금은 정리된 것으로 보인다.
 */
export async function confirmTaxToBank(
  taxInvoiceId: number,
  cashTxnId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const [inv] = await db.execute<{ id: number; direction: string; recon_status: string; total: number }>(sql`
    SELECT id, direction, recon_status, total FROM tax_invoice WHERE id = ${taxInvoiceId} AND is_active
  `);
  if (!inv) return { ok: false, error: "세금계산서를 찾을 수 없습니다" };
  if (inv.direction !== "매출") return { ok: false, error: "입금 연결은 매출 계산서만 가능합니다" };
  if (inv.recon_status === "확정") return { ok: false, error: "이미 확정된 계산서입니다 — 먼저 되돌려 주세요" };
  const [dep] = await db.execute<{ id: number; in_amount: number }>(sql`
    SELECT id, in_amount FROM cash_txn
    WHERE id = ${cashTxnId} AND source = '통장' AND is_active AND in_amount > 0
  `);
  if (!dep) return { ok: false, error: "입금 줄을 찾을 수 없습니다" };
  const dupe = await db.execute<{ id: number }>(sql`
    SELECT id FROM recon_match WHERE ref_table = 'cash_txn' AND ref_id = ${cashTxnId}
      AND kind = '매출계산서' LIMIT 1
  `);
  if (dupe.length > 0) return { ok: false, error: "그 입금은 이미 다른 계산서와 이어져 있습니다" };

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
      VALUES ('매출계산서', 'tax_invoice', ${taxInvoiceId}, 'cash_txn', ${cashTxnId}, ${inv.total}, '확정', '수동', ${g.uid}, now())
    `);
    await tx.execute(sql`UPDATE tax_invoice SET recon_status = '확정', recon_reason = '입금연결' WHERE id = ${taxInvoiceId}`);
    await tx.execute(sql`UPDATE cash_txn SET recon_status = '확정' WHERE id = ${cashTxnId}`);
  });
  revalidatePath("/finance/tax");
  revalidatePath("/finance/deposits");
  return { ok: true };
}
