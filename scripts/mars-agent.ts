/**
 * ⭐ MARS 실행 대리인 — 사장님 PC 에서 돌며 웹 버튼의 요청을 받는다 (2026-08-04)
 *
 *   사장님: "npm 으로 시작하는 콘솔 명령어라는 점이 불편함.
 *            웹페이지에 버튼이라도 따로 있었으면 좋겠음."
 *
 * 웹서버(Vercel)는 MARS 를 직접 조작할 수 없다 — 로그인·크롬 프로필이 이 PC 에 있고
 * 자격증명은 PC 밖으로 내보내지 않는다. 그래서 다리를 하나 둔다:
 *
 *   [웹 버튼] → mars_run 표에 「대기」 요청 → [이 프로그램] → mars-fill 실행
 *                                                └ 진행 로그를 되쓴다 → [웹 화면에 표시]
 *
 * 켜 두는 법 (한 번만):
 *   npm run mars:agent          ← 창을 하나 열어 두면 된다. 10초마다 요청을 확인한다.
 *
 * 윈도우 시작 시 자동 실행을 원하시면 `시작 프로그램` 폴더(Win+R → shell:startup)에
 * `mars-agent.bat` 바로가기를 넣으면 된다 (파일은 저장소의 scripts/ 에 있다).
 *
 * 🔴 한 번에 하나만 돌린다. MARS 창 두 개가 같은 프로필을 잡으면 둘 다 죽는다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { spawn } from "node:child_process";
import postgres from "postgres";

const POLL_MS = 10_000;
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

const stamp = () => new Date().toLocaleTimeString("ko-KR", { hour12: false });
const log = (s: string) => console.log(`[${stamp()}] ${s}`);

async function appendLog(id: number, line: string) {
  // 🔴 캡 20만 자 (2026-08-17 — 50건 배치 로그가 옛 캡 2만 자에 잘려 뒷부분 실패 이유가 사라졌다)
  await sql`
    UPDATE mars_run
    SET log = LEFT(COALESCE(log || E'\n', '') || ${line}, 200000)
    WHERE id = ${id}`.catch(() => {});
}

async function runOne(id: number, kind: string): Promise<void> {
  log(`요청 #${id} (${kind}) 시작`);
  await sql`UPDATE mars_run SET status='실행중', started_at=now(), log='' WHERE id=${id}`;

  const args = ["tsx", "scripts/mars-fill.ts", "--agent"];
  if (kind === "점검") args.push("--check");
  // 아침 자가점검 (2026-08-10) — 화면 구조만 훑고 아무것도 저장하지 않는다
  if (kind === "자가점검") args.push("--smoke");
  // 아침 대사 (2026-08-18 단계3) — MARS 는 읽기만, 틀린 기록은 우리 DB 만 정정
  if (kind === "대사") args.push("--reconcile");

  /**
   * ⏱️ 제한 시간은 일의 양에 비례한다 (2026-08-17 run#91 — 50건 배치는 70분이
   *    걸리는데 고정 30분에 잘렸다). mars-fill 도 스스로 이보다 5분 먼저 멈추므로
   *    이 제한은 로봇이 진짜로 굳었을 때만 발동하는 마지막 안전망이다.
   */
  let timeoutMs = 45 * 60_000;
  if (kind === "입력") {
    const [c] = await sql<{ n: number }[]>`
      SELECT count(*)::int n FROM quote WHERE status='성사' AND mars_status='미전송'`;
    timeoutMs = Math.max(30 * 60_000, Number(c.n) * 150_000 + 10 * 60_000);
  } else if (kind === "점검") {
    timeoutMs = 70 * 60_000;
  } else if (kind === "자가점검") {
    timeoutMs = 15 * 60_000;
  } else if (kind === "대사") {
    timeoutMs = 45 * 60_000;
  }
  log(`  제한 시간 ${Math.round(timeoutMs / 60_000)}분`);

  const exit = await new Promise<number>((resolve) => {
    const child = spawn("npx", args, {
      shell: true,
      cwd: process.cwd(),
      // ⏱️ 마감을 자식에게 알려준다 (2026-08-18 단계1) — fill 은 이보다 5분 먼저
      //    스스로 멈춘다. 두 군데서 따로 계산하다 점검 모드에서 역전됐던 것의 근본 수리.
      env: {
        ...process.env,
        MARS_DEADLINE_TS: String(Date.now() + timeoutMs),
        // 시도 이력(mars_attempt)에 어느 실행이었는지 같이 남긴다 (단계2)
        MARS_RUN_ID: String(id),
      },
    });
    let buf = "";
    const onChunk = (c: Buffer) => {
      buf += c.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trimEnd();
        buf = buf.slice(i + 1);
        if (line.trim()) {
          console.log(`  │ ${line}`);
          void appendLog(id, line);
        }
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    /**
     * 🔴 웹의 「중단 처리」 감지 (2026-08-18 단계1) — cancelMarsRun 은 DB 상태만
     *    '실패'로 바꿀 뿐 프로세스를 못 죽인다. 화면은 멈췄다는데 로봇은 계속
     *    입력하는 상태(run#91 계열)를 막기 위해 30초마다 확인해 트리를 끊는다.
     */
    const kill = () => {
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      } else {
        child.kill("SIGKILL");
      }
    };
    const watch = setInterval(() => {
      void sql`SELECT status FROM mars_run WHERE id=${id}`
        .then((r) => {
          if (r[0] && r[0].status === "실패") {
            log(`요청 #${id} — 웹에서 중단 처리됨, 로봇을 멈춥니다`);
            kill();
            clearInterval(watch);
          }
        })
        .catch(() => {});
    }, 30_000);
    const timer = setTimeout(() => {
      /**
       * 🔴 `child.kill()` 은 겉껍데기(cmd)만 죽인다 (2026-08-17 run#91 실측 —
       *    「실패」로 표시한 뒤에도 로봇이 40분을 더 MARS 에 입력했다. 그때
       *    「다시 실행 요청」을 눌렀다면 로봇 두 대가 같은 크롬을 잡았을 것이다).
       *    윈도우에서는 taskkill 로 **프로세스 나무 전체**를 끊는다.
       */
      kill();
      resolve(124);
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      clearInterval(watch);
      resolve(code ?? 1);
    });
  });

  if (exit === 0) {
    await sql`UPDATE mars_run SET status='완료', finished_at=now() WHERE id=${id}`;
    log(`요청 #${id} 완료`);
  } else {
    await appendLog(
      id,
      `⚠️ 종료 코드 ${exit}${exit === 124 ? ` (제한 ${Math.round(timeoutMs / 60_000)}분 초과 — 프로세스 나무를 강제 종료함)` : ""}`,
    );
    await sql`UPDATE mars_run SET status='실패', finished_at=now() WHERE id=${id}`;
    log(`요청 #${id} 실패 (코드 ${exit})`);
  }
}

async function main() {
  /**
   * 🔴 한 번에 하나만 (2026-08-06, 시작 프로그램 자동 실행 도입과 함께).
   * 자동 실행 + 손으로 또 켜기가 겹치면 MARS 창 두 개가 같은 크롬 프로필을
   * 잡아 둘 다 죽는다. DB 자문 잠금은 이 프로세스의 연결이 살아 있는 동안만
   * 유지되므로, 창을 닫으면(비정상 종료 포함) 자리가 저절로 비워진다.
   * ⚠️ 세션 풀러(5432) 전용 — 트랜잭션 풀러(6543)에서는 잠금이 유지되지 않는다.
   *    이 스크립트는 매장 PC 의 .env.local(5432)로만 돌므로 지금은 문제없다.
   */
  const [got] = await sql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(748291) AS ok`;
  if (!got.ok) {
    log("이미 다른 대리인 창이 켜져 있습니다 — 두 개를 켜면 안 되므로 이 창은 물러납니다.");
    log("(원래 켜져 있던 창을 그대로 쓰시면 됩니다. 이 창은 닫으셔도 됩니다.)");
    await sql.end();
    return;
  }

  log("MARS 실행 대리인이 켜졌습니다 — 웹의 「자동으로 넣기」 버튼을 기다립니다");
  log("끄려면 이 창에서 Ctrl+C");

  // 지난번에 죽으면서 「실행중」으로 굳은 것 정리
  await sql`
    UPDATE mars_run SET status='실패', finished_at=now(),
      log = COALESCE(log || E'\n','') || '(대리인이 재시작되며 중단 처리)'
    WHERE status='실행중'`;

  for (;;) {
    try {
      const [next] = await sql<{ id: number; kind: string }[]>`
        SELECT id, kind FROM mars_run WHERE status='대기' ORDER BY id LIMIT 1`;
      if (next) await runOne(Number(next.id), next.kind);
    } catch (e) {
      log(`오류: ${(e as Error).message.split("\n")[0]} — 계속 기다립니다`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
