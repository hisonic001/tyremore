/**
 * 사진 폴더 훑기 — 매장 PC 에서 돌린다 (C단계, docs/17)
 *
 *   npm run blog-scan                    전체 폴더 목록·미리보기 (구름 파일은 안 받는다)
 *   npm run blog-scan -- --job 12        앱의 「사진 다시 훑기」가 대리인을 거쳐 부르는 길
 *
 * 🔴 원본은 서버로 안 간다 — 160px 미리보기만 올라간다.
 * 🔴 구름에만 있는 사진은 평소에 안 받는다. 폴더 하나를 지정하고 --hydrate 를 줄 때만
 *    실제로 내려받아 미리보기를 만든다 (사진 404장 중 200장이 구름에 있다).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const args = process.argv.slice(2);
  const agent = args.includes("--agent");
  const val = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };

  /** 주문서에서 「어느 폴더를·받을지 말지」를 읽는다 (폴더명은 한글이라 명령줄로 안 넘긴다) */
  let only: string | undefined;
  let hydrate = args.includes("--hydrate");
  const jobId = val("--job") ? Number(val("--job")) : null;
  if (jobId) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      const [row] = await sql<{ payload: Record<string, unknown> | null }[]>`
        SELECT payload FROM blog_job WHERE id = ${jobId}`;
      const p = (row?.payload ?? {}) as { folderName?: string; hydrate?: boolean };
      only = p.folderName;
      if (p.hydrate) hydrate = true;
    } finally {
      await sql.end();
    }
  }

  // dotenv 를 먼저 읽어야 db 가 DATABASE_URL 을 본다 — 그래서 동적 import
  const { scanFolders } = await import("../src/lib/blog-scan");
  try {
    await scanFolders((s) => console.log(s), { only, hydrate });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(agent ? `ERROR=${msg}` : `❌ ${msg}`);
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (process.argv.includes("--agent")) console.log(`ERROR=${msg.split("\n")[0]}`);
    console.error(e);
    process.exit(1);
  });
