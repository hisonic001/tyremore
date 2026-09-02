/**
 * 구독(Claude Max)으로 모델을 부르는 어댑터 — **매장 PC 전용** (2026-09-02)
 *
 * Anthropic API 키 대신 이 PC 에 로그인된 Claude Code 를 그대로 쓴다.
 * 요금이 따로 나가지 않는 대신, 이 코드는 **Vercel 에서는 절대 돌지 않는다**
 * (claude 실행파일이 거기 없다). scripts/blog-agent.ts 만 이 파일을 부른다.
 *
 * 🔴 여기서 지키는 것 세 가지
 *   ① 한글을 명령줄 인자로 보내지 않는다 — 지시문은 전부 **표준입력(UTF-8)** 으로.
 *      윈도우 argv 는 코드페이지를 타서 한글이 깨질 수 있다.
 *   ② `.cmd` 껍데기가 아니라 **claude.exe 를 직접** 부른다 (shell 없이).
 *      새 Node 는 shell 없이 .cmd 를 못 돌린다.
 *   ③ `--bare` 를 쓰지 않는다 — 그 옵션은 열쇠고리를 안 읽어 **구독 로그인이 깨진다**.
 *      대신 `--safe-mode` 로 개인 설정만 떼어낸다.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** 모델이 답을 JSON 한 덩어리로 주게 할 때 쓰는 표준 결과 */
export interface CliResult<T> {
  data: T;
  model: string;
  /** 「API 로 샀다면 이 값」 정가 표시 — 구독이라 실제 청구는 없다 */
  costUsd: number;
  durationMs: number;
}

/** claude 실행파일 찾기 — 못 찾으면 사장님이 읽을 말로 던진다 */
export function claudeCliPath(): string {
  if (process.env.CLAUDE_CLI && existsSync(process.env.CLAUDE_CLI)) return process.env.CLAUDE_CLI;

  const win = process.platform === "win32";
  const candidates = win
    ? [
        path.join(
          process.env.APPDATA ?? "",
          "npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe",
        ),
        path.join(os.homedir(), ".local/bin/claude.exe"),
        path.join(process.env.LOCALAPPDATA ?? "", "Programs/claude/claude.exe"),
      ]
    : [
        path.join(os.homedir(), ".local/bin/claude"),
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
      ];

  for (const c of candidates) if (c && existsSync(c)) return c;
  throw new Error(
    "매장 PC 에서 클로드(claude) 실행파일을 찾지 못했습니다 — " +
      "`npm i -g @anthropic-ai/claude-code` 로 설치했는지 확인해 주세요",
  );
}

/**
 * 사장님이 읽을 한국어 한 줄로 바꾼다.
 * 🔴 CLI 는 우리 계약이 아니라 언젠가 말이 바뀐다. 못 알아들으면 원문을 그대로 보여준다.
 */
export function humanError(exitCode: number, stderr: string, stdout: string): string {
  const t = `${stderr}\n${stdout}`.toLowerCase();
  if (exitCode === 124) return "시간이 너무 오래 걸려 멈췄습니다 — 사진 수를 줄이고 다시 눌러 주세요";
  if (/usage limit|rate limit|quota|too many requests|429/.test(t))
    return "클로드 사용량이 찼습니다 — 몇 시간 뒤에 다시 눌러 주세요 (사장님이 대화에 쓰신 양과 함께 계산됩니다)";
  if (/not logged in|please run .*login|unauthorized|401|authentication|invalid api key/.test(t))
    return "매장 PC 의 클로드 로그인이 풀렸습니다 — 그 PC 에서 `claude` 를 한 번 실행해 로그인해 주세요";
  if (/credit balance|billing/.test(t))
    return "클로드 계정에 문제가 있습니다 (결제·크레딧) — 콘솔에서 확인이 필요합니다";
  if (/enoent|not found/.test(t))
    return "매장 PC 에서 클로드 실행파일을 찾지 못했습니다";
  const first = (stderr.trim() || stdout.trim()).split("\n")[0] ?? "";
  return `원고를 만들지 못했습니다 (코드 ${exitCode})${first ? ` — ${first.slice(0, 160)}` : ""}`;
}

/** ```json 울타리가 씌워져 나온 경우 벗겨낸다 */
function stripFence(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : s).trim();
}

interface CliEnvelope {
  result?: string;
  is_error?: boolean;
  subtype?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  modelUsage?: Record<string, { outputTokens?: number; costUSD?: number }>;
}

/**
 * 어느 모델이 **실제로 글을 썼나**.
 * 🔴 첫 번째 키를 쓰면 안 된다 — 클로드 코드가 곁다리 일(요약 등)에 쓰는 작은 모델이
 *    먼저 올 수 있다. 실제로 초안 #1·#2 가 haiku 로 잘못 기록됐다 (2026-09-02).
 *    글을 쓴 쪽은 출력 토큰이 압도적으로 많으므로 그것으로 고른다.
 */
function mainModel(usage: CliEnvelope["modelUsage"], fallback: string): string {
  const entries = Object.entries(usage ?? {});
  if (entries.length === 0) return fallback;
  return entries.sort((a, b) => (b[1]?.outputTokens ?? 0) - (a[1]?.outputTokens ?? 0))[0][0];
}

/** claude -p 를 한 번 돌린다. 표준입력으로 지시문을 넣고 stdout 을 통째로 돌려받는다 */
function runClaude(opts: {
  prompt: string;
  args: string[];
  timeoutMs: number;
  onLog?: (line: string) => void;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  const exe = claudeCliPath();
  return new Promise((resolve) => {
    const child = spawn(exe, opts.args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr.on("data", (c: Buffer) => {
      const s = c.toString("utf8");
      stderr += s;
      for (const raw of s.split("\n")) {
        // 색 코드를 벗기고, 사장님께 아무 뜻 없는 잡음은 화면 로그에 안 올린다
        const line = raw.replace(/\[[0-9;]*m/g, "").trim();
        if (!line) continue;
        if (/Ignoring \d+ permissions|trust dialog|hasTrustDialogAccepted/.test(line)) continue;
        opts.onLog?.(`  claude: ${line}`);
      }
    });

    const kill = () => {
      if (process.platform === "win32" && child.pid) {
        // child.kill() 은 겉껍데기만 죽인다 (mars-agent 의 교훈) — 나무 전체를 끊는다
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      } else {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      kill();
      resolve({ code: 124, stdout, stderr });
    }, opts.timeoutMs);

    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${(e as Error).message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });

    // 🔴 한글이 깨지지 않게 UTF-8 바이트로 그대로 밀어 넣는다
    child.stdin.write(Buffer.from(opts.prompt, "utf8"));
    child.stdin.end();
  });
}

/**
 * 모델이 JSON 한 덩어리로 답하게 하고 그대로 파싱한다 (ai.ts 의 generateJson 과 같은 계약).
 *
 * `--json-schema` 로 형식을 강제하되, 그래도 어긋나면 울타리 벗기기 → 스키마 없이 재시도
 * 순으로 두 번까지 시도한다.
 */
export async function generateJsonViaCli<T>(opts: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  /** 기본 "opus" — 별명이라 판번호가 올라가도 따라간다 */
  model?: string;
  timeoutMs?: number;
  onLog?: (line: string) => void;
}): Promise<CliResult<T>> {
  const model = opts.model ?? "opus";
  const timeoutMs = opts.timeoutMs ?? 6 * 60_000;

  /**
   * 🔴 인자는 전부 ASCII 여야 한다 (한글은 stdin 으로). 스키마도 영문 키만 쓴다.
   * --safe-mode: 사장님 개인 설정·훅·MCP 를 떼어낸다 (구독 로그인은 그대로)
   * --tools "" : 도구 없이 글만 쓰게 한다 (파일을 뒤지지 않는다)
   */
  const baseArgs = [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--effort",
    opts.effort ?? "medium",
    "--safe-mode",
    "--tools",
    "",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--max-budget-usd",
    "3",
  ];

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const withSchema = attempt === 0;
    const args = withSchema
      ? [...baseArgs, "--json-schema", JSON.stringify(opts.schema)]
      : [...baseArgs];

    const prompt = withSchema
      ? `${opts.system}\n\n---\n\n${opts.user}`
      : `${opts.system}\n\n---\n\n${opts.user}\n\n` +
        "위 내용을 아래 JSON 스키마에 정확히 맞는 **JSON 한 덩어리만** 출력하세요. " +
        "설명·머리말·코드 울타리 없이 `{` 로 시작해 `}` 로 끝나야 합니다.\n" +
        JSON.stringify(opts.schema);

    opts.onLog?.(
      `클로드에 보내는 중 (${model}, ${attempt === 0 ? "형식 강제" : "재시도 — 형식 강제 없이"})`,
    );
    const { code, stdout, stderr } = await runClaude({ prompt, args, timeoutMs, onLog: opts.onLog });

    if (code !== 0) {
      lastErr = humanError(code, stderr, stdout);
      // 사용량·로그인 문제는 다시 시도해도 같다 — 바로 던진다
      if (code === 124 || /사용량|로그인|결제|실행파일/.test(lastErr)) throw new Error(lastErr);
      continue;
    }

    let env: CliEnvelope;
    try {
      env = JSON.parse(stdout) as CliEnvelope;
    } catch {
      lastErr = `클로드 답을 읽지 못했습니다: ${stdout.slice(0, 160)}`;
      continue;
    }
    if (env.is_error || env.subtype !== "success" || !env.result) {
      lastErr = humanError(1, stderr, env.result ?? stdout);
      continue;
    }

    try {
      const data = JSON.parse(stripFence(env.result)) as T;
      const usedModel = mainModel(env.modelUsage, model);
      opts.onLog?.(
        `받았습니다 (${Math.round((env.duration_ms ?? 0) / 1000)}초, 정가 환산 $${(env.total_cost_usd ?? 0).toFixed(3)} — 구독이라 청구 없음)`,
      );
      return {
        data,
        model: usedModel,
        costUsd: env.total_cost_usd ?? 0,
        durationMs: env.duration_ms ?? 0,
      };
    } catch {
      lastErr = `모델 답을 JSON 으로 읽지 못했습니다: ${env.result.slice(0, 160)}`;
    }
  }

  throw new Error(lastErr || "원고를 만들지 못했습니다");
}
