import { config } from "dotenv";
config({ path: ".env.local" });

import { execSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

/**
 * ⭐ 사장님이 MARS 를 쓰시는 것을 **보고 배운다** (사장님 제안 2026-08-02)
 *
 *   "그냥 니가 로그인만 해주면 내가 어떻게 하는지 보여줄테니까
 *    모니터링 하면서 순서와 입력해야하는 것들을 확인해줄래?"
 *
 * 화면을 추측으로 더듬는 것보다 훨씬 빠르고 정확하다.
 * 로그인된 창을 열어 드리고, 누르시는 것·치시는 것을 그대로 받아 적는다.
 *
 * 🔴 이 프로그램은 **아무것도 누르지 않는다.** 보기만 한다.
 * 🔴 비밀번호 칸은 값을 적지 않는다.
 * ⚠️ 기록에는 손님 이름·전화 같은 개인정보가 들어간다.
 *    tyremore-data 안에만 두고 저장소에 올리지 않는다.
 */

const SIGNIN = "https://mars.tyremore.co.kr/MARS/SignIn?ReturnUrl=%2FMARS%2F%3Ftenant%3D61168583";

const OUT = path.resolve(process.cwd(), "..", "tyremore-data", "mars-따라하기.log");

/** 화면 안에 심을 감시자 — 모든 프레임에서 돈다 */
const WATCHER = `
(() => {
  if (window.__marsWatch) return;
  window.__marsWatch = true;

  const nameOf = (el) => {
    if (!el || !el.getAttribute) return "";
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = document.getElementById(lb);
      if (t) return (t.textContent || "").trim();
    }
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return (l.textContent || "").trim();
    }
    const txt = (el.textContent || "").replace(/\\s+/g, " ").trim();
    return txt.slice(0, 60);
  };

  const describe = (el) => {
    if (!el) return "?";
    const bits = [];
    const role = el.getAttribute("role") || el.tagName.toLowerCase();
    bits.push(role);
    const n = nameOf(el);
    if (n) bits.push('"' + n + '"');
    const cn = el.closest("[controlname]");
    if (cn) bits.push("controlname=" + cn.getAttribute("controlname"));
    const row = el.closest("tr");
    if (row) {
      const rt = (row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 70);
      if (rt) bits.push("행<" + rt + ">");
    }
    return bits.join(" ");
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("button,[role=button],[role=menuitem],a,[role=checkbox],[role=option],td,th,input,select") || e.target;
    console.log("[REC] 클릭 :: " + describe(el));
  }, true);

  document.addEventListener("change", (e) => {
    const el = e.target;
    const v = el.type === "password" ? "***" : (el.value ?? "").toString().slice(0, 60);
    console.log("[REC] 입력 :: " + describe(el) + " = " + JSON.stringify(v));
    if (el.tagName === "SELECT") {
      const opts = Array.from(el.options || []).map((o) => o.label);
      console.log("[REC]   고를수있던값 :: " + JSON.stringify(opts));
    }
  }, true);

  console.log("[REC] --- 감시 시작: " + location.href.slice(0, 90));
})();
`;

async function main() {
  const dir =
    process.env.MARS_PROFILE_DIR ?? path.resolve(process.cwd(), "..", "tyremore-data", "chrome-mars");
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*${path.basename(dir)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: "ignore", timeout: 20000 },
    );
  } catch {
    /* 없으면 그만 */
  }

  writeFileSync(OUT, `MARS 따라하기 기록 — ${new Date().toLocaleString("ko-KR")}\n\n`, "utf8");

  const ctx = await chromium.launchPersistentContext(dir, {
    headless: false,
    channel: "chrome",
    viewport: null,
    args: ["--start-maximized"],
  });

  await ctx.addInitScript(WATCHER);

  const page = ctx.pages()[0] ?? (await ctx.newPage());

  // 이미 열려 있는 프레임에도 심는다 (addInitScript 는 다음 이동부터 걸린다)
  const inject = async () => {
    for (const fr of page.frames()) await fr.evaluate(WATCHER).catch(() => {});
  };
  page.on("framenavigated", () => void inject());

  let n = 0;
  page.on("console", (m) => {
    const t = m.text();
    if (!t.startsWith("[REC]")) return;
    const line = t.replace(/^\[REC\]\s*/, "");
    n++;
    const stamp = new Date().toLocaleTimeString("ko-KR");
    const out = `${String(n).padStart(3, "0")}  ${stamp}  ${line}`;
    console.log(out);
    appendFileSync(OUT, out + "\n", "utf8");
  });

  console.log("MARS 를 엽니다…");
  await page.goto(SIGNIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await inject();

  console.log("");
  console.log("=".repeat(64));
  console.log("  창이 열렸습니다. 평소 하시던 대로 해 주세요.");
  console.log("  누르시는 것과 치시는 것을 그대로 받아 적습니다.");
  console.log("");
  console.log("  🔴 이 프로그램은 아무것도 누르지 않습니다. 보기만 합니다.");
  console.log("  🔴 전기(Posting)까지 하셔도 됩니다 — 사장님이 누르시는 것이니까요.");
  console.log("");
  console.log(`  기록: ${OUT}`);
  console.log("  다 하시면 알려 주세요. (Ctrl+C 로 끝냅니다)");
  console.log("=".repeat(64));
  console.log("");

  // 프레임이 새로 뜰 때마다 다시 심는다
  setInterval(() => void inject(), 4000);
  await new Promise(() => {});
}
main();
