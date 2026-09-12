/**
 * ⭐ 계산서 ↔ 통장 연결 코어 (2026-08-26) — 화면(서버 액션)과 연간 실행기(스크립트)가 **같은 함수**를 쓴다.
 *
 *   recon.ts 의 confirmTaxToBank/confirmTaxToBanks/confirmBankToTaxes/confirmMonthlyParty 는
 *   guard(권한) → 여기 코어 → revalidate 만 한다. 규칙이 두 벌로 갈라지지 않게 한다.
 *
 * 🔴 "use server" 아님. 권한 검사 없음 — 부르는 쪽이 책임진다. 질의 순차.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { cashUsedSql, normName } from "./recon-data";
import { nearTolerance, taxCashData, type TaxCashData } from "./tax-recon";
import { logActivity } from "./fin-activity";
import { howOfMethod, type ActivityEntry, type UndoArgs, type UndoItem, type UndoKind } from "./fin-activity-types";
import { autoReconLabel, W } from "./fin-words";

export type CoreResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * ⭐ 「최근 한 일」 기록 (개편 2단계, 2026-09-12 — 사장님 결정 14·15)
 *   코어가 커밋 뒤 한 줄씩 남긴다. 일괄(confirmSureTaxCore 등)은 quiet 로 낱장 기록을 막고
 *   activity 를 돌려받아 **한 줄 n건**으로 접는다 — 같은 일을 두 줄로 남기지 않는다.
 */
/**
 * ⭐ learn — 「이 상대는 다음부터 자동으로」 (개편 4단계, 2026-09-12; 결정 7③, **기본 켜짐**).
 *    false 면 그 건만 맞추고 별명(party_alias)을 배우지 않는다 — 맞추기 단추 옆 작은 체크칸이 이걸 끈다.
 */
export type ActivityOpts = { quiet?: boolean; learn?: boolean };

/** 낱장 activity → 일괄 줄의 items (bulk 안에 bulk 는 못 넣으니 펼친다) */
export function activityItems(e: ActivityEntry | null | undefined): UndoItem[] {
  if (!e?.undo) return [];
  if (e.undo.kind === "bulk") return (e.undo.args as { items: UndoItem[] }).items ?? [];
  return [{ kind: e.undo.kind as Exclude<UndoKind, "bulk">, args: e.undo.args as UndoArgs, label: e.label, amount: e.amount ?? null }];
}

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * 계산서 ↔ 통장 직접 연결 (사장님 통찰 2026-08-25 — "앱 내역보다 입출금 대조가 정확").
 *   매출 계산서 ↔ 입금 · 매입 계산서 ↔ 출금. 반대 방향은 상계(수수료 차감·매출↔매입 상계).
 *   계산서에 남은 금액이 있는 한 계속 잇는다(합산 발행·부분 확인). 잇는 순간 입금자명을 별명으로 배운다.
 */
export async function confirmTaxToBankCore(
  taxInvoiceId: number,
  cashTxnId: number,
  uid: number | null,
  method: "수동" | "자동" = "수동",
  opts: ActivityOpts = {},
): Promise<CoreResult<{ remaining: number; shortfall: number; netted: boolean; activity?: ActivityEntry }>> {
  /**
   * 🔴 **잠금** (2026-08-28) — 왜 트랜잭션 안에서 읽는가
   *
   *   전에는 잔액(계산서 남은 금액·통장 줄 남은 금액)을 **트랜잭션 밖에서** 읽고
   *   삽입만 트랜잭션 안에서 했다. 그래서 같은 요청이 두 번 들어오면
   *   (휴대폰에서 「잇기」가 두 번 먹히거나, 통신이 느려 재전송되거나, 「짝이 확실한 N건
   *   모두 잇기」와 손으로 누른 것이 겹치면) **둘 다 잔액을 「전액 남음」으로 읽고**
   *   각자 연결을 넣어 같은 돈이 두 번 잡힌다. 절반만 들어온 돈으로 계산서가
   *   「돈 확인 완료」로 닫히는데 화면에는 아무 표시도 안 난다.
   *   `recon_match` 에는 유니크 제약이 없어 DB 도 못 막는다.
   *
   *   그래서 **읽기까지 전부 트랜잭션 안**으로 넣고 두 줄을 `FOR UPDATE` 로 잠근다.
   *   같은 계산서·같은 통장 줄을 건드리는 두 번째 요청은 첫 번째가 끝날 때까지 기다렸다가
   *   **갱신된 잔액**을 읽으므로 "이미 다 확인됐습니다"로 정직하게 막힌다.
   *   (같은 위험을 `purchase-pay.payToSupplier` 는 이미 `FOR UPDATE OF pi` 로 막고 있었다 —
   *    계산서 연결에만 빠져 있었다.)
   *
   * 🔴 잠금 순서는 **계산서 → 통장** 으로 고정한다. 반대로 잡는 경로가 없어야 교착이 안 난다.
   */
  type TxOut =
    | { ok: false; error: string }
    | {
        ok: true;
        remaining: number;
        shortfall: number;
        netted: boolean;
        learn: { payer: string; bizNo: string; label: string };
        /** 기록용 — 이미 읽은 값만 (추가 질의 없음) */
        note: { name: string; ym: string; linkAmt: number; depDate: string; isCashIn: boolean };
      };

  const out: TxOut = await db.transaction(async (tx): Promise<TxOut> => {
    const [inv] = await tx.execute<{
      id: number; direction: string; recon_status: string; total: number;
      counterparty_biz_no: string; counterparty_name: string; ym: string;
    }>(sql`
      SELECT id, direction, recon_status, total, counterparty_biz_no, counterparty_name,
             to_char(write_date, 'YYYY-MM') ym
      FROM tax_invoice WHERE id = ${taxInvoiceId} AND is_active
      FOR UPDATE
    `);
    if (!inv) return { ok: false, error: "세금계산서를 찾을 수 없습니다" };
    if (Number(inv.total) <= 0) return { ok: false, error: `마이너스 계산서는 원본과 ${W.offset}로 정리해 주세요` };
    const [dep] = await tx.execute<{ id: number; in_amount: number; out_amount: number; description: string; d: string }>(sql`
      SELECT id, in_amount, out_amount, description,
             to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') d
      FROM cash_txn
      WHERE id = ${cashTxnId} AND source = '통장' AND is_active
      FOR UPDATE
    `);
    if (!dep) return { ok: false, error: "통장 줄을 찾을 수 없습니다" };

    /* 여기부터는 두 줄이 잠겨 있다 — 잔액이 계산 도중에 바뀌지 않는다 */
    const [covRow] = await tx.execute<{ s: string }>(sql`
      SELECT COALESCE(SUM(amount), 0)::bigint s FROM recon_match
      WHERE src_table = 'tax_invoice' AND src_id = ${taxInvoiceId} AND status = '확정'
        AND kind IN ('매입계산서', '매출계산서') AND ref_table IN ('cash_txn', 'adjust')
    `);
    const invRemain = Number(inv.total) - Number(covRow.s);
    if (invRemain <= 0)
      return { ok: false, error: `이 계산서는 금액이 이미 다 확인됐습니다 — 잘못 ${W.recon}했다면 되돌린 뒤 다시 ${W.recon}하세요` };
    const isCashIn = Number(dep.in_amount) > 0;
    if (Number(dep.in_amount) <= 0 && Number(dep.out_amount) <= 0) return { ok: false, error: "금액이 없는 통장 줄입니다" };
    const netted = (inv.direction === "매출") !== isCashIn;
    const depAmt = isCashIn ? Number(dep.in_amount) : Number(dep.out_amount);
    /* 🔴 소진량은 정본(cashUsedSql) 그대로 — 규칙을 손으로 복제하지 않는다.
       단, 반드시 **같은 트랜잭션**으로 읽어야 잠금이 뜻을 갖는다 (cashUsedMap 은 별도 연결이라 못 쓴다) */
    const [usedRow] = await tx.execute<{ used: string }>(sql`
      SELECT ${cashUsedSql("c")} used FROM cash_txn c WHERE c.id = ${cashTxnId}
    `);
    const remain0 = depAmt - Number(usedRow?.used ?? 0);
    if (remain0 <= 0) return { ok: false, error: `이 통장 줄은 남은 금액이 없습니다 — 이미 다른 ${W.reconLog}이 다 썼습니다` };
    const linkAmt = Math.min(invRemain, remain0);
    const remaining = remain0 - linkAmt;
    const shortfall = invRemain - linkAmt;

    const kind = inv.direction === "매출" ? "매출계산서" : "매입계산서";
    const reason = netted ? "상계연결" : isCashIn ? "입금연결" : "출금연결";
    await tx.execute(sql`
      INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
      VALUES (${kind}, 'tax_invoice', ${taxInvoiceId}, 'cash_txn', ${cashTxnId}, ${linkAmt}, '확정', ${method}, ${uid}, now())
    `);
    await tx.execute(sql`UPDATE tax_invoice SET recon_status = '확정', recon_reason = ${reason} WHERE id = ${taxInvoiceId}`);
    if (remaining === 0) {
      if (inv.direction === "매입" && !isCashIn) {
        await tx.execute(sql`
          UPDATE cash_txn SET recon_status = '확정', category = COALESCE(category, '매입대금') WHERE id = ${cashTxnId}
        `);
      } else {
        await tx.execute(sql`UPDATE cash_txn SET recon_status = '확정' WHERE id = ${cashTxnId}`);
      }
    } else if (inv.direction === "매입" && !isCashIn) {
      await tx.execute(sql`
        UPDATE cash_txn SET recon_status = '제안', category = COALESCE(category, '매입대금') WHERE id = ${cashTxnId}
      `);
    }
    // 부분 연결 입금은 '미대조'로 남긴다 (감사 B6) — 남은 돈을 외상 수금·다른 계산서에 쓸 수 있게
    return {
      ok: true,
      remaining,
      shortfall,
      netted,
      learn: {
        payer: dep.description.replace(/^\[[^\]]*\]\s*/, "").trim(),
        bizNo: inv.counterparty_biz_no,
        label: (inv.direction === "매출" ? "정산입금 " : "지급출금 ") + inv.counterparty_name,
      },
      note: { name: inv.counterparty_name, ym: inv.ym, linkAmt, depDate: dep.d, isCashIn },
    };
  });
  if (!out.ok) return out;

  /* ⭐ 최근 한 일 — 커밋 뒤 한 줄. 되돌리기 = undoTaxMatch(taxInvoiceId, '통장') */
  const activity: ActivityEntry = {
    ym: out.note.ym,
    actor: uid,
    how: howOfMethod(method),
    verb: "대사",
    target: { table: "tax_invoice", id: taxInvoiceId },
    amount: out.note.linkAmt,
    label: `계산서 ${out.note.name} ${won(out.note.linkAmt)} ↔ ${out.note.depDate} ${out.note.isCashIn ? "입금" : "출금"}${out.netted ? ` (${W.offset})` : ""}`,
    undo: { kind: "tax", args: { taxInvoiceId, scope: "통장" } },
  };
  if (!opts.quiet) await logActivity(activity);

  /* 입금자명 학습 — 「이관우」= 한국타이어 정산 (T:사업자번호).
     🔴 트랜잭션 **밖**에 둔다: 학습 실패가 확정을 되돌리면 안 되고, 잠금을 오래 붙들지도 않는다.
     개편 4단계(2026-09-12): 손으로 심던 INSERT 를 정본 learnAlias 로 — 「☑ 다음부터 자동으로」를
     끄면(learn:false) 안 배운다. 계산서 상대의 열쇠는 「이름@사업자번호」라 keyOverride 를 준다 */
  const { learnAlias } = await import("./deposit-core");
  await learnAlias(out.learn.payer, `T:${out.learn.bizNo}`, out.learn.label, {
    uid,
    learn: opts.learn,
    quiet: opts.quiet,
    keyOverride: normName(out.learn.payer) + "@" + out.learn.bizNo,
  });
  return { ok: true, remaining: out.remaining, shortfall: out.shortfall, netted: out.netted, activity };
}

/** 여러 통장 줄을 한 계산서에 — 허용 오차 안 잔돈(통장)·차액(계산서)은 자동 정리 */
export async function confirmTaxToBanksCore(
  taxInvoiceId: number,
  cashTxnIds: number[],
  uid: number | null,
  method: "수동" | "자동" = "수동",
  opts: ActivityOpts = {},
): Promise<CoreResult<{ applied: number; remaining: number; shortfall: number; absorbed: number; settled: number; activity?: ActivityEntry }>> {
  const ids = [...new Set((cashTxnIds ?? []).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 12);
  if (ids.length === 0) return { ok: false, error: `${W.recon}할 통장 줄을 골라 주세요` };
  let applied = 0;
  let remaining = 0;
  let lastId = 0;
  let linkedSum = 0;
  let firstLabel = "";
  for (const id of ids) {
    /* 낱장 기록은 막고(quiet) 아래서 한 줄로 — 되돌리기가 계산서 단위(scope 통장)라 한 줄이 맞다 */
    const r = await confirmTaxToBankCore(taxInvoiceId, id, uid, method, { quiet: true, learn: opts.learn });
    if (!r.ok) {
      return applied === 0 ? { ok: false, error: r.error } : { ok: false, error: `${applied}건까지 ${W.recon}했고 그다음에서 멈췄습니다 — ${r.error}` };
    }
    applied++;
    remaining = r.remaining;
    lastId = id;
    linkedSum += r.activity?.amount ?? 0;
    if (!firstLabel) firstLabel = r.activity?.label ?? "";
  }
  const [inv] = await db.execute<{ direction: string; total: number; counterparty_name: string; ym: string }>(sql`
    SELECT direction, total, counterparty_name, to_char(write_date, 'YYYY-MM') ym FROM tax_invoice WHERE id = ${taxInvoiceId}
  `);
  const total = Number(inv?.total ?? 0);
  const tol = nearTolerance(total);
  const kind = inv?.direction === "매출" ? "매출계산서" : "매입계산서";
  const [covRow] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(amount), 0)::bigint s FROM recon_match
    WHERE src_table = 'tax_invoice' AND src_id = ${taxInvoiceId} AND status = '확정'
      AND kind IN ('매입계산서', '매출계산서') AND ref_table IN ('cash_txn', 'adjust')
  `);
  let shortfall = total - Number(covRow.s);
  let absorbed = 0;
  let settled = 0;
  if (shortfall > 0 && shortfall <= tol) {
    await db.execute(sql`
      INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
      VALUES (${kind}, 'tax_invoice', ${taxInvoiceId}, 'adjust', ${taxInvoiceId}, ${shortfall}, '확정', '조정', ${uid}, now())
    `);
    settled = shortfall;
    shortfall = 0;
  }
  if (remaining > 0 && remaining <= tol && lastId > 0) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
        VALUES (${kind}, 'tax_invoice', ${taxInvoiceId}, 'cash_txn', ${lastId}, ${remaining}, '확정', '조정', ${uid}, now())
      `);
      await tx.execute(sql`
        UPDATE cash_txn SET recon_status = '확정',
               category = CASE WHEN ${kind} = '매입계산서' AND out_amount > 0 THEN COALESCE(category, '매입대금') ELSE category END
        WHERE id = ${lastId}
      `);
    });
    absorbed = remaining;
    remaining = 0;
  }
  /* ⭐ 최근 한 일 — 통장 n줄 + 조정분을 한 줄로 */
  const adj = settled + absorbed;
  const activity: ActivityEntry = {
    ym: inv?.ym ?? null,
    actor: uid,
    how: howOfMethod(method),
    verb: "대사",
    target: { table: "tax_invoice", id: taxInvoiceId },
    amount: linkedSum + settled,
    label:
      applied === 1 && adj === 0
        ? firstLabel
        : `계산서 ${inv?.counterparty_name ?? ""} ${won(Number(inv?.total ?? 0))} ↔ 통장 ${applied}줄${adj > 0 ? ` (조정 ${won(adj)})` : ""}`,
    undo: { kind: "tax", args: { taxInvoiceId, scope: "통장" } },
  };
  if (!opts.quiet) await logActivity(activity);
  return { ok: true, applied, remaining, shortfall, absorbed, settled, activity };
}

/** 통장 한 줄 → 계산서 여러 장 (타이어프로 속초점 842,160 = 242,160 + 600,000) */
export async function confirmBankToTaxesCore(
  cashTxnId: number,
  taxInvoiceIds: number[],
  uid: number | null,
  method: "수동" | "자동" = "수동",
  opts: ActivityOpts = {},
): Promise<CoreResult<{ applied: number; remaining: number; activity?: ActivityEntry }>> {
  const ids = [...new Set((taxInvoiceIds ?? []).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 12);
  if (ids.length === 0) return { ok: false, error: `${W.recon}할 계산서를 골라 주세요` };
  let applied = 0;
  let remaining = 0;
  const items: UndoItem[] = [];
  let ym: string | null = null;
  for (const id of ids) {
    const r = await confirmTaxToBankCore(id, cashTxnId, uid, method, { quiet: true, learn: opts.learn });
    if (!r.ok) {
      return applied === 0 ? { ok: false, error: r.error } : { ok: false, error: `${applied}장까지 ${W.recon}했고 그다음에서 멈췄습니다 — ${r.error}` };
    }
    applied++;
    remaining = r.remaining;
    items.push(...activityItems(r.activity));
    ym ??= r.activity?.ym ?? null;
  }
  /* ⭐ 최근 한 일 — 계산서 장수만큼 items (되돌리기는 계산서 단위) */
  const activity: ActivityEntry =
    items.length === 1
      ? { ym, actor: uid, how: howOfMethod(method), verb: "대사", target: { table: "cash_txn", id: cashTxnId }, amount: items[0].amount ?? null, label: items[0].label, undo: { kind: items[0].kind, args: items[0].args } }
      : {
          ym,
          actor: uid,
          how: howOfMethod(method),
          verb: "대사",
          target: { table: "cash_txn", id: cashTxnId },
          n: items.length,
          amount: items.reduce((s, i) => s + (i.amount ?? 0), 0),
          label: `통장 한 줄 ↔ 계산서 ${items.length}장 ${W.recon}`,
          undo: { kind: "bulk", args: { items } },
        };
  if (!opts.quiet) await logActivity(activity);
  return { ok: true, applied, remaining, activity };
}

/** 월정산 상대의 「이 달 맞음」 — 그 달 열린 계산서를 '확정/월정산'으로 */
export async function confirmMonthlyPartyCore(
  bizNo: string,
  ym: string,
  direction: "매입" | "매출",
  /** 기록용 — 화면 액션은 (uid, "수동"), 연간 실행기는 기본값(자동) */
  uid: number | null = null,
  method: "수동" | "자동" = "자동",
): Promise<CoreResult<{ applied: number }>> {
  const biz = bizNo.replace(/\D/g, "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return { ok: false, error: "달이 이상합니다" };
  const rows = await db.execute<{ id: number; counterparty_name: string; total: number }>(sql`
    UPDATE tax_invoice SET recon_status = '확정', recon_reason = '월정산'
    WHERE is_active AND counterparty_biz_no = ${biz} AND direction = ${direction}
      AND recon_status IN ('미대조', '제안')
      AND write_date >= (${ym} || '-01')::date
      AND write_date < ((${ym} || '-01')::date + INTERVAL '1 month')
    RETURNING id, counterparty_name, total
  `);
  if (rows.length > 0) {
    /* ⭐ 최근 한 일 — 되돌리기 = undoMonthlyParty(bizNo, ym, direction) */
    await logActivity({
      ym,
      actor: uid,
      how: howOfMethod(method),
      verb: "대사",
      target: { table: "tax_invoice", id: Number(rows[0].id) },
      n: rows.length,
      amount: rows.reduce((s, r) => s + Number(r.total), 0),
      label: `${W.monthly} ${rows[0].counterparty_name} ${ym} 이 달 맞음 · 계산서 ${rows.length}장`,
      undo: { kind: "monthly", args: { bizNo: biz, ym, direction } },
    });
  }
  return { ok: true, applied: rows.length };
}

/**
 * ⭐ 수정·마이너스 세금계산서 상쇄 코어 (사장님 제보 2026-08-25) — 마이너스와 원본을 한 쌍으로 「무시」.
 *    auto=true 면 사유를 '수정상쇄(자동)' 으로 남겨 연간 실행 되돌리기가 구분한다.
 */
export async function markTaxFixPairCore(
  minusId: number,
  originId: number,
  auto = false,
  /** 기록용 */
  uid: number | null = null,
  opts: ActivityOpts = {},
): Promise<{ ok: true; activity?: ActivityEntry } | { ok: false; error: string }> {
  const rows = await db.execute<{ id: number; total: number; counterparty_biz_no: string; recon_status: string; counterparty_name: string; ym: string }>(sql`
    SELECT id, total, counterparty_biz_no, recon_status, counterparty_name, to_char(write_date, 'YYYY-MM') ym FROM tax_invoice
    WHERE id IN (${minusId}, ${originId}) AND is_active
  `);
  if (rows.length !== 2) return { ok: false, error: "계산서 두 건을 찾을 수 없습니다" };
  const a = rows.find((x) => Number(x.id) === minusId)!;
  const b = rows.find((x) => Number(x.id) === originId)!;
  if (a.counterparty_biz_no !== b.counterparty_biz_no) return { ok: false, error: "상대가 다른 계산서입니다" };
  if (Number(a.total) + Number(b.total) !== 0) return { ok: false, error: `두 계산서의 금액이 ${W.offset}되지 않습니다` };
  if (a.recon_status === "확정" || b.recon_status === "확정")
    return { ok: false, error: `이미 ${W.done}된 계산서가 있습니다 — 먼저 되돌려 주세요` };
  await db.execute(sql`
    UPDATE tax_invoice SET recon_status = '무시', recon_reason = ${auto ? "수정상쇄(자동)" : "수정상쇄"}
    WHERE id IN (${minusId}, ${originId})
  `);
  /* ⭐ 최근 한 일 — 되돌리기는 두 장 각각 ignoreTaxInvoice(id, true) (bulk 2건) */
  const items: UndoItem[] = [
    { kind: "taxRevive", args: { taxInvoiceId: originId }, label: `원본 계산서 ${b.counterparty_name} ${won(Number(b.total))}`, amount: Number(b.total) },
    { kind: "taxRevive", args: { taxInvoiceId: minusId }, label: `마이너스 계산서 ${a.counterparty_name} ${won(Number(a.total))}`, amount: Number(a.total) },
  ];
  const activity: ActivityEntry = {
    ym: b.ym,
    actor: uid,
    how: auto ? "자동" : "사람",
    verb: "제외",
    target: { table: "tax_invoice", id: minusId },
    n: 2,
    amount: Number(b.total),
    label: `${W.offset}: 계산서 ${b.counterparty_name} ${won(Number(b.total))} ↔ 마이너스 ${won(Number(a.total))}`,
    undo: { kind: "bulk", args: { items } },
  };
  if (!opts.quiet) await logActivity(activity);
  return { ok: true, activity };
}

/* ==================================================================
 * ⭐ 계산서 상대 유형 규칙 — 코어 (개편 4단계, 2026-09-12)
 *
 *   recon.ts:414 setTaxPartyRule · :768 removeTaxPartyRule 의 **본문 그대로**를 코어로 뗀 것이다
 *   (계산서 되살리기 논리도 그대로). 「자동 규칙」 화면의 끄기·되살리기(party-rule.ts)가 같은
 *   함수를 써야 규칙이 두 벌로 갈라지지 않는다. 액션은 권한 → 여기 → revalidate 만 한다.
 *
 * 🔴 quiet 면 기록을 안 남긴다 — 부르는 쪽(규칙 화면)이 「규칙 끄기/켜기」 한 줄을 대신 남긴다.
 *    두 줄이 남으면 안 된다.
 * ================================================================== */
export type TaxPartyKind = "경비" | "대행정산" | "무시" | "월정산";

export async function setTaxPartyRuleCore(
  bizNoRaw: string,
  nameRaw: string,
  kind: TaxPartyKind,
  uid: number | null,
  opts: ActivityOpts = {},
): Promise<{ ok: true; applied: number } | { ok: false; error: string }> {
  const bizNo = String(bizNoRaw ?? "").replace(/\D/g, "");
  if (bizNo.length < 5) return { ok: false, error: "사업자번호가 올바르지 않습니다" };
  await db.execute(sql`
    INSERT INTO tax_party_rule (biz_no, name_raw, kind)
    VALUES (${bizNo}, ${nameRaw}, ${kind})
    ON CONFLICT (biz_no) DO UPDATE SET kind = EXCLUDED.kind, name_raw = EXCLUDED.name_raw, updated_at = now()
  `);
  let applied = 0;
  if (kind === "경비" || kind === "무시") {
    const rows = await db.execute<{ id: number }>(sql`
      UPDATE tax_invoice SET recon_status = '무시', recon_reason = ${kind}
      WHERE is_active AND recon_status IN ('미대조', '제안') AND counterparty_biz_no = ${bizNo}
      RETURNING id
    `);
    applied = rows.length;
  }
  /* ⭐ 최근 한 일 — 규칙 저장은 「사람」(결정 g). 되돌리기 = removeTaxPartyRule(bizNo) — 자동 정리분도 되살린다 */
  if (!opts.quiet) {
    await logActivity({
      actor: uid,
      how: "사람",
      verb: "규칙",
      n: Math.max(1, applied),
      label: `${W.ruleSaved}: ${nameRaw} = ${kind}${applied > 0 ? ` (계산서 ${applied}장 ${W.ignore})` : ""}`,
      undo: { kind: "rule", args: { bizNo } },
    });
  }
  return { ok: true, applied };
}

/** 상대 유형 규칙 취소 — 자동 정리분을 **모든 달** 되살린다 (🔴 2025 감사 F7 그대로) */
export async function removeTaxPartyRuleCore(
  bizNoRaw: string,
  uid: number | null,
  opts: ActivityOpts = {},
): Promise<{ ok: true; revived: number; kind: string; nameRaw: string } | { ok: false; error: string }> {
  const biz = String(bizNoRaw ?? "").replace(/\D/g, "");
  const [r] = await db.execute<{ kind: string; name_raw: string }>(sql`
    SELECT kind, name_raw FROM tax_party_rule WHERE biz_no = ${biz}
  `);
  if (!r) return { ok: false, error: "그 상대의 규칙이 없습니다" };
  await db.execute(sql`DELETE FROM tax_party_rule WHERE biz_no = ${biz}`);
  // 대행정산·월정산은 계산서를 자동 정리한 적이 없어 되살릴 게 없다 (라벨만 지운다)
  let revived = 0;
  if (r.kind === "경비" || r.kind === "무시") {
    const rows = await db.execute<{ id: number }>(sql`
      UPDATE tax_invoice SET recon_status = '미대조', recon_reason = NULL
      WHERE is_active AND counterparty_biz_no = ${biz} AND recon_status = '무시'
        AND recon_reason = ${r.kind}
      RETURNING id
    `);
    revived = rows.length;
  }
  /* ⭐ 최근 한 일 — 규칙 취소(되돌리기 없음: 다시 지정하면 된다) */
  if (!opts.quiet) {
    await logActivity({
      actor: uid,
      how: "사람",
      verb: "되돌리기",
      n: Math.max(1, revived),
      label: `${W.undo}: 규칙 취소 ${r.name_raw} = ${r.kind}${revived > 0 ? ` (계산서 ${revived}장 되살림)` : ""}`,
    });
  }
  return { ok: true, revived, kind: r.kind, nameRaw: r.name_raw };
}

/**
 * ⭐ 짝이 확실한 계산서 — 돈 확인 뷰의 후보 중
 *    one   정확 일치 + ★ + 정확 일치 후보 하나뿐
 *    combo 묶음(부분집합·날짜순 연속)이 정확히 맞고 전부 ★
 *    fee   ★ 후보가 하나뿐이고 차이가 허용 오차(1,000원·0.1%) 안 — BZ뱅크 이체는 수수료 500원이 금액에 붙는다
 *          ((주)제로 1,846,000 ↔ 1,846,500, 록산기전 405,900 ↔ 406,400 … 2025 진행 2026-08-27)
 *    fix   마이너스 계산서의 원본 후보가 하나뿐(같은 상대·정확히 상쇄·열림) → 상쇄
 *    입금 화면의 「짝이 확실한 N건」과 같은 정신.
 */
export type SureTaxPick =
  | { kind: "one"; invId: number; cashId: number }
  | { kind: "combo"; invId: number; cashIds: number[] }
  | { kind: "fee"; invId: number; cashId: number }
  | { kind: "fix"; minusId: number; originId: number };

export async function sureTaxPicks(ym: string, direction: "매입" | "매출"): Promise<SureTaxPick[]> {
  const data = await taxCashData(direction, ym);
  return sureTaxPicksFrom(data, direction);
}

/**
 * 같은 판정을 **이미 읽어 둔** taxCashData 로 — 계산서 화면 정본(tax-book)이 매입·매출 자료를 한 번씩만
 * 읽고 확실 후보까지 얻으려고 나눴다 (2026-09-11). 규칙은 위 한 벌 그대로, 질의만 안 겹친다.
 */
export async function sureTaxPicksFrom(data: TaxCashData, direction: "매입" | "매출"): Promise<SureTaxPick[]> {
  const picks: SureTaxPick[] = [];
  for (const r of data.rows) {
    if (r.fixFirst) continue;
    if (r.isFix) {
      const [inv] = await db.execute<{ biz: string; d: string }>(sql`
        SELECT counterparty_biz_no biz, to_char(write_date, 'YYYY-MM-DD') d FROM tax_invoice WHERE id = ${r.id} AND is_active
      `);
      if (!inv) continue;
      const origins = await db.execute<{ id: number }>(sql`
        SELECT id FROM tax_invoice
        WHERE is_active AND id <> ${r.id} AND counterparty_biz_no = ${inv.biz} AND direction = ${direction}
          AND total = ${-r.total} AND recon_status IN ('미대조', '제안')
          AND write_date >= ${inv.d}::date - 90 AND write_date <= ${inv.d}::date + 30
        LIMIT 3
      `);
      if (origins.length === 1) picks.push({ kind: "fix", minusId: r.id, originId: Number(origins[0].id) });
      continue;
    }
    const remain = r.total - r.bankCovered;
    const exact = r.autoBank.filter((b) => b.amount === remain);
    const exactKnown = exact.filter((b) => b.known);
    if (exactKnown.length === 1 && exact.length === 1) picks.push({ kind: "one", invId: r.id, cashId: exactKnown[0].id });
    else if (exact.length === 0 && r.bankCombo && r.bankCombo.diff === 0) picks.push({ kind: "combo", invId: r.id, cashIds: r.bankCombo.ids });
    else if (exact.length === 0 && !r.bankCombo) {
      /* 이체 수수료 차이 — 허용 오차(1,000원·0.1%) 안에 드는 ★ 후보가 **딱 하나**일 때만
         ((주)제로 1,846,000 ↔ 1,846,500 · 록산기전 405,900 ↔ 406,400 … 2025 진행 2026-08-27) */
      const near = r.autoBank.filter((b) => b.known && Math.abs(b.amount - remain) <= nearTolerance(remain));
      if (near.length === 1) picks.push({ kind: "fee", invId: r.id, cashId: near[0].id });
    }
  }
  return picks;
}

export async function confirmSureTaxCore(
  ym: string,
  direction: "매입" | "매출",
  uid: number | null,
  method: "수동" | "자동" = "자동",
): Promise<{ applied: number; failed: number }> {
  const picks = await sureTaxPicks(ym, direction);
  let applied = 0;
  let failed = 0;
  const items: UndoItem[] = [];
  for (const p of picks) {
    /* 낱장 기록은 quiet 로 막고 아래서 한 줄 n건으로 (사장님 결정 d — 「375줄 폭발」 방지) */
    const r =
      p.kind === "one"
        ? await confirmTaxToBankCore(p.invId, p.cashId, uid, method, { quiet: true })
        : p.kind === "combo"
          ? await confirmTaxToBanksCore(p.invId, p.cashIds, uid, method, { quiet: true })
          : p.kind === "fee"
            ? await confirmTaxToBanksCore(p.invId, [p.cashId], uid, method, { quiet: true })
            : await markTaxFixPairCore(p.minusId, p.originId, method === "자동", uid, { quiet: true });
    if (r.ok) {
      applied++;
      items.push(...activityItems(r.activity));
    } else failed++;
  }
  if (items.length > 0) {
    await logActivity({
      ym,
      actor: uid,
      how: howOfMethod(method),
      verb: "대사",
      n: items.length,
      amount: items.reduce((s, i) => s + (i.amount ?? 0), 0),
      label: `${autoReconLabel(items.length)} · ${direction} 계산서 ${ym}${failed > 0 ? ` (실패 ${failed})` : ""}`,
      undo: { kind: "bulk", args: { items } },
    });
  }
  return { applied, failed };
}
