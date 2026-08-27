"use server";

/**
 * 상품 목록 채우기 — 거래처가 준 상품목록 엑셀을 우리 카탈로그에 채운다.
 *
 * ⭐ 2026-08-04 개정 — 사장님: "지금 기능이 전반적으로 산만해보이는데"
 *
 *   전에는 화면 이름이 「금호 상품목록」이었다. 브랜드 이름을 메뉴에 박아 두면
 *   콘티넨탈·미쉐린이 늘 때마다 메뉴가 늘어난다 — **늘어날수록 무너지는 구조**다.
 *   화면은 하나로 두고 **거래처를 골라서** 올린다 (사장님이 고르신 방식).
 *
 * 🔴 **고른 거래처와 파일이 안 맞으면 막는다.**
 *    「미쉐린」을 골라 놓고 금호 자재검색을 올리면, 금호 자재코드가 미쉐린 품번인 것처럼
 *    사전에 들어가 매입원가가 엉뚱한 상품에 붙는다.
 *    사람이 고르는 방식은 편한 대신 잘못 고를 수 있으니 여기서 한 번 더 본다.
 *
 * ⭐ 읽기·대조·반영은 거래처별 모듈이 한다 (금호 → `kumho-sheet.ts`).
 *    새 거래처 양식은 아래 READERS 에 한 줄 더하면 된다. **화면은 손대지 않는다**
 *    (인보이스 읽기의 COLUMN_MAPS 와 같은 방식).
 *
 * ⭐ 미리보기와 확정에 **같은 파일을 두 번 올린다.** 첫 결과를 들고 있다가 그대로
 *    반영하면 그 사이 손댄 값이 통과할 수 있다 — 파일이 정답이다 (재고 엑셀과 같다).
 *
 * ⚠️ 사장님만 쓸 수 있다 — 기표가를 고치는 기능이 들어 있다.
 */
import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { isOwner } from "./auth";
import { applyCatalog, looksLikeCatalog, planCatalog, type ApplyResult, type CatalogPlan } from "./kumho-sheet";
import { applyMaster, looksLikeMaster, planMaster } from "./kumho-master";

/** 우리가 읽을 줄 아는 거래처 목록 양식 */
const READERS = {
  금호: {
    /** 어디서 받는 파일인지 — 화면에 그대로 보여 준다 */
    where: "금호 홈페이지 「자재검색」 에서 받은 엑셀",
    columns: "자재코드 · 자재명 · 패턴",
    /** 컬럼 이름으로 읽는다 */
    mode: "json" as const,
    looksLike: looksLikeCatalog,
    plan: planCatalog,
    apply: applyCatalog,
  },
  /**
   * ⭐ 금호 기표가 Master (사장님 요청 2026-08-27)
   *   자재검색과 다른 점 셋 — ①머리글이 3줄이라 컬럼 이름으로 못 읽는다(그래서 mode:'aoa')
   *   ②**기표가가 부가세 미포함**이다(자재검색의 「공장도가」는 포함) ③운영 여부(유형)가 있다.
   *   이걸 올리면 `kumho_material` 이 채워져, 인보이스에 처음 보는 자재코드가 와도
   *   **검증한 뒤에** 같은 규칙으로 상품을 만들 수 있다 — 미쉐린 CAI 와 같은 이치.
   */
  "금호 기표가": {
    where: "금호가 보내주는 「한국영업 내수 자재 내역 Master」 엑셀",
    columns: "제품군 · 자재 · 자재내역 · 기표가",
    mode: "aoa" as const,
    looksLike: looksLikeMaster,
    plan: planMaster,
    apply: applyMaster,
  },
} as const;

export type KnownSupplier = keyof typeof READERS;

/** 화면이 거래처 목록을 그릴 때 쓴다 */
export async function listReaders(): Promise<{ supplier: string; where: string; columns: string }[]> {
  return Object.entries(READERS).map(([supplier, r]) => ({
    supplier,
    where: r.where,
    columns: r.columns,
  }));
}

const MAX_BYTES = 12 * 1024 * 1024;

/**
 * 시트를 두 모양으로 들고 있는다 — 컬럼 이름으로 읽는 양식(자재검색)과
 * **머리글이 여러 줄이라 자리로 읽어야 하는 양식**(기표가 Master)이 섞여 있다 (2026-08-27).
 */
type Taken =
  | { ok: true; supplier: KnownSupplier; rows: Record<string, unknown>[]; aoa: unknown[][] }
  | { ok: false; error: string };

/** 이 거래처 양식이 맞는지 — 양식마다 보는 모양이 다르다 */
function fits(r: (typeof READERS)[KnownSupplier], json: Record<string, unknown>[], aoa: unknown[][]): boolean {
  return r.mode === "aoa" ? r.looksLike(aoa) : r.looksLike(json);
}

/** 파일 여러 개를 한꺼번에 받는다 — 사장님이 검색을 나눠 받으셨다 */
async function toRows(fd: FormData): Promise<Taken> {
  const supplier = String(fd.get("supplier") ?? "") as KnownSupplier;
  const reader = READERS[supplier];
  if (!reader) return { ok: false, error: "거래처를 골라 주세요" };

  const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: "엑셀 파일을 골라 주세요" };

  const rows: Record<string, unknown>[] = [];
  const aoaAll: unknown[][] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) return { ok: false, error: `${f.name} — 파일이 너무 큽니다 (12MB 까지)` };
    if (!/\.xlsx?$/i.test(f.name)) return { ok: false, error: `${f.name} — 엑셀 파일(.xlsx)만 올릴 수 있습니다` };

    const wb = XLSX.read(Buffer.from(await f.arrayBuffer()), { type: "buffer" });
    const sheets = wb.SheetNames.map((n) => ({
      json: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[n], { defval: "" }),
      aoa: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, blankrows: false }),
    }));

    const mine = sheets.filter((s) => fits(reader, s.json, s.aoa));
    if (mine.length > 0) {
      for (const s of mine) {
        rows.push(...s.json);
        aoaAll.push(...s.aoa);
      }
      continue;
    }

    /** 🔴 고른 거래처의 양식이 아니다 — 막지 않으면 남의 품번이 사전에 들어간다 */
    const other = (Object.keys(READERS) as KnownSupplier[]).find(
      (s) => s !== supplier && sheets.some((sh) => fits(READERS[s], sh.json, sh.aoa)),
    );
    return {
      ok: false,
      error: other
        ? `${f.name} 은(는) ${other} 목록으로 보입니다. 거래처를 ${other} 로 바꿔 주세요`
        : `${f.name} — ${supplier} 목록이 아닙니다 (${reader.columns} 칸이 있어야 합니다)`,
    };
  }
  return { ok: true, supplier, rows, aoa: aoaAll };
}

/** 무엇이 어떻게 바뀌는지만 보여준다. 아무것도 저장하지 않는다 */
export async function previewProductList(
  fd: FormData,
): Promise<{ ok: true; plan: CatalogPlan } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "사장님만 쓸 수 있습니다" };
  const t = await toRows(fd);
  if (!t.ok) return t;
  try {
    const r = READERS[t.supplier];
    return { ok: true, plan: r.mode === "aoa" ? await r.plan(t.aoa) : await r.plan(t.rows) };
  } catch (e) {
    return { ok: false, error: `엑셀을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 미리보기에서 본 대로 반영한다 */
export async function applyProductList(
  fd: FormData,
): Promise<(ApplyResult & { ok: true }) | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "사장님만 쓸 수 있습니다" };
  const t = await toRows(fd);
  if (!t.ok) return t;
  try {
    const reader = READERS[t.supplier];
    const opts = {
      updatePrices: fd.get("updatePrices") === "on",
      createMissing: fd.get("createMissing") === "on",
    };
    const r = reader.mode === "aoa" ? await reader.apply(t.aoa, opts) : await reader.apply(t.rows, opts);
    if (r.ok) {
      revalidatePath("/");
      revalidatePath("/receiving");
      revalidatePath("/settings/products");
    }
    return r;
  } catch (e) {
    return { ok: false, error: `반영하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}
