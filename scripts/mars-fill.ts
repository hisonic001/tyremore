import { config } from "dotenv";
config({ path: ".env.local" });

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

async function login(page: Page, id: string, pw: string): Promise<boolean> {
  log("로그인합니다…");
  await page.goto(SIGNIN);
  await page.locator("input#UserName").fill(id);
  await page.locator("input#Password").fill(pw);
  await page.locator("button#submitButton").click();
  try {
    await main(page).getByRole("button", { name: "확인" }).waitFor({ timeout: 20000 });
    await main(page).getByRole("button", { name: "확인" }).click();
    log("  로그인 성공\n");
    return true;
  } catch {
    log("  ⚠️ 로그인 실패 — 아이디·비밀번호를 확인해 주세요");
    return false;
  }
}

/**
 * 번호판으로 고객을 찾는다.
 * 「(이 보기에 표시할 내용이 없음)」이 보이면 등록 안 된 손님이다.
 */
async function findCustomer(page: Page, plate: string): Promise<boolean> {
  const f = main(page);
  await f.getByRole("button", { name: "고객 정보 검색" }).click();
  const box = f.getByRole("textbox", { name: "이름/번호판 번호" });
  await box.waitFor({ timeout: 10000 });
  await box.fill(plate);
  await box.press("Enter");
  await page.waitForTimeout(3000);

  const empty = f.getByText("(이 보기에 표시할 내용이 없음)", { exact: true });
  if (await empty.isVisible().catch(() => false)) return false;

  // 찾으면 고객 상세로 저절로 넘어간다 — 「판매 내역」 메뉴가 보이면 준비된 것이다
  await f.getByRole("menuitem", { name: "판매 내역" }).waitFor({ timeout: 15000 });
  return true;
}

/** 신규 매출 주문을 열고 주행거리·날짜를 넣는다 */
async function openSalesOrder(page: Page, mileage: number | null, dateISO: string) {
  const f = main(page);
  await f.getByRole("menuitem", { name: "판매 내역" }).click();
  await f.getByRole("menuitem", { name: "신규" }).click();
  await f.getByRole("menuitem", { name: "신규 매출 주문" }).click();

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
  const id = process.env.MARS_ID;
  const pw = process.env.MARS_PASSWORD;
  if (!id || !pw) {
    log("⚠️ .env.local 에 MARS_ID / MARS_PASSWORD 를 넣어 주세요.");
    log("   (이 파일은 깃허브에도 Vercel 에도 올라가지 않습니다)");
    process.exit(1);
  }

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

  // 사장님이 눈으로 보실 수 있게 창을 띄운다. 설치된 Chrome 이 있으면 그것을 쓴다
  const browser = await chromium
    .launch({ headless: false, channel: "chrome" })
    .catch(() => chromium.launch({ headless: false }));
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  let ok = 0;
  let skipped = 0;
  try {
    if (!(await login(page, id, pw))) {
      await browser.close();
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
          /**
           * 🔴 고객·차량을 새로 만드는 것은 자동으로 하지 않는다.
           *    개인정보 동의 항목까지 대신 체크하게 되는데, 그건 손님이 서명하는 것이다.
           *    (사장님 파이썬 코드에는 있었지만 여기서는 일부러 뺐다)
           */
          log("  ⚠️ MARS 에 없는 차량입니다 — 고객·차량 등록은 직접 해 주세요");
          skipped++;
          await page.goto("https://mars.tyremore.co.kr/MARS/");
          continue;
        }

        const today = new Date();
        const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        await openSalesOrder(page, null, iso);
        await fillLines(page, q.lines);

        await markEntered(q.quoteId, `자동입력 ${iso}`);
        ok++;
        log("  ✅ 매출 주문을 채웠습니다 — 전기는 안 했습니다");
        await page.goto("https://mars.tyremore.co.kr/MARS/");
        await page.waitForTimeout(1500);
      } catch (e) {
        skipped++;
        log(`  ⚠️ 실패: ${(e as Error).message.split("\n")[0]}`);
        await page.goto("https://mars.tyremore.co.kr/MARS/").catch(() => {});
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
