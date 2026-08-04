"use server";

/**
 * 금호 자재검색 목록 올리기 — 화면에서 부르는 두 동작.
 *
 * 읽기·대조·반영은 `kumho-sheet.ts` 가 한다. 여기는 파일을 받아 넘길 뿐이다.
 * ⭐ 재고 엑셀과 같은 방식으로 **미리보기와 확정에 같은 파일을 두 번 올린다.**
 *    첫 결과를 들고 있다가 그대로 반영하면 그 사이 손댄 값이 통과할 수 있다.
 *
 * ⚠️ 사장님만 쓸 수 있다 — 기표가를 고치는 기능이 들어 있다.
 */
import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { isOwner } from "./auth";
import { applyCatalog, looksLikeCatalog, planCatalog, type ApplyResult, type CatalogPlan } from "./kumho-sheet";

const MAX_BYTES = 12 * 1024 * 1024;

type Taken = { ok: true; rows: Record<string, unknown>[] } | { ok: false; error: string };

/** 파일 여러 개를 한꺼번에 받는다 — 사장님이 검색을 나눠 받으셨다 */
async function toRows(fd: FormData): Promise<Taken> {
  const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: "엑셀 파일을 골라 주세요" };

  const rows: Record<string, unknown>[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) return { ok: false, error: `${f.name} — 파일이 너무 큽니다 (12MB 까지)` };
    if (!/\.xlsx?$/i.test(f.name)) return { ok: false, error: `${f.name} — 엑셀 파일(.xlsx)만 올릴 수 있습니다` };
    const wb = XLSX.read(Buffer.from(await f.arrayBuffer()), { type: "buffer" });
    let found = false;
    for (const name of wb.SheetNames) {
      const r = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: "" });
      if (looksLikeCatalog(r)) {
        rows.push(...r);
        found = true;
      }
    }
    if (!found) {
      return {
        ok: false,
        error: `${f.name} — 자재검색 목록이 아닙니다 (자재코드·자재명·패턴 칸이 있어야 합니다)`,
      };
    }
  }
  return { ok: true, rows };
}

/** 무엇이 어떻게 바뀌는지만 보여준다. 아무것도 저장하지 않는다 */
export async function previewKumhoCatalog(
  fd: FormData,
): Promise<{ ok: true; plan: CatalogPlan } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "사장님만 쓸 수 있습니다" };
  const t = await toRows(fd);
  if (!t.ok) return t;
  try {
    return { ok: true, plan: await planCatalog(t.rows) };
  } catch (e) {
    return { ok: false, error: `엑셀을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 미리보기에서 본 대로 반영한다 */
export async function applyKumhoCatalog(
  fd: FormData,
): Promise<(ApplyResult & { ok: true }) | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "사장님만 쓸 수 있습니다" };
  const t = await toRows(fd);
  if (!t.ok) return t;
  try {
    const r = await applyCatalog(t.rows, {
      updatePrices: fd.get("updatePrices") === "on",
      createMissing: fd.get("createMissing") === "on",
    });
    if (r.ok) {
      revalidatePath("/");
      revalidatePath("/receiving");
      revalidatePath("/settings/kumho");
    }
    return r;
  } catch (e) {
    return { ok: false, error: `반영하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}
