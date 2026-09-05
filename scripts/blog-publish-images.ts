/**
 * 발행용 사진 굽기 — **매장 PC 에서 돌린다** (2026-09-05)
 *
 *   npx tsx scripts/blog-publish-images.ts --draft 11     글 하나
 *   npx tsx scripts/blog-publish-images.ts --job 42       앱의 「사진 고화질로 준비」가 부르는 길
 *   npx tsx scripts/blog-publish-images.ts --all          발행 안 한 초안 전부 (한 번 채워 넣기)
 *   … --draft 11 --copies                                「_블로그」 정렬 폴더도 다시 만든다
 *
 * `--copies` 는 **영상(V-00 …)까지 다시 넣는다.** 예전에 만든 글의 `_블로그` 폴더에는
 * 사진만 있고 영상이 없다 — 영상은 네이버 「동영상」 단추로만 올라가므로, 사장님 손이
 * 닿는 자리에 순서대로 놓여 있어야 한다.
 *
 * 🔴 왜 이 일이 있나: 앱 화면 「사진 순서」의 그림을 끌어다 네이버 글쓰기에 붙이면
 *    **그림 파일 자체**가 넘어간다. 거기 걸린 것이 목록용 160px 미리보기라
 *    160px 이 그대로 블로그에 올라갔다 (사장님 지적).
 *
 * 🔴 왜 매장 PC 인가: 사진 원본은 이 PC 의 OneDrive 폴더에만 있다. Vercel 은 못 본다.
 *    그래서 앱은 주문만 남기고, 굽는 것은 늘 여기다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

interface PlanRow {
  photoId: number;
  slot: string;
  caption: string;
}

async function main() {
  const args = process.argv.slice(2);
  const agent = args.includes("--agent");
  const val = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  let draftIds: number[] = [];
  try {
    const jobId = val("--job") ? Number(val("--job")) : null;
    if (jobId) {
      const [row] = await sql<{ payload: Record<string, unknown> | null }[]>`
        SELECT payload FROM blog_job WHERE id = ${jobId}`;
      const p = (row?.payload ?? {}) as { draftId?: number };
      if (p.draftId) draftIds = [Number(p.draftId)];
    } else if (val("--draft")) {
      draftIds = [Number(val("--draft"))];
    } else if (args.includes("--all")) {
      const rows = await sql<{ id: number }[]>`
        SELECT id FROM blog_draft
        WHERE status = '초안' AND folder_id IS NOT NULL AND photo_plan IS NOT NULL
        ORDER BY id DESC`;
      draftIds = rows.map((r) => Number(r.id));
    }
  } finally {
    await sql.end();
  }

  if (draftIds.length === 0) {
    const msg = "어느 글의 사진인지 알 수 없습니다 (--draft 11 또는 --job 42 또는 --all)";
    console.log(agent ? `ERROR=${msg}` : `❌ ${msg}`);
    process.exitCode = 1;
    return;
  }

  // dotenv 를 먼저 읽어야 db 가 DATABASE_URL 을 본다 — 그래서 동적 import
  const { db } = await import("../src/db");
  const { sql: dsql } = await import("drizzle-orm");
  const { makeOrderedCopies, uploadPublishImages } = await import("../src/lib/blog-photo-worker");
  const copies = args.includes("--copies");

  let total = 0;
  /** 🔴 글마다 순차로 — 동시에 돌리면 풀이 찬다 */
  for (const id of draftIds) {
    const rows = await db.execute<{ folder_id: number | null; photo_plan: PlanRow[] | null }>(dsql`
      SELECT folder_id, photo_plan FROM blog_draft WHERE id = ${id}`);
    const r = rows[0];
    if (!r?.folder_id || !r.photo_plan?.length) {
      console.log(`글 #${id} — 사진 계획이 없어 건너뜁니다`);
      continue;
    }
    console.log(`글 #${id} — 사진 ${r.photo_plan.length}장`);
    const made = await uploadPublishImages(Number(r.folder_id), r.photo_plan, (s) => console.log(`  ${s}`));
    if (made === 0) console.log("  이미 다 준비돼 있습니다");
    total += made;
    if (copies) {
      await makeOrderedCopies(Number(r.folder_id), r.photo_plan, (s) => console.log(`  ${s}`));
    }
  }
  console.log(`끝 — 발행용 사진 ${total}장을 새로 만들었습니다`);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (process.argv.includes("--agent")) console.log(`ERROR=${msg.split("\n")[0]}`);
    console.error(e);
    process.exit(1);
  });
