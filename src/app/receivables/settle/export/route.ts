import { isOwner } from "@/lib/auth";
import { buildInvoiceWorkbook } from "@/lib/settlement-sheet";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * 거래처 월 청구서를 엑셀로 내려받는다 (?supplier=쏘카&ym=2026-08).
 * 내려받는 순간 회차에 청구액 스냅샷을 찍는다 — 「원래 얼마 청구했나」의 정본.
 */
export async function GET(req: Request) {
  if (!(await isOwner())) return new Response("사장님 계정 전용입니다", { status: 403 });
  const url = new URL(req.url);
  const supplier = (url.searchParams.get("supplier") ?? "").trim();
  const ym = (url.searchParams.get("ym") ?? "").trim();
  if (!supplier || !/^\d{4}-\d{2}$/.test(ym)) return new Response("supplier·ym 이 필요합니다", { status: 400 });

  const { buf, total, count } = await buildInvoiceWorkbook(supplier, ym);
  if (count === 0) return new Response("그 달 외상 판매가 없습니다", { status: 404 });

  await db.execute(sql`
    UPDATE settlement_run SET invoiced_amount = ${total}, invoice_exported_at = now(), updated_at = now()
    WHERE supplier_name = ${supplier} AND ym = ${ym}
  `);

  const name = `청구내역-${supplier}-${ym}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // 한글 파일명은 filename* (RFC 5987) 로 보내야 안 깨진다
      "Content-Disposition": `attachment; filename="invoice-${ym}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
