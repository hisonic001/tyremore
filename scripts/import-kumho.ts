/**
 * 금호 자재검색 목록을 폴더째 반영 (2026-08-04)
 *
 * 화면(`/settings/kumho`)에서 파일을 골라 올리는 것과 **같은 일**을 한다.
 * 파일이 여러 개일 때 한 번에 돌리려고 둔다.
 *
 * 🔴 기표가는 기본으로 건드리지 않는다 — 손님께 말씀하시는 금액이 바뀐다.
 *    바꾸려면 `--prices` 를 붙인다. 사장님이 화면에서 숫자를 보고 정하시는 것이 낫다.
 *
 *   npx tsx scripts/import-kumho.ts --dry            무엇이 될지만 보여준다
 *   npx tsx scripts/import-kumho.ts                  잇기 + 없는 상품 만들기
 *   npx tsx scripts/import-kumho.ts --prices         기표가까지 맞추기
 *   npx tsx scripts/import-kumho.ts --dir "C:/..."   다른 폴더에서 읽기
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readdirSync } from "fs";
import * as XLSX from "xlsx";

const DEFAULT_DIR = "C:/Users/info/OneDrive/문서/통합자동화";

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const prices = argv.includes("--prices");
  const dirAt = argv.indexOf("--dir");
  const dir = dirAt >= 0 ? argv[dirAt + 1] : DEFAULT_DIR;

  const { looksLikeCatalog, planCatalog, applyCatalog } = await import("../src/lib/kumho-sheet");

  const rows: Record<string, unknown>[] = [];
  const files = readdirSync(dir).filter((f) => /자재검색.*\.xlsx?$/i.test(f));
  if (files.length === 0) {
    console.error(`${dir} 에 「자재검색」 엑셀이 없습니다`);
    process.exit(1);
  }
  for (const f of files) {
    const wb = XLSX.readFile(`${dir}/${f}`);
    let n = 0;
    for (const s of wb.SheetNames) {
      const r = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[s], { defval: "" });
      if (looksLikeCatalog(r)) {
        rows.push(...r);
        n += r.length;
      }
    }
    console.log(`  ${f} — ${n}행${n === 0 ? "  ⚠️ 자재검색 형식이 아닙니다" : ""}`);
  }

  const plan = await planCatalog(rows);
  console.log(`\n읽음 ${plan.read}개 (건너뜀 ${plan.skipped})`);
  for (const [k, v] of Object.entries(plan.counts)) if (v) console.log(`  ${k.padEnd(8)} ${v}`);
  console.log(
    `\n기표가 다른 것 ${plan.priceDiffCount}개 — 오름 ${plan.priceUpCount} · 내림 ${plan.priceDownCount} · 가장 큰 것 ${plan.priceBiggestPct.toFixed(0)}%`,
  );
  if (!prices) console.log("  → 기표가는 건드리지 않습니다 (--prices 를 붙이면 맞춥니다)");

  if (dry) {
    console.log("\n--dry 라 아무것도 저장하지 않았습니다");
    process.exit(0);
  }

  const r = await applyCatalog(rows, { updatePrices: prices, createMissing: true });
  if (!r.ok) {
    console.error("실패:", r.error);
    process.exit(1);
  }
  console.log(`\n✅ 새 상품 ${r.created}개 · 자재코드 이어짐 ${r.linked}개 · 기표가 ${r.priceUpdated}개 · 건너뜀 ${r.skipped}개`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
