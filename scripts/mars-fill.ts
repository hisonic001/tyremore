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
  await page.waitForTimeout(2500);

  if (INSPECT) {
    await dumpConsentForm(page);
    await f.getByRole("button", { name: "취소", exact: true }).first().click().catch(() => {});
    throw new Error("--inspect 이므로 저장하지 않고 멈춥니다");
  }
  await f
    .getByRole("button", { name: "코드, 오름차순 순서로 정렬됨 CASH-B2C", exact: true })
    .click()
    .catch(() => {
      /* 정렬 버튼이 없을 수도 있다 — 없으면 그냥 진행 */
    });

  await f.getByRole("textbox", { name: "이름", exact: true }).fill(c.name);
  if (c.address) await f.getByRole("textbox", { name: "주소" }).fill(c.address);
  if (c.phone) await f.getByRole("textbox", { name: "휴대폰 번호" }).fill(c.phone);

  /**
   * 동의 표는 목적(행) × 채널(열)이다.
   *   비즈니스 목적 · 제3자 제공 및 국외 이전  ← 필수 동의 (종이의 「개인정보 활용 동의」)
   *   마케팅 및 광고 목적                     ← 선택 동의 (종이의 「뉴스·프로모션 수신」)
   *
   * 채널은 종이에 있는 것만 켠다 — 카카오톡·문자와 전화.
   * 이메일은 우리가 아예 받지 않고(D-10), 하드카피도 종이에 없다.
   */
  const PURPOSES: [string, boolean][] = [
    ["비즈니스 목적의 동의", c.consentPrivacy],
    ["제3자 제공 및 국외 이전에 대한 동의", c.consentPrivacy],
    ["마케팅 및 광고 목적의 동의", c.consentMarketing],
  ];
  const CHANNELS = ["Accepts SMS & KAKAO 알림톡(Bizmessage)", "전화 통화 수락"];

  for (const [purpose, agreed] of PURPOSES) {
    const row = f.getByRole("row").filter({ hasText: purpose });
    for (const ch of CHANNELS) {
      const box = row.getByRole("gridcell", { name: ch }).locator("[role=checkbox]");
      const now = (await box.getAttribute("aria-checked").catch(() => null)) === "true";
      if (now !== agreed) await box.click().catch(() => {});
    }
    await row
      .getByRole("combobox", { name: "고객 서명" })
      .selectOption({ label: agreed ? "수락된 동의" : "거부된 동의" })
      .catch(async () => {
        // 「거부된 동의」라는 항목이 없는 화면이면 동의한 것만 표시하고 넘어간다
        if (agreed) await row.getByRole("combobox", { name: "고객 서명" }).selectOption({ label: "수락된 동의" });
      });
  }

  // 차량
  const sec = f.getByRole("button", { name: "차량" });
  if ((await sec.getAttribute("aria-expanded")) === "false") {
    await sec.click();
    await f.getByRole("textbox", { name: "번호판 번호" }).waitFor({ timeout: 10000 });
  }
  await f.getByRole("textbox", { name: "번호판 번호" }).fill(c.plateNo);
  if (c.fuelType)
    await f.getByRole("combobox", { name: "차량 종류" }).selectOption({ label: c.fuelType }).catch(() => {});
  if (c.makerName) await f.getByRole("combobox", { name: "제조사" }).fill(c.makerName);
  if (c.model) await f.getByRole("combobox", { name: "모델" }).fill(c.model);
  if (c.year) {
    await f.getByRole("textbox", { name: "차량 연도" }).fill(String(c.year));
    const t = new Date();
    const md = `-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    await f.getByRole("combobox", { name: "등록 날짜" }).fill(`${c.year}${md}`);
  }
  if (c.mileage) await f.getByRole("textbox", { name: "주행거리", exact: true }).fill(String(c.mileage));

  await f.locator(".task-dialog-content").click({ position: { x: 5, y: 5 } });

  // 중복 등 유효성 오류가 뜨면 저장하지 않고 알린다
  const err = f.locator(".ms-nav-validationmessage-error");
  if (await err.isVisible({ timeout: 3000 }).catch(() => false)) {
    throw new Error(`MARS 가 거부했습니다: ${await err.innerText()}`);
  }

  await page.waitForTimeout(1500);
  await f.getByRole("button", { name: "확인", exact: true }).last().click();
  await page.waitForTimeout(2500);

  /**
   * 🔴 **저장됐는지 반드시 확인한다.** (2026-08-02)
   *    전에는 「확인」을 누르고 바로 성공이라고 적었다. 그런데 MARS 가
   *    「고객이 서명하지 않은 동의 데이터가 아직 있습니다」라며 막고 있었고,
   *    화면에는 창이 그대로 떠 있는데 로그에는 ✅ 라고 찍혔다.
   *    사장님께 거짓으로 보고한 셈이다. 다시는 그러지 않는다.
   */
  const notice = f.getByText(/동의 데이터가 아직|입력해야|필수|이미 존재/).first();
  if (await notice.isVisible({ timeout: 2500 }).catch(() => false)) {
    throw new Error(`MARS 가 저장을 막았습니다: ${(await notice.textContent())?.trim()}`);
  }
  const stillOpen = f.getByRole("textbox", { name: "번호판 번호" });
  if (await stillOpen.isVisible({ timeout: 2000 }).catch(() => false)) {
    throw new Error("고객 생성 창이 닫히지 않았습니다 — 저장되지 않았습니다");
  }
}

/** 신규 매출 주문을 열고 주행거리·날짜를 넣는다 */
async function openSalesOrder(page: Page, mileage: number | null, dateISO: string) {
  const f = main(page);
  await clickAny(page, "판매 내역");
  await passBigSearchDialog(page);
  await clickAny(page, "신규");
  await clickAny(page, "신규 매출 주문");

  const more = f.getByRole("button", { name: "일반, 더 보기" });
  await more.waitFor({ timeout: 15000 });
  if ((await more.getAttribute("aria-expanded")) === "false") {
    await more.click();
    await page.waitForTimeout(500);
  }

  const km = f.getByRole("textbox", { name: "현재 주행거리" });
  await km.waitFor({ state: "visible", timeout: 10000 });
  if (mileage) await km.fill(String(mileage));

  await f.getByRole("combobox", { name: "문서 날짜" }).fill(dateISO);
  const done = f.getByRole("combobox", { name: "완료 일자" });
  await done.fill(dateISO);
  // Tab 을 눌러야 아래 표가 뜬다
  await done.press("Tab");
}

/** 품목 표를 채운다 */
async function fillLines(
  page: Page,
  lines: { kind: string; no: string | null; qty: number; unitPrice: number; marsName: string }[],
) {
  const f = main(page);
  const grid = f.locator("div[controlname='Sales Order Subform']");
  await grid.waitFor({ state: "visible", timeout: 20000 });
  await grid.scrollIntoViewIfNeeded();

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.no) {
      log(`    ⚠️ ${l.marsName.slice(0, 30)} — MARS 품번이 없어 건너뜁니다`);
      continue;
    }
    const row = grid.locator("tr.real-current");

    // 유형: 타이어·부품은 「상품」, 공임은 「서비스」
    await row.getByRole("combobox", { name: "유형" }).selectOption({
      label: l.kind === "tire" ? "상품" : "서비스",
    });

    const no = row.getByRole("combobox", { name: "번호", exact: true });
    await no.fill(l.no);
    await no.press("Tab");
    await page.waitForTimeout(1200); // 품번을 넣으면 이름·기본가를 불러온다

    const qty = row.getByLabel("수량", { exact: true });
    await qty.evaluate(SET_VALUE, String(l.qty));
    await qty.press("Enter");

    // ⭐ MARS 도 「단가 부가세 포함」으로 받는다 — 우리 판매가와 기준이 같다
    const price = row.getByLabel("단가 부가세 포함");
    await price.evaluate(SET_VALUE, String(l.unitPrice));
    await price.press("Enter");

    log(`    ✅ ${l.no}  ${l.marsName.slice(0, 34)}  ×${l.qty}  ${l.unitPrice.toLocaleString()}원`);

    if (i < lines.length - 1) {
      // 다음 줄로 내린다 — 늘 두 번째 행 머리글을 누르는 것이 가장 안정적이었다
      await f.getByRole("rowheader").nth(i + 1).click();
      await page.waitForTimeout(500);
    }
  }
}

async function main_() {
  const { marsQueue, markEntered } = await import("../src/lib/mars-queue");
  const queue = (await marsQueue()).slice(0, LIMIT);

  log(`MARS 자동 입력\n  대기열 ${queue.length}건\n`);
  if (queue.length === 0) {
    log("칠 것이 없습니다.");
    process.exit(0);
  }
  for (const q of queue) {
    log(`  ${q.quoteNo}  ${q.plateNo ?? "차량없음"}  ${q.customerName ?? ""}  ${q.total.toLocaleString()}원  (${q.lines.length}줄)`);
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
        await openSalesOrder(page, null, iso);
        await fillLines(page, q.lines);

        await markEntered(q.quoteId, `자동입력 ${iso}`);
        ok++;
        log("  ✅ 매출 주문을 채웠습니다 — 전기는 안 했습니다");
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
