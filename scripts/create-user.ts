/**
 * 직원 계정 만들기 / 비밀번호 바꾸기
 *
 *   npx tsx scripts/create-user.ts <아이디> <이름> <owner|tech>
 *
 * 비밀번호는 **명령줄에 적지 않는다.** 실행하면 물어본다.
 * 명령줄에 쓰면 셸 기록(history)에 그대로 남는다.
 *
 * owner — 매입원가·마진이 보인다 (D-05 6번)
 * tech  — 판매가만 보인다
 */
import { config } from "dotenv";
import { createInterface } from "node:readline";
config({ path: ".env.local" });

/** 입력이 화면에 안 보이게 받는다 — 어깨너머로 읽히지 않도록 */
function askHidden(q: string): Promise<string> {
  return new Promise((resolve) => {
    const out = process.stdout;
    const rl = createInterface({ input: process.stdin, output: out, terminal: true });
    const origWrite = out.write.bind(out);
    let muted = false;

    out.write = ((chunk: unknown, ...rest: unknown[]) => {
      if (muted) return true;
      return (origWrite as (c: unknown, ...r: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof out.write;

    rl.question(q, (answer) => {
      muted = false;
      out.write = origWrite as typeof out.write;
      out.write("\n");
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const [loginId, name, role] = process.argv.slice(2);
  if (!loginId || !name || (role !== "owner" && role !== "tech")) {
    console.error("사용법: npx tsx scripts/create-user.ts <아이디> <이름> <owner|tech>");
    process.exit(1);
  }

  const pw = await askHidden(`${name}(${loginId}) 비밀번호: `);
  if (pw.length < 8) {
    console.error("비밀번호는 8자 이상으로 하세요. 인터넷에 열리는 화면입니다.");
    process.exit(1);
  }
  const pw2 = await askHidden("한 번 더: ");
  if (pw !== pw2) {
    console.error("두 번 입력한 값이 다릅니다.");
    process.exit(1);
  }

  const { db } = await import("../src/db");
  const { appUser } = await import("../src/db/schema");
  const { hashPassword } = await import("../src/lib/auth");
  const { eq } = await import("drizzle-orm");

  const id = loginId.trim().toLowerCase();
  const passwordHash = await hashPassword(pw);

  const [existing] = await db.select().from(appUser).where(eq(appUser.loginId, id)).limit(1);
  if (existing) {
    await db.update(appUser).set({ passwordHash, name, role, isActive: true }).where(eq(appUser.id, existing.id));
    console.log(`✅ ${name}(${id}) 비밀번호를 바꿨습니다. 역할: ${role}`);
  } else {
    await db.insert(appUser).values([{ loginId: id, passwordHash, name, role }]);
    console.log(`✅ ${name}(${id}) 계정을 만들었습니다. 역할: ${role}`);
  }

  const users = await db.select({ id: appUser.loginId, name: appUser.name, role: appUser.role }).from(appUser);
  console.log("\n현재 계정:");
  for (const u of users) console.log(`   ${u.id.padEnd(14)} ${u.name.padEnd(10)} ${u.role}`);
  process.exit(0);
}
main();
