"use server";

/**
 * 재고 엑셀 — 화면(클라이언트)에서 부르는 두 가지 동작.
 *
 * 실제 읽기·맞춰보기·반영은 `stock-sheet.ts` 가 한다. 여기는 파일을 받아 넘기기만 한다.
 * ⭐ **미리보기와 확정에 같은 파일을 두 번 올린다.** 첫 번째 결과를 들고 있다가
 *    그대로 반영하면, 그 사이에 손댄 값이 그대로 통과할 수 있다. 파일이 정답이다.
 */
import { revalidatePath } from "next/cache";
import { applyStock, diffStock, type StockDiff } from "./stock-sheet";

const MAX_BYTES = 8 * 1024 * 1024;

type Taken = { ok: true; buf: Buffer } | { ok: false; error: string };

async function toBuffer(fd: FormData): Promise<Taken> {
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) return { ok: false, error: "엑셀 파일을 골라 주세요" };
  if (f.size > MAX_BYTES) return { ok: false, error: "파일이 너무 큽니다 (8MB 까지)" };
  if (!/\.xlsx?$/i.test(f.name)) return { ok: false, error: "엑셀 파일(.xlsx)만 올릴 수 있습니다" };
  return { ok: true, buf: Buffer.from(await f.arrayBuffer()) };
}

/** 무엇이 어떻게 바뀌는지만 보여준다. 아무것도 저장하지 않는다 */
export async function previewStockUpload(
  fd: FormData,
): Promise<{ ok: true; diff: StockDiff } | { ok: false; error: string }> {
  const t = await toBuffer(fd);
  if (!t.ok) return t;
  try {
    return { ok: true, diff: await diffStock(t.buf) };
  } catch (e) {
    return { ok: false, error: `엑셀을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 미리보기에서 본 대로 재고를 맞춘다 */
export async function applyStockUpload(
  fd: FormData,
): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const t = await toBuffer(fd);
  if (!t.ok) return t;
  try {
    const r = await applyStock(t.buf);
    if (r.ok) {
      revalidatePath("/stock");
      revalidatePath("/");
    }
    return r;
  } catch (e) {
    return { ok: false, error: `반영하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}
