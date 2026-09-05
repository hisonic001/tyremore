/**
 * 제원 「자동확인」 상태 (2026-09-05, 사장님 결정)
 *
 * 사장님: 「검수해야 할 것이 너무 많다 — 일정 수준의 교차검증이 통과되면 자동으로 맞다고
 * 해 달라. 나중에 작업하며 검증하면서 고쳐 나가겠다.」 (592건 전부 대기, 승인 0건)
 *
 * 🔴 그런데 DB 에 **`vs_verified` — 사람이 검수 안 한 「승인」은 못 만든다**는 제약이
 *    일부러 걸려 있다. 그 제약은 **그대로 둔다.** 기계가 본 것을 「승인」이라 부르면
 *    나중에 무엇을 사람이 봤는지 알 수 없게 된다.
 *
 * 🔴 그래서 상태를 하나 더 만든다 — **`자동확인`**.
 *    · 값은 사장님께 **다 열린다** (숨기지 않는다)
 *    · 화면에는 「사장님 확인」과 **다른 배지**로 보인다
 *    · 사장님이 일하시다 틀린 것을 보면 그 자리에서 되돌릴 수 있다
 *    구별이 없으면 「고쳐 나가겠다」가 불가능하다 — 고칠 대상을 찾을 수 없기 때문이다.
 *
 * 코드 배포 **전에** 실행한다.
 *   npx tsx scripts/add-spec-autoconfirm.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    /**
     * 🔴 제약을 통째로 다시 만드는 방식이라 **기존 값을 빠뜨리면 안 된다.**
     *    (2026-09-05 에 `blog_job` 에서 `제원` 을 실제로 한 번 날렸다.)
     *    지금 값: 검수대기 · 승인 · 자동확인 · 보류 · 거절
     */
    await sql`ALTER TABLE vehicle_spec DROP CONSTRAINT IF EXISTS vs_status`;
    await sql`
      ALTER TABLE vehicle_spec ADD CONSTRAINT vs_status
        CHECK (status IN ('검수대기','승인','자동확인','보류','거절'))`;
    console.log("✅ vehicle_spec 상태에 「자동확인」 추가됨");

    /** 자동확인이 왜 통과했는지 남긴다 — 나중에 사장님이 「왜 이게 맞다고 됐지」 물으실 때 */
    await sql`ALTER TABLE vehicle_spec ADD COLUMN IF NOT EXISTS auto_note text`;
    console.log("✅ vehicle_spec.auto_note 준비됨");

    const [c] = await sql<{ d: string }[]>`
      SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'vs_status'`;
    console.log(`   지금 제약: ${c.d}`);
    const st = await sql<{ status: string; n: number }[]>`
      SELECT status, count(*)::int AS n FROM vehicle_spec GROUP BY status ORDER BY n DESC`;
    console.log(`   지금 상태: ${st.map((r) => `${r.status} ${r.n}`).join(" · ")}`);

    /* 🔴 사람 검수 제약은 그대로 있는지 확인한다 — 이게 풀리면 안 된다 */
    const [v] = await sql<{ d: string }[]>`
      SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'vs_verified'`;
    console.log(`   사람 검수 제약(그대로여야 함): ${v?.d ?? "🔴 없어졌습니다!"}`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
