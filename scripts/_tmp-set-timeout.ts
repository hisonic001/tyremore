import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  // 60초 넘게 도는 질의는 DB 가 스스로 끊는다 — 좀비가 풀러 자리를 영영 깔고 앉는 것을 막는다.
  // 우리 앱의 정상 질의는 전부 1초 미만이고, 백업(표별 SELECT)·복원도 수 초면 끝난다.
  await sql`ALTER ROLE postgres SET statement_timeout = '60s'`;
  await sql`ALTER ROLE postgres SET idle_in_transaction_session_timeout = '120s'`;
  const rows = await sql`
    SELECT unnest(setconfig) AS cfg FROM pg_db_role_setting s
    JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'postgres'
  `;
  console.log("적용된 역할 설정:", rows.map((r) => r.cfg).join(" · "));
  await sql.end();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
