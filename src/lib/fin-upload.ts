"use server";

/**
 * ⭐ 돈 관리 — 업로드 서버 액션 (ERP 1~2단계, 2026-08-24)
 *
 *   화면에서 부르는 세 동작: 미리보기 → 확정 → (배치) 취소.
 *   파일 종류(통장·법인카드·홈택스 세금계산서)는 parseAnyFin 이 알아본다.
 *   실제 읽기는 fin-sheet.ts, 반영은 fin-ingest.ts.
 *
 * 🔴 돈 관리는 전부 **사장님 전용** — 액션마다 isOwner() 를 검사한다.
 * ⭐ 미리보기와 확정에 **같은 파일을 두 번** 올린다 (stock-excel 교훈) — 파일이 정답.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, isOwner } from "@/lib/auth";
import { getShopInfo } from "@/lib/shop";
import { parseAnyFin } from "./fin-sheet";
import { cancelFinUploadBatch, ingestCardDays, ingestCardDeposits, ingestCardTxns, ingestCashTxns, ingestTaxInvoices } from "./fin-ingest";

const MAX_BYTES = 8 * 1024 * 1024;

type Taken = { ok: true; buf: Buffer; name: string } | { ok: false; error: string };

async function toBuffer(fd: FormData): Promise<Taken> {
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) return { ok: false, error: "엑셀 파일을 골라 주세요" };
  if (f.size > MAX_BYTES) return { ok: false, error: "파일이 너무 큽니다 (8MB 까지)" };
  if (!/\.xlsx?$/i.test(f.name)) return { ok: false, error: "엑셀 파일(.xls · .xlsx)만 올릴 수 있습니다" };
  return { ok: true, buf: Buffer.from(await f.arrayBuffer()), name: f.name };
}

export interface FinPreview {
  /** cash = 통장·법인카드(계정 이름 필요), tax = 세금계산서(계정 이름 불필요) */
  kind: "cash" | "tax" | "cardday" | "carddeposit" | "cardtxn";
  source: string;
  formatName: string;
  rowCount: number;
  skippedCount: number;
  skippedSample: string[];
  periodFrom: string | null;
  periodTo: string | null;
  /** cash: 들어온/나간 돈 · tax: sumTotal 에 합계 */
  sumIn: number;
  sumOut: number;
  sumTotal: number;
  /** 눈으로 확인할 앞 줄 몇 개 */
  sample: { when: string; desc: string; inAmount: number; outAmount: number }[];
  /** 전에 쓴 계정 이름들 — 같은 이름을 고르시게 (오타로 계정이 갈라지지 않게) */
  labels: string[];
}

/** 무엇을 어떻게 읽었는지만 보여준다. 아무것도 저장하지 않는다 */
export async function previewFinUpload(
  fd: FormData,
): Promise<{ ok: true; preview: FinPreview } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const t = await toBuffer(fd);
  if (!t.ok) return t;
  try {
    const shop = await getShopInfo();
    // 🔴 감사 H1(2026-08-25): fileName 을 안 넘겨 우리카드 청구서(연도 추론)가 무조건 실패했다
    const p = parseAnyFin(t.buf, shop.bizNo, t.name);
    if (p.kind === "tax") {
      return {
        ok: true,
        preview: {
          kind: "tax",
          source: p.source,
          formatName: p.formatName,
          rowCount: p.rows.length,
          skippedCount: p.skipped.length,
          skippedSample: p.skipped.slice(0, 5).map((s) => `${s.line}줄: ${s.reason}`),
          periodFrom: p.periodFrom,
          periodTo: p.periodTo,
          sumIn: 0,
          sumOut: 0,
          sumTotal: p.sumTotal,
          sample: p.rows.slice(0, 6).map((r) => ({
            when: r.writeDate,
            desc: `${r.counterName}${r.itemSummary ? ` · ${r.itemSummary}` : ""}`,
            inAmount: r.direction === "매출" ? r.total : 0,
            outAmount: r.direction === "매입" ? r.total : 0,
          })),
          labels: [],
        },
      };
    }
    if (p.kind === "cardtxn") {
      return {
        ok: true,
        preview: {
          kind: "cardtxn",
          source: p.source,
          formatName: p.formatName,
          rowCount: p.rows.length,
          skippedCount: p.skipped.length,
          skippedSample: p.skipped.slice(0, 5).map((s) => `${s.line}줄: ${s.reason}`),
          periodFrom: p.periodFrom,
          periodTo: p.periodTo,
          sumIn: 0,
          sumOut: 0,
          sumTotal: p.sumTotal,
          sample: p.rows.slice(0, 6).map((r) => ({
            when: r.approvedAt.slice(0, 16),
            desc: `${r.cardCo} · ${r.approvalNo}${r.isCancel ? " (취소)" : ""}`,
            inAmount: r.amount > 0 ? r.amount : 0,
            outAmount: r.amount < 0 ? -r.amount : 0,
          })),
          labels: [],
        },
      };
    }
    if (p.kind === "cardday" || p.kind === "carddeposit") {
      return {
        ok: true,
        preview: {
          kind: p.kind,
          source: p.source,
          formatName: p.formatName,
          rowCount: p.rows.length,
          skippedCount: p.skipped.length,
          skippedSample: p.skipped.slice(0, 5).map((s) => `${s.line}줄: ${s.reason}`),
          periodFrom: p.periodFrom,
          periodTo: p.periodTo,
          sumIn: 0,
          sumOut: 0,
          sumTotal: p.sumTotal,
          sample:
            p.kind === "cardday"
              ? p.rows.slice(0, 6).map((r) => ({
                  when: r.date,
                  desc: `승인 ${r.approvedCnt}건 · 취소 ${r.cancelledCnt}건`,
                  inAmount: r.totalAmount,
                  outAmount: 0,
                }))
              : p.rows.slice(0, 6).map((r) => ({
                  when: r.month,
                  desc: `${r.cardCo} · 매출 ${r.saleAmount.toLocaleString()}원`,
                  inAmount: r.depositAmount,
                  outAmount: 0,
                })),
          labels: [],
        },
      };
    }
    const labels = await db.execute<{ l: string }>(sql`
      SELECT DISTINCT account_label l FROM cash_txn WHERE source = ${p.source} ORDER BY 1 LIMIT 20
    `);
    return {
      ok: true,
      preview: {
        kind: "cash",
        source: p.source,
        formatName: p.formatName,
        rowCount: p.rows.length,
        skippedCount: p.skipped.length,
        skippedSample: p.skipped.slice(0, 5).map((s) => `${s.line}줄: ${s.reason}`),
        periodFrom: p.periodFrom,
        periodTo: p.periodTo,
        sumIn: p.sumIn,
        sumOut: p.sumOut,
        sumTotal: 0,
        sample: p.rows.slice(0, 6).map((r) => ({
          when: r.occurredAt.slice(0, 16),
          desc: r.description,
          inAmount: r.inAmount,
          outAmount: r.outAmount,
        })),
        labels: labels.map((r) => r.l),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 미리보기에서 본 대로 반영한다 */
export async function applyFinUpload(
  fd: FormData,
): Promise<
  | { ok: true; source: string; newCount: number; dupCount: number; rowCount: number }
  | { ok: false; error: string }
> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const t = await toBuffer(fd);
  if (!t.ok) return t;
  try {
    const shop = await getShopInfo();
    const p = parseAnyFin(t.buf, shop.bizNo, t.name);
    if (p.rows.length === 0) return { ok: false, error: "읽을 수 있는 줄이 없습니다 — 파일을 확인해 주세요" };
    const session = await getSession();

    if (p.kind === "tax") {
      const r = await ingestTaxInvoices(p, session?.uid ?? null, t.name);
      revalidatePath("/finance");
      revalidatePath("/finance/tax");
      return { ok: true, source: p.source, newCount: r.newCount, dupCount: r.dupCount, rowCount: r.rowCount };
    }

    if (p.kind === "cardtxn") {
      const r = await ingestCardTxns(p, session?.uid ?? null, t.name);
      revalidatePath("/finance");
      revalidatePath("/finance/card");
      return { ok: true, source: p.source, newCount: r.newCount, dupCount: r.dupCount, rowCount: r.rowCount };
    }
    if (p.kind === "cardday" || p.kind === "carddeposit") {
      const r =
        p.kind === "cardday"
          ? await ingestCardDays(p, session?.uid ?? null, t.name)
          : await ingestCardDeposits(p, session?.uid ?? null, t.name);
      revalidatePath("/finance");
      revalidatePath("/finance/card");
      return { ok: true, source: p.source, newCount: r.newCount, dupCount: r.dupCount, rowCount: r.rowCount };
    }

    const label = String(fd.get("label") ?? "").trim();
    if (!label) return { ok: false, error: "어느 통장·카드인지 계정 이름을 적어 주세요 (예: 신한주거래 · 국민법인카드)" };
    const r = await ingestCashTxns(p, label, session?.uid ?? null, t.name);
    revalidatePath("/finance");
    return { ok: true, source: p.source, newCount: r.newCount, dupCount: r.dupCount, rowCount: r.rowCount };
  } catch (e) {
    return { ok: false, error: `반영하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 배치 취소 — 지우지 않고 잠재운다. 같은 파일을 다시 올리면 되살아난다 */
export async function cancelFinUpload(
  uploadId: number,
  _fd?: FormData,
): Promise<{ ok: true; hidden: number } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  if (!Number.isInteger(uploadId) || uploadId <= 0) return { ok: false, error: "배치 번호가 올바르지 않습니다" };
  const hidden = await cancelFinUploadBatch(uploadId);
  revalidatePath("/finance");
  revalidatePath("/finance/tax");
  return { ok: true, hidden };
}
