/**
 * ⭐ 발행 대행 메일 → 계산서 장부 「속보」 줄 (2026-11-25 사장님 결정 — 「1번으로 진행」)
 *
 *   intake.ts(메일 본문)가 부른다. 해석·짝 판정은 tax-mail-notice.ts(순수).
 *
 *   ① 금액·작성일자가 메일에 있어야 넣는다(팝빌·bill36524). 스마트빌·이카운트·바로빌은 금액이 없어 → 도착 알림만.
 *   ② 같은 계산서가 이미 장부에 진짜 승인번호로 있으면(엑셀이 먼저 온 경우) 넣지 않는다.
 *   ③ 상대 사업자번호는 메일에 없다 — 지난 계산서에서 이름이 같은 상대의 번호를 빌린다(하나로 갈릴 때만).
 *      그래야 경비·월정산 규칙과 거래처 묶음이 속보 줄에도 바로 듣는다. 모르면 빈칸(엑셀 확정 때 채워진다).
 *   ④ 받은 날마다 fin_upload 한 장(「메일 계산서 YYYY-MM-DD」)에 묶는다 — 「올린 자료 취소」로 하루치를 되돌릴 수 있다.
 *   ⑤ 줄은 tax_invoice 에 승인번호 자리 「알림|mail:<메일ID>」로 들어간다. 홈택스 엑셀·보안메일이 오면
 *      fin-ingest.ingestTaxInvoices → confirmTaxNotices 가 이 줄을 진짜 내용으로 **확정**한다.
 *
 * 🔴 "use server" 아님. 질의는 순차 (커넥션 max 3).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { samePartyName } from "./recon-data";
import { matchNoticeToTaxInvoice, noticeApprovalKey, provisionBlocker, type TaxMailNotice } from "./tax-mail-notice";

export type TaxNoticeOutcome =
  | { status: "반영"; taxInvoiceId: number; result: string }
  | { status: "중복"; result: string; taxInvoiceId?: number }
  | { status: "보관"; result: string };

const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export async function ingestTaxNotice(n: TaxMailNotice, messageId: string): Promise<TaxNoticeOutcome> {
  const what = `${n.vendor} ${n.kind} ${n.supplier} ${n.writeDate ?? "날짜?"}${n.supplyAmount != null ? ` 공급가 ${n.supplyAmount.toLocaleString()}` : ""}`;
  const block = provisionBlocker(n);
  if (block) return { status: "보관", result: `계산서 도착 알림 — ${what} (${block})` };
  const direction = n.kind === "매출" ? "매출" : "매입";
  const writeDate = n.writeDate!;
  const supply = n.supplyAmount!;
  const vat = n.vat!;

  // ② 진짜 계산서가 이미 장부에 있나
  const near = await db.execute<{ id: number; approval_no: string; wd: string; name: string; supply_amount: number }>(sql`
    SELECT id, approval_no, write_date::text wd, counterparty_name name, supply_amount
    FROM tax_invoice
    WHERE is_active AND direction = ${direction} AND write_date = ${writeDate}::date AND approval_no NOT LIKE '알림|%'
    LIMIT 200
  `);
  const real = matchNoticeToTaxInvoice(
    n,
    near.map((t) => ({ id: Number(t.id), approvalNo: t.approval_no, direction, writeDate: t.wd, counterName: t.name, supplyAmount: t.supply_amount })),
    (a, b) => samePartyName(a, b),
  );
  if (real) return { status: "중복", taxInvoiceId: real.id, result: `${what} — 이미 장부에 있는 계산서 (승인 ${real.approvalNo})` };

  // ③ 사업자번호 빌리기 — 이름이 같은 상대가 번호 하나로 갈릴 때만
  const parties = await db.execute<{ biz: string; name: string }>(sql`
    SELECT DISTINCT counterparty_biz_no biz, counterparty_name name
    FROM tax_invoice
    WHERE is_active AND direction = ${direction} AND approval_no NOT LIKE '알림|%' AND counterparty_biz_no <> ''
    LIMIT 5000
  `);
  const bizSet = new Set(parties.filter((p) => samePartyName(n.supplier, p.name)).map((p) => p.biz));
  const biz = bizSet.size === 1 ? [...bizSet][0] : "";

  // ④ 오늘 받은 메일 계산서 묶음
  const day = kstToday();
  const source = direction === "매입" ? "홈택스매입" : "홈택스매출";
  const fileName = `메일 계산서 ${day}`;
  const [found] = await db.execute<{ id: number }>(sql`
    SELECT id FROM fin_upload WHERE source = ${source} AND file_name = ${fileName} AND status = '반영' ORDER BY id LIMIT 1
  `);
  let uploadId = found ? Number(found.id) : 0;
  if (!uploadId) {
    const [up] = await db.execute<{ id: number }>(sql`
      INSERT INTO fin_upload (source, file_name, raw_text, row_count, period_from, period_to)
      VALUES (${source}, ${fileName}, '', 0, ${day}::date, ${day}::date)
      RETURNING id
    `);
    uploadId = Number(up.id);
  }

  // ⑤ 속보 줄 — 같은 메일이 두 번 와도 승인번호 자리 열쇠로 한 줄
  const key = noticeApprovalKey(messageId);
  const memo = `메일 속보(${n.vendor}) — 홈택스 엑셀이 올라오면 확정됩니다`;
  const ins = await db.execute<{ id: number }>(sql`
    INSERT INTO tax_invoice (direction, approval_no, write_date, counterparty_biz_no, counterparty_name,
                             supply_amount, vat, total, item_summary, upload_id, memo)
    VALUES (${direction}, ${key}, ${writeDate}::date, ${biz}, ${n.supplier},
            ${supply}, ${vat}, ${supply + vat}, ${n.item}, ${uploadId}, ${memo})
    ON CONFLICT (approval_no) DO NOTHING
    RETURNING id
  `);
  if (ins.length === 0) {
    const [old] = await db.execute<{ id: number }>(sql`SELECT id FROM tax_invoice WHERE approval_no = ${key}`);
    return { status: "중복", taxInvoiceId: old ? Number(old.id) : undefined, result: `${what} — 이미 받은 메일` };
  }
  const id = Number(ins[0].id);
  await db.execute(sql`UPDATE fin_upload SET row_count = row_count + 1, new_count = new_count + 1 WHERE id = ${uploadId}`);

  // 경비·무시 상대 규칙 — 엑셀 반영과 같은 조건 (사업자번호를 알 때만 듣는다)
  if (biz) {
    await db.execute(sql`
      UPDATE tax_invoice t SET recon_status = '무시', recon_reason = r.kind
      FROM tax_party_rule r
      WHERE t.id = ${id} AND t.recon_status = '미대조' AND r.biz_no = t.counterparty_biz_no AND r.kind IN ('경비', '무시')
    `);
  }
  return {
    status: "반영",
    taxInvoiceId: id,
    result: `계산서 속보 — ${what} 세액 ${vat.toLocaleString()}${biz ? "" : " (사업자번호 모름 — 엑셀 확정 때 채움)"}`,
  };
}
