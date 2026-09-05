/**
 * 블로그 초안 — 매장 PC 에서 돌린다 (docs/17)
 *
 *   npm run blog-draft -- --quote 1234       특정 판매 한 건 (quote.id)
 *   npm run blog-draft -- --job 42           앱에서 고르신 주문 (대리인이 쓰는 길)
 *   npm run blog-draft -- --api              구독 대신 API 키로 (기본은 구독)
 *
 * 🔴 **어느 시공으로 쓸지는 반드시 지정해야 한다** (사장님 지시 2026-09-05).
 *    예전에는 인자 없이 돌리면 그날 시공에서 스스로 골라 3건을 만들었다. 그 길은 없앴다 —
 *    사장님이 쓸 작업을 직접 고르신다.
 *
 * ⭐ 기본이 **구독**이다 (AI_PROVIDER=cli). 이 PC 에 로그인된 클로드를 그대로 쓰므로
 *    요금이 따로 나가지 않는다. `--api` 를 붙이면 ANTHROPIC_API_KEY 로 부른다.
 *
 * `--agent` 는 대리인(scripts/blog-agent.ts)이 붙인다 — 결과를 기계가 읽을 수 있게
 * `DRAFT_ID=` / `ERROR=` 로 찍는다. 사람이 쓸 일은 없다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

/** 왜 못 쓰는지 판매를 한 번 더 읽어 그대로 말해 준다 */
async function whyNotUsable(quoteId: number): Promise<string> {
  try {
    const postgres = (await import("postgres")).default;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      const [q] = await sql<{ status: string; quote_no: string }[]>`
        SELECT status, quote_no FROM quote WHERE id = ${quoteId}`;
      if (!q) return `판매 ${quoteId} 를 찾지 못했습니다`;
      if (q.status !== "성사") {
        return `판매 ${q.quote_no} 는 아직 「성사」가 아닙니다 (지금 「${q.status}」) — 성사로 바꾼 뒤 다시 눌러 주세요`;
      }
      return `판매 ${q.quote_no} 에 품목이 하나도 없습니다 — 앱에서 품목을 넣은 뒤 다시 눌러 주세요`;
    } finally {
      await sql.end();
    }
  } catch {
    return `판매 ${quoteId} 를 글감으로 못 씁니다`;
  }
}

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
  const { factsForDay, generateDraft, factsText } = await import("../src/lib/blog-draft");

  if (!flag("--dry")) {
    say(`부르는 길: ${process.env.AI_PROVIDER === "cli" ? "구독 (매장 PC 클로드)" : "API 키"}`);
  }

  /**
   * ⭐ 주문서(blog_job)에서 재료를 읽는다 (B단계, 2026-09-02).
   *    사장님이 앱에서 채운 작업 후기 폼이 payload 에 들어 있다 — 그게 글의 알맹이다.
   *    폼을 명령줄 인자로 넘기면 한글이 깨지므로 DB 를 거친다.
   */
  let jobTopic: { title: string; category: string; material: string } | undefined;
  let jobForm: Record<string, unknown> | undefined;
  let jobQuoteId: number | null = null;
  let jobFolderId: number | null = null;
  let jobPhotoIds: number[] = [];
  const jobId = val("--job") ? Number(val("--job")) : null;
  if (jobId) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      const [row] = await sql<{ payload: Record<string, unknown> | null }[]>`
        SELECT payload FROM blog_job WHERE id = ${jobId}`;
      const p = (row?.payload ?? {}) as {
        quoteId?: number;
        form?: Record<string, unknown>;
        folderId?: number;
        photoIds?: number[];
        topic?: { title: string; category: string; material: string };
      };
      jobTopic = p.topic;
      jobQuoteId = p.quoteId ? Number(p.quoteId) : null;
      jobForm = p.form;
      jobFolderId = p.folderId ? Number(p.folderId) : null;
      jobPhotoIds = Array.isArray(p.photoIds) ? p.photoIds.map(Number) : [];
    } finally {
      await sql.end();
    }
  }

  /** ⭐ 정보성 글 (D단계) — 시공이 없다. 「차종별 순정 제원」·「차량 관리팁」 */
  if (jobTopic) {
    const { generateTopicDraft } = await import("../src/lib/blog-draft");
    say(`── 정보성 글: ${jobTopic.title}`);
    const r = await generateTopicDraft({ ...jobTopic, onLog });
    if (r.ok) {
      say(`✅ 초안 #${r.id} — ${r.titles[0]}`);
      if (agent) say(`DRAFT_ID=${r.id}`);
    } else {
      say(agent ? `ERROR=${r.error}` : `❌ ${r.error}`);
      if (agent) process.exitCode = 1;
    }
    return;
  }

  const quoteId = jobQuoteId ?? (val("--quote") ? Number(val("--quote")) : null);
  if (quoteId) {
    const [f] = await factsForDay("", { quoteId });
    if (!f) {
      /**
       * 🔴 **조건을 나열하지 않는다** (2026-09-05, 사장님 제보).
       *    예전 문구는 「성사·타이어 포함·거래처 아님 조건」이라 세 개를 늘어놓기만 해서,
       *    엔진오일 건이 거래처 때문에 막힌 것을 **타이어 문제로 오해**하시게 만들었다.
       *    이제 남은 조건은 「성사」 하나뿐이니, 무엇이 문제인지 그대로 말한다.
       */
      const msg = await whyNotUsable(quoteId);
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
    /**
     * ⭐ 사진 (C단계) — 임시 폴더에 `p00.jpg` 로 복사한 뒤 그 폴더만 모델에 열어 준다.
     * 🔴 원본 폴더를 열면 폴더 이름의 번호판이 경로로 새어 나간다.
     */
    let prepared: Awaited<ReturnType<typeof import("../src/lib/blog-photo-worker").preparePhotosForAi>> | null = null;
    if (jobFolderId && jobPhotoIds.length) {
      const { preparePhotosForAi } = await import("../src/lib/blog-photo-worker");
      prepared = await preparePhotosForAi(jobFolderId, jobPhotoIds, onLog);
      if (prepared.photos.length === 0) {
        await prepared.cleanup();
        const msg = "고르신 사진을 하나도 못 읽었습니다 — 구름에만 있는 사진이면 폴더 목록에서 먼저 내려받아 주세요";
        say(agent ? `ERROR=${msg}` : `❌ ${msg}`);
        if (agent) process.exitCode = 1;
        return;
      }
    }

    try {
      const r = await generateDraft(f, {
        onLog,
        variant,
        form,
        folderId: jobFolderId ?? undefined,
        photos: prepared
          ? { dir: prepared.dir, files: prepared.photos.map((p) => ({ photoId: p.photoId, tempName: p.tempName })) }
          : undefined,
      });
      if (r.ok) {
        say(`✅ 초안 #${r.id} — ${r.titles[0]}${r.warn ? `\n⚠️ ${r.warn}` : ""}`);
        if (agent) say(`DRAFT_ID=${r.id}`);
      } else {
        say(agent ? `ERROR=${r.error}` : `❌ ${r.error}`);
        if (agent) process.exitCode = 1;
      }
    } finally {
      // 임시 폴더는 반드시 지운다 — 사진이 남아 있으면 안 된다
      await prepared?.cleanup();
    }
    return;
  }

  /* 여기까지 왔다는 것은 --quote 도 --job 도 없다는 뜻이다 */
  const msg = "어느 시공으로 쓸지 알려 주세요 (--quote 1234 또는 --job 42). 프로그램이 대신 고르지 않습니다.";
  say(agent ? `ERROR=${msg}` : `❌ ${msg}`);
  process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (process.argv.includes("--agent")) console.log(`ERROR=${msg.split("\n")[0]}`);
    console.error(e);
    process.exit(1);
  });
