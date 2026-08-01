/**
 * 엑셀 읽기 공용 도구
 *
 * ⚠️ ExcelJS 는 쓰지 않는다. MARS(Business Central) 내보내기 5종을 전부 못 읽는다
 *    ("Cannot read properties of undefined (reading 'sheets')").
 *    SheetJS 는 같은 파일을 문제없이 읽는다. 2026-08-01 확인.
 *
 * SheetJS 는 npm 레지스트리가 아니라 공식 배포처(cdn.sheetjs.com)에서 설치한다.
 * 레지스트리의 0.18.5 는 취약점이 남아 있는 구버전이다.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

export type Row = Record<string, unknown>;

/** 폴더 아래의 엑셀 파일을 전부 찾는다 (임시파일 ~$ 제외) */
export function listExcelFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listExcelFiles(p));
    else if (/\.xlsx?m?$/i.test(name) && !name.startsWith("~$")) out.push(p);
  }
  return out.sort();
}

/** 이름 일부로 파일 하나를 찾는다. 없거나 여럿이면 즉시 실패시킨다 */
export function findFile(dir: string, contains: string): string {
  const hits = listExcelFiles(dir).filter((f) => f.includes(contains));
  if (hits.length === 0) throw new Error(`엑셀을 찾지 못했습니다: '${contains}' (${dir})`);
  if (hits.length > 1) {
    throw new Error(`'${contains}' 에 맞는 파일이 여럿입니다:\n  ${hits.join("\n  ")}`);
  }
  return hits[0];
}

export function openWorkbook(path: string): XLSX.WorkBook {
  // cellDates: 날짜를 Date 로 받는다 (MARS 등록일에서 연식을 뽑아야 한다)
  return XLSX.readFile(path, { cellDates: true, cellNF: false, cellText: false });
}

/**
 * 시트를 객체 배열로 읽는다.
 * 헤더가 1행이 아닐 수 있으므로(사장님 엑셀은 제목 줄이 위에 있다) 헤더행을 찾아준다.
 */
export function readSheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  opts: { headerRow?: number; maxHeaderScan?: number } = {},
): { rows: Row[]; headers: string[]; headerRow: number } {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`시트 없음: ${sheetName} (있는 시트: ${wb.SheetNames.join(", ")})`);

  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: true,
  });
  if (grid.length === 0) return { rows: [], headers: [], headerRow: 0 };

  // 헤더행 결정: 지정이 없으면 채워진 셀이 가장 많은 첫 N행 중 하나
  let headerRow = opts.headerRow ?? 0;
  if (opts.headerRow === undefined) {
    const scan = Math.min(opts.maxHeaderScan ?? 6, grid.length);
    let best = -1;
    for (let r = 0; r < scan; r++) {
      const filled = (grid[r] ?? []).filter((v) => v !== null && String(v).trim() !== "").length;
      if (filled > best) {
        best = filled;
        headerRow = r;
      }
    }
  }

  /**
   * ⚠️ 컬럼명이 겹친다.
   * 사장님 부품 시트는 좌우 2단 구성이라 `코드`·`적용 차종`·`수량`이 한 시트에 두 벌 있다.
   * 이름으로 객체를 만들면 오른쪽 단이 왼쪽 단을 덮어써서 절반이 사라진다.
   * → 두 번째부터 `코드#2` 처럼 번호를 붙여 구분한다.
   */
  const seen = new Map<string, number>();
  const headers = (grid[headerRow] ?? []).map((v, i) => {
    const base = v === null || String(v).trim() === "" ? `열${i + 1}` : String(v).trim();
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });

  const rows: Row[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const line = grid[r] ?? [];
    if (line.every((v) => v === null || String(v).trim() === "")) continue;
    const obj: Row = {};
    headers.forEach((h, i) => {
      obj[h] = line[i] ?? null;
    });
    rows.push(obj);
  }
  return { rows, headers, headerRow };
}

/** 첫 번째(또는 유일한) 시트를 읽는다 */
export function readFirstSheet(path: string, opts?: { headerRow?: number }) {
  const wb = openWorkbook(path);
  return readSheet(wb, wb.SheetNames[0], opts);
}
