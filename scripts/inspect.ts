/**
 * 원본 엑셀의 시트·컬럼 구조를 확인한다.
 * 이관 스크립트를 짜기 전에 컬럼명을 눈으로 맞추는 용도.
 *
 *   npx tsx scripts/inspect.ts
 *
 * ⚠️ 개인정보가 들어 있으므로 값은 출력하지 않는다. 구조와 채움률만 본다.
 */
import { config } from "dotenv";
import { listExcelFiles, openWorkbook, readSheet } from "./lib/excel";

config({ path: ".env.local" });
const DATA_DIR = process.env.IMPORT_DATA_DIR ?? "C:/dev/tyremore-data";

function main() {
  const files = listExcelFiles(DATA_DIR);
  console.log(`데이터 폴더: ${DATA_DIR}\n파일 ${files.length}개`);

  for (const file of files) {
    console.log("\n" + "=".repeat(72));
    console.log(file.replace(DATA_DIR, "").replace(/^[\\/]/, ""));

    let wb;
    try {
      wb = openWorkbook(file);
    } catch (e) {
      console.log(`  ❌ 읽기 실패: ${(e as Error).message}`);
      continue;
    }

    for (const name of wb.SheetNames) {
      let res;
      try {
        res = readSheet(wb, name);
      } catch (e) {
        console.log(`  [시트] ${name}  ❌ ${(e as Error).message}`);
        continue;
      }
      const { rows, headers, headerRow } = res;
      console.log(`\n  [시트] ${name}   데이터행=${rows.length}  열=${headers.length}  (헤더행 ${headerRow + 1})`);
      if (rows.length === 0) continue;

      headers.forEach((h) => {
        const filled = rows.filter((r) => r[h] !== null && String(r[h]).trim() !== "").length;
        const pct = Math.round((filled / rows.length) * 100);
        const bar = pct >= 99 ? "████" : pct >= 70 ? "███·" : pct >= 30 ? "██··" : pct > 0 ? "█···" : "····";
        console.log(`    ${bar} ${String(pct).padStart(3)}%  ${h}`);
      });
    }
  }
}

main();
