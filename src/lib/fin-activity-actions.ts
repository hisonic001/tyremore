"use server";

/**
 * ⭐ 「최근 한 일」 되돌리기 서버 액션 (개편 2단계, 2026-09-12) — 사장님 결정 14 「되돌리기는 한 곳에」
 *
 *   fin_activity 한 줄의 undo_kind 를 보고 **기존 undo 함수만** 부른다 — 라우팅 표는 fin-activity-types.ts 상단 주석.
 *   🔴 새 되돌리기 논리를 만들지 않는다(2단계 결정 c). 여기서 하는 건 「어느 함수를 부를지」와 undone_at 찍기뿐.
 *   🔴 되돌리기의 되돌리기는 안 한다 — 되돌린 줄은 회색 「되돌림」. 이미 undone_at 이면 거절.
 *
 *   정본(fin-activity.ts)은 코어가 import 하므로 "use server" 가 아니라서 액션은 이 파일에 따로 둔다.
 */
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { getSession, hasPerm } from "./auth";
import { parseUndoArgs, undoItemsOf } from "./fin-activity";
import type { UndoItem, UndoKind } from "./fin-activity-types";
import { ignoreTaxInvoice, markTaxWaiting, removeTaxPartyRule, undoMonthlyParty, undoTaxMatch } from "./recon";
import { undoDepositKind, undoDepositLink, unmarkCardSettlement } from "./fin-deposits";
import { markSaleSettledAside } from "./trace-actions";
import { removePurchasePayment, skipWithdrawal, undoPayFromWithdrawal } from "./purchase-pay";
import { clearPosNote, reopenPosDay, unlinkMatch } from "./pos-actions";
import { setExpenseCategory } from "./fin-expense";
import { removeCollection } from "./receivable";
import { reopenMonth } from "./month-close";
import { cancelFinUpload } from "./fin-upload";

type Result = { ok: true } | { ok: false; error: string };
type Args = Record<string, unknown>;

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));
const str = (v: unknown): string => (v == null ? "" : String(v));

/**
 * 종류 하나 → 기존 함수 하나. 시그니처는 실제 파일 기준(표와 다른 곳은 여기서 맞춘다):
 *   · tax 의 scope 는 실제 undoTaxMatch 가 "통장"|"전부" 만 받는다 — 표의 "앱" 은 "전부" 로.
 *   · expense 는 해제(null) + scope 'one'|'all' (기본 one — 이 줄만).
 *   · note 는 clearPosNote(ref) 의 ref = `${refTable}:${refId}` (pos-actions 의 'pos:'·'quote:' 관례).
 */
async function undoOne(kind: Exclude<UndoKind, "bulk">, a: Args): Promise<Result> {
  switch (kind) {
    case "tax": {
      const scope = a.scope === "통장" ? "통장" : "전부";
      return undoTaxMatch(num(a.taxInvoiceId), scope);
    }
    case "deposit":
      return undoDepositLink(num(a.cashTxnId));
    case "aside":
      return markSaleSettledAside(num(a.quoteId), true);
    case "pay":
      return undoPayFromWithdrawal(num(a.cashTxnId));
    case "payment":
      return removePurchasePayment(num(a.paymentId));
    case "pos":
      return unlinkMatch(num(a.matchId));
    case "expense":
      return setExpenseCategory(num(a.cashTxnId), null, { scope: a.scope === "all" ? "all" : "one" });
    case "depositKind":
      return undoDepositKind(num(a.cashTxnId));
    case "cardSettle":
      return unmarkCardSettlement(num(a.cashTxnId));
    case "collection":
      return removeCollection(num(a.paymentId));
    case "taxRevive":
      return ignoreTaxInvoice(num(a.taxInvoiceId), true);
    case "taxUnwait":
      return markTaxWaiting(num(a.taxInvoiceId), false);
    case "monthly":
      return undoMonthlyParty(str(a.bizNo), str(a.ym), a.direction === "매출" ? "매출" : "매입");
    case "rule":
      return removeTaxPartyRule(str(a.bizNo));
    case "monthClose":
      return reopenMonth(str(a.ym));
    case "posClose":
      return reopenPosDay(str(a.day));
    case "upload":
      return cancelFinUpload(num(a.uploadId));
    case "skip":
      return skipWithdrawal(num(a.cashTxnId), true);
    case "note":
      return clearPosNote(`${str(a.refTable)}:${str(a.refId)}`);
    default:
      return { ok: false, error: `되돌릴 수 없는 종류입니다 (${String(kind)})` };
  }
}

type ActRow = {
  id: number;
  ym: string | null;
  label: string;
  amount: string | number | null;
  target_table: string | null;
  target_id: number | null;
  undo_kind: string | null;
  undo_args: unknown;
  undone_at: string | null;
};

/**
 * 한 줄 되돌리기. bulk 면 itemIndex 가 있을 때 그 건만(items[i].undone 찍기, 전부 되돌려지면 undone_at),
 * 없으면 아직 안 되돌린 건 전부 순차. 성공하면 undone_at/undone_by 를 찍는다.
 * 🔴 「되돌리기」 줄은 여기서 안 남긴다 — 기존 undo 함수(undoTaxMatch·undoDepositLink…) 안에 이미 한 줄씩 있어 두 줄이 된다.
 */
export async function undoActivity(id: number, itemIndex?: number): Promise<Result> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const s = await getSession();
  const uid = s?.uid ?? null;

  const [row] = await db.execute<ActRow>(sql`
    SELECT id, ym, label, amount, target_table, target_id, undo_kind, undo_args, undone_at::text
    FROM fin_activity WHERE id = ${id} LIMIT 1
  `);
  if (!row) return { ok: false, error: "그 기록이 없습니다 — 새로 고쳐 보세요" };
  if (row.undone_at) return { ok: false, error: "이미 되돌린 일입니다" };
  if (!row.undo_kind) return { ok: false, error: "이 일은 되돌릴 수 없습니다" };

  const args = parseUndoArgs(row.undo_args) ?? {};

  if (row.undo_kind === "bulk") {
    const items = undoItemsOf(args);
    if (!items || items.length === 0) return { ok: false, error: "되돌릴 건이 없습니다" };
    const now = new Date().toISOString();
    const targets: number[] =
      itemIndex != null
        ? [itemIndex]
        : items.map((_, i) => i).filter((i) => !items[i].undone);
    if (itemIndex != null) {
      const it = items[itemIndex];
      if (!it) return { ok: false, error: "그 건이 없습니다" };
      if (it.undone) return { ok: false, error: "이미 되돌린 일입니다" };
    }
    if (targets.length === 0) return { ok: false, error: "이미 되돌린 일입니다" };

    const errors: string[] = [];
    let doneN = 0;
    for (const i of targets) {
      const it: UndoItem = items[i];
      const r = await undoOne(it.kind, it.args as Args);
      if (r.ok) {
        it.undone = now;
        doneN += 1;
      } else {
        errors.push(`${it.label}: ${r.error}`);
      }
    }
    const allDone = items.every((it) => !!it.undone);
    /* 건별 undone 을 items 에 써 넣는다 — 전부 되돌려졌을 때만 줄의 undone_at */
    await db.execute(sql`
      UPDATE fin_activity
      SET undo_args = ${JSON.stringify({ ...args, items })}::jsonb,
          undone_at = CASE WHEN ${allDone} THEN now() ELSE undone_at END,
          undone_by = CASE WHEN ${allDone} THEN ${uid} ELSE undone_by END
      WHERE id = ${id}
    `);
    if (doneN === 0) return { ok: false, error: errors[0] ?? "되돌리지 못했습니다" };
    revalidateActivity();
    if (errors.length > 0) return { ok: false, error: `${doneN}건은 되돌렸고 ${errors.length}건은 못 했습니다 — ${errors[0]}` };
    return { ok: true };
  }

  const r = await undoOne(row.undo_kind as Exclude<UndoKind, "bulk">, args);
  if (!r.ok) return r;
  await db.execute(sql`
    UPDATE fin_activity SET undone_at = now(), undone_by = ${uid} WHERE id = ${id} AND undone_at IS NULL
  `);
  revalidateActivity();
  return { ok: true };
}

/** 되돌린 뒤 다시 그릴 화면 — 기존 undo 함수가 제 화면은 스스로 revalidate 한다 */
function revalidateActivity() {
  revalidatePath("/finance/activity");
  revalidatePath("/finance");
  revalidatePath("/finance/ledger");
}
