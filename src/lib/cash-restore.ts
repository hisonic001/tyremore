/**
 * ⭐ 통장 줄 상태 복원 정본 (2026 감사 G2·G3·G4, 2026-08-26)
 *
 *   계산서 연결·지급 잡기·외상 수금 되돌리기가 제각각 `recon_status='미대조'` 를 덮어쓰고,
 *   '매입대금' 분류 복원 여부를 계산서 단위 사유로 결정하던 것을 **줄 단위** 한 규칙으로:
 *     - 남은 확정 연결(소진량 정본 cashUsedSql)이 0이면 '미대조', 남아 있으면 '제안'(일부 확인)
 *     - '매입대금' 은 매입 계산서·매입지급 연결이 하나도 안 남았을 때만 NULL (다른 분류는 안 건드림)
 *     - '무시' 로 접어 둔 줄은 건드리지 않는다
 *
 * 🔴 "use server" 아님 — 쓰기 액션이 트랜잭션 안(tx)에서 부른다. 호출 전에 recon_match 를
 *    먼저 지워야 소진량이 맞게 계산된다.
 */
import { sql, type SQL } from "drizzle-orm";
import { cashUsedSql } from "./recon-data";

export interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

export async function restoreCashLine(ex: SqlExecutor, cashTxnId: number): Promise<void> {
  await ex.execute(sql`
    UPDATE cash_txn c
    SET recon_status = CASE WHEN ${cashUsedSql("c")} > 0 THEN '제안' ELSE '미대조' END,
        category = CASE
          WHEN c.category = '매입대금'
           AND NOT EXISTS (SELECT 1 FROM recon_match m WHERE m.status = '확정'
                            AND ((m.ref_table = 'cash_txn' AND m.ref_id = c.id AND m.kind = '매입계산서')
                              OR (m.src_table = 'cash_txn' AND m.src_id = c.id AND m.kind = '매입지급')))
          THEN NULL ELSE c.category END
    WHERE c.id = ${cashTxnId} AND c.recon_status <> '무시'
  `);
}
