/**
 * ⭐ 지워진 대사 자국을 기록으로 남긴다 (사장님 제보 2026-08-29)
 *
 *   사고: 8/27 카드 일마감의 짝 10건이 통째로 사라졌는데, **무엇이 지웠는지 알 방법이 없었다.**
 *   recon_match 는 지우면 흔적이 안 남고 앱에는 로그가 한 줄도 없다.
 *   (다른 종류의 자동 자국 — 매입·매출계산서·이체입금 — 은 08-27 것이 그대로 남아 있어
 *    「자동을 싹 지우는 스크립트」가 돈 것도 아니었다. 끝내 못 밝혔다.)
 *
 *   → 이제 자국을 지울 때 이 표에 한 줄씩 옮겨 적는다. 되돌리기용이 아니라 **까닭을 알기 위한 것**이다.
 *
 *   실행: npx tsx scripts/add-recon-trash.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS recon_match_gone (
        id           bigserial PRIMARY KEY,
        match_id     bigint      NOT NULL,
        kind         text        NOT NULL,
        src_table    text        NOT NULL,
        src_id       bigint      NOT NULL,
        ref_table    text        NOT NULL,
        ref_id       bigint      NOT NULL,
        amount       integer     NOT NULL,
        method       text,
        confirmed_at timestamptz,
        -- 누가·언제·왜 지웠나
        deleted_by   bigint      REFERENCES app_user(id),
        deleted_at   timestamptz NOT NULL DEFAULT now(),
        reason       text        NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_recon_gone_at ON recon_match_gone (deleted_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_recon_gone_src ON recon_match_gone (src_table, src_id)`;
    console.log("✅ recon_match_gone — 지워진 대사 자국 기록표");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
