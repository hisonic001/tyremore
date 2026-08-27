/**
 * 한 해를 달마다 「진행」 (사장님 요청 2026-08-26) — 화면과 같은 규칙으로 자동 분류·짝 확실한 잇기·월정산 확인.
 * 마감은 안 누른다. 결과 JSON 을 tmp 에 남긴다.
 *
 *   NODE_PATH=... DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/run-year.ts 2025 [from-ym] [to-ym]
 *   되돌리기: scripts/revert-year-run.ts <since ISO>
 */
import { writeFileSync } from "node:fs";
import { runMonth, type MonthReport } from "@/lib/year-run";
import { ymAdd } from "@/lib/ym";

async function main() {
  const year = process.argv[2] ?? "2025";
  const from = process.argv[3] ?? `${year}-01`;
  const to = process.argv[4] ?? `${year}-12`;
  const startedAt = new Date().toISOString();
  console.log(`▶ ${from} ~ ${to} 진행 시작 (${startedAt})`);
  const reports: MonthReport[] = [];
  for (let ym = from; ym <= to; ym = ymAdd(ym, 1)) {
    const r = await runMonth(ym, null, (s) => console.log(s));
    reports.push(r);
    for (const e of r.errors.slice(0, 5)) console.log("   ⚠", e);
  }
  const out = `C:/Users/info/.claude/jobs/efcb0a01/tmp/run-${year}.json`;
  writeFileSync(out, JSON.stringify({ startedAt, reports }, null, 1), "utf8");
  console.log(`✅ 끝 — 보고 ${out}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
