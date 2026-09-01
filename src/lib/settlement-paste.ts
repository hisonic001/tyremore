"use server";

/**
 * ⭐ 거래처 회신 올리기 — 붙여넣기·엑셀을 우리 판매와 잇는 미리보기 (2026-09-01)
 *
 *   purchase-paste 원칙 그대로: **못 알아본 줄은 버리지 않는다** — 미리보기에
 *   남겨 사장님이 한 번 골라 주면 된다. 저장은 미리보기를 거친 뒤에만.
 *
 * 🔴 판정 저장은 settlement.ts(saveMatchedDecisions·saveDecision)가 한다 —
 *    여기는 해석과 매칭(정본: settlement-core)만.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isOwner } from "./auth";
import { normalizePlate } from "./normalize";
import { matchReply, parseReplyText, type OurLine, type ReplyRow } from "./settlement-core";
import { parseReplyWorkbook } from "./settlement-sheet";

export interface ReplyPreviewMatched {
  lineId: number;
  quoteNo: string;
  workDate: string;
  plateNo: string | null;
  billed: number;
  agreed: number | null;
  matchedBy: string;
  memo: string;
}

export interface ReplyPreviewCandidate {
  lineId: number;
  quoteNo: string;
  workDate: string;
  plateNo: string | null;
  billed: number;
}

export interface ReplyPreview {
  matched: ReplyPreviewMatched[];
  ambiguous: { raw: string; agreed: number | null; candidates: ReplyPreviewCandidate[] }[];
  unmatched: string[];
  parsedCount: number;
}

/** 회신(붙여넣은 글 또는 엑셀 파일)을 읽어 회차의 판매들과 이어 본다 — 저장은 안 한다 */
export async function previewReply(
  runId: number,
  fd: FormData,
): Promise<{ ok: true; preview: ReplyPreview } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "정산은 사장님 계정 전용입니다" };

  let rows: ReplyRow[];
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 5_000_000) return { ok: false, error: "파일이 너무 큽니다 (5MB 까지)" };
    try {
      rows = parseReplyWorkbook(await file.arrayBuffer());
    } catch {
      return { ok: false, error: "엑셀을 읽지 못했습니다 — .xlsx 파일인지 확인해 주세요" };
    }
  } else {
    rows = parseReplyText(String(fd.get("text") ?? ""));
  }
  if (rows.length === 0) return { ok: false, error: "읽을 수 있는 줄이 없습니다 — 표를 그대로 복사했는지 확인해 주세요" };

  const [run] = await db.execute<{ supplier_name: string }>(sql`
    SELECT supplier_name FROM settlement_run WHERE id = ${runId}
  `);
  if (!run) return { ok: false, error: "회차를 찾을 수 없습니다" };
  const [sup] = await db.execute<{ vat_mode: string }>(sql`
    SELECT vat_mode FROM supplier WHERE name = ${run.supplier_name} LIMIT 1
  `);
  const vatMode = (sup?.vat_mode === "별도" ? "별도" : "포함") as "포함" | "별도";

  const ours = await db.execute<{
    line_id: number;
    quote_id: number;
    quote_no: string;
    plate_no: string | null;
    billed: number;
    work_date: string;
  }>(sql`
    SELECT l.id line_id, l.quote_id, q.quote_no, v.plate_no, l.billed_amount billed,
           COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)::text work_date
    FROM settlement_line l
    JOIN quote q ON q.id = l.quote_id
    LEFT JOIN vehicle v ON v.id = q.vehicle_id
    WHERE l.run_id = ${runId}
    LIMIT 300
  `);
  const ourLines: OurLine[] = ours.map((o) => ({
    lineId: Number(o.line_id),
    quoteId: Number(o.quote_id),
    quoteNo: o.quote_no,
    plateNorm: o.plate_no ? normalizePlate(o.plate_no) : null,
    billed: Number(o.billed),
    workDate: o.work_date,
  }));
  const byLineId = new Map(ours.map((o) => [Number(o.line_id), o]));

  const m = matchReply(rows, ourLines, vatMode);
  const toCand = (c: OurLine): ReplyPreviewCandidate => {
    const o = byLineId.get(c.lineId)!;
    return { lineId: c.lineId, quoteNo: c.quoteNo, workDate: c.workDate, plateNo: o.plate_no, billed: c.billed };
  };
  return {
    ok: true,
    preview: {
      matched: m.matched.map((x) => {
        const o = byLineId.get(x.lineId)!;
        return {
          lineId: x.lineId,
          quoteNo: o.quote_no,
          workDate: o.work_date,
          plateNo: o.plate_no,
          billed: Number(o.billed),
          agreed: x.agreed,
          matchedBy: x.matchedBy,
          memo: x.memo,
        };
      }),
      ambiguous: m.ambiguous.map((a) => ({
        raw: a.row.raw,
        agreed: a.row.amounts.length > 0 ? a.row.amounts[a.row.amounts.length - 1] : null,
        candidates: a.candidates.map(toCand),
      })),
      unmatched: m.unmatched.map((r) => r.raw).slice(0, 40),
      parsedCount: rows.length,
    },
  };
}
