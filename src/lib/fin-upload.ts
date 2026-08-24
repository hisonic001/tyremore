"use server";

/**
 * ⭐ 돈 관리 — 업로드 서버 액션 (ERP 1단계, 2026-08-24)
 *
 *   화면에서 부르는 세 동작: 미리보기 → 확정 → (배치) 취소.
 *   실제 읽기는 fin-sheet.ts, 반영은 fin-ingest.ts. 여기는 파일을 받아 넘기기만
 *   (stock-excel.ts 와 같은 역할 분담).
 *
 * 🔴 돈 관리는 전부 **사장님 전용** — 액션마다 isOwner() 를 검사한다.
 * ⭐ 미리보기와 확정에 **같은 파일을 두 번** 올린다 (stock-excel 교훈) — 파일이 정답.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, isOwner } from "@/lib/auth";
import { parseFinFile } from "./fin-sheet";
import { cancelFinUploadBatch, ingestCashTxns } from "./fin-ingest";

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
  source: string;
  formatName: string;
  rowCount: number;
  skippedCount: number;
  skippedSample: string[];
  periodFrom: string | null;
  periodTo: string | null;
  sumIn: number;
  sumOut: number;
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
    const p = parseFinFile(t.buf);
    const labels = await db.execute<{ l: string }>(sql`
      SELECT DISTINCT account_label l FROM cash_txn WHERE source = ${p.source} ORDER BY 1 LIMIT 20
    `);
    return {
      ok: true,
      preview: {
        source: p.source,
        formatName: p.formatName,
        rowCount: p.rows.length,
        skippedCount: p.skipped.length,
        skippedSample: p.skipped.slice(0, 5).map((s) => `${s.line}줄: ${s.reason}`),
        periodFrom: p.periodFrom,
        periodTo: p.periodTo,
        sumIn: p.sumIn,
        sumOut: p.sumOut,
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
  const label = String(fd.get("label") ?? "").trim();
  if (!label) return { ok: false, error: "어느 통장·카드인지 계정 이름을 적어 주세요 (예: 신한주거래 · 국민법인카드)" };
  try {
    const p = parseFinFile(t.buf);
    if (p.rows.length === 0) return { ok: false, error: "읽을 수 있는 줄이 없습니다 — 파일을 확인해 주세요" };
    const session = await getSession();
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
  return { ok: true, hidden };
}
