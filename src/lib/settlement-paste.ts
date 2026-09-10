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
import { hasPerm } from "./auth";
import { normalizePlate } from "./normalize";
import { matchReply, parseReplyText, type OurLine, type ReplyRow } from "./settlement-core";
import {
  grossFromNet,
  loadInvoiceFormat,
  parseInvoiceReplySheets,
  parseReplyWorkbook,
  type InvoiceReplyGroup,
} from "./settlement-sheet";

export interface ReplyPreviewMatched {
  lineId: number;
  quoteNo: string;
  workDate: string;
  plateNo: string | null;
  billed: number;
  agreed: number | null;
  matchedBy: string;
  memo: string;
  /** 회신을 어떻게 읽었나 — 화면에 그대로 보여 준다 (승인·조정·반려) */
  decision?: "승인" | "조정" | "반려";
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
  /** 회신에 승인금액도 체크도 없던 줄 — 건드리지 않는다 (대기로 남는다) */
  noMark?: string[];
}

/** 회신(붙여넣은 글 또는 엑셀 파일)을 읽어 회차의 판매들과 이어 본다 — 저장은 안 한다 */
export async function previewReply(
  runId: number,
  fd: FormData,
): Promise<{ ok: true; preview: ReplyPreview } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };

  let rows: ReplyRow[];
  /** ⭐ 우리가 내보낸 양식으로 돌아온 파일 — 열을 알아보고 그대로 읽는다 (2026-09-10) */
  let groups: InvoiceReplyGroup[] = [];
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 5_000_000) return { ok: false, error: "파일이 너무 큽니다 (5MB 까지)" };
    const buf = await file.arrayBuffer();
    try {
      groups = parseInvoiceReplySheets(buf);
    } catch {
      groups = [];
    }
    try {
      rows = parseReplyWorkbook(buf);
    } catch {
      return { ok: false, error: "엑셀을 읽지 못했습니다 — .xlsx 파일인지 확인해 주세요" };
    }
  } else {
    rows = parseReplyText(String(fd.get("text") ?? ""));
  }
  if (rows.length === 0 && groups.length === 0) {
    return { ok: false, error: "읽을 수 있는 줄이 없습니다 — 표를 그대로 복사했는지 확인해 주세요" };
  }

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

  const toCand = (c: OurLine): ReplyPreviewCandidate => {
    const o = byLineId.get(c.lineId)!;
    return { lineId: c.lineId, quoteNo: c.quoteNo, workDate: c.workDate, plateNo: o.plate_no, billed: c.billed };
  };

  /* ⭐ 우리 양식 그대로 돌아왔으면 열 뜻을 알고 읽는다 (2026-09-10) */
  if (groups.length > 0) {
    const format = await loadInvoiceFormat(run.supplier_name);
    return { ok: true, preview: previewFromGroups(groups, ourLines, toCand, vatMode, format?.controlFeeRate ?? 0) };
  }

  const m = matchReply(rows, ourLines, vatMode);
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

/* ============================================================
 * ⭐ 우리 양식으로 돌아온 회신 읽기 (사장님 실제 양식 반영 2026-09-10)
 *
 *   열 뜻을 알고 읽으므로 「승인금액이 빈칸」과 「승인금액이 청구액과 같음」을
 *   가릴 수 있다 — 글 해석 길에서는 마지막 숫자 칸을 승인으로 봐서 최종금액을
 *   승인으로 잘못 읽을 수 있었다.
 *
 * 🔴 **자동 확정 금지** — 관리번호로 이어진 것만 「이어짐」으로 놓고, 관리번호가
 *    지워졌으면 차량번호(+금액)로 **후보만** 낸다. 사람이 골라야 저장된다.
 * 🔴 승인금액도 체크도 없는 건은 아예 손대지 않는다 (대기로 남는다) — 회신에
 *    빠진 것을 「승인」으로 굳히면 안 된다.
 * ========================================================== */
function previewFromGroups(
  groups: InvoiceReplyGroup[],
  ours: OurLine[],
  toCand: (c: OurLine) => ReplyPreviewCandidate,
  vatMode: "포함" | "별도",
  rate: number,
): ReplyPreview {
  const byQuoteNo = new Map(ours.map((o) => [o.quoteNo, o]));
  const byPlate = new Map<string, OurLine[]>();
  for (const o of ours) {
    if (!o.plateNorm) continue;
    byPlate.set(o.plateNorm, [...(byPlate.get(o.plateNorm) ?? []), o]);
  }

  /**
   * 회신에 적힌 승인금액을 **우리 기준(관제비 차감 후·부가세 별도)** 으로 맞춘다.
   * 앱에는 이미 관제비 차감 후 금액이 들어 있으므로, 거래처가 정가(역산해 내보낸
   * 「정비금액」)를 그대로 적어 왔으면 그건 곧 「그대로 승인」이라는 뜻이다.
   */
  const toOurBase = (approved: number, billed: number): number => {
    if (approved === billed) return billed;
    if (rate > 0 && approved === grossFromNet(billed, rate)) return billed;
    if (vatMode === "별도" && Math.round(approved / 1.1) === billed) return billed;
    return approved;
  };

  const matched: ReplyPreviewMatched[] = [];
  const ambiguous: ReplyPreview["ambiguous"] = [];
  const unmatched: string[] = [];
  const noMark: string[] = [];

  for (const g of groups) {
    /* ① 이 줄이 무엇을 말하나 — 반려 / 승인금액 / 사장님 체크 */
    const signal: "반려" | "금액" | "체크" | null = g.rejected
      ? "반려"
      : g.approved != null
        ? "금액"
        : g.checked
          ? "체크"
          : null;
    if (!signal) {
      noMark.push(g.raw);
      continue;
    }

    /* ② 우리 판매 찾기 — 관리번호가 정석 */
    const hit = g.quoteNo ? (byQuoteNo.get(g.quoteNo) ?? null) : null;
    if (!hit) {
      const cands = g.plateNorm ? (byPlate.get(g.plateNorm) ?? []) : [];
      if (cands.length === 0) {
        unmatched.push(g.raw);
        continue;
      }
      // 차량번호로만 이어질 때는 금액이 맞아도 **자동 확정하지 않는다**
      const narrowed =
        cands.length > 1 ? cands.filter((c) => c.billed === g.net || c.billed === g.approved) : cands;
      ambiguous.push({
        raw: g.raw,
        agreed: signal === "반려" ? 0 : g.approved,
        candidates: (narrowed.length > 0 ? narrowed : cands).map(toCand),
      });
      continue;
    }

    const billed = hit.billed;
    const agreed = signal === "반려" ? 0 : signal === "체크" ? billed : toOurBase(g.approved!, billed);
    matched.push({
      lineId: hit.lineId,
      quoteNo: hit.quoteNo,
      workDate: hit.workDate,
      plateNo: g.plateRaw,
      billed,
      agreed,
      matchedBy: "관리번호",
      memo: [g.desc, g.memo].filter(Boolean).join(" · ").slice(0, 200),
      decision: agreed === 0 ? "반려" : agreed === billed ? "승인" : "조정",
    });
  }

  return { matched, ambiguous, unmatched: unmatched.slice(0, 40), parsedCount: groups.length, noMark: noMark.slice(0, 40) };
}
