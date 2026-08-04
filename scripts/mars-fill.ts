import { config } from "dotenv";
config({ path: ".env.local" });

import { execSync } from "node:child_process";
import path from "node:path";
import { chromium, type FrameLocator, type Locator, type Page } from "playwright";

/**
 * ⭐ MARS 자동 입력 (사장님 요청 2026-08-02)
 *
 *   "MARS 자동 입력의 경우 전에 언급했던 github에 저장된 MARS-auto-register
 *    참고하면 좋을 것임. 이전도 어느정도 작동했었던 코드임."
 *
 * 사장님이 먼저 만들어 두신 파이썬 코드(hisonic001/MARS-auto-register)의
 * 화면 조작 순서와 선택자를 그대로 가져왔다. 달라진 것은 **읽어 오는 곳**이다.
 *
 *   전:  customers.xlsm  (사람이 엑셀에 옮겨 적어야 했다)
 *   후:  판매 등록 화면   (팔면서 이미 기록된 것을 그대로 쓴다)
 *
 * 엑셀 중간 단계가 사라진다. 그리고 우리 쪽에는 이미
 * **MARS 품번**과 **부가세 포함 단가**가 들어 있어 그대로 넣으면 된다.
 *
 * 🔴 전기(Posting)는 하지 않는다 (D-08).
 *    매출 주문을 만들어 채워 두기만 한다. 사장님이 MARS 에서 확인하고 직접 전기한다.
 *    사장님 파이썬 코드도 최종 「확인」 직전에 page.pause() 로 멈춰 있었다 — 같은 원칙이다.
 *
 * ⚠️ 이 스크립트는 **사장님 PC에서 돈다.** 아이디·비밀번호는 `.env.local` 에만 두고
 *    깃허브에도 Vercel 에도 올리지 않는다.
 *
 * 쓰는 법
 *   npm run mars                        대기열 전부 처리 (브라우저가 보이게 열린다)
 *   npm run mars -- --dry               대기열만 보여주고 브라우저도 안 연다
 *   npm run mars -- --limit 1           한 건만
 *   npm run mars -- --check             전기 후 차량 점검 (전기가 끝난 건 대상)
 *   npm run mars -- --check --look      👀 전기됐는지 **보기만** 하고 아무것도 제출 안 함
 */

const SIGNIN =
  "https://mars.tyremore.co.kr/MARS/SignIn?ReturnUrl=%2FMARS%2F%3Ftenant%3D61168583";

/**
 * 🔴 시작 화면으로 돌아갈 때 **`?tenant=` 를 빼면 안 된다** (2026-08-04).
 *
 * 한 건을 끝내고 `https://mars.tyremore.co.kr/MARS/` 로 갔더니 Azure AD 가
 *   「Something went wrong. WSFederationLoginEndpoint 구성 설정의 값은 비워둘 수 없습니다.
 *    Azure AD tenant: **null**」
 * 로 튕겼다. 그래서 **첫 건은 되고 두 번째부터 「판매완료를 누르지 못했습니다」** 로 죽었다.
 * 한 건씩만 돌릴 때는 드러나지 않던 문제다.
 */
const HOME = "https://mars.tyremore.co.kr/MARS/?tenant=61168583";

const DRY = process.argv.includes("--dry");
/** 고객 생성 화면이 실제로 어떻게 생겼는지만 훑고 취소한다 — 아무것도 저장하지 않는다 */
const INSPECT = process.argv.includes("--inspect");
/**
 * ⭐ 전기 후 차량 점검 모드 (사장님 지시 2026-08-02 — "이것도 꼭 해야 하는 작업이야")
 *    전기가 끝나야 들어갈 수 있는 화면이라 매출 주문 입력과 따로 돌린다.
 *      npm run mars -- --check
 */
const CHECK = process.argv.includes("--check");
/**
 * ⭐ 「보기만」 — 송장을 찾는 데까지만 하고 **아무것도 제출하지 않는다** (2026-08-04).
 *    전기가 됐는지, 어느 송장이 걸리는지 눈으로 먼저 보려고 둔다.
 *      npm run mars -- --check --look
 */
const LOOK = process.argv.includes("--look");
/**
 * 🔴 전기(Posting)는 하지 않는다 — 사장님이 마지막에 검토하고 누르신다 (2026-08-02 지시).
 *    매출 주문을 채워 두기만 하고, 금액이 맞는지 대조해서 보여 준다.
 */
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) || 1 : Infinity;
})();

/** MARS 는 모든 화면이 이 iframe 안에 있다 */
const main = (page: Page): FrameLocator => page.frameLocator('iframe[title="Main Content"]');

/** 값이 채워져도 화면이 못 알아채는 칸이 있다 — 사장님 코드에서 쓰던 방법 그대로 */
const SET_VALUE =
  "(el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }";

/**
 * 🔴 `controlname` 이 붙은 것은 **감싸는 상자일 때도, 입력칸 자체일 때도** 있다 (2026-08-02).
 *
 * 상자에 값을 넣으려다 「Element is not an <input>…」 으로 죽었고,
 * 반대로 입력칸인데 안쪽 input 을 찾다 못 찾아서 「값이 지워졌다」고 오판하기도 했다
 * (그래서 주행거리를 두 번 넣었다). 두 경우를 한 곳에서 가린다.
 */
async function resolveInput(loc: Locator): Promise<Locator> {
  const el = loc.first();
  const tag = (await el.evaluate((e) => e.tagName).catch(() => "")) || "";
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return el;
  const inner = el.locator("input, textarea").first();
  return (await inner.count().catch(() => 0)) > 0 ? inner : el;
}

/** 칸의 현재 값을 읽는다 — 상자든 입력칸이든 같은 방식으로 */
async function readField(loc: Locator): Promise<string> {
  const el = await resolveInput(loc);
  return (await el.inputValue().catch(() => "")) || "";
}

/**
 * 🔴 칸 하나를 채우고 **들어갔는지 확인한다** (2026-08-02).
 *
 * 전에는 `.fill(...).catch(() => {})` 로 실패를 조용히 삼켰다.
 * 그래서 주행거리가 안 들어갔는데 아무 말 없이 넘어갔고,
 * 사장님이 화면을 보고 알려주셔야 알았다. 다시는 그러지 않는다.
 *
 * MARS 칸은 대부분 **먼저 눌러야** 값이 들어간다.
 */
async function fillField(
  page: Page,
  label: string,
  loc: Locator,
  value: string,
  /**
   * ⚠️ Tab 을 누를지. **기본은 누른다** — 그래야 MARS 가 값을 받아들이고
   *    「평균 주행거리/월」 같은 것을 계산한다.
   *
   * 🔴 그런데 칸마다 누르면 안 되는 데가 있다. 매출 주문의 「현재 주행거리」는
   *    넣자마자 Tab 을 누르면 MARS 가 화면을 다시 그리며 **값을 지운다** (2026-08-02).
   *    사장님 파이썬 코드도 주행거리·문서날짜는 그냥 채우고
   *    **완료 일자에서 한 번만** Tab 을 눌렀다. 그 순서가 맞다.
   */
  opts: { tab?: boolean } = {},
): Promise<boolean> {
  let el = loc.first();
  if (!(await el.isVisible({ timeout: 6000 }).catch(() => false))) {
    log(`    ⚠️ 「${label}」 칸을 못 찾았습니다`);
    return false;
  }

  /**
   * 🔴 **누른 다음에 찾는다** (2026-08-02).
   *    BC 표·양식은 칸을 클릭해야 비로소 안에 `<input>`·`<select>` 가 생긴다.
   *    누르기 전에 찾으면 껍데기만 잡혀서 값이 안 들어간다.
   *    품목 표의 「유형」이 두 줄 다 실패한 원인이 이것이었다.
   */
  await el.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(300);
  el = await resolveInput(el);
  const filled = await el.fill(value).then(() => true).catch(() => false);
  if (!filled) {
    // fill 이 안 되는 칸은 값을 직접 넣고 change 를 쏜다
    await el.evaluate(SET_VALUE, value).catch(() => {});
  }
  if (opts.tab !== false) await el.press("Tab").catch(() => {});
  await page.waitForTimeout(500);

  const got = (await el.inputValue().catch(() => "")) || "";
  const ok = got.replace(/[\s,]/g, "").includes(value.replace(/[\s,]/g, ""));
  if (!ok) log(`    ⚠️ 「${label}」에 «${value}» 를 넣었는데 «${got}» 입니다`);
  return ok;
}

const log = (s: string) => console.log(s);

/**
 * ⭐ 같은 이름이 button 으로도 menuitem 으로도 있다 (2026-08-02 화면 훑어서 확인).
 *   「고객 정보 검색」·「매출 주문」이 그렇다. 어느 쪽이든 되는 것을 누른다.
 */
async function clickAny(page: Page, name: string, timeout = 20000): Promise<void> {
  const f = main(page);
  const cands = [
    f.getByRole("button", { name, exact: true }),
    f.getByRole("menuitem", { name, exact: true }),
    f.getByRole("button", { name }),
    f.getByRole("menuitem", { name }),
  ];
  const until = Date.now() + timeout;
  let last = "";
  while (Date.now() < until) {
    for (const c of cands) {
      const el = c.first();
      if (!(await el.isVisible().catch(() => false))) continue;
      try {
        await el.click({ timeout: 4000 });
        return;
      } catch (e) {
        last = (e as Error).message.split("\n")[0];
      }
    }
    await page.waitForTimeout(700);
  }
  throw new Error(`「${name}」을 누르지 못했습니다${last ? ` (${last})` : ""}`);
}

/**
 * 🔴 시작 화면이 준비될 때까지 기다린다.
 *
 * 첫 시도가 여기서 죽었다 — 로그인 팝업을 닫자마자 바로 눌렀더니
 * 화면이 아직 그려지는 중이라 30초를 기다리다 실패했다 (2026-08-02).
 * 「고객 정보 검색」이 실제로 보일 때까지 기다리고, 그 사이 뜨는 팝업은 닫는다.
 */
async function waitHome(page: Page, timeout = 90000): Promise<boolean> {
  const f = main(page);
  const anchor = f.getByRole("button", { name: "고객 정보 검색" }).first();
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await anchor.isVisible().catch(() => false)) {
      await page.waitForTimeout(800); // 그려지는 것을 마저 기다린다
      return true;
    }
    // 걸리적거리는 팝업이 있으면 닫는다
    for (const n of ["확인", "닫기"]) {
      const b = f.getByRole("button", { name: n, exact: true }).first();
      if (await b.isVisible().catch(() => false)) {
        await b.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(1200);
      }
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

/**
 * ⭐ 로그인 (사장님 확인 2026-08-02)
 *   "mars_id와 password는 필요없음. 어차피 자동 로그인이 설정되어서
 *    링크로 이동하면 바로 mars 시작 화면이 크롬에서 켜질 것임."
 *
 * 🔴 그런데 그 자동 로그인은 **사장님 Chrome 프로필**에 저장돼 있다.
 *    Playwright 는 기본적으로 **빈 프로필**로 새 브라우저를 띄우므로 그대로는 안 된다.
 *    그래서 전용 프로필 폴더를 하나 두고 계속 쓴다 —
 *    **처음 한 번만** 사장님이 창에서 로그인하시면 그 뒤로는 저절로 들어간다.
 *
 * 아이디·비밀번호를 .env.local 에 넣어 두셨으면 그것으로 채운다. 없으면 기다린다.
 */
async function login(page: Page): Promise<boolean> {
  log("MARS 를 엽니다…");
  await page.goto(SIGNIN, { waitUntil: "domcontentloaded" });

  const idBox = page.locator("input#UserName");
  const frameReady = () => main(page).getByRole("button", { name: "확인" }).first();

  // 이미 로그인돼 있으면 시작 화면이 바로 뜬다
  const already = await frameReady()
    .waitFor({ timeout: 12000 })
    .then(() => true)
    .catch(() => false);

  if (!already && (await idBox.isVisible().catch(() => false))) {
    const id = process.env.MARS_ID;
    const pw = process.env.MARS_PASSWORD;
    if (id && pw) {
      log("  로그인 화면입니다 — .env.local 의 계정으로 들어갑니다");
      await idBox.fill(id);
      await page.locator("input#Password").fill(pw);
      await page.locator("button#submitButton").click();
    } else {
      /**
       * 🔴 비밀번호를 대신 치지 않는다. 사장님이 창에서 직접 로그인하신다.
       *    한 번만 하시면 프로필에 남아 다음부터는 안 물어본다.
       */
      log("");
      log("  ".padEnd(58, "─"));
      log("  🔑 뜬 창에서 직접 로그인해 주세요.");
      log("     이 프로필은 그대로 남아서 다음부터는 안 물어봅니다.");
      log("     로그인이 끝나면 알아서 이어집니다 (최대 5분 기다립니다)");
      log("  ".padEnd(58, "─"));
      log("");
    }
  }

  try {
    await frameReady().waitFor({ timeout: 300_000 }); // 사람이 로그인할 시간
  } catch {
    log("  ⚠️ 로그인 화면을 벗어나지 못했습니다");
    return false;
  }

  log("  ✅ 로그인 상태 확인 — 시작 화면을 기다립니다");
  if (!(await waitHome(page))) {
    log("  ⚠️ 시작 화면이 뜨지 않았습니다 (「고객 정보 검색」을 못 찾음)");
    return false;
  }
  log("  ✅ 시작 화면 준비됨\n");
  return true;
}

/**
 * 🔴 「50개 이상의 레코드가 발견되었습니다. 진행 하시겠습니까?」
 *
 * 고객 정보 검색을 열면 연락처 2,600건을 다 불러오려다 이 창이 뜬다.
 * 이게 떠 있으면 **뒤 화면을 아무것도 못 누른다.** 첫 시도가 여기서 막혔다 (2026-08-02).
 * 읽기만 하는 조회라 「예」로 진행한다.
 */
async function passBigSearchDialog(page: Page): Promise<boolean> {
  const f = main(page);
  const ask = f.getByText("50개 이상의 레코드", { exact: false }).first();
  if (!(await ask.isVisible().catch(() => false))) return false;
  log("    · 「50개 이상의 레코드」 창을 넘깁니다");
  await f.getByRole("button", { name: "예", exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return true;
}

/**
 * 번호판으로 고객을 찾는다.
 *
 * ⭐ 사장님 확인 (2026-08-02):
 *    "번호판을 입력 후 엔터를 치면 **목록에 한 줄 뜨고**, 직접 누르지 않고
 *     그냥 바로 판매내역 → 신규 로 진행하면 됨"
 *
 * 🔴 그래서 **결과 줄이 떴는지**로 판단한다.
 *    전에는 「검색칸이 사라졌는가」로 봤는데, 목록만 뜨고 화면은 그대로라
 *    20초를 기다리다 「없음」으로 처리했다. 그리고 **이미 있는 손님을 또 만들었다.**
 *
 * 🔴 모호하면 **만들지 않는다.** 중복 고객은 지우기도 번거롭고 매출이 갈린다.
 *    「없다」는 「표시할 내용이 없음」을 실제로 봤을 때만이다.
 */
type FindResult = "found" | "none" | "unclear";

async function findCustomer(page: Page, plate: string): Promise<FindResult> {
  const f = main(page);
  await clickAny(page, "고객 정보 검색");
  await passBigSearchDialog(page);

  const box = f.getByRole("textbox", { name: "이름/번호판 번호" });
  await box.waitFor({ timeout: 15000 });
  await box.fill(plate);
  await box.press("Enter");
  await page.waitForTimeout(2500);
  await passBigSearchDialog(page);

  /**
   * 🔴 **화면 글자를 통째로 읽어서 판단한다** (2026-08-02).
   *
   * 전에는 `getByText("(이 보기에 표시할 내용이 없음)", {exact:true})` 로 찾았는데
   * 화면에 분명히 떠 있는데도 못 걸려서 「모르겠다」로 빠졌다.
   * 화면 구조를 타지 않는 쪽이 튼튼하다.
   *
   * ⚠️ 번호판은 **검색칸에도** 들어 있으므로, 있는지 볼 때는
   *    `tr`(결과 표의 줄)로 좁힌다. 검색칸은 tr 안에 없다.
   */
  const hit = f.locator("tr").filter({ hasText: plate }).first();

  const until = Date.now() + 25000;
  let lastSeen = "";
  while (Date.now() < until) {
    if (await hit.isVisible().catch(() => false)) return "found";

    const body = ((await f.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
    lastSeen = body.slice(0, 200);
    if (body.includes("표시할 내용이 없음")) return "none";

    // 고객 화면으로 저절로 넘어가는 경우도 있다 (검색칸이 사라진다)
    if (!(await box.isVisible().catch(() => false))) return "found";

    await passBigSearchDialog(page);
    await page.waitForTimeout(1000);
  }
  log(`    · 판정이 안 섭니다. 화면: «${lastSeen.slice(0, 120)}»`);
  return "unclear";
}

/** 고객 생성 화면의 동의 표가 실제로 어떻게 생겼는지 찍어 본다 (--inspect) */
async function dumpConsentForm(page: Page) {
  const f = main(page);
  log("\n── 「고객 서명」 고를 수 있는 값 ──");
  const sel = f.getByRole("combobox", { name: "고객 서명" });
  const n = await sel.count().catch(() => 0);
  log(`   셀렉트 ${n}개`);
  for (let i = 0; i < n; i++) {
    const opts = await sel
      .nth(i)
      .evaluate((el) => Array.from((el as HTMLSelectElement).options).map((o) => o.label))
      .catch(() => null);
    const cur = await sel.nth(i).inputValue().catch(() => "?");
    log(`   [${i}] 현재="${cur}"  값=${opts ? JSON.stringify(opts) : "(select 태그가 아님 — 눌러서 고르는 방식)"}`);
  }

  log("\n── 동의 표 행별 상태 ──");
  for (const key of ["비즈니스 목적", "마케팅 및 광고", "제3자 제공"]) {
    const row = f.getByRole("row").filter({ hasText: key }).first();
    if (!(await row.isVisible().catch(() => false))) {
      log(`   ${key} → 행 못 찾음`);
      continue;
    }
    log(`   ${key}`);
    const cells = row.getByRole("gridcell");
    const cn = await cells.count().catch(() => 0);
    for (let i = 0; i < cn; i++) {
      const name = (await cells.nth(i).getAttribute("aria-label").catch(() => null)) ?? "";
      const txt = (await cells.nth(i).textContent().catch(() => ""))?.replace(/\s+/g, " ").trim() ?? "";
      const cb = cells.nth(i).locator("[role=checkbox]");
      const has = (await cb.count().catch(() => 0)) > 0;
      const st = has ? await cb.first().getAttribute("aria-checked").catch(() => "?") : null;
      log(`      ${i}. ${(name || txt).slice(0, 40)}${has ? `  [체크=${st}]` : ""}`);
    }
  }
}

/**
 * ⭐ MARS 에 고객·차량을 만든다 (사장님 지적 2026-08-02)
 *   "신규고객과 차량의 경우에는 필수로 넣어야 등록이 되는 정보들이 있음."
 *
 * 🔴 동의는 **손님이 종이에 표시한 그대로**만 넣는다.
 *    사장님 파이썬 코드는 3개 목적 × 4개 채널을 전부 켜고 서명을 「수락된 동의」로 넣었다.
 *    그건 손님이 고른 것이 아니다. 여기서는 판매 등록에 적어 둔 값을 따른다.
 *    서명을 안 받은 손님은 애초에 여기까지 오지 않는다 (호출 쪽에서 막는다).
 */
async function createCustomer(
  page: Page,
  c: NonNullable<import("../src/lib/mars-queue").MarsEntry["newCustomer"]>,
) {
  const f = main(page);
  await clickAny(page, "연락처/고객/차량을 생성합니다");
  await page.waitForTimeout(3000);

  /**
   * 🔴 「연락처 변환 템플릿」 창이 먼저 뜬다 (2026-08-02 실제로 걸려서 발견).
   *
   *   CASH      외상 고객(거래처/법인)   고객그룹 FLEET  결제조건 CM
   *   CASH-B2C  일반 고객(개인)          고객그룹 CASH   결제조건 CREDITCARD
   *
   * 이걸 안 넘기면 뒤 화면의 「이름」 칸을 못 채운다 — 30초 기다리다 죽는다.
   * 우리가 만드는 것은 개인 손님이므로 **CASH-B2C** 를 고른다.
   * (법인·거래처는 결제 조건이 달라 사람이 직접 만드셔야 한다)
   */
  const tmpl = f.getByRole("row").filter({ hasText: "CASH-B2C" }).first();
  if (await tmpl.isVisible({ timeout: 6000 }).catch(() => false)) {
    log("    · 「연락처 변환 템플릿」에서 CASH-B2C(일반 고객) 선택");
    await tmpl.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(600);
    await f.getByRole("button", { name: "확인", exact: true }).last().click({ timeout: 10000 });
    await page.waitForTimeout(3000);
  }

  if (INSPECT) {
    await dumpConsentForm(page);
    await f.getByRole("button", { name: "취소", exact: true }).first().click().catch(() => {});
    throw new Error("--inspect 이므로 저장하지 않고 멈춥니다");
  }

  await fillField(page, "이름", f.getByRole("textbox", { name: "이름", exact: true }), c.name);
  if (c.address) await fillField(page, "주소", f.getByRole("textbox", { name: "주소" }), c.address);
  if (c.phone) await fillField(page, "휴대폰 번호", f.getByRole("textbox", { name: "휴대폰 번호" }), c.phone);

  /**
   * ⭐ 동의 표 — 사장님이 실제로 하시는 것을 보고 그대로 옮겼다 (2026-08-02).
   *
   * 목적(행) 3줄 × 채널(열). 화면 글자 대신 `controlname` 으로 짚는다 —
   * 훨씬 튼튼하고, 글자로 찾다가 계속 헛짚었다.
   *
   * 🔴 **줄을 먼저 눌러 활성화한 뒤**에 그 줄의 칸을 눌러야 먹는다.
   *    이 단계를 빼먹어서 계속 실패했다.
   */
  /**
   * ⚠️ **MARS 에는 세 줄 모두 「수락된 동의」로 넣는다** (사장님 결정 2026-08-02).
   *
   * MARS 는 「거부된 동의」를 넣으면 **「불매치 코드」를 따로 요구**한다 —
   *   「거부된 동의의 경우 "불매치 코드"을(를) 제공해야 합니다!」
   * 그 코드가 무엇인지 정해진 것이 없어 자동으로는 넣을 수 없다.
   *
   * 🔴 그래서 **우리 기록과 MARS 기록이 다를 수 있다.**
   *    손님이 실제로 고르신 값은 `customer.consent_marketing` 에 그대로 남는다 —
   *    거기가 사실이고, MARS 는 그 시스템이 요구하는 형식이다.
   *    나중에 불매치 코드를 알게 되면 아래 한 줄만 되돌리면 된다.
   */
  const PURPOSES: [string, boolean][] = [
    ["비즈니스 목적", c.consentPrivacy],
    ["제3자 제공", c.consentPrivacy],
    ["마케팅 및 광고", true],
  ];
  if (!c.consentMarketing) {
    log("    ⚠️ 마케팅 수신은 동의 안 하셨지만 MARS 에는 수락으로 넣습니다 (불매치 코드 미정)");
  }

  /**
   * ⭐ MARS 기본 상태 (사장님 스크린샷 2026-08-02):
   *
   *              이메일접수  SMS&카톡  전화통화  하드카피   고객서명
   *   BUSINESS      ☐        ☑        ☑       ☐        (비어있음)
   *   MARKETING     ☐        ☑        ☑       ☐        (비어있음)
   *   PERSONAL      ☐        ☑        ☑       ☐        (비어있음)
   *
   * 🔴 손댈 것은 **하드카피 켜기**와 **고객 서명** 둘뿐이다.
   *    SMS·전화는 이미 켜져 있다 — 건드리면 오히려 꺼진다.
   *    전에는 세 칸을 다 만지고 있었으니 멀쩡한 것을 꺼뜨렸을 수 있다.
   *    이메일 접수는 사장님도 손대지 않으신다 (우리는 이메일을 안 받는다, D-10).
   */
  const TURN_ON = ["Accepts Hard Copy"];

  for (const [purpose, agreed] of PURPOSES) {
    const row = f.getByRole("row").filter({ hasText: purpose }).first();
    await row.click({ position: { x: 5, y: 5 } }).catch(() => {}); // 줄 활성화

    for (const ch of TURN_ON) {
      const box = row.locator(`[controlname="${ch}"]`).first();
      if (!(await box.isVisible().catch(() => false))) continue;
      // 이미 켜져 있으면 그대로 둔다 — 또 누르면 꺼진다
      if ((await box.getAttribute("aria-checked").catch(() => null)) === "true") continue;
      await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
      await box.click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(300);
    }

    /**
     * 🔴 「고객 서명」은 **비워 둘 수 없다.** 비워 뒀다가
     *    「고객이 서명하지 않은 동의 데이터가 아직 있습니다」로 저장이 막혔다.
     *    고를 수 있는 값: "" / 수락된 동의 / 거부된 동의
     */
    const cell = row.locator('[controlname="Customer Signed"]').first();
    /**
     * 🔴 **먼저 눌러야 고를 수 있다** (2026-08-02 사장님 조작 기록에서 확인).
     *      클릭 :: select "고객 서명" …
     *      입력 :: select "고객 서명" … = "1"
     *    바로 고르려다 세 줄 다 실패했다.
     *
     * 값은 라벨이 아니라 번호로 들어간다 — ["", "수락된 동의", "거부된 동의"] → 1 / 2
     */
    /**
     * 🔴 select 는 **누르지 않는다** — 누르면 드롭다운이 펼쳐져 selectOption 이 안 먹는다.
     *
     * ⚠️ 드롭다운을 닫으려고 Escape 를 눌렀다가 **고객 생성 창이 통째로 닫혔다** (2026-08-02).
     *    Business Central 에서 Escape 는 창을 닫는 단축키다. 절대 누르지 않는다.
     *    애초에 select 를 안 누르면 드롭다운도 안 열린다.
     */
    await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(350);

    const want = agreed ? "1" : "2";
    const label = agreed ? "수락된 동의" : "거부된 동의";
    const targets = [
      row.locator('[controlname="Customer Signed"] select, select[controlname="Customer Signed"]').first(),
      await resolveInput(cell),
      row.locator("select").first(),
    ];
    let signed = false;
    for (const t of targets) {
      if (await t.selectOption(want).then(() => true).catch(() => false)) {
        signed = true;
        break;
      }
      if (await t.selectOption({ label }).then(() => true).catch(() => false)) {
        signed = true;
        break;
      }
    }
    if (!signed) log(`    ⚠️ 「${purpose}」의 고객 서명을 못 골랐습니다`);
    await page.waitForTimeout(300);
  }

  // ── 차량 ──
  await fillField(page, "번호판 번호", f.getByRole("textbox", { name: "번호판 번호" }), c.plateNo);
  if (c.fuelType) {
    // Fuel · Hybird · BEV · Diesel — MARS 화면에 있는 그대로여야 한다
    // 서명 칸과 마찬가지로 **누른 뒤에** 골라야 한다
    // select 는 누르지 않는다 (드롭다운이 펼쳐지면 selectOption 이 안 먹는다)
    const fuel = await resolveInput(f.getByRole("combobox", { name: "차량 종류" }));
    const picked = await fuel
      .selectOption({ label: c.fuelType })
      .then(() => true)
      .catch(() => false);
    if (!picked) log(`    ⚠️ 차량 종류 「${c.fuelType}」를 못 골랐습니다`);
    await page.waitForTimeout(300);
  }
  if (c.makerName) await fillField(page, "제조사", f.getByRole("combobox", { name: "제조사" }), c.makerName);
  if (c.model) await fillField(page, "모델", f.getByRole("combobox", { name: "모델" }), c.model);

  if (c.year) {
    await fillField(page, "차량 연도", f.getByRole("textbox", { name: "차량 연도" }), String(c.year));
    await page.waitForTimeout(300);

    /**
     * 🔴 **등록 날짜** — 리팩터링하다 빠뜨렸던 칸이다 (사장님이 순서를 알려주셔서 발견).
     *
     * 사장님 방식: 「오늘 날짜에서 연도만 과거로 바꾼다」
     *   오늘이 2026-08-02 이고 14년식이면 → 2014-08-02
     * 실제 등록일을 모르니 월·일은 오늘 것을 그대로 쓴다.
     */
    const t = new Date();
    const md = `-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    const regDate = `${c.year}${md}`;
    const okDate =
      (await fillField(page, "등록 날짜", f.getByRole("combobox", { name: "등록 날짜" }), regDate)) ||
      (await fillField(page, "등록 날짜", f.getByRole("textbox", { name: "등록 날짜" }), regDate));
    if (!okDate) log("    ⚠️ 등록 날짜를 못 넣었습니다");
  }

  if (c.mileage) {
    await fillField(page, "주행거리", f.locator('[controlname="VehicleMileage"]'), String(c.mileage));
  }
  await page.waitForTimeout(800);

  /**
   * 🔴 「확인」이 **두 번** 필요하다 (2026-08-02 사장님 조작에서 확인).
   *    ① 생성 창의 확인  ② 뒤따라 뜨는 Dialog 의 확인
   *    전에는 ①만 누르고 성공으로 적었다.
   */
  /**
   * ⚠️ 사장님 말씀: 「**가장 아래의** 확인 버튼 클릭」
   *    화면에 확인이 여럿 있어서 위쪽 것을 누르면 엉뚱한 창이 닫힌다. 맨 아래 것을 누른다.
   */
  await f
    .locator('button[controlname="KOR Cust Contact Veh. Creation"]', { hasText: "확인" })
    .last()
    .click({ timeout: 10000 })
    .catch(async () => {
      await f.getByRole("button", { name: "확인", exact: true }).last().click({ timeout: 10000 });
    });
  await page.waitForTimeout(2000);

  // ② 뒤따르는 확인 창
  const second = f.locator('button[controlname="Dialog"]', { hasText: "확인" }).first();
  if (await second.isVisible({ timeout: 6000 }).catch(() => false)) {
    await second.click().catch(() => {});
    await page.waitForTimeout(2500);
  }

  /**
   * 🔴 **문구를 외워서 판정하지 않는다.** (2026-08-02)
   *
   * 전에는 「동의 데이터가 아직…」 같은 특정 문구만 찾았다. 그런데 MARS 는
   * 「거부된 동의의 경우 "불매치 코드"을(를) 제공해야 합니다!」처럼 다른 말도 한다.
   * 그걸 못 걸러서 창이 열려 있는데 로그에는 ✅ 라고 찍혔다 — 두 번째 거짓 보고다.
   *
   * 그래서 **창이 닫혔는지**만 본다. 그게 저장됐다는 유일한 증거다.
   * 안 닫혔으면 화면에 떠 있는 말을 그대로 옮겨 알린다.
   */
  const stillOpen = f.getByRole("textbox", { name: "번호판 번호" });
  if (await stillOpen.isVisible({ timeout: 3000 }).catch(() => false)) {
    const said =
      (await f.getByRole("dialog").last().innerText().catch(() => "")) ||
      (await f.locator('[controlname="Dialog"]').last().innerText().catch(() => "")) ||
      "";
    const msg = said.replace(/\s+/g, " ").replace(/확인\s*$/, "").trim();
    throw new Error(`MARS 가 저장을 막았습니다${msg ? `: ${msg.slice(0, 120)}` : " (창이 닫히지 않았습니다)"}`);
  }
}

/** 우리 결제 방법 → MARS 결제 수단 코드 */
const PAY_CODE: Record<string, string> = {
  카드: "CREDITCARD",
  현금: "CASH",
  계좌이체: "BANK",
};

/** 신규 매출 주문을 열고 고객·주행거리·결제·날짜를 넣는다 */
async function openSalesOrder(
  page: Page,
  plate: string,
  mileage: number | null,
  dateISO: string,
  payCode: string | null,
) {
  const f = main(page);
  await clickAny(page, "판매 내역");
  await page.waitForTimeout(3000);
  await passBigSearchDialog(page);

  /**
   * 🔴 「판매 내역」을 누르면 **「편집 - 고객/차량 이력」 창**이 뜬다.
   *    거기서 `신규` 는 메뉴가 아니라 **탭**이고, 눌러야 아래에 `신규 매출 주문` 이 나온다.
   *    둘을 연달아 눌렀더니 메뉴가 펼쳐지기 전에 다음 것을 찾아 실패했다 (2026-08-02).
   */
  const newOrder = f.getByRole("menuitem", { name: "신규 매출 주문" }).first();
  let opened = false;
  for (let i = 0; i < 4 && !opened; i++) {
    if (!(await newOrder.isVisible().catch(() => false))) {
      await clickAny(page, "신규", 8000).catch(() => {});
      await page.waitForTimeout(1500);
    }
    if (await newOrder.isVisible().catch(() => false)) {
      await newOrder.click({ timeout: 8000 }).catch(() => {});
      opened = true;
    }
  }
  if (!opened) throw new Error("「신규 매출 주문」을 열지 못했습니다");
  await page.waitForTimeout(2500);

  /**
   * ⚠️ 고객을 방금 만들고 바로 들어오면 **고객 선택 창이 뜨지 않는다** (사장님 확인 2026-08-02).
   *    "고객/차량 등록을 마치자마자 바로 판매내역 클릭 → 신규 → 신규 매출 주문"
   *
   *    어제 사장님 조작에서는 이 창이 떴는데, 그건 검색 화면을 거쳐 돌아가셨기 때문이다.
   *    그래서 **뜰 때만** 처리한다. 없으면 그냥 넘어간다.
   */
  const picker = f.locator('button[controlname="Contact Search Results"]').filter({ hasText: "확인" }).first();
  if (await picker.isVisible({ timeout: 4000 }).catch(() => false)) {
    log("    · 고객 선택 창이 떠서 번호판으로 고릅니다");
    await fillField(page, "이름/번호판 번호", f.locator('[controlname="NameLicensePlate"]'), plate);
    await page.waitForTimeout(2000);
    await f.getByRole("row").filter({ hasText: plate }).first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(500);
    await picker.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }

  /**
   * 🔴 **Tab 은 맨 마지막에 한 번만** 누른다 (2026-08-02).
   *    주행거리를 넣자마자 Tab 을 눌렀더니 MARS 가 화면을 다시 그리며 값을 지웠다.
   *    사장님 파이썬 코드도 셋을 그냥 채우고 완료 일자에서만 Tab 을 눌렀다.
   *    그 Tab 이 아래 품목 표를 불러오는 신호이기도 하다.
   */

  // ① 현재 주행거리
  const km = f.locator('[controlname="Mileage"]').first();
  await km.waitFor({ state: "visible", timeout: 20000 });
  if (mileage) await fillField(page, "현재 주행거리", km, String(mileage), { tab: false });

  /**
   * ② 문서 날짜 · 완료 일자 — **실제로 정비한 날**을 넣는다 (사장님 지시).
   *    "입력은 오늘 해도 실제 정비는 이전에 했을 수도 있음"
   */
  await fillField(page, "문서 날짜", f.locator('[controlname="Document Date"]'), dateISO, { tab: false });
  await fillField(page, "완료 일자", f.getByRole("combobox", { name: "완료 일자" }), dateISO);

  /**
   * 주행거리가 살아 있는지 다시 본다 — 실제로 지워지는 일이 있었다.
   *
   * ⚠️ 값을 **못 읽은 것**과 **지워진 것**은 다르다.
   *    빈 문자열이면 못 읽은 것일 수도 있으므로 다시 넣지 않는다 —
   *    그것 때문에 멀쩡한 값을 두 번 넣고 있었다 (사장님 지적 2026-08-02).
   */
  if (mileage) {
    const kmNow = await readField(km);
    if (kmNow !== "" && !kmNow.replace(/[\s,]/g, "").includes(String(mileage))) {
      log(`    · 주행거리가 «${kmNow}» 로 바뀌어 다시 넣습니다`);
      await fillField(page, "현재 주행거리", km, String(mileage), { tab: false });
    }
  }

  /**
   * ③ 결제 수단 코드 (사장님 확인)
   *    현금 CASH · 카드 CREDITCARD · 계좌이체 BANK
   *    외상은 여기까지 오지 않는다 — 호출 쪽에서 걸러 낸다.
   */
  if (payCode) {
    await fillField(page, "결제 수단 코드", f.locator('[controlname="<Payment Method Code_2>"]'), payCode);
    await fillField(page, "결제 조건 코드", f.locator('[controlname="<Payment Terms Code_2>"]'), payCode);
  }
  await page.waitForTimeout(1200);
}

/**
 * 품목 표를 채운다.
 *
 * ⭐ 사장님이 알려주신 순서 (2026-08-02):
 *   "번호에 품번을 치고 **엔터**를 치면 바로 수량으로 넘어갈 것.
 *    수량을 바꾸고 단가를 바꾸고 **탭**을 누르면 합계 부가세 포함도 바뀜.
 *    메모는 **설명 2 칸을 지우고** 그 안에 들어가게."
 *
 * 표 컬럼: 유효성 · 유형 · 번호 · 상세 항목 및 서비스 · **설명 2** ·
 *          측정단위코드 · 수량 · 단가 부가세 포함 · 라인 할인 % ·
 *          정가 부가세 포함 · 합계 부가세 포함
 */
async function fillLines(
  page: Page,
  lines: { kind: string; no: string | null; qty: number; unitPrice: number; marsName: string }[],
  memo?: string | null,
) {
  const f = main(page);
  const grid = f.locator("div[controlname='Sales Order Subform']");
  await grid.waitFor({ state: "visible", timeout: 25000 });
  await grid.scrollIntoViewIfNeeded();

  /** 실제로 넣은 줄 수 — 건너뛴 줄이 있으면 다음 행 위치가 달라진다 */
  let put = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.no) {
      log(`    ⚠️ ${l.marsName.slice(0, 30)} — MARS 품번이 없어 건너뜁니다`);
      continue;
    }
    const row = grid.locator("tr.real-current");

    /**
     * ⭐ 유형은 **숫자 값**으로 고른다 (2026-08-02 사장님 조작에서 확인).
     *    ["", "G/L 계정", "상품", "자원", "고정 자산", "요금(품목)"] → 상품=2, 자원=3
     *    🔴 「서비스」라는 항목은 **없다.** 공임은 「자원」이다.
     *       없는 이름을 찾고 있었으니 공임 줄은 전부 실패했을 것이다.
     */
    /**
     * 🔴 **누른 다음에 `<select>` 를 찾는다.**
     *    BC 표는 칸을 클릭해야 편집 상태가 되고 그때 select 가 생긴다.
     *    누르기 전에 찾았더니 두 줄 다 실패해서 MARS 기본값(상품)으로 들어갔고,
     *    얼라인먼트가 「자원」이 아니라 「상품」이 됐다 (2026-08-02 사장님 지적).
     */
    const want = l.kind === "tire" ? "2" : "3";
    const wantLabel = l.kind === "tire" ? "상품" : "자원";

    /**
     * 🔴 **`<select>` 는 누르면 안 된다** (2026-08-02 화면으로 확인).
     *    누르면 브라우저 기본 드롭다운이 펼쳐지고, 그 상태에서는 selectOption 이 안 먹는다.
     *    텍스트 칸에는 클릭이 도움이 됐는데 선택 칸에는 오히려 방해가 됐다.
     *
     *    **줄만 활성화**하고 select 는 건드리지 않은 채 값을 고른다.
     */
    await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(400);

    const typeCell = row.locator('[controlname="Type"]').first();
    const typeSel = row.locator('[controlname="Type"] select, select[controlname="Type"]').first();
    const target = (await typeSel.count().catch(() => 0)) > 0 ? typeSel : await resolveInput(typeCell);

    const typed =
      (await target.selectOption(want).then(() => true).catch(() => false)) ||
      (await target.selectOption({ label: wantLabel }).then(() => true).catch(() => false));

    if (typed) {
      await page.waitForTimeout(500);
      const now = await readField(typeCell);
      log(`      유형 → ${wantLabel}${now && now !== want ? ` (값 «${now}»)` : ""}`);
    } else {
      /** 🔴 유형을 못 고르면 **그 줄은 넣지 않는다.** 엉뚱한 유형으로 들어가면 장부가 틀어진다 */
      throw new Error(`「유형」을 «${wantLabel}» 으로 못 골랐습니다 — ${l.no} 줄을 넣지 않았습니다`);
    }

    /**
     * 품번을 그대로 친다.
     * 사장님은 규격·모델명으로 찾으신다 (「225/55R17」 → 「h745」, 약 2분).
     * 우리는 품번을 이미 갖고 있으니 그 검색 단계를 통째로 건너뛴다.
     */
    const noCell = row.locator('[controlname="No."]').first();
    await noCell.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(300);
    const no = await resolveInput(noCell);
    await no.fill(l.no).catch(async () => {
      await no.evaluate(SET_VALUE, l.no!).catch(() => {});
    });
    /** ⭐ 엔터를 치면 품목을 불러오고 **바로 수량으로 넘어간다** (사장님 확인) */
    await no.press("Enter");
    await page.waitForTimeout(2000);

    const qtyCell = row.locator('[controlname="Quantity"]').first();
    await qtyCell.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(300);
    const qty = await resolveInput(qtyCell);
    await qty.evaluate(SET_VALUE, String(l.qty)).catch(() => {});
    await qty.press("Enter");
    await page.waitForTimeout(700);

    /**
     * ⭐ MARS 도 「단가 부가세 포함」으로 받는다 — 우리 판매가와 기준이 같다.
     *    **탭**을 눌러야 「합계 부가세 포함」이 다시 계산된다 (사장님 확인).
     */
    const priceCell = row.locator('[controlname="Unit Price"]').first();
    await priceCell.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(300);
    const price = await resolveInput(priceCell);
    await price.evaluate(SET_VALUE, String(l.unitPrice)).catch(() => {});
    await price.press("Tab");
    await page.waitForTimeout(900);

    /**
     * ⭐ 메모는 **「설명 2」 칸을 지우고** 그 안에 넣는다 (사장님 지시).
     *    기본값으로 규격·모델명이 들어와 있는데, 그걸 메모로 갈아 끼운다.
     *    메모가 없으면 손대지 않는다 — 멀쩡한 기본값을 지울 이유가 없다.
     */
    if (memo?.trim() && i === 0) {
      const d2 = await resolveInput(
        (await row.locator('[controlname="Description 2"]').count().catch(() => 0)) > 0
          ? row.locator('[controlname="Description 2"]')
          : row.getByRole("textbox", { name: "설명 2" }),
      );
      if (await d2.isVisible().catch(() => false)) {
        await d2.click({ timeout: 6000 }).catch(() => {});
        const ok = await d2.fill(memo.trim()).then(() => true).catch(() => false);
        if (!ok) await d2.evaluate(SET_VALUE, memo.trim()).catch(() => {});
        await d2.press("Tab").catch(() => {});
        await page.waitForTimeout(700);
        log(`      설명 2 → «${memo.trim().slice(0, 30)}»`);
      } else {
        log("      ⚠️ 「설명 2」 칸을 못 찾아 메모를 못 넣었습니다");
      }
    }

    log(`    ✅ ${l.no}  ${l.marsName.slice(0, 34)}  ×${l.qty}  ${l.unitPrice.toLocaleString()}원`);
    put++;

    if (i < lines.length - 1) {
      await f.getByRole("rowheader").nth(put).click().catch(() => {});
      await page.waitForTimeout(700);
    }
  }
  return put;
}

/**
 * 🔴 전기(Posting)는 **하지 않는다.** 사장님이 검토하고 누르신다 (2026-08-02 지시).
 *
 * 대신 **대조해서 보여만 준다** — 사장님이 금액을 일일이 확인하지 않아도 되게.
 * 우리 판매 합계(또는 공급가)가 MARS 화면에 있는지 보고 결과를 적는다.
 */
interface AmountCheck {
  ok: boolean;
  /** 사람이 읽을 한 줄 — DB 에 남겨 나중에 원인을 찾는다 */
  note: string;
}

/**
 * 🔴 결과를 **글로 남긴다** (2026-08-04). 전에는 콘솔에만 찍혀 사라졌다.
 *    실제로 `56가6433` 건이 「금액 확인 필요」로 남았는데 MARS 화면에서 무엇을 봤는지
 *    아무 데도 없어서 왜 안 맞았는지 지금도 모른다. 다시는 그러지 않는다.
 */
async function checkOrder(page: Page, expectTotal: number): Promise<AmountCheck> {
  const f = main(page);
  const txt = (await f.locator("body").innerText().catch(() => "")) || "";
  const nums = [...txt.matchAll(/[\d,]{5,}/g)].map((m) => Number(m[0].replace(/,/g, "")));
  const excl = Math.round(expectTotal / 1.1);
  const ok = nums.some((n) => n === expectTotal || Math.abs(n - excl) <= 2);

  if (ok) {
    log(`    · 합계 대조 ✅ ${expectTotal.toLocaleString()}원 (공급가 ${excl.toLocaleString()})`);
    return { ok, note: `합계 맞음 ${expectTotal.toLocaleString()}원` };
  }

  // 우리 금액에 가까운 순으로 몇 개만 — 전부 남기면 읽을 수가 없다
  const near = [...new Set(nums)]
    .sort((a, b) => Math.abs(a - excl) - Math.abs(b - excl))
    .slice(0, 4)
    .map((n) => n.toLocaleString());
  log(`    · 합계 대조 ⚠️ 우리 ${expectTotal.toLocaleString()}원(공급가 ${excl.toLocaleString()})`);
  log(`      MARS 화면에서 찾은 값: ${near.join(", ") || "없음"}`);
  log(`      전기하시기 전에 금액을 꼭 확인해 주세요`);
  return {
    ok,
    note:
      `금액 확인 필요 — 우리 ${expectTotal.toLocaleString()}원(공급가 ${excl.toLocaleString()})` +
      ` · MARS 화면 값 ${near.join(", ") || "없음"}`,
  };
}

/**
 * ⭐ 방금 만든 매출 주문의 **번호**를 읽는다 (2026-08-04).
 *
 * 전에는 안 읽었다. 그래서 전기 후 차량 점검 단계에서 송장을 **번호판으로만** 찾았고,
 * 단골이면 그 번호판의 송장이 여러 개라 엉뚱한 송장에 점검을 낼 수 있었다.
 * 번호를 남겨 두면 사장님이 MARS 에서 그 주문을 바로 찾으실 수도 있다.
 *
 * ⚠️ 못 읽어도 실패로 치지 않는다 — 주문은 이미 잘 만들어져 있다.
 */
async function readOrderNo(page: Page): Promise<string | null> {
  const f = main(page);
  for (const loc of [
    f.locator('[controlname="No."]').first(),
    f.getByRole("textbox", { name: "번호" }).first(),
  ]) {
    const v = ((await readField(loc).catch(() => "")) || "").trim();
    // `61168583-23SO+000123` 같은 모양
    if (/[A-Z]{2}\+?\d{4,}/i.test(v)) return v;
  }
  return null;
}

/* ================================================================
 * 전기 후 차량 점검 (사장님 지시 2026-08-02 — "이것도 꼭 해야 하는 작업이야")
 *
 * 전기가 끝나야 들어갈 수 있는 화면이라 매출 주문 입력과 **별개 단계**다.
 *   완료된 매출 송장 → 탐색 → 전기 후 차량 점검 → … → 프로세스 → 제출
 *
 * 필수 항목 5개 (사장님 확인):
 *   타이어 · 브레이크 패드(디스크 제외) · 얼라인먼트 · 배터리 · 엔진오일
 *
 * 규칙 (사장님): "왠만하면 작업하지 않은 것들은 100%를 체크하면 돼"
 *   → 우리가 실제로 판 것만 표시하고, 나머지는 100%(매우 양호)로 채운다.
 * ============================================================== */

/**
 * 그 줄을 100%(매우 양호)로 만든다.
 *
 * ⭐ 사장님 확인 (2026-08-02): **맨 오른쪽 칸이 100%**, 맨 왼쪽 체크란이 교체.
 *    표마다 열 개수가 달라서 이름이 다르다 —
 *    브레이크는 `Value 3`, 엔진오일·얼라인먼트는 `Value 2` 가 각각 그 표의 마지막 열이다.
 *    그러니 **이름을 외우지 않고 「가장 오른쪽」을 찾는다.**
 *
 * 🔴 그래도 눌러 보고 줄에 「100」이 생겼는지 확인한다.
 *    틀린 등급이 손님 점검표에 남으면 안 되므로, 아니면 되돌리고 왼쪽으로 옮겨 간다.
 */
async function setGrade100(page: Page, rowText: string): Promise<boolean> {
  const f = main(page);
  const row = f.getByRole("row").filter({ hasText: rowText }).first();
  if (!(await row.isVisible().catch(() => false))) return false;

  const has100 = async () => ((await row.innerText().catch(() => "")) || "").includes("100");
  await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
  if (await has100()) return true;

  const cells = row.locator('[controlname^="Value "]');
  const n = await cells.count().catch(() => 0);
  // 오른쪽부터 왼쪽으로
  for (let i = n - 1; i >= 0; i--) {
    const cell = cells.nth(i);
    if (!(await cell.isVisible().catch(() => false))) continue;
    await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await cell.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(450);
    if (await has100()) return true;
    await cell.click({ timeout: 5000 }).catch(() => {}); // 되돌린다
    await page.waitForTimeout(300);
  }
  return false;
}

/**
 * ⭐ 전기된 송장 목록에서 **이 판매의 송장 한 줄**을 고른다 (2026-08-04).
 *
 * 🔴 전에는 `번호판이 든 첫 줄` 을 그냥 집었다. 단골이면 그 번호판의 송장이 여러 개라
 *    **엉뚱한 송장에 점검을 제출**할 수 있었다. 점검표는 손님에게 나가는 것이라
 *    잘못 붙으면 되돌리기 어렵다.
 *
 * 좁히는 순서 — 번호판 → 작업일자 → 금액. 그래도 여럿이면 **고르지 않고 멈춘다**
 * (인보이스 상품 매칭·거래처 품번 사전과 같은 태도).
 */
type Picked =
  | { ok: true; row: Locator; label: string }
  | { ok: false; why: string };

async function pickInvoiceRow(
  page: Page,
  c: { plateNo: string | null; workDate: string | null; total: number; marsRefNo: string | null },
): Promise<Picked> {
  const f = main(page);
  const rows = f.getByRole("row").filter({ hasText: c.plateNo! });
  const n = await rows.count().catch(() => 0);
  if (n === 0) return { ok: false, why: "전기된 송장이 없습니다 — MARS 에서 전기부터 해 주세요" };

  const texts: string[] = [];
  for (let i = 0; i < n; i++) texts.push(((await rows.nth(i).innerText().catch(() => "")) || "").replace(/\s+/g, " "));

  /** 후보를 줄이는 잣대. 하나씩 걸러 보고 남는 것이 하나면 그것이다 */
  const idx = [...texts.keys()];
  const narrow = (keep: (t: string) => boolean, name: string) => {
    const left = idx.filter((i) => keep(texts[i]));
    if (left.length > 0 && left.length < idx.length) {
      log(`    · ${name} 로 ${idx.length}건 → ${left.length}건`);
      idx.length = 0;
      idx.push(...left);
    }
  };

  if (c.workDate) narrow((t) => t.includes(c.workDate!), "작업일자");
  // 금액은 공급가(부가세 제외)로 적힌다. 둘 다 본다
  const excl = Math.round(c.total / 1.1);
  narrow(
    (t) => t.includes(c.total.toLocaleString()) || t.includes(excl.toLocaleString()),
    "금액",
  );

  if (idx.length === 1) {
    return { ok: true, row: rows.nth(idx[0]), label: texts[idx[0]].slice(0, 60) };
  }
  return {
    ok: false,
    why:
      `이 번호판의 전기된 송장이 ${idx.length}건이라 어느 것인지 고르지 못했습니다 — ` +
      `MARS 에서 직접 골라 점검해 주세요 (작업일 ${c.workDate ?? "?"} · ${c.total.toLocaleString()}원)`,
  };
}

/** 판매한 타이어 본수로 어느 바퀴를 갈았는지 정한다 */
function wheelsFor(qty: number): string[] {
  const all = ["전륜 좌측", "전륜 우측", "후륜 좌측", "후륜 우측"];
  if (qty >= 4) return all;
  if (qty === 2) return ["전륜 좌측", "전륜 우측"]; // 2본이면 보통 앞이다
  return all.slice(0, Math.max(1, qty));
}

async function fillVehicleCheck(
  page: Page,
  opts: { plateNo: string; tyreQty: number },
): Promise<{ ok: boolean; missed: string[] }> {
  const f = main(page);
  await clickAny(page, "탐색");
  await page.waitForTimeout(700);
  await clickAny(page, "전기 후 차량 점검");
  await page.waitForTimeout(3500);

  // 방문 이유 — 타이어 교체는 CHANGE
  const reason = f.locator('[controlname="Reason for Visit"]').first();
  if (await reason.isVisible().catch(() => false)) {
    await reason.fill("CHANGE").catch(() => {});
    await reason.press("Tab").catch(() => {});
    await page.waitForTimeout(800);
  }

  const missed: string[] = [];

  // ① 타이어 — 실제로 간 바퀴만 Replace
  await clickAny(page, "타이어").catch(() => {});
  await page.waitForTimeout(1200);
  for (const w of wheelsFor(opts.tyreQty)) {
    const row = f.getByRole("row").filter({ hasText: `타이어 - ${w}` }).first();
    if (!(await row.isVisible().catch(() => false))) {
      missed.push(`타이어 ${w}`);
      continue;
    }
    await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
    const rep = row.locator('[controlname="Replace"]').first();
    if ((await rep.getAttribute("aria-checked").catch(() => null)) !== "true") {
      await rep.click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(350);
    }
    log(`      타이어 ${w} — 교체 표시`);
  }

  /**
   * ②③④⑤ 나머지 필수 항목은 100%.
   *   브레이크는 **패드만** — 디스크는 필수가 아니다 (사장님 확인).
   */
  const REST: [string, string][] = [
    ["브레이크", "패드 - 전륜"],
    ["브레이크", "패드/슈 - 후륜"],
    ["얼라인먼트", "얼라이먼트"],
    ["배터리", "배터리"],
    ["기타", "엔진오일"],
  ];
  let tab = "";
  for (const [t, rowText] of REST) {
    if (t !== tab) {
      await clickAny(page, t).catch(() => {});
      await page.waitForTimeout(1200);
      tab = t;
    }
    const done = await setGrade100(page, rowText);
    log(`      ${rowText} — ${done ? "100%" : "⚠️ 못 넣었습니다"}`);
    if (!done) missed.push(rowText);
  }

  if (missed.length) return { ok: false, missed };

  // 제출
  await clickAny(page, "프로세스");
  await page.waitForTimeout(800);
  await clickAny(page, "제출");
  await page.waitForTimeout(3000);

  const blocked = f.getByText(/입력해야|필수|없습니다/).first();
  if (await blocked.isVisible({ timeout: 2000 }).catch(() => false)) {
    return { ok: false, missed: [`MARS: ${(await blocked.textContent())?.trim()}`] };
  }
  return { ok: true, missed: [] };
}

async function main_() {
  const { marsQueue, markEntered, pendingVehicleChecks, markVehicleChecked } = await import(
    "../src/lib/mars-queue"
  );

  /** 차량 점검 모드는 대기열이 아니라 「전기까지 끝난 것」을 본다 */
  const checks = CHECK ? (await pendingVehicleChecks()).slice(0, LIMIT) : [];
  const queue = CHECK ? [] : (await marsQueue()).slice(0, LIMIT);

  if (CHECK) {
    log(`MARS 차량 점검\n  점검할 것 ${checks.length}건\n`);
    for (const c of checks) {
      log(`  ${c.quoteNo}  ${c.plateNo}  ${c.customerName ?? ""}  타이어 ${c.tyreQty}본`);
    }
    if (checks.length === 0) {
      log("점검할 것이 없습니다.");
      log("(매출 주문을 넣고 MARS 에서 전기까지 마치신 건이 대상입니다)");
      process.exit(0);
    }
  } else {
    log(`MARS 자동 입력\n  대기열 ${queue.length}건\n`);
    if (queue.length === 0) {
      log("칠 것이 없습니다.");
      process.exit(0);
    }
    for (const q of queue) {
      log(`  ${q.quoteNo}  ${q.plateNo ?? "차량없음"}  ${q.customerName ?? ""}  ${q.total.toLocaleString()}원  (${q.lines.length}줄)`);
    }
  }
  if (DRY) {
    log("\n--dry 이므로 여기서 멈춥니다.");
    process.exit(0);
  }

  /**
   * ⭐ 전용 Chrome 프로필을 계속 쓴다 — 로그인 상태가 남는다.
   *   사장님이 평소 쓰시는 Chrome 프로필을 그대로 쓰려면 Chrome 을 완전히 닫아야 해서
   *   (프로필이 잠긴다) 일부러 따로 둔다. 처음 한 번만 로그인하시면 된다.
   */
  const profileDir =
    process.env.MARS_PROFILE_DIR ?? path.resolve(process.cwd(), "..", "tyremore-data", "chrome-mars");
  log(`  브라우저 프로필: ${profileDir}`);

  /**
   * 🔴 지난번 창이 안 닫혔으면 프로필이 잠겨 있어 브라우저가 안 뜬다 (2026-08-02).
   *    이 프로필을 쓰는 창만 골라 닫는다 — 사장님이 평소 쓰시는 Chrome 은 건드리지 않는다.
   */
  try {
    const leaf = path.basename(profileDir);
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | ` +
        `Where-Object { $_.CommandLine -like '*${leaf}*' } | ` +
        `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: "ignore", timeout: 20000 },
    );
  } catch {
    /* 없으면 그만이다 */
  }
  log("");

  const ctx = await chromium
    .launchPersistentContext(profileDir, {
      headless: false,
      channel: "chrome",
      viewport: null,
      args: ["--start-maximized"],
    })
    .catch(async (e) => {
      log(`  ⚠️ 설치된 Chrome 으로 못 열었습니다: ${(e as Error).message.split("\n")[0]}`);
      log("     내장 브라우저로 시도합니다 (없으면 npx playwright install chromium)");
      return chromium.launchPersistentContext(profileDir, { headless: false, viewport: null });
    });

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(30000);

  let ok = 0;
  let skipped = 0;
  try {
    if (!(await login(page))) {
      await ctx.close();
      process.exit(1);
    }

    /**
     * ⭐ 차량 점검 모드 — 전기까지 끝난 송장을 찾아 점검을 제출한다.
     *    송장 목록에서 **번호판으로** 찾는다. 전기 전이면 목록에 없으니 저절로 걸러진다.
     */
    if (CHECK) {
      for (const c of checks) {
        log(`\n── ${c.quoteNo}  ${c.plateNo} ${c.customerName ?? ""} ─────────`);
        try {
          await clickAny(page, "판매완료");
          await page.waitForTimeout(700);
          await clickAny(page, "완료된 매출 송장, 완료된 매출 송장 목록을 엽니다.");
          await page.waitForTimeout(3000);
          await passBigSearchDialog(page);

          const picked = await pickInvoiceRow(page, c);
          if (!picked.ok) {
            log(`  ⚠️ ${picked.why}`);
            skipped++;
            await page.goto(HOME);
            await waitHome(page, 40000);
            continue;
          }
          log(`  · 송장 ${picked.label}`);

          /**
           * ⭐ 「보기만」 모드 — 전기가 됐는지 확인만 하고 아무것도 제출하지 않는다.
           *      npm run mars -- --check --look
           */
          if (LOOK) {
            log("  👀 보기만 하는 모드라 여기서 멈춥니다 (제출하지 않았습니다)");
            ok++;
            await page.goto(HOME);
            await waitHome(page, 40000);
            continue;
          }

          await picked.row.locator('[controlname="No."]').first().click({ timeout: 10000 });
          await page.waitForTimeout(3000);

          const r = await fillVehicleCheck(page, { plateNo: c.plateNo!, tyreQty: c.tyreQty });
          if (!r.ok) throw new Error(`못 채운 항목: ${r.missed.join(", ")}`);

          await markVehicleChecked(c.quoteId);
          ok++;
          log("  ✅ 차량 점검 제출 완료");
        } catch (e) {
          skipped++;
          log(`  ⚠️ 실패: ${(e as Error).message.split("\n")[0]}`);
          const shot = path.resolve(process.cwd(), "..", "tyremore-data", `mars-점검오류-${c.quoteNo}.png`);
          await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
          log(`     화면을 저장했습니다: ${shot}`);
        }
        await page.goto(HOME).catch(() => {});
        await waitHome(page, 40000).catch(() => false);
      }
      log(`\n${"=".repeat(56)}`);
      log(LOOK ? `  전기된 송장을 찾은 것 ${ok}건 · 못 찾은 것 ${skipped}건  (제출 안 함)` : `  점검 제출 ${ok}건 · 넘어간 것 ${skipped}건`);
      log(`${"=".repeat(56)}\n`);
      /** 보기만 하는 모드는 스스로 닫는다 — 볼 것을 다 봤고, 고칠 것이 없다 */
      if (LOOK) {
        await ctx.close().catch(() => {});
        process.exit(0);
      }
      log("  확인하시고 이 창에서 Ctrl+C 를 누르시면 브라우저가 닫힙니다.");
      await new Promise(() => {});
    }

    for (const q of queue) {
      log(`\n── ${q.quoteNo}  ${q.plateNo ?? ""} ${q.customerName ?? ""} ─────────`);
      if (!q.plateNo) {
        log("  ⚠️ 차량번호가 없어 건너뜁니다 (비회원 판매는 MARS 에서 직접 처리해 주세요)");
        skipped++;
        continue;
      }
      /**
       * 🔴 외상은 MARS 에 넣지 않는다 (사장님 지시 2026-08-02).
       *    "외상은 일단 mars 에 입력 보류하고 저장해놔야됨"
       *    우리 쪽에는 기록이 그대로 남고, 대기열에도 남아 나중에 처리할 수 있다.
       */
      if (q.paymentMethod === "외상") {
        log("  ⏸️ 외상이라 MARS 입력을 보류합니다 — 우리 기록에는 남아 있습니다");
        skipped++;
        continue;
      }
      try {
        const found = await findCustomer(page, q.plateNo);

        /**
         * 🔴 「모르겠다」를 「없다」로 처리하지 않는다 (2026-08-02).
         *    그렇게 했다가 이미 있는 손님을 또 만들었다. MARS 에 중복이 생겼다.
         */
        if (found === "unclear") {
          throw new Error("이 손님이 MARS 에 있는지 확실하지 않아 멈췄습니다 — 직접 확인해 주세요");
        }

        if (found === "none") {
          const c = q.newCustomer;
          /**
           * 🔴 서명을 안 받은 손님은 만들지 않는다.
           *    MARS 고객 등록 화면에는 「고객 서명」 칸이 있다.
           *    받지도 않은 서명을 「수락된 동의」로 넣을 수는 없다.
           */
          if (!c || !c.consentSigned) {
            log(
              c
                ? "  ⚠️ 개인정보 동의 서명이 없어 고객 등록을 하지 않습니다 — 판매 등록에서 서명 확인을 체크해 주세요"
                : "  ⚠️ MARS 에 없는 차량입니다 — 고객·차량 등록은 직접 해 주세요",
            );
            skipped++;
            await page.goto(HOME);
            continue;
          }
          log(`  → MARS 에 없는 손님입니다. 새로 만듭니다 (${c.name} ${c.plateNo})`);
          await createCustomer(page, c);
          log("    ✅ 고객·차량 등록 완료");
        }

        /** ⭐ 실제로 정비한 날. 사장님이 판매 등록에서 고치실 수 있다 (기본은 오늘) */
        const d = new Date();
        const iso =
          q.workDate ??
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        log(`    · 작업일자 ${iso} · 결제 ${q.paymentMethod ?? "-"}`);
        await openSalesOrder(page, q.plateNo, q.newCustomer?.mileage ?? null, iso, PAY_CODE[q.paymentMethod ?? ""] ?? null);
        const put = await fillLines(page, q.lines, q.saleMemo);

        /**
         * 🔴 줄이 다 안 들어갔으면 「입력 완료」로 넘기지 않는다.
         *    모자란 채로 대기열에서 내리면 빠진 줄을 아무도 모르게 된다.
         *    사장님이 MARS 에서 마저 채우고 전기하셔야 한다.
         */
        if (put !== q.lines.length) {
          throw new Error(`${q.lines.length}줄 중 ${put}줄만 들어갔습니다 — MARS 에서 마저 채워 주세요`);
        }

        const amount = await checkOrder(page, q.total);
        /**
         * 🔴 번호 칸과 메모 칸을 섞지 않는다 (2026-08-04).
         *    전에는 「자동입력 2026-08-02 (금액 확인 필요)」 라는 **메모**를
         *    송장번호 칸(`mars_ref_no`)에 넣었다. 그래서 번호로 송장을 찾을 수 없었고
         *    메모 칸은 비어 있었다.
         */
        const orderNo = await readOrderNo(page);
        if (orderNo) log(`    · 매출 주문 번호 ${orderNo}`);
        await markEntered(q.quoteId, orderNo, `자동입력 ${iso} · ${amount.note}`);
        ok++;
        log("  ✅ 매출 주문을 채웠습니다 — 🔴 전기는 사장님이 확인하고 눌러 주세요");
        await page.goto(HOME);
        await waitHome(page, 40000);
      } catch (e) {
        skipped++;
        log(`  ⚠️ 실패: ${(e as Error).message.split("\n")[0]}`);
        /**
         * 어디서 막혔는지 나중에 볼 수 있게 남긴다.
         * 화면 조작은 MARS 가 바뀌면 어긋난다 — 그때 이 그림이 유일한 단서다.
         */
        const shot = path.resolve(process.cwd(), "..", "tyremore-data", `mars-오류-${q.quoteNo}.png`);
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        log(`     화면을 저장했습니다: ${shot}`);
        await page.goto(HOME).catch(() => {});
        await waitHome(page, 30000).catch(() => false);
      }
    }
  } finally {
    log(`\n${"=".repeat(56)}`);
    log(`  채운 것 ${ok}건 · 넘어간 것 ${skipped}건`);
    log("");
    log("  🔴 전기(Posting)는 안 했습니다.");
    log("     MARS 「매출 주문」 목록에서 확인하시고 직접 전기해 주세요.");
    log(`${"=".repeat(56)}\n`);
    log("  확인하시고 이 창에서 Ctrl+C 를 누르시면 브라우저가 닫힙니다.");
    // 사장님이 확인하실 때까지 브라우저를 열어 둔다
    await new Promise(() => {});
  }
}

main_();
