/**
 * ⭐ 확인 스크립트 전부 돌리기 (2회차, 2026-08-28)
 *
 * 🔴 **왜 만들었나** — 전에는 package.json 에서 `&&` 로 이어 놓았다.
 *    그래서 **앞에서 하나만 빨개도 뒤의 검사들이 아예 안 돌았다.**
 *    지킴이가 여덟 개인데 하나가 나머지 일곱을 가리면 안 된다.
 *    여기서는 **전부 돌리고 맨 끝에 한 줄로 요약**한다.
 *
 *   npm run check
 */
import { spawnSync } from "node:child_process";

const CHECKS: { file: string; what: string }[] = [
  { file: "check-money-links.ts", what: "1회차 ① 같은 돈이 두 번 잡힌 자국" },
  { file: "check-limits.ts", what: "1회차 ② 목록이 조용히 잘리는 것" },
  { file: "check-counts-match.ts", what: "1회차 ③ 화면마다 숫자가 갈라지는 것" },
  { file: "check-query-load.ts", what: "1회차 ⑤ 질의가 자료 따라 느는 것" },
  { file: "check-ledger.ts", what: "2회차 A1·A2·A3 거래처 원장" },
  { file: "check-receivables.ts", what: "2회차 A4·D1·E1 외상 장부" },
  { file: "check-expense-cats.ts", what: "2회차 A5·C1 + 정규식·이름 함정" },
  { file: "check-payables.ts", what: "2회차 안 고친 2순위 감시" },
];

const results: { file: string; what: string; okay: boolean }[] = [];
for (const c of CHECKS) {
  const r = spawnSync("npx", ["tsx", "scripts/" + c.file], { stdio: "inherit", shell: true });
  results.push({ ...c, okay: r.status === 0 });
}

const bad = results.filter((r) => !r.okay);
console.log("\n" + "═".repeat(74));
console.log("  확인 스크립트 " + results.length + "개 요약");
console.log("═".repeat(74));
for (const r of results) {
  console.log("  " + (r.okay ? "✓" : "⚠") + " " + r.file.padEnd(26) + " " + r.what);
}
if (bad.length === 0) {
  console.log("\n  전부 통과 ✅  — 고친 것이 그대로 있고 새로 무너진 것이 없다.\n");
} else {
  console.log(
    "\n  ⚠ " + bad.length + "개에서 확인할 것이 나왔다: " + bad.map((b) => b.file).join(", "),
  );
  console.log("     위로 올려 그 스크립트의 ⚠ 줄을 보라. docs/review/회차2.md 에 설명이 있다.\n");
}
process.exit(bad.length === 0 ? 0 : 1);
