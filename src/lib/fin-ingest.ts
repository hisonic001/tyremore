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
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { CardDayParseResult, CardDepositParseResult, FinParseResult, NormalizedCashTxn, TaxParseResult } from "./fin-sheet";

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
      base = `카드|${label}|${r.approvalNo}|${r.occurredAt.slice(0, 10)}`;
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

  /**
   * ⭐ 분류 자동 적용 (경비 분류, 2026-08-25) — 한 번 배운 상대(expense_rule)는
   *    새로 올린 파일에도 바로 붙는다. 내부이체(우리 상호)도 자동.
   */
  await db.execute(sql`
    UPDATE cash_txn c SET category = r.category
    FROM expense_rule r
    WHERE c.upload_id = ${uploadId} AND c.category IS NULL AND c.out_amount > 0
      AND r.key = (CASE WHEN c.source = '통장'
                    THEN trim(regexp_replace(c.description, '^\[[^\]]*\] *', ''))
                    ELSE trim(c.description) END)
  `);
  await db.execute(sql`
    UPDATE cash_txn SET category = '내부이체'
    WHERE upload_id = ${uploadId} AND category IS NULL AND source = '통장'
      AND description LIKE '%싸이오토모%'
  `);
  // 지역화폐 정산 — 「속초정산」 = 속초 지역상품권(모바일) 정산 입금 (사장님 설명 2026-08-25).
  //   매출은 앱 판매(지역화폐)에서 이미 세므로 여기서 또 세지 않는다 — 분류만 붙여 정리
  await db.execute(sql`
    UPDATE cash_txn SET category = '지역화폐정산'
    WHERE upload_id = ${uploadId} AND category IS NULL AND source = '통장'
      AND description LIKE '%속초정산%'
  `);
  // 주주거래 — 조준호·이현숙(내부 관계자·주주, 사장님 확인 2026-08-25)의 입출금은 매출·경비가 아니다
  await db.execute(sql`
    UPDATE cash_txn SET category = '주주거래'
    WHERE upload_id = ${uploadId} AND category IS NULL AND source = '통장'
      AND (description LIKE '%조준호%' OR description LIKE '%이현숙%')
  `);

  const dupCount = parsed.rows.length - newCount;
  await db.execute(sql`
    UPDATE fin_upload SET new_count = ${newCount}, dup_count = ${dupCount} WHERE id = ${uploadId}
  `);
  return { uploadId, rowCount: parsed.rows.length, newCount, dupCount };
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
          : sql.raw("cash_txn");
  const rows = await db.execute<{ id: number }>(sql`
    UPDATE ${table} SET is_active = false WHERE upload_id = ${uploadId} AND is_active RETURNING id
  `);
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
