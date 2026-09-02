/**
 * ⭐ 계정별 기능 권한 칸 (사장님 요청 2026-09-02)
 *
 *   app_user.perms jsonb — 모듈 스위치 맵 (정본: src/lib/perm-keys.ts).
 *   기존 직원(tech) 계정은 전부 켠 맵으로 채운다 — 하던 일이 안 끊기게 (사장님 결정).
 *   새 계정 기본은 {} = 전부 꺼짐.
 *
 * 실행: npx tsx --env-file=.env.local scripts/add-user-perms.ts   (멱등)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { allOnPerms } from "@/lib/perm-keys";

async function main() {
  await db.execute(sql`ALTER TABLE app_user ADD COLUMN IF NOT EXISTS perms jsonb`);
  const on = JSON.stringify(allOnPerms());
  const rows = await db.execute<{ login_id: string }>(sql`
    UPDATE app_user SET perms = ${on}::jsonb
    WHERE role = 'tech' AND perms IS NULL
    RETURNING login_id
  `);
  const all = await db.execute<{ login_id: string; role: string; perms: unknown }>(sql`
    SELECT login_id, role, perms FROM app_user ORDER BY id
  `);
  console.log(`✅ perms 칸 준비 — 기존 직원 ${rows.length}명 전부 켬`);
  for (const u of all) console.log(`  ${u.login_id} (${u.role}): ${u.perms ? JSON.stringify(u.perms) : "—"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(0), 500));
