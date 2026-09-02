/**
 * 블로그 초안 — 매장 PC 에서 돌린다 (docs/17)
 *
 *   npm run blog-draft -- --dry              오늘 후보와 지시문에 들어갈 사실만 (모델 안 부름)
 *   npm run blog-draft -- --limit 1          초안 1건만 — 처음 시험할 때
 *   npm run blog-draft                       오늘 최대 3건
 *   npm run blog-draft -- --day 2026-08-28   다른 날짜
 *   npm run blog-draft -- --quote 1234       특정 판매 한 건 (quote.id)
 *   npm run blog-draft -- --api              구독 대신 API 키로 (기본은 구독)
 *
 * ⭐ 기본이 **구독**이다 (AI_PROVIDER=cli). 이 PC 에 로그인된 클로드를 그대로 쓰므로
 *    요금이 따로 나가지 않는다. `--api` 를 붙이면 ANTHROPIC_API_KEY 로 부른다.
 *
 * `--agent` 는 대리인(scripts/blog-agent.ts)이 붙인다 — 결과를 기계가 읽을 수 있게
 * `DRAFT_ID=` / `ERROR=` 로 찍는다. 사람이 쓸 일은 없다.
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

  // 🔴 db 를 들여오기 전에 정해야 한다 — 부르는 길(구독/API)은 환경변수로 전한다
  if (!flag("--api")) process.env.AI_PROVIDER = "cli";

  const agent = flag("--agent");
  const say = (s: string) => console.log(s);
  const onLog = (line: string) => console.log(line);

  // dotenv 를 먼저 읽어야 db 가 DATABASE_URL 을 본다 — 그래서 동적 import
  const { runNightly, factsForDay, generateDraft, factsText } = await import("../src/lib/blog-draft");

  if (!flag("--dry")) {
    say(`부르는 길: ${process.env.AI_PROVIDER === "cli" ? "구독 (매장 PC 클로드)" : "API 키"}`);
  }

  /**
   * ⭐ 주문서(blog_job)에서 재료를 읽는다 (B단계, 2026-09-02).
   *    사장님이 앱에서 채운 작업 후기 폼이 payload 에 들어 있다 — 그게 글의 알맹이다.
   *    폼을 명령줄 인자로 넘기면 한글이 깨지므로 DB 를 거친다.
   */
  let jobForm: Record<string, unknown> | undefined;
  let jobQuoteId: number | null = null;
  const jobId = val("--job") ? Number(val("--job")) : null;
  if (jobId) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      const [row] = await sql<{ payload: Record<string, unknown> | null }[]>`
        SELECT payload FROM blog_job WHERE id = ${jobId}`;
      const p = (row?.payload ?? {}) as { quoteId?: number; form?: Record<string, unknown> };
      jobQuoteId = p.quoteId ? Number(p.quoteId) : null;
      jobForm = p.form;
    } finally {
      await sql.end();
    }
  }

  const quoteId = jobQuoteId ?? (val("--quote") ? Number(val("--quote")) : null);
  if (quoteId) {
    const [f] = await factsForDay("", { quoteId });
    if (!f) {
      const msg = `quote ${quoteId} 를 글감으로 못 씁니다 (성사·타이어 포함·거래처 아님 조건)`;
      say(agent ? `ERROR=${msg}` : `❌ ${msg}`);
      process.exitCode = agent ? 1 : 0;
      return;
    }
    say(`── ${f.quoteNo}\n${factsText(f)}\n`);
    if (flag("--dry")) return;
    const variant = val("--variant") ? Number(val("--variant")) : undefined;
    const { sanitizeForm, formHasMaterial } = await import("../src/lib/blog-form");
    const form = jobForm ? sanitizeForm(jobForm) : undefined;
    if (form && !formHasMaterial(form)) {
      const msg = "작업 후기를 하나도 안 고르셔서 만들지 않았습니다 — 재료가 없으면 뻔한 글이 됩니다";
      say(agent ? `ERROR=${msg}` : `❌ ${msg}`);
      if (agent) process.exitCode = 1;
      return;
    }
    const r = await generateDraft(f, { onLog, variant, form });
    if (r.ok) {
      say(`✅ 초안 #${r.id} — ${r.titles[0]}${r.warn ? `\n⚠️ ${r.warn}` : ""}`);
      if (agent) say(`DRAFT_ID=${r.id}`);
    } else {
      say(agent ? `ERROR=${r.error}` : `❌ ${r.error}`);
      if (agent) process.exitCode = 1;
    }
    return;
  }

  const day = val("--day");
  const limit = val("--limit") ? Number(val("--limit")) : 3;
  const { day: usedDay, results } = await runNightly({ day, limit, dry: flag("--dry"), onLog });
  if (results.length === 0) {
    const msg = `${usedDay}: 글감이 없습니다 (성사된 타이어 시공 중 거래처·무상 제외, 이미 초안 있는 건 제외)`;
    say(agent ? `ERROR=${msg}` : msg);
    if (agent) process.exitCode = 1;
    return;
  }
  let made = 0;
  for (const r of results) {
    say(`── ${r.quoteNo}\n${r.facts}`);
    if (r.result === null) say("   (dry — 만들지 않음)");
    else if (r.result.ok) {
      say(`   ✅ 초안 #${r.result.id} — ${r.result.titles[0]}${r.result.warn ? `\n   ⚠️ ${r.result.warn}` : ""}`);
      if (agent) say(`DRAFT_ID=${r.result.id}`);
      made += 1;
    } else {
      say(`   ❌ ${r.result.error}`);
      if (agent) say(`ERROR=${r.result.error}`);
    }
    say("");
  }
  // 한 건도 못 만들었으면 대리인에게 실패로 알린다
  if (agent && !flag("--dry") && made === 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (process.argv.includes("--agent")) console.log(`ERROR=${msg.split("\n")[0]}`);
    console.error(e);
    process.exit(1);
  });
