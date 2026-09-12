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
import { getSession, hasPerm } from "@/lib/auth";
import { payerKeyOf } from "./expense-cats";
import { cashUsedMap, cashUsedSql, normDescSql, normName } from "./recon-data";
import { taxReconV2 } from "./tax-recon";
/* 개편 4단계(2026-09-12): setTaxPartyRuleCore·removeTaxPartyRuleCore 추가 —
   「자동 규칙」 화면의 켜기·끄기가 이 액션과 **같은 본문**을 쓰게 하려고 코어로 옮겼다 */
import { confirmBankToTaxesCore, confirmMonthlyPartyCore, confirmSureTaxCore, confirmTaxToBankCore, confirmTaxToBanksCore, markTaxFixPairCore, removeTaxPartyRuleCore, setTaxPartyRuleCore } from "./recon-core";
/* 개편 4단계(2026-09-12): 별명 학습은 정본 한 곳(deposit-core.learnAlias) — 손 INSERT 복제를 없앴다 */
import { learnAlias } from "./deposit-core";
import { restoreCashLine } from "./cash-restore";
import { revalidateFinance } from "./fin-revalidate";
import { logActivity } from "./fin-activity";
import { howOfMethod, type ActivityEntry, type UndoItem } from "./fin-activity-types";
import { activityItems } from "./recon-core";
import { autoReconLabel, W } from "./fin-words";

const won = (n: number) => n.toLocaleString("ko-KR");

export interface MatchRef {
  table: "purchase_invoice" | "quote";
  id: number;
  amount: number;
}

async function guard(): Promise<{ ok: true; uid: number | null } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
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
  /** 일괄(autoConfirmTax)이 한 줄 n건으로 접을 때 — 낱장 기록을 막는다 */
  quiet?: boolean;
},
  /** ⭐ 「☑ 다음부터 자동으로」(개편 4단계, 2026-09-12) — 끄면 계산서 상호 별명을 안 배운다 */
  opts?: { learn?: boolean },
): Promise<{ ok: true; warning: string | null; activity?: ActivityEntry } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const refs = (input.refs ?? []).filter((r) => Number.isInteger(r.id) && r.id > 0).slice(0, 30);
  if (refs.length === 0) return { ok: false, error: `${W.recon}할 기록을 골라 주세요` };

  const [inv] = await db.execute<{
    id: number; direction: string; recon_status: string; counterparty_biz_no: string;
    counterparty_name: string; total: number; ym: string;
  }>(sql`
    SELECT id, direction, recon_status, counterparty_biz_no, counterparty_name, total,
           to_char(write_date, 'YYYY-MM') ym
    FROM tax_invoice
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
    return { ok: false, error: `이미 앱 기록과 ${W.recon}된 계산서입니다 — 먼저 되돌려 주세요` };

  // ref 존재 검증 — FK 가 없으니 여기서 (kind 별로)
  for (const r of refs) {
    if (inv.direction === "매입" && r.table !== "purchase_invoice")
      return { ok: false, error: `매입 계산서는 매입 기록과만 ${W.recon}할 수 있습니다` };
    if (inv.direction === "매출" && r.table !== "quote")
      return { ok: false, error: `매출 계산서는 판매 기록과만 ${W.recon}할 수 있습니다` };
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
    if (taken.length > 0) return { ok: false, error: `기록 ${r.table}#${r.id} 은(는) 이미 다른 계산서와 ${W.recon}돼 있습니다` };
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
    /* 개편 4단계(2026-09-12): 손으로 심던 INSERT 를 정본 learnAlias 로 — 「☑ 다음부터 자동으로」를
       끄면(learn:false) 안 배운다. 일괄(quiet)이면 규칙 줄도 접는다.
       🔴 트랜잭션 밖(위 확정은 이미 커밋됐다). try/catch 는 위 상대 찾기 SELECT 두 개 때문에
          그대로 둔다 — learnAlias 자신은 실패를 삼키지만 그 SELECT 는 안 삼킨다 */
    if (partyKey) {
      await learnAlias(inv.counterparty_name, partyKey, partyLabel, {
        uid: g.uid,
        learn: opts?.learn,
        quiet: input.quiet,
      });
    }
  } catch {
    // 별명 학습 실패는 확정 자체를 막지 않는다
  }

  /* ⭐ 최근 한 일 — 되돌리기 = undoTaxMatch(taxInvoiceId, '전부') (앱 기록 연결만 푸는 scope 는 없다) */
  const refWord = inv.direction === "매입" ? "매입" : "판매";
  const activity: ActivityEntry = {
    ym: inv.ym,
    actor: g.uid,
    how: howOfMethod(input.method),
    verb: "대사",
    target: { table: "tax_invoice", id: input.taxInvoiceId },
    amount: Number(inv.total),
    label: `계산서 ${inv.counterparty_name} ${won(Number(inv.total))} ↔ 앱 ${refWord} 기록${refs.length > 1 ? ` ${refs.length}건` : ""}`,
    undo: { kind: "tax", args: { taxInvoiceId: input.taxInvoiceId, scope: "전부" } },
  };
  if (!input.quiet) await logActivity(activity);

  revalidateFinance(); // 2026 감사 N9: 현황·원장·입금까지
  revalidatePath("/finance");
  return { ok: true, warning, activity };
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
  /* 개편 4단계(2026-09-12): 정본 learnAlias 로. 🔴 quiet — 이 액션은 **일부러 규칙을 지정하는**
     것이라 아래에 제 규칙 줄을 이미 남긴다. learnAlias 가 또 남기면 한 번 눌러 두 줄이 된다.
     여기엔 「다음부터 자동으로」 체크가 없다(지정 자체가 규칙 만들기다) — 항상 배운다 */
  await learnAlias(inv.counterparty_name, `S:${sup.name}`, `거래처 ${sup.name}`, { uid: g.uid, quiet: true });
  /* ⭐ 최근 한 일 — 되돌리기 = 그 별명 규칙 끄기(개편 4단계 — 전엔 되돌릴 길이 없었다) */
  await logActivity({
    actor: g.uid,
    how: "사람",
    verb: "규칙",
    target: { table: "tax_invoice", id: taxInvoiceId },
    label: `${W.ruleSaved}: 계산서 상호 「${inv.counterparty_name}」 = 거래처 ${sup.name}`,
    undo: { kind: "ruleOff", args: { ruleKind: "alias", key: normName(inv.counterparty_name) } },
  });
  revalidateFinance(); // 2026 감사 N9: 현황·원장·입금까지
  return { ok: true, learned: sup.name, warning };
}

/** 자동확정 가능한 것(정확 일치·유일·사업자번호 확실)을 서버가 다시 계산해 한꺼번에 확정 */
export async function autoConfirmTax(
  ym: string,
): Promise<{ ok: true; confirmed: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  // 🔴 화면이 보낸 목록을 믿지 않는다 — 서버가 같은 규칙으로 다시 계산한다 (보는 달과 같은 범위)
  const data = await taxReconV2(ym);
  let confirmed = 0;
  const items: UndoItem[] = [];
  for (const s of data.groups.flatMap((g) => g.items)) {
    if (!s.auto) continue;
    const r = await confirmTaxMatch({
      taxInvoiceId: s.inv.id,
      refs: [{ table: s.auto.table, id: s.auto.id, amount: s.auto.amount }],
      method: "자동",
      learnSupplierId: s.learnable ? s.supplierId : null,
      quiet: true,
    });
    if (r.ok) {
      confirmed++;
      items.push(...activityItems(r.activity));
    }
  }
  /* ⭐ 최근 한 일 — 한 줄 n건 (건별 되돌리기는 items) */
  if (items.length > 0) {
    await logActivity({
      ym,
      actor: g.uid,
      how: "자동",
      verb: "대사",
      n: items.length,
      amount: items.reduce((s, i) => s + (i.amount ?? 0), 0),
      label: `${autoReconLabel(items.length)} · 계산서 ↔ 앱 기록 ${ym}`,
      undo: { kind: "bulk", args: { items } },
    });
  }
  revalidateFinance(); // 2026 감사 N9: 현황·원장·입금까지
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
  const [invRow] = await db.execute<{ recon_reason: string | null; counterparty_name: string; counterparty_biz_no: string; total: number; ym: string }>(sql`
    SELECT recon_reason, counterparty_name, counterparty_biz_no, total, to_char(write_date, 'YYYY-MM') ym
    FROM tax_invoice WHERE id = ${taxInvoiceId}
  `);
  const gone = await db.execute<{ ref_table: string; ref_id: number }>(sql`
    DELETE FROM recon_match WHERE src_table = 'tax_invoice' AND src_id = ${taxInvoiceId}
      AND kind IN ('매입계산서', '매출계산서')
      ${scope === "통장" ? sql`AND ref_table IN ('cash_txn', 'adjust')` : sql``}
    RETURNING ref_table, ref_id
  `);
  /* 🔴 2026 감사 G4(2026-08-26): 계산서의 마지막 사유 하나로 N개 통장 줄을 일괄 복원하던 것을
     줄 단위 정본(restoreCashLine)으로 — 다른 확정 연결이 남은 줄은 '제안', '매입대금'은 매입
     연결이 하나도 안 남았을 때만 해제 */
  for (const mrow of gone) {
    if (mrow.ref_table === "cash_txn") await restoreCashLine(db, Number(mrow.ref_id));
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
    for (const mrow of gone) {
      if (mrow.ref_table !== "cash_txn") continue;
      const [depRow] = await db.execute<{ description: string }>(sql`
        SELECT description FROM cash_txn WHERE id = ${mrow.ref_id}
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
  /* ⭐ 최근 한 일 — 되돌리기 자체도 한 줄 (되돌리기의 되돌리기는 없다, 결정 c) */
  await logActivity({
    ym: invRow?.ym ?? null,
    actor: g.uid,
    how: "사람",
    verb: "되돌리기",
    target: { table: "tax_invoice", id: taxInvoiceId },
    n: Math.max(1, gone.length),
    amount: invRow ? Number(invRow.total) : null,
    label: `${W.undo}: 계산서 ${invRow?.counterparty_name ?? ""} ${scope === "통장" ? `통장 ${W.recon}` : `${W.recon} 전부`} 풀기 (${gone.length}건)`,
  });
  revalidateFinance(); // 2026 감사 N9: 현황·원장·입금까지
  revalidatePath("/finance");
  revalidatePath("/finance/deposits");
  revalidatePath("/finance/expenses");
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
  const done = await db.execute<{ counterparty_name: string; total: number; ym: string }>(sql`
    UPDATE tax_invoice SET recon_status = ${back ? "미대조" : "무시"},
           recon_reason = ${back ? null : "직접"}
    WHERE id = ${taxInvoiceId} AND recon_status <> '확정'
    RETURNING counterparty_name, total, to_char(write_date, 'YYYY-MM') ym
  `);
  /* ⭐ 최근 한 일 — 제외/되살리기. 되돌리기 = ignoreTaxInvoice(id, true) */
  if (done[0]) {
    await logActivity({
      ym: done[0].ym,
      actor: g.uid,
      how: "사람",
      verb: back ? "되돌리기" : "제외",
      target: { table: "tax_invoice", id: taxInvoiceId },
      amount: Number(done[0].total),
      label: back
        ? `${W.undo}: 계산서 ${done[0].counterparty_name} ${won(Number(done[0].total))} 되살리기`
        : `${W.ignore}: 계산서 ${done[0].counterparty_name} ${won(Number(done[0].total))}`,
      undo: back ? null : { kind: "taxRevive", args: { taxInvoiceId } },
    });
  }
  revalidateFinance(); // 2026 감사 N9: 현황·원장·입금까지
  return { ok: true };
}

/* ================================================================== */
/* 대조 v2 — 상대 유형·입금 연결 (사장님 승인 2026-08-25)                 */

/**
 * 상대(사업자번호) 유형 지정 — 한 번 정하면 과거·미래 계산서가 계속 자동 처리된다.
 * '경비'·'무시' = 열린 계산서를 전부 무시(사유 포함).
 * '대행정산'·'월정산' = 라벨만 — 대행정산은 입금 연결로, 월정산은 월 잔액으로 확인한다.
 */
export async function setTaxPartyRule(input: {
  bizNo: string;
  nameRaw: string;
  kind: "경비" | "대행정산" | "무시" | "월정산";
}): Promise<{ ok: true; applied: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  /* 개편 4단계(2026-09-12): 본문은 recon-core.setTaxPartyRuleCore — 「자동 규칙」 화면의 되살리기가
     같은 함수를 쓴다. 기록(규칙 저장 한 줄)은 코어가 남긴다 — 동작·기록 전과 같다 */
  const r = await setTaxPartyRuleCore(input.bizNo, input.nameRaw, input.kind, g.uid);
  if (!r.ok) return r;
  revalidateFinance(); // 2026 감사 N9: 현황·원장·입금까지
  revalidatePath("/finance");
  return { ok: true, applied: r.applied };
}

/**
 * 계산서 ↔ 통장 직접 연결 — 규칙은 recon-core.ts(코어) 한 벌. 여기는 권한 검사와 화면 갱신만 (2026-08-26).
 */
export async function confirmTaxToBank(
  taxInvoiceId: number,
  cashTxnId: number,
  /** ⭐ 「☑ 다음부터 자동으로」(개편 4단계, 2026-09-12) — 끄면(learn:false) 입금자 별명을 안 배운다.
      🔴 맨 끝 선택 인자라 이 인자를 안 주는 기존 호출은 전과 똑같이 배운다(기본 켜짐, 결정 7③) */
  opts?: { learn?: boolean },
): Promise<{ ok: true; remaining: number; shortfall: number; netted: boolean } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const r = await confirmTaxToBankCore(taxInvoiceId, cashTxnId, g.uid, "수동", { learn: opts?.learn });
  if (r.ok) revalidateFinance();
  return r;
}

/** 여러 통장 줄을 한 계산서에 (허용 오차 잔돈·차액 자동 정리) */
export async function confirmTaxToBanks(
  taxInvoiceId: number,
  cashTxnIds: number[],
  opts?: { learn?: boolean },
): Promise<
  | { ok: true; applied: number; remaining: number; shortfall: number; absorbed: number; settled: number }
  | { ok: false; error: string }
> {
  const g = await guard();
  if (!g.ok) return g;
  const r = await confirmTaxToBanksCore(taxInvoiceId, cashTxnIds, g.uid, "수동", { learn: opts?.learn });
  if (r.ok) revalidateFinance();
  return r;
}

/** 통장 한 줄 → 계산서 여러 장 */
export async function confirmBankToTaxes(
  cashTxnId: number,
  taxInvoiceIds: number[],
  opts?: { learn?: boolean },
): Promise<{ ok: true; applied: number; remaining: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const r = await confirmBankToTaxesCore(cashTxnId, taxInvoiceIds, g.uid, "수동", { learn: opts?.learn });
  if (r.ok) revalidateFinance();
  return r;
}

/** 월정산 상대의 「이 달 맞음」 */
export async function confirmMonthlyParty(
  bizNo: string,
  ym: string,
  direction: "매입" | "매출",
): Promise<{ ok: true; applied: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const r = await confirmMonthlyPartyCore(bizNo, ym, direction, g.uid, "수동"); // 기록은 코어가 남긴다
  if (r.ok) revalidateFinance();
  return r;
}

/** ⭐ 돈 확인 뷰 「짝이 확실한 N건 모두 잇기」 (2026-08-26) — 서버가 같은 규칙으로 다시 계산한다 */
export async function confirmSureTax(
  ym: string,
  direction: "매입" | "매출",
): Promise<{ ok: true; applied: number; failed: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return { ok: false, error: "달이 이상합니다" };
  const r = await confirmSureTaxCore(ym, direction, g.uid, "자동");
  revalidateFinance();
  return { ok: true, ...r };
}


/**
 * ⭐ 「아직 안 들어옴 / 아직 안 줌」으로 미루기 (사장님 질문 2026-08-27)
 *
 *   "카랑은 보통 다음달에 입금을 해주는데 아직 안 들어온 건 어떻게 처리해야하나?"
 *
 * 🔴 「정리(무시)」와 헷갈리면 안 된다 —
 *      정리(무시) = 없던 일로 한다. 셈에서 뺀다. (수정 상쇄·경비 계산서)
 *      미루기(대기) = **돈이 아직 안 왔을 뿐이다.** 받을 돈으로 남는다.
 *
 * 이 달 「돈 확인할 것」에서는 빠지지만 통장 후보 풀에는 그대로 있다 —
 * 다음 달 입금이 오면 그 줄과 이으면 `confirmTaxToBank` 가 '확정' 으로 바꾼다.
 * 이미 확정된 계산서는 미룰 수 없다 (먼저 되돌려야 한다).
 */
export async function markTaxWaiting(
  taxInvoiceId: number,
  on: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const [inv] = await db.execute<{ id: number; recon_status: string; counterparty_name: string; total: number; ym: string }>(sql`
    SELECT id, recon_status, counterparty_name, total, to_char(write_date, 'YYYY-MM') ym
    FROM tax_invoice WHERE id = ${taxInvoiceId} AND is_active
  `);
  if (!inv) return { ok: false, error: "세금계산서를 찾을 수 없습니다" };
  if (on && inv.recon_status === "확정")
    return { ok: false, error: "이미 돈 확인이 끝난 계산서입니다 — 먼저 되돌려 주세요" };
  if (!on && inv.recon_status !== "대기") return { ok: false, error: `${W.hold}한 계산서가 아닙니다` };
  await db.execute(sql`
    UPDATE tax_invoice
    SET recon_status = ${on ? "대기" : "미대조"},
        recon_reason = ${on ? "아직 안 들어옴" : null}
    WHERE id = ${taxInvoiceId}
  `);
  /* ⭐ 최근 한 일 — 되돌리기 = markTaxWaiting(id, false) */
  await logActivity({
    ym: inv.ym,
    actor: g.uid,
    how: "사람",
    verb: on ? "보류" : "되돌리기",
    target: { table: "tax_invoice", id: taxInvoiceId },
    amount: Number(inv.total),
    label: on
      ? `${W.hold}: 계산서 ${inv.counterparty_name} ${won(Number(inv.total))} — 아직 안 들어옴`
      : `${W.undo}: 계산서 ${inv.counterparty_name} ${won(Number(inv.total))} ${W.hold} 풀기`,
    undo: on ? { kind: "taxUnwait", args: { taxInvoiceId } } : null,
  });
  revalidateFinance();
  return { ok: true };
}

/**
 * ⭐ 월정산 거래처 「시작 잔액 고치기」 (계산서 화면 개편 결정 7, 2026-09-11)
 *
 *   기준일(기본 2026-08-25)과 그날의 시작 잔액(세무사 원장 잔액 — 사장님 8/26 「일치」 회신)을 상대별로 둔다.
 *   남은 돈 = 시작 잔액 + 기준일 이후 계산서 − 기준일 이후 지급 (정본 monthlyRemain, tax-recon.ts).
 *   세무사 표에 없는 곳은 앱 추정을 넣어 두었으니(scripts/add-tax-baseline.ts) 명세서를 받으면 여기서 고친다.
 *   음수도 허용 — 선급(딜러타이어 페이머니)이면 잔액이 마이너스일 수 있다.
 */
export async function setTaxBaseline(
  bizNo: string,
  date: string,
  amount: number,
  note: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const biz = String(bizNo ?? "").replace(/\D/g, "");
  if (biz.length < 5) return { ok: false, error: "사업자번호가 올바르지 않습니다" };
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date) || Number.isNaN(Date.parse(date)))
    return { ok: false, error: "기준일은 2026-08-25 처럼 적어 주세요" };
  if (!Number.isInteger(amount) || Math.abs(amount) > 5_000_000_000)
    return { ok: false, error: "시작 잔액은 원 단위 정수로 적어 주세요" };
  const memo = String(note ?? "").trim().slice(0, 200) || null;
  /* 기록에 이전 값을 남기려고 한 번 읽는다 (수정은 되돌리기 없음 — 이전 값이 label 에 있다) */
  const [prev] = await db.execute<{ name_raw: string; baseline_amount: number | null; baseline_date: string | null }>(sql`
    SELECT name_raw, baseline_amount, to_char(baseline_date, 'YYYY-MM-DD') baseline_date
    FROM tax_party_rule WHERE biz_no = ${biz} AND kind = '월정산'
  `);
  const rows = await db.execute<{ biz_no: string }>(sql`
    UPDATE tax_party_rule
    SET baseline_date = ${date}::date, baseline_amount = ${amount}, baseline_note = ${memo}, updated_at = now()
    WHERE biz_no = ${biz} AND kind = '월정산'
    RETURNING biz_no
  `);
  if (rows.length === 0) return { ok: false, error: `${W.monthly}으로 지정된 상대가 아닙니다 — 먼저 「${W.monthly}」으로 지정해 주세요` };
  await logActivity({
    ym: date.slice(0, 7),
    actor: g.uid,
    how: "사람",
    verb: "수정",
    amount,
    label: `수정: ${prev?.name_raw ?? biz} 시작 잔액 ${prev?.baseline_amount == null ? "없음" : won(Number(prev.baseline_amount))} → ${won(amount)} (기준일 ${prev?.baseline_date ?? "없음"} → ${date})`,
  });
  revalidatePath("/finance/tax");
  revalidatePath("/finance"); // 현황 「할 일」 수(taxOpenCounts)가 남은 돈에 따라 바뀐다
  return { ok: true };
}

/** 월정산 「이 달 맞음」 되돌리기 */
export async function undoMonthlyParty(
  bizNo: string,
  ym: string,
  direction: "매입" | "매출",
): Promise<{ ok: true; reverted: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const biz = bizNo.replace(/\D/g, "");
  const rows = await db.execute<{ id: number; counterparty_name: string; total: number }>(sql`
    UPDATE tax_invoice SET recon_status = '미대조', recon_reason = NULL
    WHERE is_active AND counterparty_biz_no = ${biz} AND direction = ${direction}
      AND recon_reason = '월정산'
      AND write_date >= (${ym} || '-01')::date
      AND write_date < ((${ym} || '-01')::date + INTERVAL '1 month')
    RETURNING id, counterparty_name, total
  `);
  if (rows.length > 0) {
    await logActivity({
      ym,
      actor: g.uid,
      how: "사람",
      verb: "되돌리기",
      target: { table: "tax_invoice", id: Number(rows[0].id) },
      n: rows.length,
      amount: rows.reduce((s, r) => s + Number(r.total), 0),
      label: `${W.undo}: ${W.monthly} ${rows[0].counterparty_name} ${ym} 이 달 맞음 풀기 (계산서 ${rows.length}장)`,
    });
  }
  revalidateFinance(); // 2026 감사 N9: 현황·원장·입금까지
  return { ok: true, reverted: rows.length };
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
  const [inv] = await db.execute<{ id: number; direction: string; total: number; counterparty_name: string; ym: string }>(sql`
    SELECT id, direction, total, counterparty_name, to_char(write_date, 'YYYY-MM') ym
    FROM tax_invoice WHERE id = ${taxInvoiceId} AND is_active
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
    return { ok: false, error: `먼저 통장 출금·입금을 하나 이상 ${W.recon}해 주세요` };
  const remain = Number(inv.total) - Number(covRow.s);
  if (remain <= 0) return { ok: false, error: "남은 차액이 없습니다 — 이미 확인이 끝났습니다" };
  const kind = inv.direction === "매출" ? "매출계산서" : "매입계산서";
  await db.execute(sql`
    INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
    VALUES (${kind}, 'tax_invoice', ${taxInvoiceId}, 'adjust', ${taxInvoiceId}, ${remain}, '확정', '수동', ${g.uid}, now())
  `);
  /* ⭐ 최근 한 일 — 되돌리기(통장)가 adjust 자국도 함께 지운다 */
  await logActivity({
    ym: inv.ym,
    actor: g.uid,
    how: "사람",
    verb: "대사",
    target: { table: "tax_invoice", id: taxInvoiceId },
    amount: remain,
    label: `차액 조정 ${won(remain)} → 계산서 ${inv.counterparty_name} ${won(Number(inv.total))} 확인 끝`,
    undo: { kind: "tax", args: { taxInvoiceId, scope: "통장" } },
  });
  revalidateFinance(); // 2026 감사 N9: 현황·원장·입금까지
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
    id: number; recon_status: string; counterparty_biz_no: string; item_summary: string | null; counterparty_name: string; ym: string;
  }>(sql`
    SELECT id, recon_status, counterparty_biz_no, item_summary, counterparty_name, to_char(write_date, 'YYYY-MM') ym
    FROM tax_invoice
    WHERE id = ${taxInvoiceId} AND is_active
  `);
  if (!inv) return { ok: false, error: "세금계산서를 찾을 수 없습니다" };
  if (inv.recon_status === "확정") return { ok: false, error: `이미 ${W.done}된 계산서입니다 — 먼저 되돌려 주세요` };

  const itemKey = normName(inv.item_summary ?? "");
  let applied = 0;
  let appliedIds: number[] = [taxInvoiceId];
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
      appliedIds = ids;
    }
  } else {
    await db.execute(sql`
      UPDATE tax_invoice SET recon_status = '무시', recon_reason = '경비' WHERE id = ${taxInvoiceId}
    `);
    applied = 1;
  }
  /* ⭐ 최근 한 일 — 건별 되돌리기 = ignoreTaxInvoice(id, true) (품목 규칙도 함께 지운다) */
  const items: UndoItem[] = appliedIds.map((id) => ({
    kind: "taxRevive",
    args: { taxInvoiceId: id },
    label: `계산서 ${inv.counterparty_name}${id === taxInvoiceId ? "" : ` #${id}`} 되살리기`,
  }));
  await logActivity({
    ym: inv.ym,
    actor: g.uid,
    how: "사람",
    verb: "규칙",
    target: { table: "tax_invoice", id: taxInvoiceId },
    n: Math.max(1, applied),
    label: `규칙 저장: ${inv.counterparty_name}${itemKey.length >= 2 ? ` 「${inv.item_summary}」` : ""} = 경비 (계산서 ${applied}장 ${W.ignore})`,
    undo: items.length === 1 ? { kind: "taxRevive", args: { taxInvoiceId } } : { kind: "bulk", args: { items } },
  });
  revalidateFinance(); // 2026 감사 N9: 현황·원장·입금까지
  return { ok: true, applied, item: itemKey.length >= 2 ? inv.item_summary : null };
}

/** 상대 유형 규칙 취소 — 잘못 지정했을 때. 자동 정리분을 **모든 달** 되살린다
 *  (🔴 2025 감사 F7: 지정은 전 기간인데 취소는 2026-08 이후만 되살려 20개월치가 묻혔다) */
export async function removeTaxPartyRule(
  bizNo: string,
): Promise<{ ok: true; revived: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  /* 개편 4단계(2026-09-12): 본문은 recon-core.removeTaxPartyRuleCore — 「자동 규칙」 화면의 끄기가
     같은 함수를 쓴다(계산서 되살리기 논리 그대로). 기록 한 줄도 코어가 남긴다 */
  const r = await removeTaxPartyRuleCore(bizNo, g.uid);
  if (!r.ok) return r;
  revalidateFinance(); // 2026 감사 N9: 현황·원장·입금까지
  return { ok: true, revived: r.revived };
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
  const r = await markTaxFixPairCore(minusId, originId, false, g.uid); // 기록은 코어가 남긴다
  if (!r.ok) return r;
  revalidateFinance(); // 2026 감사 N9: 현황·원장·입금까지
  return { ok: true };
}

/**
 * 🔴 감사 M17(2026-08-25): 「통장에서 직접 찾기」를 서버 검색으로 — 최신 200줄 풀이
 *   아니라 DB 전체에서 찾는다 (선입금·적립은 오래된 줄일 수 있다). 남은 금액 있는 줄만.
 */
export interface BankHit {
  id: number;
  label: string;
  /** 남은 금액 — 「골라서 잇기」 합계 계산용 */
  amount: number;
  /** 계산서 방향과 반대인 줄 — 상계(정산에서 차감·매입과 상계)로 처리된 건 */
  opposite: boolean;
}

/**
 * 🔴 감사 M17(2026-08-25): 「통장에서 직접 찾기」를 서버 검색으로 — DB 전체에서 찾는다.
 *
 * ⭐ 보완(사장님 제보 2026-08-25 — "(주)트랜스코스·맥스런이 검색이 안 됨"):
 *    ① **양방향**으로 찾는다. 온라인몰 정산사는 수수료(매입)를 정산 입금에서 떼고,
 *       서로 사고파는 거래처는 매출 대금을 매입과 상계해 반대 방향으로만 찍힌다.
 *       방향이 맞는 것을 먼저, 반대인 것은 opposite 로 표시해 뒤에 보여준다.
 *    ② **이름 정규화** 매칭 — 은행 적요는 12자쯤에서 잘리고((주)트랜스코스),
 *       ㈜·(주)·주식회사·공백 표기도 제각각이라 상호 그대로는 안 걸린다.
 */
export async function searchBankLines(
  direction: "매출" | "매입",
  query: string,
  /** 계산서 날짜(YYYY-MM-DD) — 주면 그 날짜에 가까운 줄부터 (🔴 2025 감사 F9: 최신순 80건 컷은
   *  20개월 거래처의 2025 줄에 영원히 못 닿았다) */
  anchor?: string,
): Promise<{ ok: true; rows: BankHit[] } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const q = query.trim();
  if (q.length < 1) return { ok: false, error: "검색어를 입력해 주세요" };
  const qEsc = q.replace(/([%_\\])/g, "\\$1"); // LIKE 와일드카드 이스케이프 (감사 C7)
  const amt = Number(q.replace(/[^0-9]/g, "")) || 0;
  const nq = normName(q);
  const wantIn = direction === "매출";
  /* ⭐ 은행 적요는 12자쯤에서 잘린다(「(주)트랜스코스」) — 상호 전체로는 못 찾는다.
     그래서 ①정규화한 검색어 ②그 앞 5자 ③심어 둔 별명(금호타이어→「조준호A금호타」)
     세 갈래로 찾는다. 이걸 안 해서 「(주)트랜스코스」·「맥스런」이 0건이었다. */
  const aliasRows =
    nq.length >= 2
      ? await db.execute<{ raw: string }>(sql`
          SELECT alias_raw raw FROM party_alias
          WHERE party_label ILIKE ${"%" + qEsc + "%"}
             OR split_part(alias_key, '@', 1) LIKE ${"%" + nq + "%"} -- 사업자번호부 오탐 방지(C7)
          LIMIT 10
        `)
      : [];
  const pats = [...new Set([nq, nq.length >= 5 ? nq.slice(0, 5) : "", ...aliasRows.map((a) => normName(a.raw))]
    .filter((p) => p.length >= 2))];
  // 🔴 감사 B1(2026-08-25): 손 복제본은 \(주\) 가 캡처그룹으로 죽어 '주' 글자를
  //    전부 지웠다("광주고무" 검색 0건 경로) — 정규화는 정본 하나만 쓴다
  const NORM_DESC = normDescSql("c.description");
  const nameCond =
    pats.length > 0
      ? sql.join(pats.map((p) => sql`${NORM_DESC} LIKE ${"%" + p + "%"}`), sql` OR `)
      : sql`false`;
  const rows = await db.execute<{
    id: number; date: string; description: string; in_amount: number; out_amount: number;
    l: string; linked: string;
  }>(sql`
    SELECT c.id, to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           c.description, c.in_amount, c.out_amount, c.account_label l,
           ${cashUsedSql("c")} linked
    FROM cash_txn c
    WHERE c.source = '통장' AND c.is_active
      AND (c.in_amount > 0 OR c.out_amount > 0)
      AND (c.category IS NULL OR c.category = '매입대금') -- 카드정산·내부이체·급여는 후보 아님(C7)
      AND (c.in_amount + c.out_amount) > ${cashUsedSql("c")} -- 남은 금액 있는 줄만 (2026 감사 N8: 상위 60줄이 전부 소진이면 "없음"이 뜨던 것)
      AND (c.description ILIKE ${"%" + qEsc + "%"}
           OR (${nameCond})
           OR (${amt} > 0 AND (c.in_amount = ${amt} OR c.out_amount = ${amt})))
    ORDER BY ${
      anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor)
        ? sql`abs((c.occurred_at AT TIME ZONE 'Asia/Seoul')::date - ${anchor}::date)`
        : sql`c.occurred_at DESC`
    } LIMIT 60
  `);
  const out = rows
    .map((r) => {
      const isIn = Number(r.in_amount) > 0;
      const amount = isIn ? Number(r.in_amount) : Number(r.out_amount);
      return { ...r, isIn, remain: amount - Number(r.linked) };
    })
    .filter((r) => r.remain > 0)
    // 방향이 맞는 줄을 먼저 — 반대 방향(상계)은 뒤에
    .sort((a, b) => Number(a.isIn !== wantIn) - Number(b.isIn !== wantIn))
    .slice(0, 12)
    .map((r) => ({
      id: Number(r.id),
      // 연도 포함 날짜, 시트명 제거 (2025 감사 F3 — 라벨 정본 bankLabel 과 같은 꼴)
      label: `${r.isIn !== wantIn ? "↔ " : ""}${r.date.slice(2)} · ${payerKeyOf("통장", r.description).slice(0, 20)} · ${r.isIn ? "+" : "−"}${r.remain.toLocaleString()}원`,
      amount: r.remain,
      opposite: r.isIn !== wantIn,
    }));
  return { ok: true, rows: out };
}
