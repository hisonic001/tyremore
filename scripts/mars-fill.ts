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

/** 진단 스크린샷 저장 폴더 (2026-08-05 정리 — tyremore-data 루트에 어지르지 않는다) */
const SHOT_DIR = path.resolve(process.cwd(), "..", "tyremore-data", "스크린샷");

/**
 * ⭐ MARS 미등록 상품을 대신 넣는 **범용 품번** (사장님 결정 2026-08-04).
 *
 * 거래처 목록·손 등록으로 만든 상품(235개)은 MARS 마스터에 없다. 그 줄은 이 품번으로
 * 넣고 실제 상품명을 「설명 2」에 남긴다 — 금액·수량 실적은 정확하고 브랜드만 뭉개진다.
 *
 * 🔴 아직 **쓸 수 있는 범용 품번이 없다** (2026-08-04 실측).
 *    마스터에서 찾았던 후보 `580/001/00290`(이름 빈 10-TIRES 자리표시)를 실제로
 *    넣어 봤더니 **줄에 오류 두 개**가 떴다 — 마스터 설정이 미완성이라 MARS 가 거부한다.
 *    사장님이 MARS 에서 범용 품목을 하나 만들거나(또는 이 품목을 고치거나) 코드를
 *    주시면 .env.local 에 `MARS_FALLBACK_ITEM=코드` 로 넣는다. 그 전까지
 *    미등록 상품 줄은 **명확한 실패**로 알린다 — 깨진 줄을 만드는 것보다 낫다.
 */
const FALLBACK_ITEM = process.env.MARS_FALLBACK_ITEM ?? null;

const DRY = process.argv.includes("--dry");
/** 고객 생성 화면이 실제로 어떻게 생겼는지만 훑고 취소한다 — 아무것도 저장하지 않는다 */
const INSPECT = process.argv.includes("--inspect");
/**
 * 🔍 동의 표 시험 (2026-08-05) — 고객 생성 창에서 **동의 표까지만** 채워 보고
 *    (마케팅 거부 → 거부된 동의 + NONEED) 저장하지 않고 취소한다.
 *    NONEED 칸을 실제로 못 넣던 문제를 저장 없이 재현·검증하기 위한 것.
 *      npx tsx scripts/mars-fill.ts --try-consent
 */
const TRY_CONSENT = process.argv.includes("--try-consent");
/**
 * 🔍 기존 연락처에 차량 붙이기 탐침 (2026-08-05) — 렌트카처럼 **고객은 MARS 에 있는데
 *    차량만 없는** 경우를 위해, 생성 창의 「연락처에 첨부」에 기존 번호를 넣으면
 *    화면이 어떻게 변하는지 본다. **저장하지 않고 취소한다.**
 *      npx tsx scripts/mars-fill.ts --try-attach C583-016890
 */
const TRY_ATTACH = (() => {
  const i = process.argv.indexOf("--try-attach");
  return i >= 0 ? process.argv[i + 1] : null;
})();
/**
 * ⭐ 채워진 초안을 열어 **전기만 이어서** 한다 (2026-08-05).
 *    전기 오판/실패로 「주문은 채워졌는데 전기만 남은」 초안이 생길 때 쓴다.
 *      npx tsx scripts/mars-fill.ts --post-draft 165하4306 30000 [렌트카]
 *    끝나면 송장 번호를 보고한다 — 우리 DB 는 건드리지 않는다 (따로 맞춘다).
 */
const POST_DRAFT = (() => {
  const i = process.argv.indexOf("--post-draft");
  if (i < 0) return null;
  const pick = (k: number) => {
    const v = process.argv[i + k];
    return v && !v.startsWith("--") ? v : null;
  };
  return {
    plate: process.argv[i + 1],
    total: Number(process.argv[i + 2] ?? "0") || 0,
    /** 번호판 검색 색인이 늦을 때 쓸 고객 이름·전화 (고객 이력의 「열린 판매 문서」 경유) */
    name: pick(3),
    phone: pick(4),
  };
})();
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
 * ⭐ 대리인 모드 (2026-08-04) — 웹 버튼(`mars-agent.ts`)이 돌릴 때 붙인다.
 *    끝나면 브라우저를 닫고 스스로 종료한다. 사람이 옆에 없으니
 *    「Ctrl+C 를 누르세요」 하고 기다리면 안 된다.
 */
const AGENT = process.argv.includes("--agent");
/**
 * 🔍 기존 매출 주문을 열어 품목표의 **칸 이름(controlname)과 실제 값**을 찍는다.
 *    단가가 안 들어간 원인을 찾을 때 쓴다 (2026-08-04). 읽기만 하고 저장하지 않는다.
 *      npx tsx scripts/mars-fill.ts --probe-order 123테4567
 */
const PROBE_ORDER = (() => {
  const i = process.argv.indexOf("--probe-order");
  return i >= 0 ? process.argv[i + 1] : null;
})();
/**
 * 🔍 범용 품번 시험 (2026-08-05) — 지정한 번호판의 **기존 초안**을 열어
 *    FALLBACK_ITEM 을 줄 하나에 쳐 보고 MARS 가 받는지만 확인한다.
 *    전기는 하지 않는다. 지난번 후보(580/001/00290)가 목록엔 있는데 실제
 *    입력에서 거부됐기 때문에, 새 후보는 반드시 이걸로 먼저 확인한다.
 *      npx tsx scripts/mars-fill.ts --try-item 123테4567
 */
const TRY_ITEM = (() => {
  const i = process.argv.indexOf("--try-item");
  return i >= 0 ? process.argv[i + 1] : null;
})();
/**
 * 🔍 전기된 송장 확인 (2026-08-05) — 완료된 매출 송장 목록에서 번호판으로 줄들을 찍고,
 *    두 번째 인자(금액 등 줄에 든 글자, 또는 줄 번호)를 주면 그 송장을 열어
 *    번호와 품목 줄까지 읽는다. **읽기만 한다.**
 *      npx tsx scripts/mars-fill.ts --peek-invoices 123테4567 8,000
 */
const PEEK_INV = (() => {
  const i = process.argv.indexOf("--peek-invoices");
  if (i < 0) return null;
  const plate = process.argv[i + 1];
  const pick = process.argv[i + 2];
  return { plate, pick: pick && !pick.startsWith("--") ? pick : null };
})();
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
  /**
   * ⭐ 손님이 고른 **그대로** 넣는다 (사장님 지시 2026-08-04).
   *
   *   "고객이 동의 거부할시에는 고객 서명: 거부된 동의,
   *    불매치 코드: NONEED 로 바꿔야 함 (3가지 모두)."
   *
   * 드디어 불매치 코드를 알았다 — **NONEED**. 그동안은 코드를 몰라 거부를 못 넣고
   * 전부 수락으로 밀어 넣었는데(8/2 임시 결정), 이제 우리 기록과 MARS 가 같아진다.
   *   비즈니스 목적 · 제3자 제공 ← consent_privacy (필수 동의)
   *   마케팅 및 광고            ← consent_marketing
   */
  const PURPOSES: [string, boolean][] = [
    ["비즈니스 목적", c.consentPrivacy],
    ["제3자 제공", c.consentPrivacy],
    ["마케팅 및 광고", c.consentMarketing],
  ];

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
    let okTarget: Locator | null = null;
    for (const t of targets) {
      if (await t.selectOption(want).then(() => true).catch(() => false)) {
        signed = true;
        okTarget = t;
        break;
      }
      if (await t.selectOption({ label }).then(() => true).catch(() => false)) {
        signed = true;
        okTarget = t;
        break;
      }
    }
    /**
     * 🔴 골랐다고 믿지 않는다 — 고른 select 의 값을 읽어서 확인한다 (2026-08-05).
     *    사장님이 스크린샷으로 확인하셨다: 앱에서 마케팅을 체크 안 했는데 MARS 에는
     *    「수락된 동의」로 남아 있었다. 동의는 법적 기록이라 어긋나면 안 된다.
     */
    if (signed && okTarget) {
      await page.waitForTimeout(400);
      const nowVal = (await okTarget.inputValue().catch(() => "")) || "";
      const rowNow = ((await row.innerText().catch(() => "")) || "").replace(/\s+/g, " ");
      if (nowVal !== want && !rowNow.includes(label)) signed = false;
    }
    if (!signed) {
      throw new Error(`「${purpose}」의 고객 서명을 «${label}» 로 고치지 못했습니다 — 고객 등록을 멈춥니다 (동의 기록이 어긋나면 안 됩니다)`);
    }

    /**
     * ⭐ 거부된 동의에는 **불매치 코드 NONEED** (사장님 확인 2026-08-04).
     *    이걸 안 넣으면 「거부된 동의의 경우 "불매치 코드"을(를) 제공해야 합니다!」로
     *    저장이 막힌다. controlname 후보가 다 빗나가서 (2026-08-05 실측)
     *    **열 이름(aria-label)** 으로도 찾는다 — 편집 상태의 칸은 열 머리글이 이름이 된다.
     *
     * 🔴 끝내 못 넣으면 **수락으로 되돌리지 않는다** (사장님 지시 2026-08-05 —
     *    "체크를 안했으면 거부된 동의 → NONEED 로 바꾸는 것이 확실해지게").
     *    받지도 않은 동의를 「수락」으로 남기는 것이 최악이다. 등록을 멈추고 알린다.
     */
    if (!agreed) {
      // ⭐ 칸의 실제 이름은 **Disagreement Code** (2026-08-05 --try-consent 로 줄을 찍어 확인).
      //    "Mismatch" 후보들은 전부 헛짚었던 것 — 화면 이름(불매치 코드)과 영어가 다르다.
      const candidates: Locator[] = [
        row.locator('[controlname="Disagreement Code"]').first(),
        row.locator('[controlname*="Disagreement"]').first(),
        row.getByRole("textbox", { name: /불매치|Mismatch|Disagreement/i }).first(),
        row.locator('[controlname*="Mismatch"], [controlname*="Unmatch"]').first(),
      ];
      let coded = false;
      for (const cell2 of candidates) {
        if ((await cell2.count().catch(() => 0)) === 0) continue;
        await cell2.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(300);
        const input = await resolveInput(cell2);
        await input.fill("NONEED").catch(async () => {
          await input.evaluate(SET_VALUE, "NONEED").catch(() => {});
        });
        await input.press("Tab").catch(() => {});
        await page.waitForTimeout(500);
        // 🔴 편집 중인 칸은 innerText 가 비어 보인다 — **입력값을 되읽어** 확인한다
        //    (2026-08-05: 실제로는 NONEED 가 들어갔는데 innerText 검증이 놓쳐 실패 처리했다)
        const back = ((await readField(cell2)) || "").toUpperCase();
        const rowText = ((await row.innerText().catch(() => "")) || "").toUpperCase();
        if (back.includes("NONEED") || rowText.includes("NONEED")) {
          coded = true;
          log(`      「${purpose}」 거부 + 불매치 코드 NONEED ✓`);
          break;
        }
      }
      if (!coded) {
        // 마지막 수단 — 줄의 칸 이름을 전부 찍는다 (다음에 후보로 쓴다)
        const cells = row.locator("[controlname]");
        const nc = await cells.count().catch(() => 0);
        const names: string[] = [];
        for (let i = 0; i < Math.min(nc, 40); i++) {
          const cn = (await cells.nth(i).getAttribute("controlname").catch(() => null)) ?? "";
          if (cn) names.push(cn);
        }
        log(`      · 이 줄의 controlname 들: ${names.join(" | ").slice(0, 400)}`);
        const inputs = row.locator("input, select");
        const ni = await inputs.count().catch(() => 0);
        const als: string[] = [];
        for (let i = 0; i < Math.min(ni, 20); i++) {
          const al = (await inputs.nth(i).getAttribute("aria-label").catch(() => null)) ?? "";
          if (al) als.push(al);
        }
        if (als.length) log(`      · 입력칸 aria-label 들: ${als.join(" | ").slice(0, 300)}`);
        const shotC = path.resolve(SHOT_DIR, "mars-consent-fail.png");
        await page.screenshot({ path: shotC, fullPage: true }).catch(() => {});
        log(`      · 화면: ${shotC}`);
        throw new Error(`「${purpose}」 거부에 불매치 코드 NONEED 를 넣지 못했습니다 — 고객 등록을 멈춥니다 (수락으로 바꿔 넣지 않습니다)`);
      }
    }
    await page.waitForTimeout(300);
  }

  /** 🔍 동의 표 시험 — 여기까지만 하고 **저장하지 않고** 취소한다 */
  if (TRY_CONSENT) {
    const shot = path.resolve(SHOT_DIR, "mars-try-consent.png");
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    log(`    화면: ${shot}`);
    await f.getByRole("button", { name: "취소", exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    // 혹시 「저장하시겠습니까」류 확인 창이 뜨면 **저장하지 않는 쪽**을 누른다
    const dlg = f.locator('[controlname="Dialog"]').last();
    if (await dlg.isVisible({ timeout: 2000 }).catch(() => false)) {
      const said = ((await dlg.innerText().catch(() => "")) || "").replace(/\s+/g, " ");
      log(`    · 확인 창: «${said.slice(0, 80)}»`);
      const no = f.locator('button[controlname="Dialog"]', { hasText: "아니요" }).first();
      if (await no.isVisible().catch(() => false)) await no.click().catch(() => {});
      else await f.locator('button[controlname="Dialog"]', { hasText: "확인" }).first().click().catch(() => {});
    }
    throw new Error("--try-consent 이므로 저장하지 않았습니다 (시험 정상 종료)");
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

  /**
   * ② 뒤따르는 창 — 🔴 **내용을 읽고 나서** 누른다 (2026-08-04 실제 실행에서 발견).
   *
   * 전에는 뒤따라 뜨는 창을 무조건 「성공 확인 창」으로 알고 확인을 눌렀다.
   * 그런데 「거부된 동의의 경우 "불매치 코드"을(를) 제공해야 합니다!」 같은
   * **오류 팝업에도 확인 버튼이 있다.** 그걸 눌러 닫아 버리니 화면은 막힌 채인데
   * 로그에는 ✅ 가 찍혔다 — 세 번째 거짓 보고다. 오류면 여기서 멈춘다.
   */
  const second = f.locator('button[controlname="Dialog"]', { hasText: "확인" }).first();
  if (await second.isVisible({ timeout: 6000 }).catch(() => false)) {
    const saidBefore =
      (await f.getByRole("dialog").last().innerText().catch(() => "")) ||
      (await f.locator('[controlname="Dialog"]').last().innerText().catch(() => "")) ||
      "";
    const flat = saidBefore.replace(/\s+/g, " ").trim();
    if (/제공해야|입력해야|않습니다|없습니다|오류|잘못/.test(flat)) {
      await second.click().catch(() => {}); // 팝업은 닫아 준다 — 다음 건까지 막으면 안 된다
      throw new Error(`MARS 가 저장을 막았습니다: ${flat.replace(/확인\s*$/, "").slice(0, 120)}`);
    }
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

/**
 * ⭐ 기존 연락처에 **차량만** 새로 단다 (사장님 버그 제보 2026-08-05 — 렌트카).
 *
 * 「고객은 MARS 에 있는데 차량만 없다」는 경우가 실제로 있다: 차를 바꾼 손님,
 * 렌터카 회사처럼 차가 여러 대인 손님. 전에는 이 경우 「MARS 에 없는 차량입니다」로
 * 그냥 멈췄다 — 고객 생성 경로(연락 고객 차량 생성)는 **새 연락처 전용**이라서다
 * (「연락처에 첨부」는 회사 연락처만 받는다 — 탐침으로 확인, 2026-08-05).
 *
 * 길은 따로 있다: **마스터 데이터 → 차량 → 신규** 카드.
 * 「Contact No.」에 기존 연락처(C583-…)를 넣으면 고객 이름이 따라온다.
 */
async function createVehicleForContact(
  page: Page,
  contactNo: string,
  v: {
    plateNo: string;
    makerName: string | null;
    model: string | null;
    year: number | null;
    fuelType: string | null;
    mileage: number | null;
  },
) {
  const f = main(page);
  await page.goto(HOME);
  await waitHome(page, 40000);
  await clickAny(page, "마스터 데이터");
  await page.waitForTimeout(1200);
  await clickAny(page, "차량", 8000);
  await page.waitForTimeout(4000);
  await passBigSearchDialog(page);
  await clickAny(page, "신규", 8000);
  await page.waitForTimeout(4000);

  // 카드가 뜰 때까지 기다린다 — 「차량 카드」 제목의 빈 번호판 칸이 증거
  await f
    .getByRole("textbox", { name: "번호판 번호" })
    .first()
    .waitFor({ state: "visible", timeout: 25000 })
    .catch(() => {
      throw new Error("신규 차량 카드가 뜨지 않았습니다");
    });

  /** 오류 창이 뜨면 내용을 갖고 멈춘다 — 조용히 넘어가면 깨진 차량이 남는다 */
  const guard = async (what: string) => {
    const dlg = f.locator('[controlname="Dialog"]').last();
    if (!(await dlg.isVisible({ timeout: 1200 }).catch(() => false))) return;
    const said = ((await dlg.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (/않습니다|없습니다|제공해야|입력해야|오류|잘못/.test(said)) {
      await f.locator('button[controlname="Dialog"]', { hasText: "확인" }).last().click().catch(() => {});
      throw new Error(`차량 카드에서 MARS 가 막았습니다 (${what}): ${said.slice(0, 100)}`);
    }
    await f.locator('button[controlname="Dialog"]', { hasText: "확인" }).last().click().catch(() => {});
    await page.waitForTimeout(500);
  };

  /**
   * 🔴 controlname 은 여기서 못 쓴다 (2026-08-05 두 번 실패로 배움) —
   *    같은 이름이 목록 화면의 표(td)와 팩트박스에도 있어서 계속 헛짚었다.
   *    카드의 **화면 라벨**(번호판 번호·년도·주행거리…)로 잡는다. 라벨도 여러 개면
   *    뒤에서부터 보이는 것을 쓴다.
   */
  const one = async (l: Locator): Promise<Locator> => {
    const n = await l.count().catch(() => 0);
    for (let i = n - 1; i >= 0; i--) {
      if (await l.nth(i).isVisible().catch(() => false)) return l.nth(i);
    }
    return l.first();
  };

  // ① 연락처 (아래 「고객」 묶음에 있다) — 이걸 넣어야 차량이 그 손님에게 붙는다
  const contactCell = await one(f.getByRole("combobox", { name: "연락처", exact: true }));
  await contactCell.scrollIntoViewIfNeeded().catch(() => {});
  await fillField(page, "연락처", contactCell, contactNo);
  await page.waitForTimeout(2000);
  await guard("연락처");
  const owner =
    ((await readField(await one(f.getByRole("textbox", { name: "고객 이름" }))).catch(() => "")) || "").trim();
  log(`    · 연락처 ${contactNo} → 고객 이름 «${owner || "(못 읽음)"}»`);

  // ② 번호판
  await fillField(page, "번호판 번호", await one(f.getByRole("textbox", { name: "번호판 번호" })), v.plateNo);
  await page.waitForTimeout(800);
  await guard("번호판 번호");

  // ③ Vehicle Type (Fuel · Hybird · BEV · Diesel — MARS 표기 그대로. 라벨이 영문이다)
  if (v.fuelType) {
    const fuel = await resolveInput(await one(f.getByRole("combobox", { name: "Vehicle Type" })));
    const picked = await fuel.selectOption({ label: v.fuelType }).then(() => true).catch(() => false);
    if (!picked) log(`    ⚠️ Vehicle Type 「${v.fuelType}」를 못 골랐습니다`);
    await page.waitForTimeout(400);
  }

  // ④ 제조사·모델 — 고객 생성 창과 같은 값 형식
  if (v.makerName) {
    await fillField(page, "차량 제조사", await one(f.getByRole("combobox", { name: "차량 제조사" })), v.makerName);
    await page.waitForTimeout(600);
    await guard("차량 제조사");
  }
  if (v.model) {
    await fillField(page, "차량 모델", await one(f.getByRole("combobox", { name: "차량 모델" })), v.model);
    await page.waitForTimeout(600);
    await guard("차량 모델");
  }

  // ⑤ 년도 + 등록 날짜 (사장님 방식: 오늘 날짜에서 연도만 그 해로)
  if (v.year) {
    await fillField(page, "년도", await one(f.getByRole("textbox", { name: "년도" })), String(v.year));
    await page.waitForTimeout(400);
    const t = new Date();
    const md = `-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    const regCell = await one(f.getByRole("combobox", { name: "등록 날짜" }));
    const okReg =
      (await fillField(page, "등록 날짜", regCell, `${v.year}${md}`)) ||
      (await fillField(page, "등록 날짜", await one(f.getByRole("textbox", { name: "등록 날짜" })), `${v.year}${md}`));
    if (!okReg) log("    ⚠️ 등록 날짜를 못 넣었습니다");
    await page.waitForTimeout(400);
    await guard("등록 날짜");
  }

  // ⑥ 주행거리
  if (v.mileage) {
    await fillField(page, "주행거리", await one(f.getByRole("textbox", { name: "주행거리" })), String(v.mileage));
    await page.waitForTimeout(400);
  }
  await guard("마무리");
  const shotV = path.resolve(SHOT_DIR, "mars-vehcard.png");
  await page.screenshot({ path: shotV, fullPage: true }).catch(() => {});
  log(`    · 카드 화면: ${shotV}`);

  // 카드 머리글에서 차량 번호(V583-…)를 읽는다 — 저장 증거이자 중복 방지 열쇠
  let vehNo: string | null = null;
  const heads = f.getByRole("heading");
  const nh = await heads.count().catch(() => 0);
  for (let i = nh - 1; i >= 0 && !vehNo; i--) {
    if (!(await heads.nth(i).isVisible().catch(() => false))) continue;
    const m = /V\d{3}-\d{6}/.exec((await heads.nth(i).innerText().catch(() => "")) || "");
    if (m) vehNo = m[0];
  }
  log(`    · 차량 번호: «${vehNo ?? "(못 읽음)"}»`);

  // 카드는 자동 저장이다 — 홈으로 돌아가면 된다 (Escape 는 절대 누르지 않는다)
  await page.goto(HOME);
  await waitHome(page, 40000);
  return vehNo;
}

/**
 * ⭐ 번호판이 아니라 **이름(+전화)** 으로 고객을 찾아 줄을 선택해 둔다 (2026-08-05).
 *    갓 만든 차량은 번호판 검색 색인에 늦게 잡힌다 — 이름 검색은 바로 된다.
 *    줄을 클릭해 두면 「판매 내역」이 그 손님 기준으로 열린다.
 */
async function findCustomerByName(page: Page, name: string, phone: string | null): Promise<boolean> {
  const f = main(page);
  const box = f.getByRole("textbox", { name: "이름/번호판 번호" });
  // 직전에 번호판 검색을 하고 왔으면 이미 검색 화면이다 — 링크를 또 누르면 실패한다
  if (!(await box.isVisible({ timeout: 1500 }).catch(() => false))) {
    await clickAny(page, "고객 정보 검색");
    await passBigSearchDialog(page);
  }
  await box.waitFor({ timeout: 15000 });
  await box.fill(name);
  await box.press("Enter");
  await page.waitForTimeout(3000);
  // 같은 이름이 여럿일 수 있다(렌트카·AJ렌트카…) — 전화번호로 좁힌다
  let rows = f.locator("tr").filter({ hasText: name });
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (digits) rows = rows.filter({ hasText: digits });
  const row = rows.first();
  if (!(await row.isVisible({ timeout: 10000 }).catch(() => false))) return false;
  log(`    · 이름 검색: ${(((await row.innerText().catch(() => "")) || "").replace(/\s+/g, " ")).slice(0, 100)}`);
  await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(800);
  return true;
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
  //    🔴 **.last() 로 찾는다** (2026-08-05). 주문 화면은 「고객/차량 이력」 창 위에
  //    겹쳐 뜨는데 뒤층에도 Mileage 칸이 있다 — .first() 는 그 **안 보이는 뒤층 칸**을
  //    잡고 45초를 기다리다 죽었다 (화면에는 칸이 멀쩡히 보이는데도).
  //    전기 버튼에서 배운 층 규칙과 같다: 겹친 화면에서는 뒤(마지막)가 앞이다.
  const km = f.locator('[controlname="Mileage"]').last();
  await km.waitFor({ state: "visible", timeout: 45000 });
  if (mileage) await fillField(page, "현재 주행거리", km, String(mileage), { tab: false });

  /**
   * ② 문서 날짜 · 완료 일자 — **실제로 정비한 날**을 넣는다 (사장님 지시).
   *    "입력은 오늘 해도 실제 정비는 이전에 했을 수도 있음"
   */
  await fillField(page, "문서 날짜", f.locator('[controlname="Document Date"]'), dateISO, { tab: false });
  await fillField(page, "완료 일자", f.getByRole("combobox", { name: "완료 일자" }), dateISO);

  /**
   * 🔴 주행거리가 살아 있는지 다시 본다 — **비어 있어도 다시 넣는다** (2026-08-04).
   *
   * 사장님이 육안으로 확인하셨다: "주행거리가 입력되었다가 완료일자 입력 이후
   * 즈음에 사라지는 현상을 발견함." 8/2 에는 「빈 값 = 못 읽은 것일 수도」라며
   * 다시 넣지 않았는데, 실제로는 **지워진 것**이었다. 같은 값을 두 번 넣는 것은
   * 해가 없지만(덮어쓸 뿐), 빈 채로 두면 MARS 기록에서 주행거리가 사라진다.
   */
  if (mileage) {
    const kmNow = ((await readField(km)) || "").replace(/[\s,]/g, "");
    if (!kmNow.includes(String(mileage))) {
      log(`    · 주행거리가 «${kmNow || "(비어 있음)"}» 라 다시 넣습니다`);
      await fillField(page, "현재 주행거리", km, String(mileage), { tab: false });
      const kmAfter = ((await readField(km)) || "").replace(/[\s,]/g, "");
      log(`    · 주행거리 확인: «${kmAfter || "(못 읽음)"}»`);
    }
  }

  /**
   * ③ 결제 수단 코드 (사장님 확인)
   *    현금 CASH · 카드 CREDITCARD · 계좌이체 BANK
   *    외상은 여기까지 오지 않는다 — 호출 쪽에서 걸러 낸다.
   */
  if (payCode) {
    await fillField(page, "결제 수단 코드", f.locator('[controlname="<Payment Method Code_2>"]'), payCode);
    /**
     * 🔴 「결제 조건 코드」는 **건드리지 않는다** (사장님 지시 2026-08-05).
     *    "결제 수단 코드만 바꾸면 되고 결제 조건 코드는 건드리면 안되는 것 같아."
     *    수단을 고르면 MARS 가 조건을 알아서 맞춘다.
     */
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
  lines: { kind: string; no: string | null; qty: number; unitPrice: number; marsName: string; memo?: string | null }[],
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

    /**
     * 🔴 **MARS 가 이 품번을 아는지 확인한다** (사장님 질문 2026-08-04 —
     *    "mars에 코드가 없는 상품을 판매할 시에는 어떻게 해야할지").
     *
     * 거래처 목록·손 등록으로 만든 상품(KM+자재코드, ID-… 등) 235개는 MARS 마스터에
     * 없다. 엔터를 쳐도 상품이 안 실리는데 모르고 지나가면 **빈 품번에 수량·단가만 든
     * 깨진 줄**이 생긴다.
     *
     * ⭐ 모르는 품번이면 **범용 품번으로 대신 넣는다** (사장님 결정 2026-08-04 —
     *    "범용으로 타이어던 부품이던 넣을 만한 품번을 … 찾아줘").
     *    상품 마스터에서 찾은 것: `580/001/00290` — 이름이 비고 단가 0, 범주 10-TIRES.
     *    실제 상품명은 「설명 2」에 남겨 무엇을 팔았는지 알 수 있게 한다.
     *    금액·수량 실적은 정확히 잡히고, 브랜드 구분만 뭉개진다.
     */
    const clearDialog = async (): Promise<string> => {
      const dlg = f.locator('[controlname="Dialog"]').last();
      if (!(await dlg.isVisible({ timeout: 1500 }).catch(() => false))) return "";
      const said = ((await dlg.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      await f.locator('button[controlname="Dialog"]', { hasText: "확인" }).first().click().catch(() => {});
      await page.waitForTimeout(600);
      return said;
    };

    /**
     * 🔴 미등록 품번 판정은 **오류 창이 떴을 때만** 한다 (2026-08-04 세 번 고쳐 배운 것).
     *    처음엔 「상세 항목」 칸을 읽어 비면 미등록으로 봤는데, 그 칸은 편집 상태가
     *    아니면 늘 빈 값을 돌려준다 — 멀쩡한 126081 을 미등록으로 오판해
     *    범용 품번으로 갈아치웠다. 확실한 신호(오류 창)만 믿는다.
     */
    /**
     * 🔴 모르는 품번이면 오류 창 대신 **「매치 코드 검색」 창**이 뜨기도 한다 (2026-08-05 발견).
     *    친 코드가 검색어로 넘어가 「표시할 내용이 없음」이 뜬다 — 그 창이 뜬 것
     *    자체가 「마스터에 없는 품번」이라는 신호다. 취소로 닫고 대체 경로로 간다.
     *    (안 닫으면 화면을 막아서 뒤의 수량·단가 입력이 전부 실패한다.)
     */
    /**
     * 🔴 「매치 코드 검색」 창 판별 (2026-08-05, 네 번 고쳐 배운 것):
     *    ① 「매치 코드 검색」 글자로 찾으면 홈(뒤층) 메뉴의 같은 글자에 오탐한다.
     *    ② role=dialog 로 좁히면 진짜 창을 놓친다 (제목이 dialog 노드 밖).
     *    ③ 「비교 수량」 exact 일치도 놓쳤다 — 공백이 다르게 렌더링되는 듯하다.
     *    → 창에만 있는 칸 이름을 **정규식**으로 찾는다.
     */
    const closeMatchWin = async (timeout = 1500): Promise<boolean> => {
      // 🔴 .last() 는 못 쓴다 — 같은 글자가 **안 보이는 복제 노드**로도 존재해서
      //    마지막 것이 하필 숨은 노드면 창이 떠 있어도 false 가 났다 (2026-08-05, frame 덤프로 확인).
      //    **보이는 노드가 하나라도 있는지**를 직접 훑는다. 취소 버튼도 같은 함정이라 뒤에서부터 보이는 것을 누른다.
      const marks = f.getByText(/비교\s*수량|인벤토리\s*필터/);
      const until = Date.now() + timeout;
      let seen = false;
      do {
        const n = await marks.count().catch(() => 0);
        for (let i = 0; i < n && !seen; i++) {
          if (await marks.nth(i).isVisible().catch(() => false)) seen = true;
        }
        if (!seen) await page.waitForTimeout(250);
      } while (!seen && Date.now() < until);
      if (!seen) return false;
      const cancels = f.getByRole("button", { name: "취소" });
      const nc = await cancels.count().catch(() => 0);
      for (let i = nc - 1; i >= 0; i--) {
        if (await cancels.nth(i).isVisible().catch(() => false)) {
          await cancels.nth(i).click().catch(() => {});
          break;
        }
      }
      await page.waitForTimeout(900);
      return true;
    };

    /**
     * 🔴 품번 엔터 후에는 **신호가 잡힐 때까지 기다린다** (최대 15초, 2026-08-05).
     *    고정 2초 대기로는 서버가 느린 날 매치 창을 놓치고 지나가 줄이 깨졌다.
     *    신호 셋 중 하나는 반드시 온다:
     *      · 오류 창                   → 미등록 품번
     *      · 매치 코드 검색 창          → 미등록 품번 (닫고 대체)
     *      · 측정 단위 칸이 채워짐(PCS) → 품목이 실렸다
     *    15초 다 지나도 아무 신호가 없으면 실린 것으로 보고 넘어간다 —
     *    안 실렸으면 뒤의 수량·단가 되읽기 검증이 잡는다.
     */
    const settleItemNo = async (): Promise<{ dlg: string; match: boolean }> => {
      const uomCell = row.locator('[controlname="Unit of Measure Code"]').first();
      const until = Date.now() + 15000;
      while (Date.now() < until) {
        const dlg = await clearDialog();
        if (dlg) return { dlg, match: false };
        if (await closeMatchWin(400)) return { dlg: "", match: true };
        const u = ((await readField(uomCell).catch(() => "")) || "").trim();
        if (u) return { dlg: "", match: false };
        await page.waitForTimeout(700);
      }
      return { dlg: "", match: false };
    };

    const s1 = await settleItemNo();
    const noDlg = s1.dlg;
    const wasMatchWin = s1.match;
    let usedFallback = false;
    if (wasMatchWin || /찾을 수 없|존재하지 않|않습니다|없습니다/.test(noDlg)) {
      if (!FALLBACK_ITEM) {
        throw new Error(
          `MARS 에 없는 품번입니다: ${l.no} «${l.marsName}» — 범용 품번이 아직 없어 이 줄은 직접 처리해 주세요` +
            ` (MARS: ${noDlg.slice(0, 80)})`,
        );
      }
      log(`      ⚠️ MARS 에 없는 품번 ${l.no} — 범용 품번 ${FALLBACK_ITEM} 으로 대신 넣습니다`);
      await noCell.click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(300);
      const no2 = await resolveInput(noCell);
      await no2.fill(FALLBACK_ITEM).catch(async () => {
        await no2.evaluate(SET_VALUE, FALLBACK_ITEM).catch(() => {});
      });
      await no2.press("Enter");
      await page.waitForTimeout(2000);
      const s2 = await settleItemNo();
      if (s2.dlg || s2.match) {
        throw new Error(
          `범용 품번 ${FALLBACK_ITEM} 도 MARS 가 거부했습니다: ${s2.match ? "매치 코드 검색 창이 떴습니다 (마스터에 없음)" : s2.dlg.slice(0, 80)}`,
        );
      }
      usedFallback = true;
    }

    /**
     * 🔴 수량도 **넣고 읽어서 확인한다** (2026-08-04).
     *    단가를 고치고 나니 이번엔 수량 2가 안 먹고 1로 남아 합계가 370,000 이 됐다.
     *    SET_VALUE(값 대입)는 이 표에서 조용히 실패할 때가 있다 — **fill(실제 타이핑)** 이
     *    확실하다. 그래도 읽어서 다르면 한 번 더 시도하고, 끝내 다르면 그 줄은 실패다.
     */
    const qtyCell = row.locator('[controlname="Quantity"]').first();
    let qtyOk = false;
    for (let attempt = 0; attempt < 2 && !qtyOk; attempt++) {
      await qtyCell.click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(300);
      const qty = await resolveInput(qtyCell);
      await qty.fill(String(l.qty)).catch(async () => {
        await qty.evaluate(SET_VALUE, String(l.qty)).catch(() => {});
      });
      await qty.press("Enter").catch(() => {});
      await page.waitForTimeout(700);
      const back = ((await readField(qtyCell)) || "").replace(/[,\s]/g, "");
      if (back === String(l.qty)) {
        qtyOk = true;
        if (l.qty !== 1) log(`      수량 ${l.qty} ✓`);
      } else if (back) {
        log(`      수량 시도 → 칸에는 «${back}» (다시)`);
      }
    }
    if (!qtyOk) {
      throw new Error(`${l.no} 줄의 수량 ${l.qty}을 넣지 못했습니다`);
    }

    /**
     * ⭐ MARS 도 「단가 부가세 포함」으로 받는다 — 우리 판매가와 기준이 같다.
     *    **탭**을 눌러야 「합계 부가세 포함」이 다시 계산된다 (사장님 확인).
     *
     * 🔴 **넣었다고 믿지 않는다 — 읽어서 확인한다** (2026-08-04 실제 실행에서 발견).
     *    `controlname="Unit Price"` 로 넣던 값이 **한 줄도 안 들어가고** MARS 기본단가가
     *    남아 있었다 (얼라인먼트 88,000 · 배터리 22,000). 클릭·입력이 조용히 실패해도
     *    로그엔 ✅ 가 찍혔다. 칸 이름 후보를 차례로 시도하고, 읽어서 값이 맞아야 넘어간다.
     *    끝내 못 넣으면 **그 줄을 실패로 처리한다** — 단가가 틀리면 실적 금액이 틀린다.
     */
    const PRICE_CELLS = [
      "Unit Price Incl. VAT",
      "KOR Unit Price Incl. VAT",
      "Unit Price Including VAT",
      "Unit Price",
    ];
    let priceOk = false;
    for (const cn of PRICE_CELLS) {
      const cell = row.locator(`[controlname="${cn}"]`).first();
      if ((await cell.count().catch(() => 0)) === 0) continue;
      await cell.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(300);
      const price = await resolveInput(cell);
      await price.fill(String(l.unitPrice)).catch(async () => {
        await price.evaluate(SET_VALUE, String(l.unitPrice)).catch(() => {});
      });
      await price.press("Tab").catch(() => {});
      await page.waitForTimeout(900);
      const back = ((await readField(cell)) || "").replace(/[,\s]/g, "");
      if (back === String(l.unitPrice)) {
        priceOk = true;
        log(`      단가 ${l.unitPrice.toLocaleString()} ← ${cn} ✓`);
        break;
      }
      if (back) log(`      단가 시도 ${cn} → 칸에는 «${back}» (계속 시도)`);
    }
    if (!priceOk) {
      // 마지막 수단 — 줄 전체 글자에 우리 단가가 있으면 들어간 것으로 본다
      const rowText = ((await row.innerText().catch(() => "")) || "").replace(/\s/g, "");
      if (rowText.includes(l.unitPrice.toLocaleString())) {
        priceOk = true;
        log(`      단가 ${l.unitPrice.toLocaleString()} — 줄에서 확인 ✓`);
      }
    }
    if (!priceOk) {
      throw new Error(
        `${l.no} 줄의 단가 ${l.unitPrice.toLocaleString()}원을 넣지 못했습니다 — MARS 기본단가가 남아 있습니다`,
      );
    }

    /**
     * ⭐ 메모는 **그 줄의 「설명 2」 칸을 지우고** 그 안에 넣는다 (사장님 지시 2026-08-07).
     *    전에는 판매 전체 메모 하나를 첫 줄에만 넣었는데, 이제 판매 등록에서
     *    **줄마다** 메모를 받아 각자 자기 줄 설명 2 로 들어간다.
     *    결제 메모(quote.payment_memo)는 우리 기록용 — MARS 에 넣지 않는다.
     *    메모가 없으면 손대지 않는다 — 멀쩡한 기본값(규격·모델명)을 지울 이유가 없다.
     */
    /**
     * ⭐ 범용 품번으로 넣은 줄은 **실제 상품명을 설명 2에** 남긴다 —
     *    안 남기면 나중에 「이게 뭘 판 줄이지?」를 아무도 모른다.
     *    줄 메모와 겹치면 「상품명 · 메모」로 붙인다.
     */
    const d2Text = [usedFallback ? l.marsName : null, l.memo?.trim() || null]
      .filter(Boolean)
      .join(" · ");
    if (d2Text) {
      const d2 = await resolveInput(
        (await row.locator('[controlname="Description 2"]').count().catch(() => 0)) > 0
          ? row.locator('[controlname="Description 2"]')
          : row.getByRole("textbox", { name: "설명 2" }),
      );
      if (await d2.isVisible().catch(() => false)) {
        await d2.click({ timeout: 6000 }).catch(() => {});
        const ok = await d2.fill(d2Text).then(() => true).catch(() => false);
        if (!ok) await d2.evaluate(SET_VALUE, d2Text).catch(() => {});
        await d2.press("Tab").catch(() => {});
        await page.waitForTimeout(700);
        log(`      설명 2 → «${d2Text.slice(0, 40)}»`);
      } else {
        log("      ⚠️ 「설명 2」 칸을 못 찾았습니다");
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

/**
 * ⭐ 전기(Posting) — 이제 자동으로 한다 (사장님 결정 2026-08-04).
 *
 *   "사실 전기까지 자동으로 완료가 되어야함. 이유는 전기를 하는 것이 생각보다
 *    복잡해서 사람 손이 많이 들어감. 전기, 전기 후 차량 점검 완료까지 원스톱으로."
 *
 * 🔴 8/2 의 「전기는 사람이 누른다」(D-08) 결정이 **사장님 지시로 뒤집혔다.**
 *    대신 안전장치 하나를 남긴다: **합계 대조가 일치할 때만** 전기한다.
 *    전기는 취소가 번거로우니(대변 전표) 금액이 어긋난 채로 넘기지 않는다 —
 *    그 경우 주문을 초안으로 남기고 사람에게 알린다.
 *
 * 매출 주문 카드에서: 「전기」 → 「출하 및 송장」 → 확인.
 */
async function postOrder(
  page: Page,
): Promise<{ ok: boolean; invoiceNo: string | null; why?: string; unsure?: boolean }> {
  const f = main(page);

  /**
   * 🔴 화면의 송장 번호는 **전기 전에도 있다** (2026-08-05 실제 사고 — 렌트카).
   *    주문 화면 뒤층의 고객/차량 이력에 그 손님의 **옛 송장 번호**가 깔려 있어서,
   *    전기가 실패했는데 옛 번호(…SI+001742)를 주워 「전기 완료」로 기록했다.
   *    → 전기 **전**의 번호들을 적어 두고, 끝난 뒤 **새로 나타난 번호만** 증거로 인정한다.
   */
  const scanSIs = async (): Promise<Set<string>> => {
    const body = ((await f.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, "");
    return new Set(body.match(/\d{8}-\d{2}SI\+\d{6}/g) ?? []);
  };
  const beforeSIs = await scanSIs();

  /**
   * 🔴 다섯 번째 시도 끝에 배운 것 (2026-08-04):
   *   · 주문 화면은 홈 **위에 겹쳐진 층**이다. 앞에서부터 세면 뒤에 깔린 홈 메뉴
   *     수십 개가 먼저 잡혀 위층의 「전기...」에 못 닿는다.
   *   · F9(BC 표준 전기 단축키)는 이 화면에서 아무 일도 안 한다.
   *   → 「전기」 묶음을 연 뒤, **DOM 끝에서부터 거꾸로** 찾는다.
   *     팝업 메뉴는 문서 끝에 붙는다 — 끝에서 처음 만나는 「전기...」가 위층 것이다.
   */
  try {
    await clickAny(page, "전기", 8000);
  } catch {
    return { ok: false, invoiceNo: null, why: "「전기」 메뉴를 찾지 못했습니다" };
  }
  await page.waitForTimeout(1000);

  /** 글자 「전기...」를 직접 찾는다. 못 찾으면 묶음을 한 번 더 눌러(토글) 다시 찾는다 */
  let pressed = false;
  for (let attempt = 0; attempt < 2 && !pressed; attempt++) {
    const t = f.getByText("전기...", { exact: true });
    const nT = await t.count().catch(() => 0);
    log(`    · 「전기...」 글자 ${nT}개 발견`);
    for (let i = nT - 1; i >= 0; i--) {
      if (!(await t.nth(i).isVisible().catch(() => false))) continue;
      await t.nth(i).click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1800);
      pressed = true;
      break;
    }
    if (!pressed) {
      const shot = path.resolve(SHOT_DIR, "mars-전기메뉴.png");
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      log(`    · 「전기...」가 안 보여 묶음을 다시 누릅니다 (화면: ${shot})`);
      await clickAny(page, "전기", 5000).catch(() => {});
      await page.waitForTimeout(1000);
    }
  }
  if (!pressed) {
    return { ok: false, invoiceNo: null, why: "「전기...」 항목이 화면에 나타나지 않았습니다" };
  }

  /**
   * 전기 방식 고르기 — 이 화면의 선택지는 「배송 / 송장 / **배송 및 송장**」이다
   * (2026-08-04 진단 실행으로 확인 — BC 표준 문서의 「출하」가 여기선 「배송」이다).
   * 「배송 및 송장」이어야 재고 출하와 송장이 한 번에 끝난다.
   * 🔴 대화상자 **안에서만** 찾는다 — 화면 전체에서 찾으면 뒤층의 글자를 잡는다.
   */
  /**
   * 🔴 .last() dialog 는 **안 보이는 복제 노드**를 잡을 수 있다 (매치 창에서 배운 것).
   *    보이는 dialog 들을 훑어 「배송 및 송장」 선택지가 든 것을 찾는다.
   *
   * 🔴 선택지를 못 찾으면 **기본값으로 진행하지 않는다** (2026-08-05, Q26-0805-003).
   *    기본값은 「배송」이라 재고만 출하되고 송장이 안 만들어진다 — 어중간하게
   *    전기된 주문이 남아 사람이 수습해야 했다. 못 찾으면 취소하고 실패로 알린다.
   */
  let postDlg: Locator | null = null;
  let ship: Locator | null = null;
  {
    const until = Date.now() + 8000;
    while (Date.now() < until && !ship) {
      const dlgs = f.getByRole("dialog");
      const nd = await dlgs.count().catch(() => 0);
      for (let i = nd - 1; i >= 0 && !ship; i--) {
        const d = dlgs.nth(i);
        if (!(await d.isVisible().catch(() => false))) continue;
        const opt = d.getByText(/배송 및 송장|출하 및 송장/).first();
        if (await opt.isVisible().catch(() => false)) {
          postDlg = d;
          ship = opt;
        } else if (!postDlg) {
          postDlg = d; // 선택지 없는 대화상자라도 기억해 둔다 — 취소할 때 쓴다
        }
      }
      if (!ship) await page.waitForTimeout(500);
    }
  }
  if (!postDlg) {
    return { ok: false, invoiceNo: null, why: "전기 대화상자가 뜨지 않았습니다" };
  }
  if (!ship) {
    const said = ((await postDlg.innerText().catch(() => "")) || "").replace(/\s+/g, " ").slice(0, 120);
    await postDlg.getByRole("button", { name: "취소", exact: true }).last().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    return {
      ok: false,
      invoiceNo: null,
      why: `「배송 및 송장」 선택지를 못 찾아 전기를 취소했습니다 (창 내용: ${said})`,
    };
  }
  await ship.click().catch(() => {});
  await page.waitForTimeout(400);
  await postDlg.getByRole("button", { name: "확인", exact: true }).last().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(5000);

  /** 결과 창들을 하나씩 읽는다 — 오류면 멈추고, 「여시겠습니까」면 연다 */
  for (let i = 0; i < 4; i++) {
    const dlg = f.locator('[controlname="Dialog"]').last();
    if (!(await dlg.isVisible({ timeout: 2500 }).catch(() => false))) break;
    const said = ((await dlg.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();

    if (/여시겠습니까|열겠습니까|open/i.test(said)) {
      // 「전기된 송장을 여시겠습니까?」 → 예 (점검 화면으로 바로 이어진다)
      const yes = f.getByRole("button", { name: /^(예|Yes)$/ }).last();
      if (await yes.isVisible({ timeout: 2000 }).catch(() => false)) await yes.click().catch(() => {});
      else await f.locator('button[controlname="Dialog"]', { hasText: "확인" }).last().click().catch(() => {});
      await page.waitForTimeout(4000);
      continue;
    }
    if (/않습니다|없습니다|제공해야|입력해야|오류|잘못|부족/.test(said)) {
      await f.locator('button[controlname="Dialog"]', { hasText: "확인" }).last().click().catch(() => {});
      return { ok: false, invoiceNo: null, why: said.replace(/확인\s*$/, "").slice(0, 140) };
    }
    // 그 밖의 안내 창은 닫고 계속
    await f.locator('button[controlname="Dialog"]', { hasText: "확인" }).last().click().catch(() => {});
    await page.waitForTimeout(1500);
  }

  /**
   * 전기가 됐다는 증거 — **전기 후 새로 나타난** 송장 번호만 인정한다.
   * 🔴 자릿수를 못박는다 (8-2SI+6): 공백을 지우고 찾기 때문에 느슨한 패턴은
   *    옆 숫자와 붙어 «0461168583-23SI+00317610000» 같은 오염 번호를 만든다
   *    (2026-08-04 Q26-0804-006, 2026-08-05 run#22 두 번 실제로 그랬다).
   */
  const afterSIs = await scanSIs();
  const fresh = [...afterSIs].filter((x) => !beforeSIs.has(x));
  if (fresh.length === 1) {
    log(`    · 전기 완료 — 송장 ${fresh[0]}`);
    return { ok: true, invoiceNo: fresh[0] };
  }
  if (fresh.length > 1) {
    log(`    · 새 송장 번호가 여러 개 보입니다 (${fresh.join(", ")}) — 송장 목록에서 확정합니다`);
  }
  /**
   * 화면만으로는 못 정한다 — **모르겠다**고 답한다.
   * 🔴 실제로 전기가 성공했는데 「주문 화면이 그대로」라며 실패로 적은 일이 있었다
   *    (2026-08-04 — 그 바람에 같은 주문을 몇 번이나 다시 만들었다).
   *    호출한 쪽이 「완료된 매출 송장 목록」에서 번호판·날짜·금액으로 확인한다.
   */
  return { ok: false, invoiceNo: null, unsure: true, why: "화면으로는 전기 여부를 확정하지 못했습니다" };
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
 * 그 줄의 **맨 오른쪽 등급 칸**을 켠다 — 100%(매우 양호) 또는 타이어의 8mm.
 *
 * ⭐ 타이어 트레드 표(교체·2mm~8mm)에도 그대로 쓴다 (사장님 지시 2026-08-07) —
 *    8mm 가 맨 오른쪽이라 규칙이 같다. 교체 안 한 바퀴가 이 함수로 8mm 를 받는다.
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

  /**
   * 🔴 2026-08-04 실전에서 다시 배운 것:
   *   · 「Value N」 칸을 눌러도 **칸만 선택되고 체크박스는 안 켜진다** —
   *     칸 안의 체크박스를 직접 눌러야 한다 (타이어의 Replace 체크와 같은 방식).
   *   · 성공 판정을 줄 글자 「100」에 기대면 안 된다 — **aria-checked** 를 읽는다.
   *   · 표마다 열 수가 달라도(브레이크 30/70/100 · 기타 0/100)
   *     **맨 오른쪽 체크박스가 100%** 라는 것은 같다 (화면으로 확인).
   */
  await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(300);

  const boxes = row.locator('input[type="checkbox"], [role="checkbox"]');
  const n = await boxes.count().catch(() => 0);
  for (let i = n - 1; i >= 0; i--) {
    const box = boxes.nth(i);
    if (!(await box.isVisible().catch(() => false))) continue;
    const checked = async () =>
      (await box.getAttribute("aria-checked").catch(() => null)) === "true" ||
      (await box.isChecked().catch(() => false));
    if (await checked()) return true; // 이미 켜져 있다 (다시 돌린 경우)
    await box.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(450);
    if (await checked()) return true;
    // 안 켜졌으면 칸을 먼저 활성화하고 한 번 더
    await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await box.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(450);
    if (await checked()) return true;
    return false; // 맨 오른쪽이 안 켜지면 다른 칸(70%…)을 켜면 안 된다 — 실패로 알린다
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

/**
 * ⭐ 고른 줄의 송장을 **연다** (2026-08-04).
 *
 * 🔴 `row.locator('[controlname="No."]').click()` 이 10초를 기다리다 죽었다.
 *    `controlname="No."` 는 **감싸는 칸**이고 실제로 눌리는 것은 그 안의 링크다
 *    (`controlname` 이 상자일 때도 입력칸일 때도 있는 것과 같은 사정 — resolveInput 참조).
 *    사장님 조작 기록에는 `button "61168583-23SI+003137" controlname=No.` 로 남아 있다.
 *    → **송장번호를 이름 삼아 버튼을 누른다.**
 *
 * 🔴 눌렀다고 믿지 않는다. 송장 카드에서만 보이는 「탐색」이 떴는지 확인한다.
 */
async function openInvoice(page: Page, row: Locator): Promise<boolean> {
  const f = main(page);
  const flat = ((await row.innerText().catch(() => "")) || "").replace(/\s+/g, "");
  const no = /\d{8}-\d{2}SI\+\d{6}/.exec(flat)?.[0] ?? null;

  await row.scrollIntoViewIfNeeded().catch(() => {});
  // 줄을 먼저 눌러 활성으로 만든다 — 목록에서 다른 줄이 잡혀 있으면 링크가 안 먹는다
  await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(600);

  const opened = async () =>
    await f
      .getByRole("menuitem", { name: "탐색" })
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);
  if (await opened()) return true;

  const tries: Locator[] = [];
  if (no) tries.push(f.getByRole("button", { name: no, exact: false }).first());
  tries.push(row.locator('[controlname="No."] a, [controlname="No."] button').first());
  tries.push(row.locator('[controlname="No."]').first());

  for (const t of tries) {
    if (!(await t.isVisible().catch(() => false))) continue;
    await t.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    if (await opened()) return true;
  }
  return false;
}

/**
 * ⭐ 판매한 **서비스 이름**으로 어떤 항목을 실제로 교환·조정했는지 정한다
 *    (사장님 지시 2026-08-05):
 *
 *   "얼라이먼트 조정, 엔진오일 교환, 브레이크 패드 교환, 배터리 교환 시에도
 *    여전히 100%에 체크하고 완료함. 교체 혹은 교환시(단순 점검시에는 아님)에는
 *    100%가 아닌 교체 체크란에 체크하도록."
 *
 * 🔴 「점검」이 들어간 서비스(배터리 점검 등)는 교체가 아니다 — 100% 그대로.
 * ⚠️ 패드는 서비스 이름에 앞/뒤가 없으면 **전륜**으로 표시한다 (가장 흔한 경우) —
 *    뒤 패드였으면 점검표에서 고쳐 주셔야 한다. 이름에 후륜·리어·뒤·슈가 있으면 후륜.
 */
type ReplacedItems = {
  padFront: boolean;
  padRear: boolean;
  alignment: boolean;
  battery: boolean;
  engineOil: boolean;
};

function replacedFromServices(names: (string | null)[]): ReplacedItems {
  const done: ReplacedItems = { padFront: false, padRear: false, alignment: false, battery: false, engineOil: false };
  for (const raw of names) {
    const n = (raw ?? "").replace(/\s+/g, "");
    if (!n || /점검/.test(n)) continue;
    if (/엔진오일/.test(n)) done.engineOil = true;
    if (/배터리/.test(n)) done.battery = true;
    if (/얼라이|얼라인/.test(n)) done.alignment = true;
    if (/패드|라이닝|브레이크슈/.test(n)) {
      // 드럼·라이닝·슈는 후륜이다 — 점검표의 후륜 줄 이름이 「패드/슈」인 것과 같은 이치
      if (/후륜|리어|뒤|드럼|라이닝|슈/.test(n)) done.padRear = true;
      else done.padFront = true;
    }
  }
  return done;
}

/**
 * 점검표 줄의 **교체(Replace) 체크박스**를 켠다 — 타이어와 같은 칸이다.
 * setGrade100 과 같은 규칙: aria-checked 로 확인하고, 못 켜면 실패로 알린다
 * (교체를 못 표시했다고 100% 를 대신 켜지 않는다 — 그건 거짓 기록이다).
 */
async function setReplace(page: Page, rowText: string): Promise<boolean> {
  const f = main(page);
  const row = f.getByRole("row").filter({ hasText: rowText }).first();
  if (!(await row.isVisible().catch(() => false))) return false;
  await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(300);
  const rep = row.locator('[controlname="Replace"]').first();
  if ((await rep.count().catch(() => 0)) === 0) return false;
  const checked = async () =>
    (await rep.getAttribute("aria-checked").catch(() => null)) === "true" ||
    (await rep.isChecked().catch(() => false));
  if (await checked()) return true;
  await rep.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(400);
  if (await checked()) return true;
  await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
  await rep.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(400);
  return checked();
}

/** 판매한 타이어 본수로 어느 바퀴를 갈았는지 정한다 */
function wheelsFor(qty: number): string[] {
  const all = ["전륜 좌측", "전륜 우측", "후륜 좌측", "후륜 우측"];
  if (qty >= 4) return all;
  if (qty === 2) return ["전륜 좌측", "전륜 우측"]; // 2본이면 보통 앞이다
  return all.slice(0, Math.max(1, qty));
}

/**
 * 점검 상태를 읽는다.
 *
 * 🔴 `readField`(inputValue) 로만 읽으면 안 된다 — Status 는 입력칸이 아니라
 *    **읽기 전용 표시**라 빈 문자열이 나온다. 그것 때문에 이미 제출된 점검을
 *    「빈 것」으로 보고 값을 써 넣었다 (2026-08-04).
 */
async function readStatus(f: FrameLocator): Promise<string> {
  const el = f.locator('[controlname="Status"]').first();
  const v = ((await readField(el).catch(() => "")) || "").trim();
  if (v) return v;
  return ((await el.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
}

async function fillVehicleCheck(
  page: Page,
  opts: { plateNo: string; tyreQty: number; replaced?: ReplacedItems; wheels?: string[] },
): Promise<{ ok: boolean; missed: string[]; already?: boolean }> {
  const f = main(page);
  await clickAny(page, "탐색");
  await page.waitForTimeout(700);
  await clickAny(page, "전기 후 차량 점검");
  await page.waitForTimeout(3500);

  /**
   * 🔴 **이미 제출된 점검은 건드리지 않는다** (2026-08-04 실제 실행에서 확인).
   *
   * `56가6433` 을 열었더니 `Status: Submitted` 였다 — 사장님이 8월 3일에 직접
   * 제출해 두신 것이다. 제출된 점검은 잠겨 있어 값이 안 들어가는데, 코드는
   * 「항목을 하나도 못 찾았다」며 실패로 처리했다. 실패가 아니라 **이미 끝난 것**이다.
   *
   * ⚠️ 취소하고 다시 열어서 덮어쓰지 않는다. 사장님이 직접 보고 넣으신 값이
   *    우리가 짐작으로 채운 100% 보다 정확하다.
   */
  const status = await readStatus(f);
  log(`      점검 상태: ${status || "(못 읽음)"}`);
  if (/submit|제출|released|승인|complete/i.test(status)) {
    log("      이미 제출된 점검입니다 — 그대로 둡니다");
    return { ok: true, missed: [], already: true };
  }
  /**
   * 🔴 상태를 **못 읽으면 손대지 않는다** (2026-08-04).
   *    처음엔 `readField` 로만 읽었는데 Status 는 입력칸이 아니라 빈 문자열이 나왔고,
   *    그래서 이미 제출된 점검을 「빈 것」으로 보고 값을 써 넣었다.
   *    모르면 멈추는 편이 낫다 — 손님 점검표는 덮어쓰면 되돌릴 수 없다.
   */
  if (!status) return { ok: false, missed: ["점검 상태를 읽지 못해 손대지 않았습니다"] };

  /** 👀 보기만 하는 모드는 여기까지 — 아무것도 쓰지 않는다 */
  if (LOOK) return { ok: true, missed: [], already: false };

  // 방문 이유 — 타이어 교체는 CHANGE
  const reason = f.locator('[controlname="Reason for Visit"]').first();
  if (await reason.isVisible().catch(() => false)) {
    await reason.fill("CHANGE").catch(() => {});
    await reason.press("Tab").catch(() => {});
    await page.waitForTimeout(800);
  }

  const missed: string[] = [];

  /**
   * 🔴 섹션 제목(타이어·브레이크…)은 **토글**이다 (2026-08-04 — 라인 섹션과 같은 함정).
   *    무조건 누르면 열려 있던 것을 닫는다. 지난 실행이 열어 둔 상태가 남아 있어서
   *    한 번은 되고 다음 번은 안 되는 널뛰기가 생겼다.
   *    → **찾는 행이 안 보일 때만** 누른다. 눌러도 안 보이면 한 번 더 (닫힘→열림).
   */
  const openSection = async (title: string, probeRow: string) => {
    for (let k = 0; k < 3; k++) {
      const visible = await f
        .getByRole("row")
        .filter({ hasText: probeRow })
        .first()
        .isVisible({ timeout: 1500 })
        .catch(() => false);
      if (visible) return true;
      await clickAny(page, title, 5000).catch(() => {});
      await page.waitForTimeout(1200);
    }
    return false;
  };

  // ① 타이어 — 간 바퀴는 「교체」, 안 간 바퀴는 「8mm」 (사장님 지시 2026-08-07).
  //    ⭐ 판매 등록에서 바퀴를 골라 주셨으면 **그 선택 그대로** (사장님 요청 2026-08-05).
  //       안 골랐으면 지금처럼 본수로 짐작한다.
  //    ⭐ 교체 안 한 바퀴도 비워 두지 않는다 — 트레드 표의 8mm 칸에 체크한다.
  //       타이어 표 열은 「교체 · 2mm · 3mm · … · 8mm」 순서라 **8mm 가 맨 오른쪽**이다.
  //       그래서 다른 항목의 100%(맨 오른쪽 체크박스)와 같은 setGrade100 을 그대로 쓴다 —
  //       맨 오른쪽이 안 켜져도 7mm 로 물러서지 않는 안전장치까지 동일하게 받는다.
  await openSection("타이어", "타이어 - 전륜");
  const wheels = opts.wheels?.length ? opts.wheels : wheelsFor(opts.tyreQty);
  const ALL_WHEELS = ["전륜 좌측", "전륜 우측", "후륜 좌측", "후륜 우측"];
  for (const w of ALL_WHEELS) {
    if (wheels.includes(w)) {
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
    } else {
      const done = await setGrade100(page, `타이어 - ${w}`);
      log(`      타이어 ${w} — ${done ? "8mm 표시 (교체 안 함)" : "⚠️ 8mm 표시를 못 넣었습니다"}`);
      if (!done) missed.push(`타이어 ${w} (8mm)`);
    }
  }

  /**
   * ②③④⑤ 나머지 필수 항목.
   *   브레이크는 **패드만** — 디스크는 필수가 아니다 (사장님 확인).
   *
   * ⭐ 이번 판매에서 실제로 **교환·조정한 항목은 100% 가 아니라 교체 칸**에 표시한다
   *    (사장님 지시 2026-08-05 — "단순 점검시에는 아님"). 나머지는 지금처럼 100%.
   */
  const rep = opts.replaced ?? { padFront: false, padRear: false, alignment: false, battery: false, engineOil: false };
  const REST: [string, string, boolean][] = [
    ["브레이크", "패드 - 전륜", rep.padFront],
    ["브레이크", "패드/슈 - 후륜", rep.padRear],
    ["얼라인먼트", "얼라이먼트", rep.alignment],
    ["배터리", "배터리", rep.battery],
    ["기타", "엔진오일", rep.engineOil],
  ];
  for (const [t, rowText, wasReplaced] of REST) {
    await openSection(t, rowText);
    if (wasReplaced) {
      const done = await setReplace(page, rowText);
      log(`      ${rowText} — ${done ? "교체 표시 (이번에 교환함)" : "⚠️ 교체 표시를 못 넣었습니다"}`);
      if (!done) missed.push(`${rowText} (교체)`);
    } else {
      const done = await setGrade100(page, rowText);
      log(`      ${rowText} — ${done ? "100%" : "⚠️ 못 넣었습니다"}`);
      if (!done) missed.push(rowText);
    }
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
  const { marsQueue, markEntered, pendingVehicleChecks, markVehicleChecked, saveVehicleMarsNo } = await import(
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
    if (queue.length === 0 && !PROBE_ORDER && !TRY_ITEM && !PEEK_INV && !TRY_CONSENT && !TRY_ATTACH && !POST_DRAFT) {
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
     * 🔍 범용 품번 시험 — 시험 고객으로 **새 초안**을 만들고, 일부러 없는 품번을 넣어
     *    실제 대체 경로(fillLines 의 FALLBACK_ITEM 분기)를 그대로 태운다.
     *    전기는 하지 않는다. 초안 하나가 남으므로 끝나면 지워 달라고 알린다.
     *    (처음엔 기존 초안에 줄만 넣으려 했는데, 사장님이 시험 초안을 이미 다
     *     지우셔서 새로 만든다 — 2026-08-05 확인.)
     */
    if (TRY_ITEM) {
      if (!FALLBACK_ITEM) {
        log("  ⚠️ .env.local 에 MARS_FALLBACK_ITEM 이 없습니다 — 시험할 품번이 없습니다");
        await ctx.close().catch(() => {});
        process.exit(1);
      }
      log(`\n── 범용 품번 시험: ${FALLBACK_ITEM}  (시험 고객 ${TRY_ITEM}) ─────────`);
      const f = main(page);
      const shotPath = path.resolve(SHOT_DIR, "mars-try-item.png");
      try {
        const found = await findCustomer(page, TRY_ITEM);
        if (found !== "found") {
          throw new Error(
            found === "none"
              ? `시험 고객(${TRY_ITEM})이 MARS 에 없습니다 — 시험 주문을 만들 수 없습니다`
              : `시험 고객(${TRY_ITEM})이 있는지 확실하지 않습니다`,
          );
        }
        const d = new Date();
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        await openSalesOrder(page, TRY_ITEM, null, iso, null);

        // 🔴 일부러 없는 품번 — fillLines 가 오류 창을 보고 FALLBACK_ITEM 으로 갈아끼운다
        const put = await fillLines(page, [
          { kind: "tire", no: "KMTRY0000000", qty: 1, unitPrice: 100000, marsName: "범용 품번 시험 (지워도 되는 초안)" },
        ]);
        if (put !== 1) throw new Error("시험 줄이 들어가지 않았습니다");

        // 줄 머리의 「오류 N개」 표시 — 지난 후보(580/001/00290)의 실패 신호가 이것이었다
        await page.waitForTimeout(1500);
        const grid = f.locator("div[controlname='Sales Order Subform']");
        const rowText = ((await grid.locator("tr.real-current").innerText().catch(() => "")) || "")
          .replace(/\s+/g, " ")
          .trim();
        log(`  줄 내용: ${rowText.slice(0, 160)}`);
        const errBadge = f.getByText(/오류\s*\d/).last();
        const errText = (await errBadge.isVisible({ timeout: 2000 }).catch(() => false))
          ? ((await errBadge.innerText().catch(() => "")) || "").trim()
          : "";
        await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
        log(`  화면: ${shotPath}`);
        if (errText) throw new Error(`줄에 오류 표시가 있습니다: ${errText}`);

        log(`  ✅ ${FALLBACK_ITEM} 을 MARS 가 받았습니다 — 범용 품번으로 쓸 수 있습니다`);
        log(`     ⚠️ 시험 초안이 하나 남았습니다 (${TRY_ITEM}, 전기 안 함) — MARS 에서 지워 주세요`);
        await ctx.close().catch(() => {});
        process.exit(0);
      } catch (e) {
        log(`  ❌ 시험 실패: ${(e as Error).message.split("\n")[0]}`);
        // 매치 창이 어느 frame 에 있는지 찍는다 — 감지가 계속 빗나가는 원인 추적
        for (const fr of page.frames()) {
          const has = await fr.locator("text=/비교\\s*수량/").count().catch(() => 0);
          if (has > 0) log(`  · 「비교 수량」이 있는 frame: ${fr.url().slice(0, 120)}`);
        }
        const nIf = await page.locator('iframe[title="Main Content"]').count().catch(() => 0);
        log(`  · iframe[title="Main Content"]: ${nIf}개 · 전체 frame: ${page.frames().length}개`);
        await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
        log(`     화면: ${shotPath}`);
        await ctx.close().catch(() => {});
        process.exit(1);
      }
    }

    /* 🔍 기존 연락처에 차량 붙이기 탐침 — 저장하지 않는다 */
    if (TRY_ATTACH) {
      log(`\n── 연락처에 첨부 탐침: ${TRY_ATTACH} (저장 안 함) ─────────`);
      const f = main(page);
      const shotA = path.resolve(SHOT_DIR, "mars-try-attach.png");
      try {
        // ⭐ 지금은: 고객 이력 창(기본 보기 = 완료된 송장)에서 오늘 송장의 번호를 읽는다
        const name = process.argv[process.argv.indexOf("--try-attach") + 2] ?? "렌트카";
        const phone = process.argv[process.argv.indexOf("--try-attach") + 3] ?? null;
        if (!(await findCustomerByName(page, name, phone))) throw new Error("고객을 못 찾았습니다");
        await clickAny(page, "판매 내역");
        await page.waitForTimeout(3500);
        await passBigSearchDialog(page);
        const today = "2026-08-05";
        const rows = f.getByRole("row").filter({ hasText: "-23SI+" }).filter({ hasText: today });
        const nr = await rows.count().catch(() => 0);
        log(`  · 오늘(${today}) 완료된 송장 줄 ${nr}개`);
        for (let i = 0; i < nr; i++) {
          log(`    [${i}] ${(((await rows.nth(i).innerText().catch(() => "")) || "").replace(/\s+/g, " ")).slice(0, 160)}`);
        }
        if (nr > 0) {
          const row = rows.first();
          await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
          await page.waitForTimeout(500);
          await row.locator("a").first().click({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(4500);
          const heads = f.getByRole("heading");
          const nh = await heads.count().catch(() => 0);
          for (let i = nh - 1; i >= 0; i--) {
            if (!(await heads.nth(i).isVisible().catch(() => false))) continue;
            const t = ((await heads.nth(i).innerText().catch(() => "")) || "").replace(/\s+/g, " ");
            const m = /\d{8}-\d{2}SI\+\d{6}/.exec(t);
            if (m) {
              log(`  · 송장 번호: ${m[0]}  (머리글: ${t.slice(0, 80)})`);
              break;
            }
          }
        }
        const shotA0 = path.resolve(SHOT_DIR, "mars-try-attach.png");
        await page.screenshot({ path: shotA0, fullPage: true }).catch(() => {});
        log(`  화면: ${shotA0}`);
        await ctx.close().catch(() => {});
        process.exit(0);
      } catch (e) {
        log(`  ⚠️ ${(e as Error).message.split("\n")[0]}`);
        await page.screenshot({ path: shotA, fullPage: true }).catch(() => {});
        log(`  화면: ${shotA}`);
      }
      await f.getByRole("button", { name: "취소", exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(800);
      await ctx.close().catch(() => {});
      process.exit(0);
    }

    /* 🔍 동의 표 시험 — 고객 생성 창을 열어 동의만 채워 보고 저장 없이 취소한다 */
    if (TRY_CONSENT) {
      log(`\n── 동의 표 시험 (저장 안 함) ─────────`);
      const f = main(page);
      try {
        // 「생성」 버튼은 고객 검색 화면에 있다 — 없는 번호판으로 검색해 들어간다
        const where = await findCustomer(page, "999테9999");
        if (where === "unclear") throw new Error("고객 검색 화면 판정이 안 서서 멈춥니다");
        await createCustomer(page, {
          name: "동의시험",
          phone: null,
          address: null,
          consentPrivacy: true,
          consentMarketing: false,
          consentSigned: true,
          plateNo: "999테9999",
          makerName: null,
          model: null,
          year: null,
          fuelType: null,
          mileage: null,
        });
      } catch (e) {
        log(`  ${(e as Error).message.split("\n")[0]}`);
        // 시험이 어떻게 끝났든 생성 창은 저장하지 않고 닫는다
        await f.getByRole("button", { name: "취소", exact: true }).first().click().catch(() => {});
        await page.waitForTimeout(800);
      }
      await ctx.close().catch(() => {});
      process.exit(0);
    }

    /* ⭐ 채워진 초안을 열어 전기만 이어서 한다 */
    if (POST_DRAFT) {
      const f = main(page);
      log(`\n── 초안 전기: ${POST_DRAFT.plate} (${POST_DRAFT.total.toLocaleString()}원) ─────────`);
      await clickAny(page, "매출 주문 목록");
      await page.waitForTimeout(3000);
      await passBigSearchDialog(page);
      const search = f.getByRole("textbox", { name: /번호판|이름|전화/ }).first();
      let opened = false;
      for (const key of [POST_DRAFT.plate, POST_DRAFT.name].filter(Boolean) as string[]) {
        if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
          await search.fill(key).catch(() => {});
          await search.press("Enter").catch(() => {});
          await page.waitForTimeout(2500);
        }
        const row = f.getByRole("row").filter({ hasText: POST_DRAFT.plate }).first();
        if (!(await row.isVisible({ timeout: 8000 }).catch(() => false))) {
          log(`  · «${key}» 검색으로는 초안이 안 보입니다`);
          continue;
        }
        await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
        await page.waitForTimeout(500);
        await row.locator("a").first().click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(4500);
        opened = true;
        break;
      }

      /**
       * 🔴 갓 만든 차량의 초안은 주문 목록 검색에도 안 잡힌다 (색인 지연 — 2026-08-05).
       *    고객 이력 창의 「열린 판매 문서」로 돌아 들어간다.
       */
      if (!opened && POST_DRAFT.name) {
        log("  · 고객 이력의 「열린 판매 문서」로 찾아봅니다");
        await page.goto(HOME);
        await waitHome(page, 40000);
        if (await findCustomerByName(page, POST_DRAFT.name, POST_DRAFT.phone)) {
          await clickAny(page, "판매 내역");
          await page.waitForTimeout(3000);
          await passBigSearchDialog(page);
          const openDocs = f.getByRole("menuitem", { name: "열린 판매 문서" }).first();
          if (!(await openDocs.isVisible({ timeout: 3000 }).catch(() => false))) {
            await clickAny(page, "프로세스", 6000).catch(() => {});
            await page.waitForTimeout(1200);
          }
          await openDocs.click({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(3500);
          // 금액(합계)으로 줄을 찾는다 — 초안 줄에는 번호판이 없을 수 있다
          const won = POST_DRAFT.total.toLocaleString();
          const row2 = f
            .getByRole("row")
            .filter({ hasText: /-23SO[-+]/ })
            .filter({ hasText: won })
            .last();
          if (await row2.isVisible({ timeout: 8000 }).catch(() => false)) {
            log(`  · 열린 문서 줄: ${(((await row2.innerText().catch(() => "")) || "").replace(/\s+/g, " ")).slice(0, 140)}`);
            await row2.click({ position: { x: 5, y: 5 } }).catch(() => {});
            await page.waitForTimeout(500);
            await row2.locator("a").first().click({ timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(4500);
            opened = true;
          } else {
            log(`  · 열린 판매 문서에서 ${won}원짜리 주문을 못 찾았습니다`);
            const shotD = path.resolve(SHOT_DIR, "mars-post-draft.png");
            await page.screenshot({ path: shotD, fullPage: true }).catch(() => {});
            log(`     화면: ${shotD}`);
          }
        }
      }
      if (!opened) {
        log("  ⚠️ 초안을 찾지 못했습니다");
        await ctx.close().catch(() => {});
        process.exit(1);
      }
      let posted = await postOrder(page);
      if (!posted.ok && posted.unsure) {
        log("    · 전기 여부를 송장 목록에서 확인합니다");
        await page.goto(HOME);
        await waitHome(page, 40000);
        await clickAny(page, "판매완료");
        await page.waitForTimeout(700);
        await clickAny(page, "완료된 매출 송장, 완료된 매출 송장 목록을 엽니다.");
        await page.waitForTimeout(3000);
        await passBigSearchDialog(page);
        const picked = await pickInvoiceRow(page, {
          plateNo: POST_DRAFT.plate,
          workDate: null,
          total: POST_DRAFT.total,
          marsRefNo: null,
        });
        if (picked.ok) {
          const si = /\d{8}-\d{2}SI\+\d{6}/.exec(picked.label.replace(/\s+/g, ""))?.[0] ?? null;
          posted = { ok: true, invoiceNo: si };
        } else {
          posted = { ok: false, invoiceNo: null, why: picked.why };
        }
      }
      if (posted.ok) {
        log(`  ✅ 전기 완료 — 송장 ${posted.invoiceNo ?? "(번호 미확인)"}`);
      } else {
        log(`  ❌ 전기 실패: ${posted.why}`);
        const shotP = path.resolve(SHOT_DIR, "mars-post-draft.png");
        await page.screenshot({ path: shotP, fullPage: true }).catch(() => {});
        log(`     화면: ${shotP}`);
      }
      await ctx.close().catch(() => {});
      process.exit(posted.ok ? 0 : 1);
    }

    /* 🔍 전기된 송장 확인 — 읽기만 한다 */
    if (PEEK_INV) {
      await clickAny(page, "판매완료");
      await page.waitForTimeout(700);
      await clickAny(page, "완료된 매출 송장, 완료된 매출 송장 목록을 엽니다.");
      await page.waitForTimeout(3000);
      await passBigSearchDialog(page);
      const f = main(page);
      const rows = f.getByRole("row").filter({ hasText: PEEK_INV.plate });
      const n = await rows.count().catch(() => 0);
      log(`\n── ${PEEK_INV.plate} 의 전기된 송장 ${n}건 ──`);
      for (let i = 0; i < n; i++) {
        const t = (((await rows.nth(i).innerText().catch(() => "")) || "").replace(/\s+/g, " ")).trim();
        log(`  [${i}] ${t.slice(0, 200)}`);
      }
      if (n > 0 && PEEK_INV.pick) {
        const byIdx = /^\d+$/.test(PEEK_INV.pick) && Number(PEEK_INV.pick) < n;
        const row = byIdx ? rows.nth(Number(PEEK_INV.pick)) : rows.filter({ hasText: PEEK_INV.pick }).first();
        if (!(await row.isVisible().catch(() => false))) {
          log(`  ⚠️ «${PEEK_INV.pick}» 이 든 줄이 없습니다`);
        } else if (await openInvoice(page, row)) {
          await page.waitForTimeout(2000);
          // 송장 번호는 목록에서 잘려 보이므로 **연 카드에서** 읽는다 — 자릿수를 못박아
          // 옆 숫자와 붙어 읽히는 것을 막는다 (8-2SI+6 형식)
          const body = ((await f.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
          const no = /\d{8}-\d{2}SI\+\d{6}/.exec(body)?.[0] ?? "(못 읽음)";
          log(`  송장 번호: ${no}`);
          const sub = f.locator("div[controlname*='Subform']").last();
          const lrs = sub.getByRole("row");
          const m = await lrs.count().catch(() => 0);
          log(`  품목 줄 ${m}개:`);
          for (let i = 0; i < m; i++) {
            const t = (((await lrs.nth(i).innerText().catch(() => "")) || "").replace(/\s+/g, " ")).trim();
            if (t) log(`    ${t.slice(0, 200)}`);
          }
        } else {
          log("  ⚠️ 송장을 못 열었습니다");
        }
      }
      const shotP = path.resolve(SHOT_DIR, "mars-peek-inv.png");
      await page.screenshot({ path: shotP, fullPage: true }).catch(() => {});
      log(`  화면: ${shotP}`);
      await ctx.close().catch(() => {});
      process.exit(0);
    }

    /* 🔍 품목표 탐침 — 읽기만 한다 */
    if (PROBE_ORDER) {
      await clickAny(page, "매출 주문 목록");
      await page.waitForTimeout(3000);
      await passBigSearchDialog(page);
      const f = main(page);
      // 목록은 검색해야 나온다 — 「번호판 / 이름 / 전화번호」 칸에 치고 엔터
      const search = f.getByRole("textbox", { name: /번호판|이름|전화/ }).first();
      if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
        await search.fill(PROBE_ORDER).catch(() => {});
        await search.press("Enter").catch(() => {});
        await page.waitForTimeout(2500);
      }
      const row = f.getByRole("row").filter({ hasText: PROBE_ORDER }).first();
      if (!(await row.isVisible({ timeout: 10000 }).catch(() => false))) {
        log(`  ⚠️ ${PROBE_ORDER} 가 든 매출 주문이 없습니다`);
        const shot = path.resolve(SHOT_DIR, "mars-probe.png");
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        log(`     화면: ${shot}`);
      } else {
        await row.click({ position: { x: 5, y: 5 } }).catch(() => {});
        await page.waitForTimeout(500);
        // 번호가 화면에서 「61168583-23…」로 잘려 있다 — 줄 안의 링크(a)를 그대로 누른다
        await row.locator("a").first().click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(4500);
        // 주문 카드의 「라인」 섹션 — 🔴 버튼이 **토글**이라, 접혀 있을 때만 누른다
        const probeRow = () => f.getByRole("row").filter({ hasText: "S001/" }).last();
        if (!(await probeRow().isVisible({ timeout: 3000 }).catch(() => false))) {
          const lines = f.getByRole("button", { name: /^라인/ }).first();
          if (await lines.isVisible({ timeout: 4000 }).catch(() => false)) {
            await lines.click().catch(() => {});
            await page.waitForTimeout(2500);
          }
        }
        /* 전기 메뉴를 펼쳐 항목들을 그대로 찍는다 — 전기 자동화가 무엇을 눌러야 하는지 */
        await clickAny(page, "전기", 8000).catch(() => {});
        await page.waitForTimeout(1200);
        log(`\n── 「전기」 메뉴를 펼친 뒤 보이는 menuitem 들 ──`);
        const mis = f.getByRole("menuitem");
        const nMis = await mis.count().catch(() => 0);
        for (let i = 0; i < Math.min(nMis, 40); i++) {
          if (!(await mis.nth(i).isVisible().catch(() => false))) continue;
          const t = ((await mis.nth(i).innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
          const cn = (await mis.nth(i).getAttribute("controlname").catch(() => null)) ?? "";
          if (t) log(`   [${i}] «${t}»${cn ? `  controlname=${cn}` : ""}`);
        }
        const shotM = path.resolve(SHOT_DIR, "mars-probe-menu.png");
        await page.screenshot({ path: shotM, fullPage: true }).catch(() => {});
        log(`  메뉴 화면: ${shotM}`);

        const shot0 = path.resolve(SHOT_DIR, "mars-probe.png");
        await page.screenshot({ path: shot0, fullPage: true }).catch(() => {});
        log(`  화면: ${shot0}`);
        log(`\n── 품목표 칸 이름과 값 ──`);
        for (const key of ["126081", "S001/1190", "S001/1209"]) {
          // 같은 글자가 알림 배너에도 있어 줄이 여러 개 잡힌다 — 마지막(표 안의 것)을 쓴다
          const line = f.getByRole("row").filter({ hasText: key }).last();
          if (!(await line.isVisible().catch(() => false))) {
            log(`  «${key}» 줄 없음`);
            continue;
          }
          log(`  «${key}» 통짜 글자: ${((await line.innerText().catch(() => "")) || "").replace(/\s+/g, " ").slice(0, 160)}`);
          // 눌러서 편집 상태로 만들면 controlname 이 생긴다
          await line.click({ position: { x: 5, y: 5 } }).catch(() => {});
          await page.waitForTimeout(800);
          const cells = line.locator("[controlname]");
          const n = await cells.count().catch(() => 0);
          for (let i = 0; i < Math.min(n, 30); i++) {
            const cn = (await cells.nth(i).getAttribute("controlname").catch(() => "")) ?? "";
            const val =
              (await cells.nth(i).locator("input, select, textarea").first().inputValue().catch(() => null)) ??
              ((await cells.nth(i).innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
            if (cn) log(`     ${cn.padEnd(34)} = «${String(val).slice(0, 40)}»`);
          }
        }
      }
      await ctx.close().catch(() => {});
      process.exit(0);
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

          if (!(await openInvoice(page, picked.row))) {
            throw new Error("송장을 열지 못했습니다 (번호 링크를 누르지 못함)");
          }
          await page.waitForTimeout(1500);

          const r = await fillVehicleCheck(page, {
            plateNo: c.plateNo!,
            tyreQty: c.tyreQty,
            replaced: replacedFromServices(c.serviceNames),
            wheels: c.tyrePositions,
          });
          if (!r.ok) throw new Error(`못 채운 항목: ${r.missed.join(", ")}`);

          /** 👀 보기만 하는 모드는 우리 기록도 건드리지 않는다 */
          if (LOOK) {
            log("  👀 보기만 했습니다 (아무것도 쓰지 않았습니다)");
            ok++;
            await page.goto(HOME);
            await waitHome(page, 40000);
            continue;
          }

          await markVehicleChecked(c.quoteId);
          ok++;
          log(r.already ? "  ✅ 이미 점검이 끝나 있어 기록만 맞췄습니다" : "  ✅ 차량 점검 제출 완료");
        } catch (e) {
          skipped++;
          log(`  ⚠️ 실패: ${(e as Error).message.split("\n")[0]}`);
          const shot = path.resolve(SHOT_DIR, `mars-점검오류-${c.quoteNo}.png`);
          await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
          log(`     화면을 저장했습니다: ${shot}`);
        }
        await page.goto(HOME).catch(() => {});
        await waitHome(page, 40000).catch(() => false);
      }
      log(`\n${"=".repeat(56)}`);
      log(LOOK ? `  전기된 송장을 찾은 것 ${ok}건 · 못 찾은 것 ${skipped}건  (제출 안 함)` : `  점검 제출 ${ok}건 · 넘어간 것 ${skipped}건`);
      log(`${"=".repeat(56)}\n`);
      /** 보기만·대리인 모드는 스스로 닫는다 — 사람이 옆에 없다 */
      if (LOOK || AGENT) {
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
           * ⭐ 고객은 MARS 에 있는데(연락처 번호 보유) **차량만 없는** 경우 —
           *    차량 카드만 새로 만든다 (사장님 버그 제보 2026-08-05, 렌트카 165하4306).
           *    전에는 「MARS 에 없는 차량입니다」로 그냥 멈췄다.
           */
          if (!c && q.contactNo && q.customerName) {
            /**
             * 🔴 이미 만들어 둔 차량이면 **다시 만들지 않는다** (2026-08-05 실제 사고 —
             *    갓 만든 차량이 번호판 검색 색인에 안 잡혀 같은 차가 두 번 만들어졌다).
             */
            if (q.marsVehicleNo) {
              log(`  → 차량은 이미 MARS 에 있습니다 (${q.marsVehicleNo}) — 이름으로 이어서 진행합니다`);
            } else {
              log(`  → 고객(${q.contactNo})은 MARS 에 있습니다 — 차량 ${q.plateNo} 만 새로 답니다`);
              const vehNo = await createVehicleForContact(page, q.contactNo, {
                plateNo: q.plateNo,
                makerName: q.makerName,
                model: q.vehicleModel,
                year: q.year,
                fuelType: q.fuelType,
                mileage: q.mileage,
              });
              if (vehNo) await saveVehicleMarsNo(q.quoteId, vehNo);
              log(`    ✅ 차량 등록 완료${vehNo ? ` (${vehNo})` : ""}`);
            }
            // 번호판 검색은 색인이 늦어 못 믿는다 — 이름+전화로 고객 줄을 잡는다
            if (!(await findCustomerByName(page, q.customerName, q.phone))) {
              throw new Error("이름으로도 고객을 찾지 못했습니다 — MARS 에서 확인해 주세요");
            }
          } else if (!c || !c.consentSigned) {
            /**
             * 🔴 서명을 안 받은 손님은 만들지 않는다.
             *    MARS 고객 등록 화면에는 「고객 서명」 칸이 있다.
             *    받지도 않은 서명을 「수락된 동의」로 넣을 수는 없다.
             */
            log(
              c
                ? "  ⚠️ 개인정보 동의 서명이 없어 고객 등록을 하지 않습니다 — 판매 등록에서 서명 확인을 체크해 주세요"
                : "  ⚠️ MARS 에 없는 차량·고객입니다 — 고객 등록은 직접 해 주세요",
            );
            skipped++;
            await page.goto(HOME);
            continue;
          } else {
            log(`  → MARS 에 없는 손님입니다. 새로 만듭니다 (${c.name} ${c.plateNo})`);
            await createCustomer(page, c);
            log("    ✅ 고객·차량 등록 완료");
          }
        }

        /** ⭐ 실제로 정비한 날. 사장님이 판매 등록에서 고치실 수 있다 (기본은 오늘) */
        const d = new Date();
        const iso =
          q.workDate ??
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        log(`    · 작업일자 ${iso} · 결제 ${q.paymentMethod ?? "-"}`);
        /**
         * ⭐ 주행거리는 **차량의 최근 값**을 쓴다 (사장님 버그 제보 2026-08-05).
         *    전에는 newCustomer(신규 고객)에만 있어서 기존 고객은 주행거리가
         *    아예 안 들어갔다. 판매 등록에서 고치면 vehicle.mileage 가 갱신되어
         *    최신 값이, 안 고치면 마지막으로 알던 값이 들어간다.
         */
        await openSalesOrder(
          page,
          q.plateNo,
          q.mileage ?? q.newCustomer?.mileage ?? null,
          iso,
          PAY_CODE[q.paymentMethod ?? ""] ?? null,
        );
        const put = await fillLines(page, q.lines);

        /**
         * 🔴 줄이 다 안 들어갔으면 「입력 완료」로 넘기지 않는다.
         *    모자란 채로 대기열에서 내리면 빠진 줄을 아무도 모르게 된다.
         *    사장님이 MARS 에서 마저 채우고 전기하셔야 한다.
         */
        if (put !== q.lines.length) {
          throw new Error(`${q.lines.length}줄 중 ${put}줄만 들어갔습니다 — MARS 에서 마저 채워 주세요`);
        }

        const amount = await checkOrder(page, q.total);
        // 🔴 번호 칸과 메모 칸을 섞지 않는다 (2026-08-04) — 번호는 번호 칸에, 사연은 메모에
        const orderNo = await readOrderNo(page);
        if (orderNo) log(`    · 매출 주문 번호 ${orderNo}`);

        /**
         * ⭐ 원스톱 — 전기까지, 그리고 차량 점검까지 (사장님 결정 2026-08-04).
         *
         * 🔴 안전장치: **합계가 일치할 때만 전기한다.** 전기는 취소가 번거로우니
         *    금액이 어긋난 주문은 초안으로 남기고 사람에게 넘긴다.
         */
        if (!amount.ok) {
          await markEntered(q.quoteId, orderNo, `자동입력 ${iso} · ${amount.note} · 전기 보류(금액 불일치)`);
          ok++;
          log("  ⚠️ 금액이 안 맞아 전기하지 않았습니다 — MARS 에서 확인 후 직접 전기해 주세요");
          await page.goto(HOME);
          await waitHome(page, 40000);
          continue;
        }

        let posted = await postOrder(page);
        /** 화면으로 못 정했으면 **송장 목록에서** 확정한다 — 번호판·작업일·금액으로 */
        let verifiedRow: Locator | null = null;
        if (!posted.ok && posted.unsure && q.plateNo) {
          log("    · 전기 여부를 송장 목록에서 확인합니다");
          await page.goto(HOME);
          await waitHome(page, 40000);
          await clickAny(page, "판매완료");
          await page.waitForTimeout(700);
          await clickAny(page, "완료된 매출 송장, 완료된 매출 송장 목록을 엽니다.");
          await page.waitForTimeout(3000);
          await passBigSearchDialog(page);
          const picked = await pickInvoiceRow(page, {
            plateNo: q.plateNo,
            workDate: iso,
            total: q.total,
            marsRefNo: null,
          });
          if (picked.ok) {
            const flat = picked.label.replace(/\s+/g, "");
            // 🔴 자릿수 고정 — 느슨한 패턴은 옆 숫자(날짜 등)와 붙어 오염 번호가 된다
            const si = /\d{8}-\d{2}SI\+\d{6}/.exec(flat)?.[0] ?? null;
            posted = { ok: true, invoiceNo: si };
            verifiedRow = picked.row;
            log(`    · 전기 완료 확인 — 송장 ${si ?? "(번호 미확인)"}`);
          } else {
            posted = { ok: false, invoiceNo: null, why: `전기 확인 실패: ${picked.why}` };
          }
        }
        if (!posted.ok) {
          await markEntered(q.quoteId, orderNo, `자동입력 ${iso} · ${amount.note} · 전기 실패: ${posted.why}`);
          ok++;
          log(`  ⚠️ 전기하지 못했습니다: ${posted.why} — 주문은 채워져 있으니 MARS 에서 전기해 주세요`);
          const shot = path.resolve(SHOT_DIR, `mars-전기실패-${q.quoteNo}.png`);
          await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
          await page.goto(HOME);
          await waitHome(page, 40000);
          continue;
        }

        await markEntered(q.quoteId, posted.invoiceNo ?? orderNo, `자동입력+전기 ${iso} · ${amount.note}`);

        /** 전기 직후 그 자리에서 차량 점검까지 — 타이어를 판 건만 */
        const tyreQty = q.lines.filter((l) => l.kind === "tire").reduce((s, l) => s + l.qty, 0);
        if (tyreQty > 0 && q.plateNo) {
          try {
            const f2 = main(page);
            // 송장 목록에서 확정했다면 그 줄을 바로 연다
            if (verifiedRow) {
              if (!(await openInvoice(page, verifiedRow))) throw new Error("송장을 열지 못했습니다");
              await page.waitForTimeout(1500);
            }
            // 「전기된 송장을 여시겠습니까 → 예」 로 이미 송장 카드에 있으면 바로 점검
            const onInvoice =
              verifiedRow !== null ||
              (await f2
                .getByRole("menuitem", { name: "탐색" })
                .first()
                .isVisible({ timeout: 4000 })
                .catch(() => false));
            if (!onInvoice) {
              // 송장 카드가 아니면 완료된 매출 송장 목록에서 찾아 들어간다
              await page.goto(HOME);
              await waitHome(page, 40000);
              await clickAny(page, "판매완료");
              await page.waitForTimeout(700);
              await clickAny(page, "완료된 매출 송장, 완료된 매출 송장 목록을 엽니다.");
              await page.waitForTimeout(3000);
              await passBigSearchDialog(page);
              const picked = await pickInvoiceRow(page, {
                plateNo: q.plateNo,
                workDate: iso,
                total: q.total,
                marsRefNo: posted.invoiceNo,
              });
              if (!picked.ok) throw new Error(picked.why);
              if (!(await openInvoice(page, picked.row))) throw new Error("송장을 열지 못했습니다");
              await page.waitForTimeout(1500);
            }
            const r2 = await fillVehicleCheck(page, {
              plateNo: q.plateNo,
              tyreQty,
              // 이번 판매의 서비스 줄에서 실제 교환한 항목을 읽는다 (사장님 지시 2026-08-05)
              replaced: replacedFromServices(q.lines.filter((l) => l.kind !== "tire").map((l) => l.marsName)),
              // 판매 등록에서 고른 바퀴 그대로 (사장님 요청 2026-08-05)
              wheels: q.tyrePositions,
            });
            if (!r2.ok) throw new Error(`못 채운 항목: ${r2.missed.join(", ")}`);
            await markVehicleChecked(q.quoteId);
            log(r2.already ? "    · 차량 점검 — 이미 제출돼 있었습니다" : "    · 차량 점검 제출 ✅");
          } catch (e2) {
            log(`  ⚠️ 차량 점검은 못 끝냈습니다: ${(e2 as Error).message.split("\n")[0]}`);
            log("     (매출·전기는 끝났습니다. 점검만 다시 돌리면 됩니다 — 웹의 점검 단추)");
            const shot = path.resolve(SHOT_DIR, `mars-점검오류-${q.quoteNo}.png`);
            await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
          }
        }

        ok++;
        log("  ✅ 매출 주문 → 전기 → 차량 점검까지 끝났습니다");
        await page.goto(HOME);
        await waitHome(page, 40000);
      } catch (e) {
        skipped++;
        log(`  ⚠️ 실패: ${(e as Error).message.split("\n")[0]}`);
        /**
         * 어디서 막혔는지 나중에 볼 수 있게 남긴다.
         * 화면 조작은 MARS 가 바뀌면 어긋난다 — 그때 이 그림이 유일한 단서다.
         */
        const shot = path.resolve(SHOT_DIR, `mars-오류-${q.quoteNo}.png`);
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        log(`     화면을 저장했습니다: ${shot}`);
        await page.goto(HOME).catch(() => {});
        await waitHome(page, 30000).catch(() => false);
      }
    }
  } finally {
    log(`\n${"=".repeat(56)}`);
    log(`  처리한 것 ${ok}건 · 넘어간 것 ${skipped}건`);
    log("  (전기까지 자동입니다 — 금액이 안 맞거나 전기가 막힌 건만 초안으로 남습니다)");
    log(`${"=".repeat(56)}\n`);
    if (AGENT) {
      // 대리인 모드 — 사람이 옆에 없으니 닫고 끝낸다. 결과는 웹 화면에 남는다
      await ctx.close().catch(() => {});
      process.exit(0);
    }
    log("  확인하시고 이 창에서 Ctrl+C 를 누르시면 브라우저가 닫힙니다.");
    // 사장님이 확인하실 때까지 브라우저를 열어 둔다
    await new Promise(() => {});
  }
}

main_();
