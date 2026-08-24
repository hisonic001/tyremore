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
import { taxReconData } from "./recon-data";

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
    id: number; direction: string; recon_status: string; counterparty_biz_no: string; total: number;
  }>(sql`
    SELECT id, direction, recon_status, counterparty_biz_no, total FROM tax_invoice
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

  revalidatePath("/finance/tax");
  revalidatePath("/finance");
  return { ok: true, warning };
}

/** 자동확정 가능한 것(정확 일치·유일·사업자번호 확실)을 서버가 다시 계산해 한꺼번에 확정 */
export async function autoConfirmTax(): Promise<{ ok: true; confirmed: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  // 🔴 화면이 보낸 목록을 믿지 않는다 — 서버가 같은 규칙으로 다시 계산한다
  const data = await taxReconData();
  let confirmed = 0;
  for (const s of data.open) {
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
  await db.execute(sql`
    DELETE FROM recon_match WHERE src_table = 'tax_invoice' AND src_id = ${taxInvoiceId}
      AND kind IN ('매입계산서', '매출계산서')
  `);
  await db.execute(sql`UPDATE tax_invoice SET recon_status = '미대조' WHERE id = ${taxInvoiceId}`);
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
    UPDATE tax_invoice SET recon_status = ${back ? "미대조" : "무시"}
    WHERE id = ${taxInvoiceId} AND recon_status <> '확정'
  `);
  revalidatePath("/finance/tax");
  return { ok: true };
}
