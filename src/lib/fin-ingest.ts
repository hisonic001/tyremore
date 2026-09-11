/**
 * ⭐ 돈 관리 — 정규화 행을 DB 에 반영 (ERP 1단계, 2026-08-24)
 *
 *   fin-sheet.ts(엑셀)든 나중의 fin-popbill.ts(API)든 **같은 정규화 행**을 이리로
 *   보낸다 — 중복 방지·배치 기록·손익 화면은 자료가 어디서 왔는지 모른다.
 *
 * 중복 방지(dedup_key) 규칙 — 계획서 표 그대로:
 *   통장       통장|계정|일시|입금|출금|잔액   (같은 초 같은 금액도 잔액이 다르다)
 *   법인카드   카드|계정|승인번호|일자          (승인번호 없는 형식은 일자|금액|가맹점|#차례)
 *
 * 🔴 질의는 순차 — Promise.all 금지 (커넥션 max 3). 삽입은 100줄씩 묶는다.
 * 🔴 "use server" 아님 — fin-upload.ts(서버 액션)만 부른다.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { CARD_SETTLE_PATTERN_SQL } from "./expense-cats";
import { normName } from "./recon-data";
import type { CardDayParseResult, CardDepositParseResult, CardTxnParseResult, FinParseResult, NormalizedCashTxn, PosParseResult, TaxParseResult } from "./fin-sheet";
import { autoMatchPosDayCore } from "./pos-close";
import { applyAutoCategories } from "./expense-core";
import { restoreCashLine } from "./cash-restore";

export interface IngestResult {
  uploadId: number;
  rowCount: number;
  newCount: number;
  dupCount: number;
}

/** 행마다 중복 방지 열쇠 — 승인번호 없는 카드 형식은 파일 안 차례번호(#n)로 가른다 */
function dedupKeys(rows: NormalizedCashTxn[], label: string): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    let base: string;
    if (r.source === "통장") {
      base = `통장|${label}|${r.occurredAt}|${r.inAmount}|${r.outAmount}|${r.balance ?? ""}`;
    } else if (r.approvalNo) {
      // 🔴 금액 포함 (2026-08-25 실측) — 취소·환불이 같은 승인번호로 +/− 두 줄 온다 (신한 전체내역)
      base = `카드|${label}|${r.approvalNo}|${r.occurredAt.slice(0, 10)}|${r.outAmount}`;
    } else {
      base = `카드|${label}|${r.occurredAt.slice(0, 10)}|${r.outAmount}|${r.description}`;
    }
    /**
     * 같은 열쇠가 파일 안에 여러 번 나오면 #2, #3… 을 붙인다.
     * 같은 파일을 다시 올리면 같은 차례가 되어 중복이 안 생기고,
     * 진짜 같은 날 같은 가게 같은 금액 두 번(식당 결제 둘로 나누기)도 둘 다 남는다.
     */
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}|#${n}`;
  });
}

/** 파싱 결과를 한 배치로 반영한다. 같은 파일을 다시 올려도 안전하다 */
export async function ingestCashTxns(
  parsed: FinParseResult,
  accountLabel: string,
  userId: number | null,
  fileName: string,
): Promise<IngestResult> {
  const label = accountLabel.trim();
  const keys = dedupKeys(parsed.rows, label);

  // ① 배치 머리 먼저 — 원본 CSV 를 보존한다 (파서를 고쳐 다시 읽을 수 있게)
  const [up] = await db.execute<{ id: number }>(sql`
    INSERT INTO fin_upload (source, account_label, file_name, raw_text, row_count, period_from, period_to, created_by)
    VALUES (${parsed.source}, ${label}, ${fileName}, ${parsed.rawCsv.slice(0, 2_000_000)},
            ${parsed.rows.length}, ${parsed.periodFrom}, ${parsed.periodTo}, ${userId})
    RETURNING id
  `);
  const uploadId = Number(up.id);

  // ② 100줄씩 순차 삽입 — 이미 있는 열쇠는 조용히 건너뛴다
  let newCount = 0;
  for (let i = 0; i < parsed.rows.length; i += 100) {
    const chunk = parsed.rows.slice(i, i + 100);
    const chunkKeys = keys.slice(i, i + 100);
    const values = chunk.map(
      (r, j) => sql`(${r.source}, ${label}, ${r.occurredAt + "+09"}::timestamptz, ${r.description},
        ${r.inAmount}, ${r.outAmount}, ${r.balance}, ${r.approvalNo}, ${r.bizNo},
        ${r.installment}, ${r.branch}, ${r.payerCode}, ${chunkKeys[j]}, ${uploadId})`,
    );
    const ins = await db.execute<{ id: number }>(sql`
      INSERT INTO cash_txn (source, account_label, occurred_at, description,
                            in_amount, out_amount, balance, approval_no, biz_no,
                            installment, branch, payer_code, dedup_key, upload_id)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (dedup_key) DO NOTHING
      RETURNING id
    `);
    newCount += ins.length;

    // 취소했던 배치의 줄을 다시 올리면 되살린다 (지우지 않는다 규약의 반대 방향)
    await db.execute(sql`
      UPDATE cash_txn SET is_active = true
      WHERE is_active = false AND dedup_key IN (${sql.join(chunkKeys.map((k) => sql`${k}`), sql`, `)})
    `);
  }

  /* ⭐ 자동 분류 정본 — expense-core.applyAutoCategories (경비 규칙·내부이체·카드정산·지역화폐·주주거래).
     🔴 2026-08-26: 전엔 여기 손 복제 정규식(백슬래시 1개)이라 경비 규칙이 통장 줄에 한 번도 안 붙었다 */
  await applyAutoCategories({ uploadId }, userId); // 기록(최근 한 일)의 actor — 누가 올렸는지

  const dupCount = parsed.rows.length - newCount;
  await db.execute(sql`
    UPDATE fin_upload SET new_count = ${newCount}, dup_count = ${dupCount} WHERE id = ${uploadId}
  `);
  return { uploadId, rowCount: parsed.rows.length, newCount, dupCount };
}

/**
 * 계산서 줄 상태 복원 (2026-09-10) — 「확정인데 근거도 사유도 없는」 상태를 안 만든다.
 *
 * 🔴 감사 A2 의 조건과 **글자 그대로 같은 조건**만 되돌린다 — 사장님이 손으로 남긴
 *    사유('월정산'·차액 확인 끝)나 다른 자국이 남은 계산서는 건드리지 않는다.
 *    cash_txn 쪽 짝은 줄 단위 정본 cash-restore.restoreCashLine.
 */
async function restoreTaxLines(which: SQL): Promise<void> {
  await db.execute(sql`
    UPDATE tax_invoice t SET recon_status = '미대조'
    WHERE ${which}
      AND t.recon_status = '확정' AND COALESCE(t.recon_reason, '') = ''
      AND NOT EXISTS (SELECT 1 FROM recon_match m
        WHERE (m.src_table = 'tax_invoice' AND m.src_id = t.id)
           OR (m.ref_table = 'tax_invoice' AND m.ref_id = t.id))
  `);
}

/**
 * 배치 취소 — 그 배치가 새로 넣었던 줄만 잠재운다 (겹친 줄은 다른 배치 소속이라 그대로).
 * 🔴 원천별로 제 표를 잠재워야 한다 (2026-08-25 감사에서 발견 — 전에는 cash_txn 만
 *    처리해서 세금계산서·카드매출 배치는 취소해도 줄이 살아 있었다).
 */
export async function cancelFinUploadBatch(uploadId: number): Promise<number> {
  const [up] = await db.execute<{ source: string }>(sql`
    SELECT source FROM fin_upload WHERE id = ${uploadId}
  `);
  if (!up) return 0;
  const table =
    up.source === "홈택스매출" || up.source === "홈택스매입"
      ? sql.raw("tax_invoice")
      : up.source === "카드매출승인"
        ? sql.raw("card_day")
        : up.source === "카드매출입금"
          ? sql.raw("card_deposit")
          : up.source === "토스포스"
            ? sql.raw("pos_txn")
            : sql.raw("cash_txn");
  const rows = await db.execute<{ id: number }>(sql`
    UPDATE ${table} SET is_active = false WHERE upload_id = ${uploadId} AND is_active RETURNING id
  `);
  // 토스 포스 배치 취소 — 그 결제 건에 붙은 일마감 자국도 지운다 (2026-08-26)
  // 🔴 지운 자국은 recon_match_gone 에 옮겨 적는다 (2026-08-29 — 왜 사라졌는지 알 수 있게)
  if (up.source === "토스포스") {
    await db.execute(sql`
      WITH d AS (
        DELETE FROM recon_match WHERE kind = '포스결제' AND src_table = 'pos_txn'
          AND src_id IN (SELECT id FROM pos_txn WHERE upload_id = ${uploadId})
        RETURNING *
      )
      INSERT INTO recon_match_gone
        (match_id, kind, src_table, src_id, ref_table, ref_id, amount, method, confirmed_at, reason)
      SELECT d.id, d.kind, d.src_table, d.src_id, d.ref_table, d.ref_id, d.amount, d.method, d.confirmed_at,
             ${"배치 되돌리기 #" + uploadId}
      FROM d
    `);
  }
  // 🔴 감사 M9: '카드매출승인' 배치는 card_day(집계)와 card_txn(건별) 둘 다 잠재운다
  if (up.source === "카드매출승인") {
    await db.execute(sql`
      UPDATE card_txn SET is_active = false WHERE upload_id = ${uploadId} AND is_active
    `);
  }
  /* 🔴 감사 M10: 잠재운 줄에 붙어 있던 대조 연결을 지운다 — 안 지우면 죽은 줄과 이어진
     매입·판매·계산서가 영영 후보에서 제외된다.
     🔴 2026-09-10: 자국만 지우고 **상태를 안 되돌렸다** (주석은 "미대조로 되돌림"이라 쓰여
     있었지만 코드엔 없었다). 잠재운 줄은 같은 파일을 다시 올리면 `is_active=true` 로
     되살아나는데, 그때 '확정'인 채 근거(자국)만 없어 **스스로 감사 A2(「확정인데 근거 없음」)를
     만들었다.** 줄 상태는 줄 단위 정본 restoreCashLine — 반드시 자국을 지운 **뒤에** 부른다. */
  if (up.source === "통장" || up.source === "법인카드") {
    const gone = await db.execute<{ src_table: string; src_id: number; ref_id: number }>(sql`
      DELETE FROM recon_match WHERE ref_table = 'cash_txn'
        AND ref_id IN (SELECT id FROM cash_txn WHERE upload_id = ${uploadId})
      RETURNING src_table, src_id, ref_id
    `);
    for (const id of new Set(gone.map((g) => Number(g.ref_id)))) await restoreCashLine(db, id);
    // 계산서(src) 쪽 — 근거가 하나도 안 남고 사유도 없는 것만 미대조로 (「월정산」·「차액 확인 끝」은 사장님 판단이라 둔다)
    const taxIds = [...new Set(gone.filter((g) => g.src_table === "tax_invoice").map((g) => Number(g.src_id)))];
    if (taxIds.length > 0) await restoreTaxLines(sql`t.id IN (${sql.join(taxIds.map((n) => sql`${n}`), sql`, `)})`);
  } else if (up.source === "홈택스매출" || up.source === "홈택스매입") {
    const gone = await db.execute<{ ref_table: string; ref_id: number }>(sql`
      DELETE FROM recon_match WHERE src_table = 'tax_invoice'
        AND src_id IN (SELECT id FROM tax_invoice WHERE upload_id = ${uploadId})
      RETURNING ref_table, ref_id
    `);
    // 반대편 통장 줄 — 이 계산서가 유일한 근거였다면 '확정'인 채 남아 감사 A2 가 된다
    for (const id of new Set(gone.filter((g) => g.ref_table === "cash_txn").map((g) => Number(g.ref_id)))) {
      await restoreCashLine(db, id);
    }
    // 잠재운 계산서 자신도 — 되살아날 때를 위해 (위와 같은 까닭)
    await restoreTaxLines(sql`t.upload_id = ${uploadId}`);
  }
  await db.execute(sql`UPDATE fin_upload SET status = '취소' WHERE id = ${uploadId}`);
  return rows.length;
}

/* ================================================================== */
/* ERP 2단계 — 세금계산서 반영 (2026-08-24)                             */


/** 홈택스 목록을 한 배치로 반영 — 승인번호가 중복 방지의 전부라 페이지 분할 파일이 겹쳐도 안전 */
export async function ingestTaxInvoices(
  parsed: TaxParseResult,
  userId: number | null,
  fileName: string,
): Promise<IngestResult> {
  const [up] = await db.execute<{ id: number }>(sql`
    INSERT INTO fin_upload (source, file_name, raw_text, row_count, period_from, period_to, created_by)
    VALUES (${parsed.source}, ${fileName}, ${parsed.rawCsv.slice(0, 2_000_000)},
            ${parsed.rows.length}, ${parsed.periodFrom}, ${parsed.periodTo}, ${userId})
    RETURNING id
  `);
  const uploadId = Number(up.id);

  let newCount = 0;
  for (let i = 0; i < parsed.rows.length; i += 100) {
    const chunk = parsed.rows.slice(i, i + 100);
    const values = chunk.map(
      (r) => sql`(${r.direction}, ${r.approvalNo}, ${r.writeDate}::date, ${r.issueDate}::date,
        ${r.counterBizNo}, ${r.counterName}, ${r.supplyAmount}, ${r.vat}, ${r.total},
        ${r.itemSummary}, ${uploadId})`,
    );
    const ins = await db.execute<{ id: number }>(sql`
      INSERT INTO tax_invoice (direction, approval_no, write_date, issue_date,
                               counterparty_biz_no, counterparty_name, supply_amount, vat, total,
                               item_summary, upload_id)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (approval_no) DO NOTHING
      RETURNING id
    `);
    newCount += ins.length;
    await db.execute(sql`
      UPDATE tax_invoice SET is_active = true
      WHERE is_active = false
        AND approval_no IN (${sql.join(chunk.map((r) => sql`${r.approvalNo}`), sql`, `)})
    `);
  }

  /**
   * ⭐ 자동 정리 — 상대 유형(경비·무시) 학습분만 자동 무시.
   * 🔴 과거분 자동 접힘은 폐지 (사장님 방침 2026-08-26: "중요한 건 자료들 —
   *    이전 내용 전부 살려 달라"). 2025년 계산서도 통장(2025-01~)과 대조한다.
   */
  await db.execute(sql`
    UPDATE tax_invoice t SET recon_status = '무시', recon_reason = r.kind
    FROM tax_party_rule r
    WHERE t.upload_id = ${uploadId} AND t.recon_status = '미대조'
      AND r.biz_no = t.counterparty_biz_no AND r.kind IN ('경비', '무시')
  `);
  // 품목 단위 규칙 (미쉐린 digital module 같은 혼합 상대) — 품목 정규화가 JS 라 여기서 맞춘다
  const itemRules = await db.execute<{ biz_no: string; item_key: string; kind: string }>(sql`
    SELECT biz_no, item_key, kind FROM tax_item_rule LIMIT 2000
  `);
  if (itemRules.length > 0) {
    const rmap = new Map(itemRules.map((r) => [`${r.biz_no}|${r.item_key}`, r.kind]));
    const fresh = await db.execute<{ id: number; counterparty_biz_no: string; item_summary: string | null }>(sql`
      SELECT id, counterparty_biz_no, item_summary FROM tax_invoice
      WHERE upload_id = ${uploadId} AND recon_status = '미대조' LIMIT 500
    `);
    for (const row of fresh) {
      const k = rmap.get(`${row.counterparty_biz_no}|${normName(row.item_summary ?? "")}`);
      if (k) {
        await db.execute(sql`
          UPDATE tax_invoice SET recon_status = '무시', recon_reason = ${k} WHERE id = ${row.id}
        `);
      }
    }
  }

  const dupCount = parsed.rows.length - newCount;
  await db.execute(sql`
    UPDATE fin_upload SET new_count = ${newCount}, dup_count = ${dupCount} WHERE id = ${uploadId}
  `);
  return { uploadId, rowCount: parsed.rows.length, newCount, dupCount };
}

/* ================================================================== */
/* ERP 3단계 — 여신협회 카드매출 반영 (2026-08-24)                       */
/* 합계 자료라 「덮어쓰기」가 맞다 — 같은 날/월을 다시 올리면 최신 값이 정답 */

export async function ingestCardDays(
  parsed: CardDayParseResult,
  userId: number | null,
  fileName: string,
): Promise<IngestResult> {
  const [up] = await db.execute<{ id: number }>(sql`
    INSERT INTO fin_upload (source, file_name, raw_text, row_count, period_from, period_to, created_by)
    VALUES (${parsed.source}, ${fileName}, ${parsed.rawCsv.slice(0, 2_000_000)},
            ${parsed.rows.length}, ${parsed.periodFrom}, ${parsed.periodTo}, ${userId})
    RETURNING id
  `);
  const uploadId = Number(up.id);
  let newCount = 0;
  for (let i = 0; i < parsed.rows.length; i += 100) {
    const chunk = parsed.rows.slice(i, i + 100);
    const values = chunk.map(
      (r) => sql`(${r.date}::date, ${r.totalAmount}, ${r.totalCnt}, ${r.approvedAmount},
        ${r.approvedCnt}, ${r.cancelledAmount}, ${r.cancelledCnt}, ${uploadId})`,
    );
    const ins = await db.execute<{ inserted: boolean }>(sql`
      INSERT INTO card_day (day, total_amount, total_cnt, approved_amount, approved_cnt,
                            cancelled_amount, cancelled_cnt, upload_id)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (day) DO UPDATE SET
        total_amount = EXCLUDED.total_amount, total_cnt = EXCLUDED.total_cnt,
        approved_amount = EXCLUDED.approved_amount, approved_cnt = EXCLUDED.approved_cnt,
        cancelled_amount = EXCLUDED.cancelled_amount, cancelled_cnt = EXCLUDED.cancelled_cnt,
        is_active = true, upload_id = EXCLUDED.upload_id
      RETURNING (xmax = 0) AS inserted
    `);
    newCount += ins.filter((r) => r.inserted).length;
  }
  const dupCount = parsed.rows.length - newCount;
  await db.execute(sql`UPDATE fin_upload SET new_count = ${newCount}, dup_count = ${dupCount} WHERE id = ${uploadId}`);
  return { uploadId, rowCount: parsed.rows.length, newCount, dupCount };
}

export async function ingestCardDeposits(
  parsed: CardDepositParseResult,
  userId: number | null,
  fileName: string,
): Promise<IngestResult> {
  const [up] = await db.execute<{ id: number }>(sql`
    INSERT INTO fin_upload (source, file_name, raw_text, row_count, period_from, period_to, created_by)
    VALUES (${parsed.source}, ${fileName}, ${parsed.rawCsv.slice(0, 2_000_000)},
            ${parsed.rows.length}, ${parsed.periodFrom}, ${parsed.periodTo}, ${userId})
    RETURNING id
  `);
  const uploadId = Number(up.id);
  let newCount = 0;
  for (let i = 0; i < parsed.rows.length; i += 100) {
    const chunk = parsed.rows.slice(i, i + 100);
    const values = chunk.map(
      (r) => sql`(${r.month}, ${r.cardCo}, ${r.saleCnt}, ${r.saleAmount}, ${r.vatAgency},
        ${r.depositAmount}, ${uploadId})`,
    );
    const ins = await db.execute<{ inserted: boolean }>(sql`
      INSERT INTO card_deposit (month, card_co, sale_cnt, sale_amount, vat_agency, deposit_amount, upload_id)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (month, card_co) DO UPDATE SET
        sale_cnt = EXCLUDED.sale_cnt, sale_amount = EXCLUDED.sale_amount,
        vat_agency = EXCLUDED.vat_agency, deposit_amount = EXCLUDED.deposit_amount,
        is_active = true, upload_id = EXCLUDED.upload_id
      RETURNING (xmax = 0) AS inserted
    `);
    newCount += ins.filter((r) => r.inserted).length;
  }
  const dupCount = parsed.rows.length - newCount;
  await db.execute(sql`UPDATE fin_upload SET new_count = ${newCount}, dup_count = ${dupCount} WHERE id = ${uploadId}`);
  return { uploadId, rowCount: parsed.rows.length, newCount, dupCount };
}

/* ================================================================== */
/* 카드 매출 건별 승인 반영 (2026-08-25)                                */

/**
 * ⭐ 토스 포스 결제 건 — pos_txn 에 넣고, 반영한 날짜마다 앱 판매와 자동 대조 (2026-08-26)
 *   dedup = 토스포스|일자|결제시각|수단|매입사|금액|상태 (승인번호가 없는 형식)
 */
export async function ingestPosTxns(
  parsed: PosParseResult,
  userId: number | null,
  fileName: string,
): Promise<IngestResult & { matched: number }> {
  const [up] = await db.execute<{ id: number }>(sql`
    INSERT INTO fin_upload (source, file_name, raw_text, row_count, period_from, period_to, created_by)
    VALUES (${parsed.source}, ${fileName}, ${parsed.rawCsv.slice(0, 2_000_000)},
            ${parsed.rows.length}, ${parsed.periodFrom}, ${parsed.periodTo}, ${userId})
    RETURNING id
  `);
  const uploadId = Number(up.id);
  let newCount = 0;
  for (let i = 0; i < parsed.rows.length; i += 100) {
    const chunk = parsed.rows.slice(i, i + 100);
    const keys = chunk.map(
      (r) => `토스포스|${r.day}|${r.paidAt}|${r.method}|${r.cardCo ?? ""}|${r.amount}|${r.isCancel ? "취소" : "승인"}`,
    );
    const values = chunk.map(
      (r, j) => sql`(${r.day}::date, ${r.paidAt + "+09"}::timestamptz, ${r.channel}, ${r.orderNo}, ${r.method}, ${r.cardCo},
        ${r.amount}, ${r.vat}, ${r.isCancel}, ${r.cancelAt ? r.cancelAt + "+09" : null}::timestamptz, ${keys[j]}, ${uploadId})`,
    );
    const ins = await db.execute<{ id: number }>(sql`
      INSERT INTO pos_txn (day, paid_at, channel, order_no, method, card_co, amount, vat, is_cancel, cancel_at, dedup_key, upload_id)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (dedup_key) DO NOTHING
      RETURNING id
    `);
    newCount += ins.length;
    await db.execute(sql`
      UPDATE pos_txn SET is_active = true
      WHERE is_active = false AND dedup_key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
    `);
  }
  // 반영한 날짜마다 자동 대조 — 올리면 바로 짝이 맞는다
  let matched = 0;
  for (const day of [...new Set(parsed.rows.map((r) => r.day))].sort()) matched += await autoMatchPosDayCore(day, userId);
  const dupCount = parsed.rows.length - newCount;
  await db.execute(sql`UPDATE fin_upload SET new_count = ${newCount}, dup_count = ${dupCount} WHERE id = ${uploadId}`);
  return { uploadId, rowCount: parsed.rows.length, newCount, dupCount, matched };
}

/** 건별 승인 — card_txn 에 넣고, 일별 합계(card_day)도 세부에서 집계해 같이 얹는다 */
export async function ingestCardTxns(
  parsed: CardTxnParseResult,
  userId: number | null,
  fileName: string,
): Promise<IngestResult> {
  const [up] = await db.execute<{ id: number }>(sql`
    INSERT INTO fin_upload (source, file_name, raw_text, row_count, period_from, period_to, created_by)
    VALUES (${parsed.source}, ${fileName}, ${parsed.rawCsv.slice(0, 2_000_000)},
            ${parsed.rows.length}, ${parsed.periodFrom}, ${parsed.periodTo}, ${userId})
    RETURNING id
  `);
  const uploadId = Number(up.id);

  let newCount = 0;
  for (let i = 0; i < parsed.rows.length; i += 100) {
    const chunk = parsed.rows.slice(i, i + 100);
    const keys = chunk.map(
      (r) => `카드승인|${r.cardCo}|${r.approvalNo}|${r.approvedAt}|${r.amount}`,
    );
    const values = chunk.map(
      (r, j) => sql`(${r.approvedAt + "+09"}::timestamptz, ${r.cardCo}, ${r.cardNoMasked},
        ${r.approvalNo}, ${r.amount}, ${r.isCancel}, ${r.installment}, ${keys[j]}, ${uploadId})`,
    );
    const ins = await db.execute<{ id: number }>(sql`
      INSERT INTO card_txn (approved_at, card_co, card_no_masked, approval_no, amount,
                            is_cancel, installment, dedup_key, upload_id)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (dedup_key) DO NOTHING
      RETURNING id
    `);
    newCount += ins.length;
    await db.execute(sql`
      UPDATE card_txn SET is_active = true
      WHERE is_active = false AND dedup_key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
    `);
  }

  // 일별 합계도 세부에서 만든다 — 요약 파일 없이 세부만 올려도 대조 화면이 돈다
  const byDay = new Map<string, { total: number; cnt: number; ok: number; okCnt: number; cx: number; cxCnt: number }>();
  for (const r of parsed.rows) {
    const day = r.approvedAt.slice(0, 10);
    const a = byDay.get(day) ?? { total: 0, cnt: 0, ok: 0, okCnt: 0, cx: 0, cxCnt: 0 };
    a.total += r.amount;
    a.cnt++;
    if (r.isCancel) {
      a.cx += r.amount;
      a.cxCnt++;
    } else {
      a.ok += r.amount;
      a.okCnt++;
    }
    byDay.set(day, a);
  }
  for (const [day, a] of byDay) {
    await db.execute(sql`
      INSERT INTO card_day (day, total_amount, total_cnt, approved_amount, approved_cnt,
                            cancelled_amount, cancelled_cnt, upload_id)
      VALUES (${day}::date, ${a.total}, ${a.cnt}, ${a.ok}, ${a.okCnt}, ${a.cx}, ${a.cxCnt}, ${uploadId})
      ON CONFLICT (day) DO UPDATE SET
        total_amount = EXCLUDED.total_amount, total_cnt = EXCLUDED.total_cnt,
        approved_amount = EXCLUDED.approved_amount, approved_cnt = EXCLUDED.approved_cnt,
        cancelled_amount = EXCLUDED.cancelled_amount, cancelled_cnt = EXCLUDED.cancelled_cnt,
        is_active = true, upload_id = EXCLUDED.upload_id
    `);
  }

  const dupCount = parsed.rows.length - newCount;
  await db.execute(sql`UPDATE fin_upload SET new_count = ${newCount}, dup_count = ${dupCount} WHERE id = ${uploadId}`);
  return { uploadId, rowCount: parsed.rows.length, newCount, dupCount };
}
