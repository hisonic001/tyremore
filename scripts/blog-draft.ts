/**
 * 블로그 초안 — 매장 PC 에서 직접 돌리기 (마케팅 1단계, docs/17)
 *
 *   npm run blog-draft -- --dry              오늘 후보와 지시문에 들어갈 사실만 보여준다 (API 안 부름)
 *   npm run blog-draft -- --limit 1          초안 1건만 만든다 — 처음 시험할 때
 *   npm run blog-draft                       오늘 최대 3건
 *   npm run blog-draft -- --day 2026-08-28   다른 날짜
 *   npm run blog-draft -- --quote 1234       특정 판매 한 건 (quote.id)
 *
 * 평소에는 Vercel 크론(21:00)이 같은 일을 한다. 이 스크립트는 시험·수동용이다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const args = process.argv.slice(2);
  const flag = (k: string) => args.includes(k);
  const val = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  // dotenv 를 먼저 읽어야 db 가 DATABASE_URL 을 본다 — 그래서 동적 import
  const { runNightly, factsForDay, generateDraft, factsText, kstToday } = await import("../src/lib/blog-draft");

  const quoteId = val("--quote") ? Number(val("--quote")) : null;
  if (quoteId) {
    const [f] = await factsForDay("", { quoteId });
    if (!f) {
      console.log(`❌ quote ${quoteId} 를 글감으로 못 씁니다 (성사·타이어 포함·거래처 아님 조건)`);
      return;
    }
    console.log(`── ${f.quoteNo}\n${factsText(f)}\n`);
    if (flag("--dry")) return;
    const r = await generateDraft(f);
    console.log(r.ok ? `✅ 초안 #${r.id} — ${r.titles[0]}${r.warn ? `\n⚠️ ${r.warn}` : ""}` : `❌ ${r.error}`);
    return;
  }

  const day = val("--day") ?? kstToday();
  const limit = val("--limit") ? Number(val("--limit")) : 3;
  const { results } = await runNightly({ day, limit, dry: flag("--dry") });
  if (results.length === 0) {
    console.log(`${day}: 글감이 없습니다 (성사된 타이어 시공 중 거래처·무상 제외, 이미 초안 있는 건 제외)`);
    return;
  }
  for (const r of results) {
    console.log(`── ${r.quoteNo}\n${r.facts}`);
    if (r.result === null) console.log("   (dry — 만들지 않음)");
    else if (r.result.ok) console.log(`   ✅ 초안 #${r.result.id} — ${r.result.titles[0]}${r.result.warn ? `\n   ⚠️ ${r.result.warn}` : ""}`);
    else console.log(`   ❌ ${r.result.error}`);
    console.log();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
