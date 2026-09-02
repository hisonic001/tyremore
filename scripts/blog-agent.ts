/**
 * ⭐ 블로그 원고 대리인 — 매장 PC 에서 돌며 앱 버튼의 요청을 받는다 (v3 1단계, 2026-09-02)
 *
 * 글은 이 PC 에서만 만들어진다. 클로드 **구독**이 여기 로그인되어 있고, Vercel 에는
 * 그 로그인이 없기 때문이다. 그래서 다리를 하나 둔다 (mars-agent 와 같은 모양):
 *
 *   [앱 버튼] → blog_job 「대기」 → [이 프로그램] → blog-draft.ts (구독으로 클로드 호출)
 *                                     └ 진행 로그를 되쓴다 → [앱 화면에 표시]
 *
 * 켜 두는 법:
 *   npm run blog:agent          ← 창을 하나 열어 두면 된다. 5초마다 요청을 확인한다.
 *   시작 프로그램에 넣으려면 scripts/blog-agent.bat 바로가기를 shell:startup 에.
 *   (mars-agent.bat 이 이 프로그램도 같이 띄우므로 보통은 따로 할 일이 없다)
 *
 * 🔴 MARS 대리인과 표를 나눈 이유: MARS 입력은 최대 70분짜리이고 「한 번에 하나」다.
 *    원고는 1~3분짜리라 그 뒤에 세우면 사장님이 버튼을 누르고 한 시간을 기다린다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import os from "node:os";
import postgres from "postgres";

const POLL_MS = 5_000;
const HEARTBEAT_MS = 15_000;
const sql = postgres(process.env.DATABASE_URL!, { max: 1, idle_timeout: 20 });

const stamp = () => new Date().toLocaleTimeString("ko-KR", { hour12: false });
const log = (s: string) => console.log(`[${stamp()}] ${s}`);

/** 클로드 판번호 — 앱 화면에 보여 주면 문제를 짚기 쉽다 */
function claudeVersion(): string {
  try {
    return execFileSync("claude", ["--version"], { encoding: "utf8", shell: true, timeout: 30_000 })
      .trim()
      .split("\n")[0];
  } catch {
    return "(확인 실패)";
  }
}

async function beat(version: string) {
  await sql`
    INSERT INTO agent_heartbeat (name, last_seen, host, version)
    VALUES ('blog', now(), ${os.hostname()}, ${version})
    ON CONFLICT (name) DO UPDATE
      SET last_seen = now(), host = EXCLUDED.host, version = EXCLUDED.version`.catch(() => {});
}

async function appendLog(id: number, line: string) {
  await sql`
    UPDATE blog_job
    SET log = LEFT(COALESCE(log || E'\n', '') || ${line}, 30000)
    WHERE id = ${id}`.catch(() => {});
}

interface Claimed {
  id: number;
  kind: string;
  payload: Record<string, unknown> | null;
}

/**
 * 다음 요청을 원자적으로 집는다.
 * `FOR UPDATE SKIP LOCKED` 라 창을 두 개 켜도 같은 요청을 두 번 처리하지 않는다
 * — mars-agent 의 자문 잠금과 달리 연결을 놓아도 안전하다.
 */
async function claim(): Promise<Claimed | null> {
  const rows = await sql<Claimed[]>`
    UPDATE blog_job
    SET status='실행중', started_at=now(), log='', error=NULL
    WHERE id = (
      SELECT id FROM blog_job WHERE status='대기'
      ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, payload`;
  return rows[0] ?? null;
}

async function runOne(job: Claimed): Promise<void> {
  const p = (job.payload ?? {}) as { limit?: number; quoteId?: number; variant?: number };
  const quoteId = p.quoteId ? Number(p.quoteId) : null;
  const limit = Number(p.limit ?? 2);

  /** 단건(「다르게 한 번 더」)이면 그 시공만, 아니면 오늘치 여러 건 */
  const cliArgs = quoteId
    ? ["tsx", "scripts/blog-draft.ts", "--agent", "--quote", String(quoteId)].concat(
        p.variant ? ["--variant", String(p.variant)] : [],
      )
    : ["tsx", "scripts/blog-draft.ts", "--agent", "--limit", String(limit)];

  log(`요청 #${job.id} (${job.kind}, ${quoteId ? `판매 ${quoteId}` : `최대 ${limit}건`}) 시작`);
  await appendLog(
    job.id,
    quoteId ? "같은 시공으로 다시 만듭니다" : `원고 만들기를 시작합니다 (최대 ${limit}건)`,
  );

  // 원고 하나에 1~3분. 넉넉히 잡되 굳으면 반드시 끊는다.
  const timeoutMs = (quoteId ? 1 : limit) * 5 * 60_000 + 2 * 60_000;

  const draftIds: number[] = [];
  let errorMsg = "";

  const exit = await new Promise<number>((resolve) => {
    const child = spawn("npx", cliArgs, {
      shell: true,
      cwd: process.cwd(),
      env: { ...process.env, AI_PROVIDER: "cli" },
    });

    let buf = "";
    const onChunk = (c: Buffer) => {
      buf += c.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trimEnd();
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const idm = line.match(/^DRAFT_ID=(\d+)$/);
        if (idm) {
          draftIds.push(Number(idm[1]));
          continue; // 기계용 줄은 화면 로그에 안 보낸다
        }
        const em = line.match(/^ERROR=(.*)$/);
        if (em) {
          errorMsg = em[1];
          continue;
        }
        console.log(`  │ ${line}`);
        // 도구가 뱉는 잡음은 화면 로그에 안 올린다 — 사장님께 아무 뜻이 없다
        if (/injected env|dotenvx|npm warn|^\s*$/.test(line)) continue;
        void appendLog(job.id, line);
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);

    const kill = () => {
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      } else {
        child.kill("SIGKILL");
      }
    };
    // 화면에서 「중단」을 누르면 상태가 '실패'로 바뀐다 — 그때 프로세스 나무를 끊는다
    const watch = setInterval(() => {
      void sql`SELECT status FROM blog_job WHERE id=${job.id}`
        .then((r) => {
          if (r[0] && r[0].status === "실패") {
            log(`요청 #${job.id} — 화면에서 중단됨, 멈춥니다`);
            kill();
            clearInterval(watch);
          }
        })
        .catch(() => {});
    }, 15_000);
    const timer = setTimeout(() => {
      kill();
      resolve(124);
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      clearInterval(watch);
      resolve(code ?? 1);
    });
  });

  if (exit === 0 && draftIds.length > 0) {
    await sql`
      UPDATE blog_job SET status='완료', finished_at=now(), draft_ids=${sql.json(draftIds)}
      WHERE id=${job.id} AND status='실행중'`;
    log(`요청 #${job.id} 완료 — 초안 ${draftIds.length}건`);
  } else {
    const msg =
      errorMsg ||
      (exit === 124
        ? `시간이 너무 오래 걸려 멈췄습니다 (${Math.round(timeoutMs / 60_000)}분 초과)`
        : `원고를 만들지 못했습니다 (코드 ${exit})`);
    await sql`
      UPDATE blog_job SET status='실패', finished_at=now(), error=${msg}
      WHERE id=${job.id} AND status='실행중'`;
    log(`요청 #${job.id} 실패 — ${msg}`);
  }
}

async function main() {
  const version = claudeVersion();
  log(`블로그 원고 대리인이 켜졌습니다 — 앱의 「원고 만들기」 버튼을 기다립니다`);
  log(`클로드: ${version}`);
  log("끄려면 이 창에서 Ctrl+C");

  // 지난번에 죽으면서 「실행중」으로 굳은 것 정리
  await sql`
    UPDATE blog_job SET status='실패', finished_at=now(),
      error = COALESCE(error, '대리인이 다시 켜지며 중단 처리되었습니다')
    WHERE status='실행중'`;

  await beat(version);
  const heart = setInterval(() => void beat(version), HEARTBEAT_MS);
  heart.unref?.();

  for (;;) {
    try {
      const job = await claim();
      if (job) await runOne(job);
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
