import { config } from "dotenv";
config({ path: ".env.local" });

import { createHash } from "node:crypto";
import { readdir, readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * ⭐ 인보이스 자동 수집기 (사장님 요청 2026-08-02)
 *
 *   "매입입고 → 인보이스 올리기, 자동으로 하는 버튼을 만들어도 괜찮을 것 같아."
 *
 * 사장님이 미쉐린·콘티넨탈·금호 사이트에서 엑셀을 **내려받기만 하면**
 * 이 프로그램이 알아서 읽어 「입고 예정」에 올려 놓는다.
 * 앱을 열어 파일을 고르고 올리는 절차가 통째로 없어진다.
 *
 * ⚠️ 이 스크립트는 **사장님 PC에서 돈다.** Vercel(웹서버)은 PC의 다운로드 폴더를
 *    볼 수 없기 때문이다. 대신 데이터베이스는 같은 곳(Supabase)을 쓰므로
 *    여기서 저장하면 웹 화면에 바로 나타난다.
 *
 * 🔴 사장님 파일을 **옮기거나 지우지 않는다.** 다운로드 폴더에는 인보이스가 아닌
 *    파일이 훨씬 많다. 읽어 보기만 하고 그대로 둔다. 무엇을 이미 읽었는지는
 *    따로 기록해 둔다.
 *
 * 🔴 **처음 켤 때는 아무것도 올리지 않는다.**
 *    다운로드 폴더에는 몇 달 치 인보이스가 쌓여 있다. 그것을 다 올리면
 *    이미 도착해서 팔린 타이어가 「입고 예정」으로 뜬다 —
 *    실제로 그런 일이 있었다 (2026-08-02, 5~7월 657본).
 *    그래서 처음 한 번은 **지금 있는 파일을 기록만** 해 두고,
 *    그 뒤에 새로 받는 것부터 올린다.
 *    지난 것을 일부러 불러오시려면 `--catchup` 을 붙인다.
 *
 * 쓰는 법
 *   npm run collect             지켜보기 (계속 떠 있음, 30초마다 확인)
 *   npm run collect -- --once      한 번만 훑고 끝 (작업 스케줄러용)
 *   npm run collect -- --catchup   지난 인보이스도 불러오기 (처음 한 번만, 일부러)
 */

const ONCE = process.argv.includes("--once");
const CATCHUP = process.argv.includes("--catchup");
const EVERY_MS = 30_000;

/** 인보이스가 내려오는 곳. 다른 폴더도 보려면 .env.local 에 COLLECT_DIRS 로 추가 */
const DIRS = [
  path.join(homedir(), "Downloads"),
  ...(process.env.COLLECT_DIRS ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean),
];

/**
 * 처음 켰을 때 다운로드 폴더 전체를 뒤지면 몇 년 치 엑셀을 다 열어 본다.
 * 최근 것만 본다 (.env.local 의 COLLECT_DAYS 로 조절).
 */
const DAYS = Number(process.env.COLLECT_DAYS ?? 21);

const STATE_FILE =
  process.env.COLLECT_STATE ?? path.resolve(process.cwd(), "..", "tyremore-data", "collect-state.json");

interface Seen {
  /** 내용 해시 → 결과. 파일 이름을 바꾸거나 다시 받아도 두 번 읽지 않는다 */
  [hash: string]: { at: string; file: string; result: string };
}

async function loadState(): Promise<Seen> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as Seen;
  } catch {
    return {};
  }
}

async function saveState(s: Seen) {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(s, null, 2), "utf8");
}

/** 엑셀·PDF만 본다. 받다 만 파일과 엑셀 임시파일(~$)은 건너뛴다 */
function candidate(name: string): boolean {
  if (name.startsWith("~$") || name.startsWith(".")) return false;
  return /\.(xlsx?|pdf)$/i.test(name);
}

const stamp = () => new Date().toLocaleTimeString("ko-KR");

/**
 * @param baseline 참이면 **읽기만 하고 올리지 않는다.** 지금 있는 파일을 기준선으로 기록한다.
 */
async function sweep(seen: Seen, baseline = false): Promise<number> {
  const { saveInvoice } = await import("../src/lib/invoice");
  const cutoff = Date.now() - DAYS * 86_400_000;
  let saved = 0;

  for (const dir of DIRS) {
    if (!existsSync(dir)) {
      console.log(`  (없는 폴더 건너뜀: ${dir})`);
      continue;
    }
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (e) {
      console.log(`  ⚠️ ${dir} 를 못 읽었습니다: ${(e as Error).message}`);
      continue;
    }

    for (const name of names) {
      if (!candidate(name)) continue;
      const full = path.join(dir, name);

      let size = 0;
      try {
        const st = await stat(full);
        if (!st.isFile() || st.mtimeMs < cutoff) continue;
        size = st.size;
      } catch {
        continue; // 읽는 사이에 사라졌다
      }
      if (size === 0 || size > 25 * 1024 * 1024) continue;

      let buf: Buffer;
      try {
        buf = await readFile(full);
      } catch {
        continue; // 아직 받는 중이라 잠겨 있다 — 다음 차례에 다시 본다
      }
      const hash = createHash("sha1").update(buf).digest("hex");
      if (seen[hash]) continue;

      if (baseline) {
        seen[hash] = { at: new Date().toISOString(), file: name, result: "기준선 — 올리지 않음" };
        saved++; // 기준선 모드에서는 「기록한 개수」로 쓴다
        continue;
      }

      const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      const r = await saveInvoice(name, bytes, { updatePrices: true });

      if (r.ok) {
        saved += r.saved;
        console.log(
          `  ✅ ${name} — 인보이스 ${r.saved}건 등록` +
            (r.skipped ? ` (이미 있던 것 ${r.skipped}건)` : "") +
            (r.priceUpdates ? ` · 기표가·할인율 ${r.priceUpdates}건 갱신` : ""),
        );
        seen[hash] = { at: new Date().toISOString(), file: name, result: `등록 ${r.saved}건` };
      } else {
        /**
         * 인보이스가 아닌 엑셀이 훨씬 많다 (재고표·견적서·남의 자료…).
         * 조용히 기억만 하고 넘어간다 — 매번 다시 열어 보지 않도록.
         */
        seen[hash] = { at: new Date().toISOString(), file: name, result: r.error };
        if (!/알아보지 못했습니다|이미 등록된/.test(r.error)) {
          console.log(`  · ${name} — ${r.error}`);
        }
      }
      await saveState(seen);
    }
  }
  return saved;
}

async function main() {
  console.log("인보이스 자동 수집기");
  console.log(`  지켜보는 곳: ${DIRS.join("  ·  ")}`);
  console.log(`  최근 ${DAYS}일 안에 받은 엑셀·PDF만 봅니다`);
  console.log(`  기록: ${STATE_FILE}\n`);

  const seen = await loadState();
  const first = Object.keys(seen).length === 0;

  if (first && !CATCHUP) {
    /**
     * 🔴 처음 켰다 — 지금 있는 것은 올리지 않는다. 위 주석 참조.
     */
    console.log("처음 켜셨습니다. 지금 폴더에 있는 파일은 **올리지 않고 기록만** 합니다.");
    console.log("이미 도착해서 팔린 타이어가 「입고 예정」으로 뜨는 것을 막기 위해서입니다.\n");
    const marked = await sweep(seen, true);
    await saveState(seen);
    console.log(`  기준선 ${marked}개 기록\n`);
    console.log("이제부터 **새로 받는 인보이스**만 올라갑니다.");
    console.log("지난 것도 일부러 불러오시려면:  npm run collect -- --catchup\n");
  } else {
    console.log(`[${stamp()}] 확인 중…`);
    const n = await sweep(seen);
    console.log(`[${stamp()}] ${n > 0 ? `${n}건 등록했습니다` : "새 인보이스 없음"}`);
  }

  if (ONCE) process.exit(0);

  console.log(`\n지켜보는 중입니다. 파일을 내려받으면 알아서 올라갑니다. (끝내려면 Ctrl+C)`);
  setInterval(() => {
    void (async () => {
      const got = await sweep(seen);
      if (got > 0) console.log(`[${stamp()}] ${got}건 등록했습니다`);
    })();
  }, EVERY_MS);
}

main();
