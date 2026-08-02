import { config } from "dotenv";
config({ path: ".env.local" });

import { execSync } from "node:child_process";
import path from "node:path";
import { chromium, type FrameLocator, type Page } from "playwright";

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
 *   npm run mars                 대기열 전부 처리 (브라우저가 보이게 열린다)
 *   npm run mars -- --dry        로그인해서 대기열만 보여주고 아무것도 안 만든다
 *   npm run mars -- --limit 1    한 건만
 */

const SIGNIN =
  "https://mars.tyremore.co.kr/MARS/SignIn?ReturnUrl=%2FMARS%2F%3Ftenant%3D61168583";

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
 * ⚠️ 「판매 내역」이 보인다고 찾은 것이 아니다 — 그건 검색 결과 화면의
 *    **툴바 버튼이라 늘 있다.** 그걸 근거로 삼았다가 없는 손님을 찾았다고 오해했다.
 *    MARS 는 딱 맞는 것이 있으면 **고객 화면으로 저절로 넘어간다.**
 *    그러니 「이름/번호판 번호」 칸이 사라졌는지로 판단한다.
 */
async function findCustomer(page: Page, plate: string): Promise<boolean> {
  const f = main(page);
  await clickAny(page, "고객 정보 검색");
  await passBigSearchDialog(page);

  const box = f.getByRole("textbox", { name: "이름/번호판 번호" });
  await box.waitFor({ timeout: 15000 });
  await box.fill(plate);
  await box.press("Enter");
  await page.waitForTimeout(2000);
  await passBigSearchDialog(page);

  const empty = f.getByText("(이 보기에 표시할 내용이 없음)", { exact: true });
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    // 검색 칸이 사라졌으면 고객 화면으로 넘어간 것이다 = 찾았다
    if (!(await box.isVisible().catch(() => false))) {
      await f.getByRole("menuitem", { name: "판매 내역" }).first().waitFor({ timeout: 15000 });
      return true;
    }
    if (await empty.isVisible().catch(() => false)) return false;
    await passBigSearchDialog(page);
    await page.waitForTimeout(1000);
  }
  return false;
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

  await f.getByRole("textbox", { name: "이름", exact: true }).fill(c.name);
  if (c.address) await f.getByRole("textbox", { name: "주소" }).fill(c.address);
  if (c.phone) await f.getByRole("textbox", { name: "휴대폰 번호" }).fill(c.phone);

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
  /** 사장님이 켜시는 채널 그대로 (이메일 칸은 손대지 않으신다) */
  const CHANNELS = ["Accepts SMS", "Accepts Phone Call", "Accepts Hard Copy"];

  for (const [purpose, agreed] of PURPOSES) {
    const row = f.getByRole("row").filter({ hasText: purpose }).first();
    await row.click({ position: { x: 5, y: 5 } }).catch(() => {}); // 줄 활성화

    for (const ch of CHANNELS) {
      const box = row.locator(`[controlname="${ch}"]`).first();
      if (!(await box.isVisible().catch(() => false))) continue;
      const now = (await box.getAttribute("aria-checked").catch(() => null)) === "true";
      if (now !== agreed) {
        await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
        await box.click({ timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(250);
      }
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
    await cell.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(350);

    const want = agreed ? "1" : "2";
    const label = agreed ? "수락된 동의" : "거부된 동의";
    const targets = [cell, cell.locator("select").first(), row.locator("select").first()];
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
  await f.getByRole("textbox", { name: "번호판 번호" }).fill(c.plateNo);
  if (c.fuelType) {
    // Fuel · Hybird · BEV · Diesel — MARS 화면에 있는 그대로여야 한다
    // 서명 칸과 마찬가지로 **누른 뒤에** 골라야 한다
    const fuel = f.getByRole("combobox", { name: "차량 종류" }).first();
    await fuel.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(300);
    const picked =
      (await fuel.selectOption({ label: c.fuelType }).then(() => true).catch(() => false)) ||
      (await fuel.locator("select").first().selectOption({ label: c.fuelType }).then(() => true).catch(() => false));
    if (!picked) log(`    ⚠️ 차량 종류 「${c.fuelType}」를 못 골랐습니다`);
    await page.waitForTimeout(300);
  }
  if (c.makerName) await f.getByRole("combobox", { name: "제조사" }).fill(c.makerName).catch(() => {});
  if (c.model) await f.getByRole("combobox", { name: "모델" }).fill(c.model).catch(() => {});
  if (c.year) {
    await f.getByRole("textbox", { name: "차량 연도" }).fill(String(c.year)).catch(() => {});
  }
  if (c.mileage) {
    await f.locator('[controlname="VehicleMileage"]').first().fill(String(c.mileage)).catch(() => {});
  }
  await page.waitForTimeout(800);

  /**
   * 🔴 「확인」이 **두 번** 필요하다 (2026-08-02 사장님 조작에서 확인).
   *    ① 생성 창의 확인  ② 뒤따라 뜨는 Dialog 의 확인
   *    전에는 ①만 누르고 성공으로 적었다.
   */
  await f.locator('button[controlname="KOR Cust Contact Veh. Creation"]', { hasText: "확인" }).first()
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
   * 🔴 **고객·차량을 다시 고르는 창이 먼저 뜬다** (2026-08-02 사장님 조작에서 확인).
   *    내 코드에는 이 단계가 아예 없어서 바로 주행거리부터 넣으려다 실패했다.
   *    번호판으로 찾아 「차량」 줄을 고르고 확인을 누른다.
   */
  const pick = f.locator('[controlname="NameLicensePlate"]').first();
  if (await pick.isVisible({ timeout: 8000 }).catch(() => false)) {
    await pick.fill(plate);
    await pick.press("Enter");
    await page.waitForTimeout(2500);
    // 결과에서 「차량」 줄을 고른다 (고객 줄이 아니라 차량 줄이어야 주행거리가 붙는다)
    const veh = f.getByRole("row").filter({ hasText: plate }).first();
    await veh.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(500);
    await f
      .locator('button[controlname="Contact Search Results"]', { hasText: "확인" })
      .first()
      .click({ timeout: 8000 })
      .catch(async () => {
        await f.getByRole("button", { name: "확인", exact: true }).last().click({ timeout: 8000 });
      });
    await page.waitForTimeout(2500);
  }

  const km = f.locator('[controlname="Mileage"]').first();
  await km.waitFor({ state: "visible", timeout: 20000 });
  if (mileage) {
    await km.fill(String(mileage));
    await km.press("Tab");
  }

  // 결제 수단·조건 — 우리가 이미 알고 있는 값이다
  if (payCode) {
    for (const cn of ["<Payment Method Code_2>", "<Payment Terms Code_2>"]) {
      await f.locator(`[controlname="${cn}"]`).first().fill(payCode).catch(() => {});
      await page.waitForTimeout(400);
    }
  }

  await f.locator('[controlname="Document Date"]').first().fill(dateISO).catch(() => {});
  await page.waitForTimeout(1200);
}

/** 품목 표를 채운다 */
async function fillLines(
  page: Page,
  lines: { kind: string; no: string | null; qty: number; unitPrice: number; marsName: string }[],
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
    await row
      .locator('[controlname="Type"]')
      .first()
      .selectOption(l.kind === "tire" ? "2" : "3");
    await page.waitForTimeout(500);

    /**
     * 품번을 그대로 친다.
     * 사장님은 규격·모델명으로 찾으신다 (「225/55R17」 → 「h745」, 약 2분).
     * 우리는 품번을 이미 갖고 있으니 그 검색 단계를 통째로 건너뛴다.
     */
    const no = row.locator('[controlname="No."]').first();
    await no.fill(l.no);
    await no.press("Tab");
    await page.waitForTimeout(1600); // 품번을 넣으면 이름·기본가를 불러온다

    const qty = row.locator('[controlname="Quantity"]').first();
    await qty.evaluate(SET_VALUE, String(l.qty));
    await qty.press("Enter");
    await page.waitForTimeout(600);

    // ⭐ MARS 도 「단가 부가세 포함」으로 받는다 — 우리 판매가와 기준이 같다
    const price = row.locator('[controlname="Unit Price"]').first();
    await price.evaluate(SET_VALUE, String(l.unitPrice));
    await price.press("Enter");
    await page.waitForTimeout(600);

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
async function checkOrder(page: Page, expectTotal: number): Promise<boolean> {
  const f = main(page);
  const txt = (await f.locator("body").innerText().catch(() => "")) || "";
  const nums = [...txt.matchAll(/[\d,]{5,}/g)].map((m) => Number(m[0].replace(/,/g, "")));
  const excl = Math.round(expectTotal / 1.1);
  const ok = nums.some((n) => n === expectTotal || Math.abs(n - excl) <= 2);

  if (ok) {
    log(`    · 합계 대조 ✅ ${expectTotal.toLocaleString()}원 (공급가 ${excl.toLocaleString()})`);
  } else {
    log(`    · 합계 대조 ⚠️ 우리 ${expectTotal.toLocaleString()}원(공급가 ${excl.toLocaleString()})`);
    log(`      MARS 화면에서 찾은 값: ${nums.slice(-6).join(", ") || "없음"}`);
    log(`      전기하시기 전에 금액을 꼭 확인해 주세요`);
  }
  return ok;
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

          const f2 = main(page);
          const row = f2.getByRole("row").filter({ hasText: c.plateNo! }).first();
          if (!(await row.isVisible({ timeout: 10000 }).catch(() => false))) {
            log("  ⚠️ 전기된 송장이 없습니다 — MARS 에서 전기부터 해 주세요");
            skipped++;
            await page.goto("https://mars.tyremore.co.kr/MARS/");
            await waitHome(page, 40000);
            continue;
          }
          await row.locator('[controlname="No."]').first().click({ timeout: 10000 });
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
        await page.goto("https://mars.tyremore.co.kr/MARS/").catch(() => {});
        await waitHome(page, 40000).catch(() => false);
      }
      log(`\n${"=".repeat(56)}`);
      log(`  점검 제출 ${ok}건 · 넘어간 것 ${skipped}건`);
      log(`${"=".repeat(56)}\n`);
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
      try {
        const found = await findCustomer(page, q.plateNo);
        if (!found) {
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
            await page.goto("https://mars.tyremore.co.kr/MARS/");
            continue;
          }
          log(`  → MARS 에 없는 손님입니다. 새로 만듭니다 (${c.name} ${c.plateNo})`);
          await createCustomer(page, c);
          log("    ✅ 고객·차량 등록 완료");
        }

        const today = new Date();
        const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        await openSalesOrder(page, q.plateNo, q.newCustomer?.mileage ?? null, iso, PAY_CODE[q.paymentMethod ?? ""] ?? null);
        const put = await fillLines(page, q.lines);

        /**
         * 🔴 줄이 다 안 들어갔으면 「입력 완료」로 넘기지 않는다.
         *    모자란 채로 대기열에서 내리면 빠진 줄을 아무도 모르게 된다.
         *    사장님이 MARS 에서 마저 채우고 전기하셔야 한다.
         */
        if (put !== q.lines.length) {
          throw new Error(`${q.lines.length}줄 중 ${put}줄만 들어갔습니다 — MARS 에서 마저 채워 주세요`);
        }

        const matched = await checkOrder(page, q.total);
        await markEntered(q.quoteId, `자동입력 ${iso}${matched ? "" : " (금액 확인 필요)"}`);
        ok++;
        log("  ✅ 매출 주문을 채웠습니다 — 🔴 전기는 사장님이 확인하고 눌러 주세요");
        await page.goto("https://mars.tyremore.co.kr/MARS/");
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
        await page.goto("https://mars.tyremore.co.kr/MARS/").catch(() => {});
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
