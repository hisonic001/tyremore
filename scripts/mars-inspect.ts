import { config } from "dotenv";
config({ path: ".env.local" });

import { execSync } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";

/**
 * 「연락 고객 차량 생성」 화면이 실제로 어떻게 생겼는지 훑는다.
 *
 * 🔴 아무것도 저장하지 않는다. 마지막에 「취소」를 누른다.
 */
const SIGNIN = "https://mars.tyremore.co.kr/MARS/SignIn?ReturnUrl=%2FMARS%2F%3Ftenant%3D61168583";

async function main() {
  const dir =
    process.env.MARS_PROFILE_DIR ?? path.resolve(process.cwd(), "..", "tyremore-data", "chrome-mars");
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*${path.basename(dir)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: "ignore", timeout: 20000 },
    );
  } catch {}

  const ctx = await chromium.launchPersistentContext(dir, {
    headless: false,
    channel: "chrome",
    viewport: null,
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(20000);
  const f = page.frameLocator('iframe[title="Main Content"]');

  const passDialog = async () => {
    const ask = f.getByText("50개 이상의 레코드", { exact: false }).first();
    if (await ask.isVisible().catch(() => false)) {
      await f.getByRole("button", { name: "예", exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(2500);
    }
  };

  console.log("MARS 를 엽니다…");
  await page.goto(SIGNIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const okBtn = f.getByRole("button", { name: "확인" }).first();
  if (await okBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
    await okBtn.click().catch(() => {});
    await page.waitForTimeout(3000);
  }
  await f.getByRole("button", { name: "고객 정보 검색" }).first().waitFor({ timeout: 60000 });
  console.log("시작 화면 준비됨");

  await f.getByRole("button", { name: "고객 정보 검색" }).first().click();
  await passDialog();
  await page.waitForTimeout(2000);
  await passDialog();

  console.log("「연락처/고객/차량을 생성합니다」를 엽니다…");
  await f.getByRole("button", { name: "연락처/고객/차량을 생성합니다" }).first().click();
  await page.waitForTimeout(4000);
  await passDialog();

  // 「고객 서명」 셀렉트가 무엇을 고를 수 있는지
  console.log("\n── 「고객 서명」 고를 수 있는 값 ──");
  const sel = f.getByRole("combobox", { name: "고객 서명" });
  const n = await sel.count().catch(() => 0);
  console.log(`   셀렉트 ${n}개`);
  for (let i = 0; i < n; i++) {
    const opts = await sel
      .nth(i)
      .evaluate((el) => Array.from((el as HTMLSelectElement).options).map((o) => `${o.value}|${o.label}`))
      .catch(() => ["(select 가 아님)"]);
    const cur = await sel.nth(i).inputValue().catch(() => "?");
    console.log(`   [${i}] 현재="${cur}"  고를 수 있는 값: ${JSON.stringify(opts)}`);
  }

  console.log("\n── 동의 표의 열 이름 ──");
  const heads = f.getByRole("columnheader");
  const hn = await heads.count().catch(() => 0);
  for (let i = 0; i < Math.min(hn, 25); i++) {
    const t = (await heads.nth(i).textContent().catch(() => ""))?.replace(/\s+/g, " ").trim();
    if (t) console.log(`   ${t}`);
  }

  console.log("\n── 동의 표의 행과 체크 상태 ──");
  for (const key of ["비즈니스 목적의 동의", "마케팅 및 광고 목적의 동의", "제3자 제공 및 국외 이전에 대한 동의"]) {
    const row = f.getByRole("row").filter({ hasText: key }).first();
    if (!(await row.isVisible().catch(() => false))) {
      console.log(`   ${key} → 행을 못 찾음`);
      continue;
    }
    const cells = row.getByRole("gridcell");
    const cn = await cells.count().catch(() => 0);
    const parts: string[] = [];
    for (let i = 0; i < cn; i++) {
      const name = (await cells.nth(i).getAttribute("aria-label").catch(() => null)) ?? "";
      const cb = cells.nth(i).locator("[role=checkbox]");
      const has = (await cb.count().catch(() => 0)) > 0;
      const state = has ? await cb.first().getAttribute("aria-checked").catch(() => "?") : null;
      parts.push(has ? `${name.slice(0, 24)}=${state}` : `${name.slice(0, 24)}`);
    }
    console.log(`   ${key}`);
    for (const p of parts) console.log(`      ${p}`);
  }

  console.log("\n🔴 아무것도 저장하지 않고 「취소」를 누릅니다");
  await f.getByRole("button", { name: "취소", exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(2000);
  console.log("끝. 창은 열어 둡니다 (Ctrl+C 로 닫기)");
  await new Promise(() => {});
}
main();
