/**
 * ⭐ 거래처 월 청구서 엑셀 (사장님 요청 2026-09-01)
 *
 *   수기 「8월 렌트카 수리비.xlsx」의 업체별 시트 꼴을 따른다:
 *   차량번호·차종 / 점검내용 / 금액 / 승인금액(빈칸) / 승인(빈칸).
 *
 * ⭐ 맨 앞에 **관리번호(Q26-…)** 를 넣는다 — 거래처가 이 파일에 승인금액만 채워
 *   돌려주면 회신 올리기가 관리번호로 정확히 이어진다 (왕복 호환).
 * ⭐ 부가세: supplier.vat_mode 가 '별도'(AJ)면 공급가액·부가세·합계 세 칸으로 —
 *   앱에 부가세 별도 금액으로 등록해 오신 실측 관행 그대로.
 * 🔴 "use server" 아님 — export route 가 쓴다.
 */
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db";
import { monthRange } from "./ym";
import { parseReplyText, type ReplyRow } from "./settlement-core";

export async function buildInvoiceWorkbook(
  supplier: string,
  ym: string,
): Promise<{ buf: Buffer; total: number; count: number; vatMode: "포함" | "별도" }> {
  const { start, nextStart } = monthRange(ym);
  const [sup] = await db.execute<{ vat_mode: string }>(sql`
    SELECT vat_mode FROM supplier WHERE name = ${supplier} LIMIT 1
  `);
  const vatMode = (sup?.vat_mode === "별도" ? "별도" : "포함") as "포함" | "별도";

  const rows = await db.execute<{
    quote_no: string;
    work_date: string;
    plate_no: string | null;
    model: string | null;
    description: string;
    qty: number;
    amount: number;
  }>(sql`
    SELECT q.quote_no,
           COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)::text work_date,
           v.plate_no, v.model, i.description, i.qty, (i.qty * i.final_price)::int amount
    FROM quote q
    JOIN quote_item i ON i.quote_id = q.id
    LEFT JOIN vehicle v ON v.id = q.vehicle_id
    WHERE q.status = '성사' AND q.payment_method = '외상' AND q.supplier_name = ${supplier}
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}::date
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
    ORDER BY work_date ASC, q.id ASC, i.id ASC
    LIMIT 2000
  `);

  const quotes = new Set(rows.map((r) => r.quote_no));
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  const head =
    vatMode === "별도"
      ? ["관리번호", "작업일", "차량번호", "차종", "점검내용", "수량", "공급가액", "부가세", "합계", "승인금액", "승인", "비고"]
      : ["관리번호", "작업일", "차량번호", "차종", "점검내용", "수량", "금액", "승인금액", "승인", "비고"];

  const body: (string | number)[][] = rows.map((r) => {
    const amt = Number(r.amount);
    const common = [r.quote_no, r.work_date, r.plate_no ?? "", r.model ?? "", r.description, Number(r.qty)];
    return vatMode === "별도"
      ? [...common, amt, Math.round(amt * 0.1), Math.round(amt * 1.1), "", "", ""]
      : [...common, amt, "", "", ""];
  });
  const sumRow =
    vatMode === "별도"
      ? ["합계", "", "", "", `${quotes.size}건`, "", total, Math.round(total * 0.1), Math.round(total * 1.1), "", "", ""]
      : ["합계", "", "", "", `${quotes.size}건`, "", total, "", "", ""];

  const ws = XLSX.utils.aoa_to_sheet([
    [`${ym} ${supplier} 정비 청구 내역 — 타이어모어 속초점`],
    vatMode === "별도" ? ["금액은 부가세 별도이며 「합계」가 청구액입니다. 승인금액·승인 칸을 채워 회신해 주세요."] : ["승인금액·승인 칸을 채워 회신해 주세요."],
    head,
    ...body,
    sumRow,
  ]);
  ws["!cols"] = head.map((h) => ({ wch: h === "점검내용" ? 34 : h === "차량번호" || h === "관리번호" ? 13 : 10 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "청구내역");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { buf, total, count: quotes.size, vatMode };
}

/**
 * 회신 엑셀 읽기 — 시트의 칸을 탭으로 이어 **글 회신과 같은 길**(parseReplyText)로 보낸다.
 * 우리가 내보낸 파일이든 거래처 자체 양식이든 관리번호·차량번호·금액만 있으면 읽힌다.
 */
export function parseReplyWorkbook(buf: Buffer | ArrayBuffer): ReplyRow[] {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? "array" : "buffer" });
  const lines: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, { header: 1, raw: true, defval: "" });
    for (const row of rows) {
      const cells = row.map((c) => String(c ?? "").replace(/\r?\n/g, " ").trim());
      if (cells.every((c) => !c)) continue;
      lines.push(cells.join("\t"));
    }
  }
  return parseReplyText(lines.join("\n"));
}
