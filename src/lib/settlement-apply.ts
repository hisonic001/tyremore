/**
 * ⭐ 렌트카 거래처 월 정산 — 코어 (사장님 요청 2026-09-01)
 *
 * 🔴 "use server" 아님 — 여기 함수는 공개 엔드포인트가 아니다. 화면이 부르는
 *    문은 settlement.ts 가 isOwner() 로 지키고 이 코어를 부른다
 *    (recon-core 의 confirmMonthlyPartyCore 와 같은 관례 — 검증 스크립트도
 *    세션 없이 이 코어를 부른다).
 *
 *   "월초에 거래처가 검토 후 반려/승인/금액조정 → 앱에서 전부 재조정(가장 불편)"
 *
 *   회차(settlement_run)를 만들어 그 달 외상 판매를 스냅샷하고, 판정(승인·조정·
 *   부분반려·반려·보류)을 모아 「한꺼번에 적용」한다. 실제 고치기는 **정본만** 쓴다:
 *     조정 = updateSaleLine (recomputeTotal 이 총액 불변식을 지킨다)
 *     부분반려 = removeSaleLine (재고 자동 복원)
 *     반려 = cancelSale (수금 있으면 차단 — 같은 날 고친 전역 구멍)
 *
 * 🔴 멱등 — 적용은 applied_at IS NULL 인 줄만. 판정을 고치면 null 로 되돌린다.
 *    두 번 눌러도, 중간에 끊겨도 두 번 깎이지 않는다.
 * 🔴 돈 관리는 사장님 전용 (receivable.ts 와 같은 기준).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { cancelSale, removeSaleLine, updateSaleLine } from "./sale-edit";
import { planAdjustment } from "./settlement-core";
import { monthRange } from "./ym";

const DECISIONS = ["대기", "승인", "조정", "부분반려", "반려", "보류"] as const;

/** 회차 시작 — 그 달 외상 판매를 스냅샷으로 담는다. 이미 있으면 그 회차를 돌려준다 */
export async function startSettlementCore(
  supplier: string,
  ym: string,
): Promise<{ ok: true; runId: number; added: number } | { ok: false; error: string }> {
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, error: "달은 2026-08 형식입니다" };
  const name = supplier.trim();
  if (!name) return { ok: false, error: "거래처를 골라 주세요" };

  const [run] = await db.execute<{ id: number }>(sql`
    INSERT INTO settlement_run (supplier_name, ym)
    VALUES (${name}, ${ym})
    ON CONFLICT (supplier_name, ym) DO UPDATE SET updated_at = now()
    RETURNING id
  `);
  const added = await syncLines(Number(run.id), name, ym);
  return { ok: true, runId: Number(run.id), added };
}

/** run 에 없는 그 달 판매를 담는다 (스냅샷은 담는 시점의 금액) */
async function syncLines(runId: number, supplier: string, ym: string): Promise<number> {
  const { start, nextStart } = monthRange(ym);
  const ins = await db.execute<{ id: number }>(sql`
    INSERT INTO settlement_line (run_id, quote_id, billed_amount)
    SELECT ${runId}, q.id, q.total_amount
    FROM quote q
    /* 본사청구(claim_party)도 같은 대상으로 — 정본 receivable-key.ts (2026-09-10) */
    WHERE q.status = '성사' AND q.payment_method = '외상'
      AND COALESCE(q.supplier_name, q.claim_party) = ${supplier}
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}::date
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
    ON CONFLICT (run_id, quote_id) DO NOTHING
    RETURNING id
  `);
  return ins.length;
}

/**
 * ⭐ 「항상 최신으로」 (사장님 요청 2026-09-10) — 화면을 열 때마다 그 달 외상을
 *    다시 긁는다.
 *
 *   전에는 회차를 만든 **그 순간으로 굳어** 낡았다: 쏘카 8월 회차가 9/1 에
 *   160만으로 만들어졌는데, 그 뒤 등록된 8월 판매까지 합치면 213만이었다
 *   (실제 발행한 계산서도 213만). 담기 단추가 있었지만 아무도 안 눌렀다.
 *
 * 🔴 **「작성중」 회차만** 자동으로 담는다 — 이미 청구서를 내보내 회신을 받거나
 *    입금까지 끝난 회차에 새 건이 슬쩍 들어가면 합의한 금액이 흔들린다.
 */
export async function autoSyncDraft(supplier: string, ym: string): Promise<number> {
  const [run] = await db.execute<{ id: number; status: string }>(sql`
    SELECT id, status FROM settlement_run WHERE supplier_name = ${supplier} AND ym = ${ym} LIMIT 1
  `);
  if (!run || run.status !== "작성중") return 0;
  return syncLines(Number(run.id), supplier, ym);
}

/** 회차를 연 뒤 새로 등록된 그 달 판매 담기 */
export async function addNewSalesCore(runId: number): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const [run] = await db.execute<{ supplier_name: string; ym: string }>(sql`
    SELECT supplier_name, ym FROM settlement_run WHERE id = ${runId}
  `);
  if (!run) return { ok: false, error: "회차를 찾을 수 없습니다" };
  const added = await syncLines(runId, run.supplier_name, run.ym);
  return { ok: true, added };
}

export interface ItemInstruction {
  quoteItemId: number;
  /** '반려' = 그 줄 빼기 · '조정' = 그 줄 단가를 agreedPrice 로 */
  action: "반려" | "조정";
  agreedPrice?: number | null;
}

/**
 * 판정 저장 — 적용 자국(applied_at)은 **되돌린다** (다시 적용 대상이 된다).
 * 줄 지시(items)는 통째로 갈아 끼운다.
 */
export async function saveDecisionCore(input: {
  lineId: number;
  decision: (typeof DECISIONS)[number];
  /** '조정'일 때 건 합의금액 (줄 지시가 있으면 서버가 다시 계산한다) */
  agreed?: number | null;
  replyMemo?: string | null;
  matchedBy?: string | null;
  items?: ItemInstruction[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!DECISIONS.includes(input.decision)) return { ok: false, error: "판정이 올바르지 않습니다" };
  const [line] = await db.execute<{ id: number; quote_id: number; billed_amount: number }>(sql`
    SELECT id, quote_id, billed_amount FROM settlement_line WHERE id = ${input.lineId}
  `);
  if (!line) return { ok: false, error: "정산 줄을 찾을 수 없습니다" };

  const items = (input.items ?? []).filter((i) => Number.isInteger(i.quoteItemId));
  let agreed = input.agreed == null ? null : Math.round(Number(input.agreed));

  if (items.length > 0) {
    // 줄 지시가 있으면 합의금액은 지시에서 계산한다 — 두 값이 어긋나면 안 된다
    const cur = await db.execute<{ id: number; qty: number; final_price: number; description: string }>(sql`
      SELECT id, qty, final_price, description FROM quote_item WHERE quote_id = ${line.quote_id}
    `);
    const byId = new Map(cur.map((c) => [Number(c.id), c]));
    let total = 0;
    for (const c of cur) {
      const ins = items.find((i) => i.quoteItemId === Number(c.id));
      if (ins?.action === "반려") continue;
      const price = ins?.action === "조정" ? Math.round(Number(ins.agreedPrice ?? c.final_price)) : Number(c.final_price);
      if (price < 0 || !Number.isFinite(price)) return { ok: false, error: "줄 단가가 올바르지 않습니다" };
      total += Number(c.qty) * price;
    }
    const rejectAll = cur.length > 0 && cur.every((c) => items.find((i) => i.quoteItemId === Number(c.id))?.action === "반려");
    if (rejectAll) return { ok: false, error: "모든 줄을 빼면 판매가 비어 버립니다 — 건 「반려」로 처리해 주세요" };
    for (const i of items) {
      if (!byId.has(i.quoteItemId)) return { ok: false, error: "이미 없어진 품목 줄이 섞여 있습니다 — 새로 고쳐 주세요" };
    }
    agreed = total;

    await db.execute(sql`DELETE FROM settlement_line_item WHERE line_id = ${line.id}`);
    for (const i of items) {
      const c = byId.get(i.quoteItemId)!;
      await db.execute(sql`
        INSERT INTO settlement_line_item (line_id, quote_item_id, description, qty, original_price, action, agreed_price)
        VALUES (${line.id}, ${i.quoteItemId}, ${c.description}, ${c.qty}, ${c.final_price}, ${i.action},
                ${i.action === "조정" ? Math.round(Number(i.agreedPrice ?? c.final_price)) : null})
      `);
    }
  } else {
    await db.execute(sql`DELETE FROM settlement_line_item WHERE line_id = ${line.id}`);
  }

  if (input.decision === "승인") agreed = Number(line.billed_amount);
  if (input.decision === "반려") agreed = 0;
  if (input.decision === "조정" && agreed == null) return { ok: false, error: "합의금액을 넣어 주세요" };
  if (agreed != null && (agreed < 0 || !Number.isFinite(agreed))) return { ok: false, error: "합의금액이 올바르지 않습니다" };

  await db.execute(sql`
    UPDATE settlement_line SET decision = ${input.decision}, agreed_amount = ${agreed},
      reply_memo = ${input.replyMemo?.trim() || null},
      matched_by = ${input.matchedBy?.trim() || null},
      applied_at = NULL, updated_at = now()
    WHERE id = ${line.id}
  `);
  await db.execute(sql`
    UPDATE settlement_run SET status = CASE WHEN status = '작성중' THEN '회신반영중' ELSE status END,
      updated_at = now()
    WHERE id = (SELECT run_id FROM settlement_line WHERE id = ${line.id})
  `);
  return { ok: true };
}

/** 회신 미리보기에서 확정한 판정들을 한 번에 저장 */
export async function saveMatchedDecisionsCore(
  runId: number,
  rows: { lineId: number; agreed: number | null; matchedBy: string; memo: string }[],
): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  let saved = 0;
  for (const r of rows.slice(0, 300)) {
    const [line] = await db.execute<{ id: number; billed_amount: number }>(sql`
      SELECT id, billed_amount FROM settlement_line WHERE id = ${r.lineId} AND run_id = ${runId}
    `);
    if (!line) continue;
    const billed = Number(line.billed_amount);
    const decision = r.agreed == null || r.agreed === billed ? "승인" : "조정";
    const res = await saveDecisionCore({
      lineId: r.lineId,
      decision,
      agreed: r.agreed ?? billed,
      replyMemo: r.memo || null,
      matchedBy: r.matchedBy,
    });
    if (res.ok) saved++;
  }
  return { ok: true, saved };
}

/** 아직 「대기」인 줄을 전부 승인으로 — 회신에 없던 건은 보통 그대로 인정된 것 */
export async function approveRestCore(runId: number): Promise<{ ok: true; n: number } | { ok: false; error: string }> {
  const rows = await db.execute<{ id: number }>(sql`
    UPDATE settlement_line SET decision = '승인', agreed_amount = billed_amount, applied_at = NULL, updated_at = now()
    WHERE run_id = ${runId} AND decision = '대기'
    RETURNING id
  `);
  return { ok: true, n: rows.length };
}

export interface ApplyLineResult {
  quoteNo: string;
  decision: string;
  ok: boolean;
  note: string;
}

/**
 * ⭐ 한꺼번에 적용 — 가장 불편하셨던 「전부 재조정」이 이 버튼 하나다.
 *
 * 줄별로 처리하고 줄별로 결과를 알린다 (한 건이 막혀도 나머지는 나간다 —
 * 정산은 건별 독립이라 전부-아니면-전무가 오히려 불편하다).
 */
export async function applySettlementCore(
  runId: number,
): Promise<{ ok: true; results: ApplyLineResult[]; applied: number; failed: number } | { ok: false; error: string }> {
  const [run] = await db.execute<{ id: number; status: string }>(sql`
    SELECT id, status FROM settlement_run WHERE id = ${runId}
  `);
  if (!run) return { ok: false, error: "회차를 찾을 수 없습니다" };

  const lines = await db.execute<{
    id: number;
    quote_id: number;
    decision: string;
    agreed_amount: number | null;
    billed_amount: number;
  }>(sql`
    SELECT id, quote_id, decision, agreed_amount, billed_amount
    FROM settlement_line
    WHERE run_id = ${runId} AND applied_at IS NULL AND decision IN ('승인','조정','부분반려','반려')
    ORDER BY id
  `);

  const results: ApplyLineResult[] = [];
  for (const l of lines) {
    const r = await applyOneLine(Number(l.id), Number(l.quote_id), l.decision, l.agreed_amount, Number(l.billed_amount));
    results.push(r);
  }

  // 회차 상태 갱신 — 남은 대기·보류·실패가 없으면 적용완료
  const [left] = await db.execute<{ n: number; agreed: string }>(sql`
    SELECT count(*) FILTER (WHERE applied_at IS NULL AND decision <> '보류')::int n,
           COALESCE(SUM(agreed_amount) FILTER (WHERE applied_at IS NOT NULL), 0)::bigint agreed
    FROM settlement_line WHERE run_id = ${runId}
  `);
  if (Number(left.n) === 0) {
    await db.execute(sql`
      UPDATE settlement_run SET status = '적용완료', agreed_amount = ${Number(left.agreed)}, applied_at = now(), updated_at = now()
      WHERE id = ${runId} AND status IN ('작성중','회신반영중','적용완료')
    `);
  }
  const failed = results.filter((r) => !r.ok).length;
  return { ok: true, results, applied: results.length - failed, failed };
}

async function applyOneLine(
  lineId: number,
  quoteId: number,
  decision: string,
  agreedIn: number | null,
  billed: number,
): Promise<ApplyLineResult> {
  const stamp = async (agreed: number) => {
    await db.execute(sql`
      UPDATE settlement_line SET applied_at = now(), agreed_amount = ${agreed}, updated_at = now() WHERE id = ${lineId}
    `);
  };
  const [q] = await db.execute<{ quote_no: string; status: string; total: number; paid: number }>(sql`
    SELECT q.quote_no, q.status, q.total_amount total,
           COALESCE((SELECT SUM(amount)::int FROM receivable_payment rp WHERE rp.quote_id = q.id), 0) paid
    FROM quote q WHERE q.id = ${quoteId}
  `);
  if (!q) return { quoteNo: `#${quoteId}`, decision, ok: false, note: "판매를 찾을 수 없습니다" };
  const no = q.quote_no;
  const paid = Number(q.paid);

  try {
    if (decision === "승인") {
      await stamp(agreedIn ?? billed);
      return { quoteNo: no, decision, ok: true, note: "그대로 인정" };
    }

    if (decision === "반려") {
      if (q.status === "취소") {
        await stamp(0);
        return { quoteNo: no, decision, ok: true, note: "이미 취소돼 있음" };
      }
      const r = await cancelSale(quoteId);
      if (!r.ok) return { quoteNo: no, decision, ok: false, note: r.error };
      await stamp(0);
      return { quoteNo: no, decision, ok: true, note: r.restored > 0 ? `취소 · 재고 ${r.restored}개 복원` : "취소" };
    }

    if (q.status === "취소") return { quoteNo: no, decision, ok: false, note: "취소된 판매입니다 — 판정을 다시 봐 주세요" };

    /* 줄 지시 (부분반려·줄 조정) */
    const instr = await db.execute<{ quote_item_id: number | null; action: string; agreed_price: number | null }>(sql`
      SELECT quote_item_id, action, agreed_price FROM settlement_line_item WHERE line_id = ${lineId}
    `);

    if (decision === "부분반려" || (decision === "조정" && instr.length > 0)) {
      // 예상 합계를 먼저 셈해 수금보다 작아지면 손대기 전에 멈춘다
      const cur = await db.execute<{ id: number; qty: number; final_price: number }>(sql`
        SELECT id, qty, final_price FROM quote_item WHERE quote_id = ${quoteId}
      `);
      let expected = 0;
      for (const c of cur) {
        const ins = instr.find((i) => Number(i.quote_item_id) === Number(c.id));
        if (ins?.action === "반려") continue;
        const price = ins?.action === "조정" ? Number(ins.agreed_price ?? c.final_price) : Number(c.final_price);
        expected += Number(c.qty) * price;
      }
      if (expected === Number(q.total) && !instr.some((i) => i.action === "반려" && cur.some((c) => Number(c.id) === Number(i.quote_item_id)))) {
        await stamp(expected); // 이미 맞음 (재적용 멱등)
        return { quoteNo: no, decision, ok: true, note: "이미 반영돼 있음" };
      }
      if (expected < paid) {
        return { quoteNo: no, decision, ok: false, note: `합의 후 금액(${expected.toLocaleString()})이 이미 받은 수금(${paid.toLocaleString()})보다 작습니다 — 수금을 먼저 정리해 주세요` };
      }
      for (const ins of instr) {
        const c = cur.find((x) => Number(x.id) === Number(ins.quote_item_id));
        if (!c) continue; // 이미 지워짐 (재적용 멱등)
        if (ins.action === "반려") {
          const r = await removeSaleLine(Number(c.id));
          if (!r.ok) return { quoteNo: no, decision, ok: false, note: r.error };
        } else if (ins.action === "조정" && Number(ins.agreed_price) !== Number(c.final_price)) {
          const r = await updateSaleLine({ itemId: Number(c.id), qty: Number(c.qty), unitPrice: Number(ins.agreed_price) });
          if (!r.ok) return { quoteNo: no, decision, ok: false, note: r.error };
        }
      }
      await stamp(expected);
      return { quoteNo: no, decision, ok: true, note: `합의가 ${expected.toLocaleString()}원으로` };
    }

    /* 건 단위 조정 — 값 있는 줄에 비례 배분 */
    if (decision === "조정") {
      const agreed = agreedIn;
      if (agreed == null) return { quoteNo: no, decision, ok: false, note: "합의금액이 없습니다" };
      if (Number(q.total) === agreed) {
        await stamp(agreed);
        return { quoteNo: no, decision, ok: true, note: "이미 합의가와 같음" };
      }
      if (agreed < paid) {
        return { quoteNo: no, decision, ok: false, note: `합의금액(${agreed.toLocaleString()})이 이미 받은 수금(${paid.toLocaleString()})보다 작습니다 — 수금을 먼저 정리해 주세요` };
      }
      const cur = await db.execute<{ id: number; qty: number; final_price: number; description: string }>(sql`
        SELECT id, qty, final_price, description FROM quote_item WHERE quote_id = ${quoteId}
      `);
      const plan = planAdjustment(
        cur.map((c) => ({ itemId: Number(c.id), qty: Number(c.qty), price: Number(c.final_price) })),
        agreed,
      );
      if (!plan.ok) return { quoteNo: no, decision, ok: false, note: plan.error };
      for (const ch of plan.changes) {
        const c = cur.find((x) => Number(x.id) === ch.itemId)!;
        // 고치기 전 단가를 기록에 남긴다 (원 청구의 줄 단위 근거)
        await db.execute(sql`
          INSERT INTO settlement_line_item (line_id, quote_item_id, description, qty, original_price, action, agreed_price)
          VALUES (${lineId}, ${ch.itemId}, ${c.description}, ${c.qty}, ${c.final_price}, '조정', ${ch.newPrice})
        `);
        const r = await updateSaleLine({ itemId: ch.itemId, qty: Number(c.qty), unitPrice: ch.newPrice });
        if (!r.ok) return { quoteNo: no, decision, ok: false, note: r.error };
      }
      await stamp(agreed);
      return { quoteNo: no, decision, ok: true, note: `합의가 ${agreed.toLocaleString()}원으로` };
    }

    return { quoteNo: no, decision, ok: false, note: "알 수 없는 판정" };
  } catch (e) {
    return { quoteNo: no, decision, ok: false, note: (e as Error).message || "적용 실패" };
  }
}

/** 회차 다시 열기 — 판정을 고칠 수 있게 (소프트 확정 원칙, month-close 관례) */
export async function reopenRunCore(runId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await db.execute<{ id: number }>(sql`
    UPDATE settlement_run SET status = '회신반영중', updated_at = now() WHERE id = ${runId} RETURNING id
  `);
  if (r.length === 0) return { ok: false, error: "회차를 찾을 수 없습니다" };
  return { ok: true };
}

/** 잘못 시작한 회차 지우기 — 아무것도 적용 안 됐을 때만 */
export async function deleteRunCore(runId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const [n] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM settlement_line WHERE run_id = ${runId} AND applied_at IS NOT NULL
  `);
  if (Number(n.n) > 0) return { ok: false, error: "이미 적용된 줄이 있는 회차는 지울 수 없습니다 — 다시 열어 판정을 고쳐 주세요" };
  await db.execute(sql`DELETE FROM settlement_run WHERE id = ${runId}`);
  return { ok: true };
}
