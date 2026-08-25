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
import { payerKeyOf } from "./expense-cats";
import { cashUsedMap, cashUsedSql, normName } from "./recon-data";
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
  /* ⭐ 재설계(2026-08-25): 통장 연결만 있는 확정 계산서에도 앱 기록을 더 이을 수 있다
     (3자 대조: 계산서 = 앱 기록 = 실제 돈). 거절은 「이미 앱 기록 연결이 있을 때」만. */
  const appTaken = await db.execute<{ id: number }>(sql`
    SELECT id FROM recon_match WHERE src_table = 'tax_invoice' AND src_id = ${input.taxInvoiceId}
      AND ref_table IN ('purchase_invoice', 'quote') AND kind IN ('매입계산서', '매출계산서') LIMIT 1
  `);
  if (appTaken.length > 0)
    return { ok: false, error: "이미 앱 기록과 이어진 계산서입니다 — 먼저 되돌려 주세요" };

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
    // 🔴 감사 H3(2026-08-25): 같은 매입·판매가 두 계산서에 이어지는 것을 서버가 막는다
    const taken = await db.execute<{ id: number }>(sql`
      SELECT id FROM recon_match WHERE ref_table = ${r.table} AND ref_id = ${r.id}
        AND kind IN ('매입계산서', '매출계산서') LIMIT 1
    `);
    if (taken.length > 0) return { ok: false, error: `기록 ${r.table}#${r.id} 은(는) 이미 다른 계산서와 이어져 있습니다` };
  }
  // 🔴 감사 L8: 묶음 확정은 배분 합이 계산서 금액과 맞아야 한다
  if (refs.length > 1) {
    const sum = refs.reduce((s, r) => s + r.amount, 0);
    if (sum !== inv.total) return { ok: false, error: `묶음 배분 합(${sum.toLocaleString()}원)이 계산서(${inv.total.toLocaleString()}원)와 다릅니다` };
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
    if (refs.length > 1) {
      // 🔴 감사 L7: 여러 기록 묶음에서는 어느 상대인지 확실치 않아 배우지 않는다
      partyKey = null;
    } else if (inv.direction === "매입") {
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
export async function autoConfirmTax(
  ym?: string,
): Promise<{ ok: true; confirmed: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  // 🔴 화면이 보낸 목록을 믿지 않는다 — 서버가 같은 규칙으로 다시 계산한다 (보는 달과 같은 범위)
  const data = await taxReconV2(ym);
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
  /** "통장" = 통장 연결만 풀기(앱 기록 연결·확정은 유지) · "전부" = 현행 전체 초기화 */
  scope: "통장" | "전부" = "전부",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  // 입금·출금과 이어져 있었다면 그 통장 줄도 미대조로 되돌린다 (v2 — 직접 연결)
  const [invRow] = await db.execute<{ recon_reason: string | null; counterparty_name: string; counterparty_biz_no: string }>(sql`
    SELECT recon_reason, counterparty_name, counterparty_biz_no FROM tax_invoice WHERE id = ${taxInvoiceId}
  `);
  const gone = await db.execute<{ ref_table: string; ref_id: number }>(sql`
    DELETE FROM recon_match WHERE src_table = 'tax_invoice' AND src_id = ${taxInvoiceId}
      AND kind IN ('매입계산서', '매출계산서')
      ${scope === "통장" ? sql`AND ref_table IN ('cash_txn', 'adjust')` : sql``}
    RETURNING ref_table, ref_id
  `);
  for (const g of gone) {
    if (g.ref_table === "cash_txn") {
      if (invRow?.recon_reason === "출금연결") {
        // 이을 때 우리가 붙였던 '매입대금' 분류도 함께 되돌린다 (사장님 확인 2026-08-25)
        await db.execute(sql`
          UPDATE cash_txn SET recon_status = '미대조',
                 category = CASE WHEN category = '매입대금' THEN NULL ELSE category END
          WHERE id = ${g.ref_id}
        `);
      } else {
        await db.execute(sql`UPDATE cash_txn SET recon_status = '미대조' WHERE id = ${g.ref_id}`);
      }
    }
  }
  /* 🔴 감사 H8(2026-08-25): 확정 때 배운 별명을 함께 지운다 — 안 지우면 잘못된 학습이
     다음 자동확정 후보 1순위로 계속 되살아난다 ("고쳐도 그대로"의 근원) */
  if (invRow) {
    if (scope === "전부") {
      const nameKey = normName(invRow.counterparty_name);
      if (nameKey.length >= 2) {
        await db.execute(sql`DELETE FROM party_alias WHERE alias_key = ${nameKey} AND party_key LIKE 'S:%'`);
      }
    }
    for (const g of gone) {
      if (g.ref_table !== "cash_txn") continue;
      const [depRow] = await db.execute<{ description: string }>(sql`
        SELECT description FROM cash_txn WHERE id = ${g.ref_id}
      `);
      if (depRow) {
        const payerKey = normName(depRow.description.replace(/^\[[^\]]*\]\s*/, "").trim());
        if (payerKey.length >= 2) {
          await db.execute(sql`
            DELETE FROM party_alias WHERE alias_key = ${payerKey + "@" + invRow.counterparty_biz_no}
          `);
        }
      }
    }
  }
  if (scope === "통장") {
    // 앱 기록 연결이 남아 있으면 확정은 유지(돈 미확인 상태로만 복귀), 없으면 미대조로
    const [appLeft] = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int n FROM recon_match WHERE src_table = 'tax_invoice' AND src_id = ${taxInvoiceId}
        AND ref_table IN ('purchase_invoice', 'quote') AND kind IN ('매입계산서', '매출계산서')
    `);
    if (Number(appLeft.n) > 0) {
      await db.execute(sql`UPDATE tax_invoice SET recon_reason = NULL WHERE id = ${taxInvoiceId}`);
    } else {
      await db.execute(sql`UPDATE tax_invoice SET recon_status = '미대조', recon_reason = NULL WHERE id = ${taxInvoiceId}`);
    }
  } else {
    await db.execute(sql`UPDATE tax_invoice SET recon_status = '미대조', recon_reason = NULL WHERE id = ${taxInvoiceId}`);
  }
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
  /* 🔴 감사 H9(2026-08-25): 「되살리기」가 품목규칙을 안 지우면 다음 업로드에서
     같은 계산서가 다시 자동 무시된다 — 되살릴 때 그 (상대+품목) 규칙도 지운다 */
  if (back) {
    const [inv] = await db.execute<{ counterparty_biz_no: string; item_summary: string | null }>(sql`
      SELECT counterparty_biz_no, item_summary FROM tax_invoice WHERE id = ${taxInvoiceId}
    `);
    if (inv) {
      const itemKey = normName(inv.item_summary ?? "");
      if (itemKey.length >= 2) {
        await db.execute(sql`
          DELETE FROM tax_item_rule WHERE biz_no = ${inv.counterparty_biz_no} AND item_key = ${itemKey}
        `);
      }
    }
  }
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
 * 계산서 ↔ 통장 직접 연결 (사장님 통찰 2026-08-25 — "앱 내역보다 입출금 대조가 정확").
 *   매출 계산서 ↔ 입금 (대행 정산사) · 매입 계산서 ↔ 출금 (지급).
 *   매입-출금을 이으면 그 출금은 자동으로 '매입대금' 분류까지 된다.
 */
export async function confirmTaxToBank(
  taxInvoiceId: number,
  cashTxnId: number,
): Promise<{ ok: true; remaining: number; shortfall: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const [inv] = await db.execute<{
    id: number; direction: string; recon_status: string; total: number;
    counterparty_biz_no: string; counterparty_name: string;
  }>(sql`
    SELECT id, direction, recon_status, total, counterparty_biz_no, counterparty_name
    FROM tax_invoice WHERE id = ${taxInvoiceId} AND is_active
  `);
  if (!inv) return { ok: false, error: "세금계산서를 찾을 수 없습니다" };
  if (Number(inv.total) <= 0)
    return { ok: false, error: "마이너스 계산서는 원본과 상쇄로 정리해 주세요" };
  /* ⭐ 여러 출금·입금 합산 발행 지원 (사장님 제보 2026-08-25) — 계산서에 남은 금액이
     있는 한 계속 잇는다. 부분 확인 상태는 돈 확인 뷰가 「일부 확인 · 남은 X원」으로 보여준다. */
  const [covRow] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(amount), 0)::bigint s FROM recon_match
    WHERE src_table = 'tax_invoice' AND src_id = ${taxInvoiceId} AND status = '확정'
      AND kind IN ('매입계산서', '매출계산서') AND ref_table IN ('cash_txn', 'adjust')
  `);
  const invCovered = Number(covRow.s);
  const invRemain = Number(inv.total) - invCovered;
  if (invRemain <= 0)
    return { ok: false, error: "이 계산서는 금액이 이미 다 확인됐습니다 — 잘못 이었다면 되돌린 뒤 다시 이으세요" };
  const [dep] = await db.execute<{ id: number; in_amount: number; out_amount: number; description: string }>(sql`
    SELECT id, in_amount, out_amount, description FROM cash_txn
    WHERE id = ${cashTxnId} AND source = '통장' AND is_active
  `);
  if (!dep) return { ok: false, error: "통장 줄을 찾을 수 없습니다" };
  if (inv.direction === "매출" && Number(dep.in_amount) <= 0)
    return { ok: false, error: "매출 계산서는 입금과만 이을 수 있습니다" };
  if (inv.direction === "매입" && Number(dep.out_amount) <= 0)
    return { ok: false, error: "매입 계산서는 출금과만 이을 수 있습니다" };
  /**
   * ⭐ 한 통장 줄 ↔ 여러 계산서 (사장님 제보 2026-08-25): ①카랑이 현대캐피탈·쏘카 몫을
   *    한 번에 입금 ②선입금(포인트 적립) 후 매입 계산서가 여러 번 — 남은 금액을 추적하며
   *    부분 연결한다. 첫 연결은 차액(수수료 차감 등)이 있어도 허용, 차액을 돌려준다.
   */
  const depAmt = inv.direction === "매출" ? Number(dep.in_amount) : Number(dep.out_amount);
  /* ⭐ 소진량 정본(cashUsedMap) — 지급 잡기('매입지급')·외상 수금('이체입금')이 쓴 몫까지
     센다 (리뷰 C1 이중계상 차단). 남은 금액만큼만 기록해 SUM 이 통장 금액을 못 넘게 한다(C5). */
  const already = (await cashUsedMap([cashTxnId])).get(cashTxnId) ?? 0;
  const remain0 = depAmt - already;
  if (remain0 <= 0)
    return { ok: false, error: "이 통장 줄은 남은 금액이 없습니다 — 이미 다른 연결이 다 썼습니다" };
  const linkAmt = Math.min(invRemain, remain0);
  const remaining = remain0 - linkAmt; // 통장 쪽 잔여 (>= 0)
  const shortfall = invRemain - linkAmt; // 계산서에 아직 남은 금액 — 다른 줄을 이어 잇거나 「차액 확인 끝」

  const kind = inv.direction === "매출" ? "매출계산서" : "매입계산서";
  const reason = inv.direction === "매출" ? "입금연결" : "출금연결";
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
      VALUES (${kind}, 'tax_invoice', ${taxInvoiceId}, 'cash_txn', ${cashTxnId}, ${linkAmt}, '확정', '수동', ${g.uid}, now())
    `);
    await tx.execute(sql`UPDATE tax_invoice SET recon_status = '확정', recon_reason = ${reason} WHERE id = ${taxInvoiceId}`);
    if (remaining === 0) {
      // 통장 줄이 다 찼다(또는 계산서가 더 크다) — 확정으로 정리
      if (inv.direction === "매입") {
        await tx.execute(sql`
          UPDATE cash_txn SET recon_status = '확정', category = COALESCE(category, '매입대금')
          WHERE id = ${cashTxnId}
        `);
      } else {
        await tx.execute(sql`UPDATE cash_txn SET recon_status = '확정' WHERE id = ${cashTxnId}`);
      }
    } else if (inv.direction === "매입") {
      // 적립 소진 중 — 분류를 미리 붙이고 '제안' 상태로 (다음 계산서를 기다린다)
      await tx.execute(sql`
        UPDATE cash_txn SET recon_status = '제안', category = COALESCE(category, '매입대금')
        WHERE id = ${cashTxnId}
      `);
    } else {
      /* 🔴 감사 H6(2026-08-25): 매출 부분 연결도 상태를 남긴다 — 안 남기면 입금 대조
         화면에 전액으로 다시 떠서 외상 수금까지 이중으로 잡을 수 있다 */
      await tx.execute(sql`UPDATE cash_txn SET recon_status = '제안' WHERE id = ${cashTxnId}`);
    }
  });

  /**
   * ⭐ 입금자명 학습 (사장님 제보 2026-08-25 — 한국타이어 정산이 「이관우」 개인 이름으로 온다).
   *    한 번 이으면 그 입금자명 = 이 계산서 상대의 정산 입금으로 기억한다 ('T:'+사업자번호).
   */
  try {
    const payer = dep.description.replace(/^\[[^\]]*\]\s*/, "").trim();
    const key = normName(payer);
    if (key.length >= 2) {
      await db.execute(sql`
        INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
        VALUES (${key + "@" + inv.counterparty_biz_no}, ${payer}, ${"T:" + inv.counterparty_biz_no},
                ${(inv.direction === "매출" ? "정산입금 " : "지급출금 ") + inv.counterparty_name})
        ON CONFLICT (alias_key) DO UPDATE SET party_key = EXCLUDED.party_key,
          party_label = EXCLUDED.party_label, updated_at = now()
      `);
    }
  } catch {
    // 학습 실패는 확정을 막지 않는다
  }

  revalidatePath("/finance/tax");
  revalidatePath("/finance/deposits");
  return { ok: true, remaining, shortfall };
}

/**
 * ⭐ 차액 확인 끝 (사장님 제보 2026-08-25) — 포인트·적립 소진, 수수료 차감, 에누리로
 *    계산서와 통장 금액이 끝내 안 맞는 경우: 남은 차액을 「조정」으로 기록해 확인을 끝낸다.
 *    ref_table='adjust' 는 통장 소진량(cashUsedMap)에 안 세이고, 되돌리기(통장)가 함께 지운다.
 */
export async function closeTaxShortfall(
  taxInvoiceId: number,
): Promise<{ ok: true; settled: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const [inv] = await db.execute<{ id: number; direction: string; total: number }>(sql`
    SELECT id, direction, total FROM tax_invoice WHERE id = ${taxInvoiceId} AND is_active
  `);
  if (!inv) return { ok: false, error: "세금계산서를 찾을 수 없습니다" };
  const [covRow] = await db.execute<{ s: string; cash_n: number }>(sql`
    SELECT COALESCE(SUM(amount), 0)::bigint s,
           count(*) FILTER (WHERE ref_table = 'cash_txn')::int cash_n
    FROM recon_match
    WHERE src_table = 'tax_invoice' AND src_id = ${taxInvoiceId} AND status = '확정'
      AND kind IN ('매입계산서', '매출계산서') AND ref_table IN ('cash_txn', 'adjust')
  `);
  if (Number(covRow.cash_n) === 0)
    return { ok: false, error: "먼저 통장 출금·입금을 하나 이상 이어 주세요" };
  const remain = Number(inv.total) - Number(covRow.s);
  if (remain <= 0) return { ok: false, error: "남은 차액이 없습니다 — 이미 확인이 끝났습니다" };
  const kind = inv.direction === "매출" ? "매출계산서" : "매입계산서";
  await db.execute(sql`
    INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
    VALUES (${kind}, 'tax_invoice', ${taxInvoiceId}, 'adjust', ${taxInvoiceId}, ${remain}, '확정', '수동', ${g.uid}, now())
  `);
  revalidatePath("/finance/tax");
  return { ok: true, settled: remain };
}

/**
 * ⭐ 계산서 한 건을 「경비」로 — 품목까지 기억한다 (사장님 제보 2026-08-25).
 *    미쉐린처럼 타이어 매입과 수수료(digital module)가 섞인 상대는 상대 전체가 아니라
 *    (상대 + 품목명) 조합으로 배운다: 같은 품목의 열린 계산서 일괄 + 새 업로드 자동.
 */
export async function markTaxExpense(
  taxInvoiceId: number,
): Promise<{ ok: true; applied: number; item: string | null } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const [inv] = await db.execute<{
    id: number; recon_status: string; counterparty_biz_no: string; item_summary: string | null;
  }>(sql`
    SELECT id, recon_status, counterparty_biz_no, item_summary FROM tax_invoice
    WHERE id = ${taxInvoiceId} AND is_active
  `);
  if (!inv) return { ok: false, error: "세금계산서를 찾을 수 없습니다" };
  if (inv.recon_status === "확정") return { ok: false, error: "이미 확정된 계산서입니다 — 먼저 되돌려 주세요" };

  const itemKey = normName(inv.item_summary ?? "");
  let applied = 0;
  if (itemKey.length >= 2) {
    await db.execute(sql`
      INSERT INTO tax_item_rule (biz_no, item_key, item_raw, kind)
      VALUES (${inv.counterparty_biz_no}, ${itemKey}, ${inv.item_summary}, '경비')
      ON CONFLICT (biz_no, item_key) DO UPDATE SET kind = '경비', updated_at = now()
    `);
    // 같은 상대 + 같은 품목의 열린 계산서 일괄 (품목 정규화가 JS 라 id 로 모아서)
    const opens = await db.execute<{ id: number; item_summary: string | null }>(sql`
      SELECT id, item_summary FROM tax_invoice
      WHERE is_active AND recon_status IN ('미대조', '제안')
        AND counterparty_biz_no = ${inv.counterparty_biz_no} LIMIT 300
    `);
    const ids = opens.filter((o) => normName(o.item_summary ?? "") === itemKey).map((o) => Number(o.id));
    if (ids.length > 0) {
      await db.execute(sql`
        UPDATE tax_invoice SET recon_status = '무시', recon_reason = '경비'
        WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      `);
      applied = ids.length;
    }
  } else {
    await db.execute(sql`
      UPDATE tax_invoice SET recon_status = '무시', recon_reason = '경비' WHERE id = ${taxInvoiceId}
    `);
    applied = 1;
  }
  revalidatePath("/finance/tax");
  return { ok: true, applied, item: itemKey.length >= 2 ? inv.item_summary : null };
}

/** 상대 유형 규칙 취소 — 잘못 지정했을 때. 실사용 기간의 자동 정리분을 되살린다 (과거분은 유지) */
export async function removeTaxPartyRule(
  bizNo: string,
): Promise<{ ok: true; revived: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const biz = bizNo.replace(/\D/g, "");
  const [r] = await db.execute<{ kind: string }>(sql`SELECT kind FROM tax_party_rule WHERE biz_no = ${biz}`);
  if (!r) return { ok: false, error: "그 상대의 규칙이 없습니다" };
  await db.execute(sql`DELETE FROM tax_party_rule WHERE biz_no = ${biz}`);
  // 대행정산은 계산서를 자동 정리한 적이 없어 되살릴 것도 없다 — 라벨만 지운다 (리뷰 지적)
  let revived = 0;
  if (r.kind !== "대행정산") {
    const rows = await db.execute<{ id: number }>(sql`
      UPDATE tax_invoice SET recon_status = '미대조', recon_reason = NULL
      WHERE is_active AND counterparty_biz_no = ${biz} AND recon_status = '무시'
        AND recon_reason = ${r.kind} AND write_date >= ${TAX_APP_START}::date
      RETURNING id
    `);
    revived = rows.length;
  }
  revalidatePath("/finance/tax");
  return { ok: true, revived };
}

/**
 * ⭐ 수정·마이너스 세금계산서 상쇄 (사장님 제보 2026-08-25 — "잘못 발행하면 나중에
 *    수정·추가·마이너스 발행을 한다"). 마이너스 계산서와 그 원본을 한 쌍으로 정리한다.
 */
export async function markTaxFixPair(
  minusId: number,
  originId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const rows = await db.execute<{ id: number; total: number; counterparty_biz_no: string; recon_status: string }>(sql`
    SELECT id, total, counterparty_biz_no, recon_status FROM tax_invoice
    WHERE id IN (${minusId}, ${originId}) AND is_active
  `);
  if (rows.length !== 2) return { ok: false, error: "계산서 두 건을 찾을 수 없습니다" };
  const a = rows.find((x) => Number(x.id) === minusId)!;
  const b = rows.find((x) => Number(x.id) === originId)!;
  if (a.counterparty_biz_no !== b.counterparty_biz_no) return { ok: false, error: "상대가 다른 계산서입니다" };
  if (Number(a.total) + Number(b.total) !== 0) return { ok: false, error: "두 계산서의 금액이 상쇄되지 않습니다" };
  if (a.recon_status === "확정" || b.recon_status === "확정")
    return { ok: false, error: "이미 확정된 계산서가 있습니다 — 먼저 되돌려 주세요" };
  await db.execute(sql`
    UPDATE tax_invoice SET recon_status = '무시', recon_reason = '수정상쇄'
    WHERE id IN (${minusId}, ${originId})
  `);
  revalidatePath("/finance/tax");
  return { ok: true };
}

/**
 * 🔴 감사 M17(2026-08-25): 「통장에서 직접 찾기」를 서버 검색으로 — 최신 200줄 풀이
 *   아니라 DB 전체에서 찾는다 (선입금·적립은 오래된 줄일 수 있다). 남은 금액 있는 줄만.
 */
export async function searchBankLines(
  direction: "매출" | "매입",
  query: string,
): Promise<{ ok: true; rows: { id: number; label: string }[] } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const q = query.trim();
  if (q.length < 1) return { ok: false, error: "검색어를 입력해 주세요" };
  const amt = Number(q.replace(/[^0-9]/g, "")) || 0;
  const isIn = direction === "매출";
  const rows = await db.execute<{
    id: number; date: string; description: string; amount: number; l: string; linked: string;
  }>(sql`
    SELECT c.id, to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           c.description, ${isIn ? sql.raw("c.in_amount") : sql.raw("c.out_amount")} amount, c.account_label l,
           ${cashUsedSql("c")} linked
    FROM cash_txn c
    WHERE c.source = '통장' AND c.is_active
      AND ${isIn ? sql.raw("c.in_amount > 0") : sql.raw("c.out_amount > 0")}
      AND (c.description ILIKE ${"%" + q + "%"}
           OR (${amt} > 0 AND ${isIn ? sql.raw("c.in_amount") : sql.raw("c.out_amount")} = ${amt}))
    ORDER BY c.occurred_at DESC LIMIT 20
  `);
  const out = rows
    .map((r) => ({ ...r, remain: Number(r.amount) - Number(r.linked) }))
    .filter((r) => r.remain > 0)
    .slice(0, 12)
    .map((r) => ({
      id: Number(r.id),
      label: `${r.date.slice(5)} · ${payerKeyOf("통장", r.description).slice(0, 20)} · ${isIn ? "+" : "−"}${r.remain.toLocaleString()}원 (${r.l})`,
    }));
  return { ok: true, rows: out };
}
