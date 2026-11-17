/**
 * ⭐ 우리카드 보안메일(YettieSoft VestMail) 해독 — 첨부 안의 엔진을 격리된 vm 에서 그대로 돌린다 (2026-11-17, D-41 보강)
 *
 *   구조 (2026-11 실물): 첨부 `WooriCard.html` 안에 압축된 암호 엔진(~18만 자) + 암호문 조각 배열 `s[]` +
 *   `<script id="__p">var b_p='…';eval(atob(b_p))</script>`(풀이 순서: 비밀번호 해시 → 열쇠·IV → 조각마다 풀기 →
 *   `document.write(명세서 HTML)`). 비밀번호가 틀리면 엔진이 「비밀번호 입력이 잘못되었습니다」 알림을 낸다.
 *   엔진을 손으로 옮기지 않는다 — 우리카드가 엔진을 바꿔도 첨부에 새 엔진이 같이 오므로 그대로 돈다.
 *
 * 🔴 보안 — 메일 첨부의 스크립트를 서버에서 돌리는 것이라 격리를 지킨다:
 *    ① 문맥(context)은 프로토타입 없는 빈 객체로 만든다 — `this.constructor.constructor` 로 바깥 Function 에 닿지 못하게.
 *    ② 화면 흉내(document·window…)는 **문맥 안에서** 글자 코드로 만든다 — 바깥 객체를 하나도 넘기지 않는다.
 *    ③ 안팎으로는 **글자(문자열)만** 주고받는다. 문맥 안 함수를 바깥에서 직접 부르지 않는다(caller 로 바깥 프레임에 닿지 않게).
 *    ④ 실행마다 시간 제한. require·process·네트워크·파일은 문맥에 없다.
 *    ⑤ 부르는 쪽(intake.ts)은 우리카드 발신 + VestMail 표식이 있는 첨부만 넘긴다.
 * 🔴 사장님 승인(2026-11-17): 명세서 메일을 사업자번호로 연다.
 */
import vm from "node:vm";

export type VestMailResult = { ok: true; html: string } | { ok: false; error: string; wrongPassword?: boolean };

export function isVestMail(html: string): boolean {
  return /VestMail/i.test(html) && /b_p\s*=/.test(html) && /decForm|doAction/.test(html);
}

/** 문맥 안에서 만드는 화면 흉내 — 이 글자 코드만 문맥 안에서 실행된다 */
const STUB = String.raw`
var __out = "", __q = [], __log = [], __els = {};
function __doc() { return { write: function (s) { __out += s; }, writeln: function (s) { __out += s + "\n"; },
  open: function () {}, close: function () {}, charset: "UTF-8", characterSet: "UTF-8",
  body: { style: {}, scrollHeight: 0, clientHeight: 0, appendChild: function () {}, removeChild: function () {} },
  documentElement: { style: {}, scrollHeight: 0 } }; }
function __el(id) {
  if (__els[id]) return __els[id];
  var d = __doc();
  var e = { id: id, value: "", className: "", style: {}, innerHTML: "", innerText: "", textContent: "", text: "",
    parentNode: { removeChild: function () {}, appendChild: function () {} },
    contentDocument: d, contentWindow: { document: d, focus: function () {}, print: function () {} },
    setAttribute: function () {}, getAttribute: function () { return null; }, appendChild: function () {}, removeChild: function () {},
    focus: function () {}, blur: function () {}, addEventListener: function () {}, attachEvent: function () {}, submit: function () {}, click: function () {} };
  __els[id] = e; return e;
}
var window = this, self = this, top = this, parent = this;
var document = { getElementById: __el, getElementsByTagName: function () { return []; }, createElement: function () { return __el("__n" + Math.random()); },
  body: { style: {}, scrollHeight: 0, clientHeight: 0, appendChild: function () {}, removeChild: function () {} },
  documentElement: { style: {} }, charset: "UTF-8", characterSet: "UTF-8", readyState: "complete",
  addEventListener: function () {}, attachEvent: function () {}, write: function (s) { __out += s; }, open: function () {}, close: function () {} };
var navigator = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36", platform: "Win32", appVersion: "5.0", vendor: "Google Inc.", language: "ko-KR", userLanguage: "ko-KR" };
var location = { href: "file:///WooriCard.html", protocol: "file:" }, screen = { width: 1920, height: 1080 };
var console = { log: function () {}, error: function () {}, warn: function () {} };
function alert(s) { __log.push("ALERT " + s); } function confirm() { return true; }
function setTimeout(f) { __q.push(f); return __q.length; } function clearTimeout() {} function setInterval() { return 0; } function clearInterval() {}
var __B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function atob(s) { s = String(s).replace(/[^A-Za-z0-9+/]/g, ""); var o = "", b = 0, n = 0;
  for (var i = 0; i < s.length; i++) { b = (b << 6) | __B.indexOf(s.charAt(i)); n += 6; if (n >= 8) { n -= 8; o += String.fromCharCode((b >> n) & 255); } } return o; }
function btoa(s) { var o = "", i = 0; for (; i < s.length; i += 3) { var a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2);
  o += __B.charAt(a >> 2) + __B.charAt(((a & 3) << 4) | (b >> 4)) + (isNaN(b) ? "=" : __B.charAt(((b & 15) << 2) | (c >> 6))) + (isNaN(c) ? "=" : __B.charAt(c & 63)); } return o; }
function __drain() { var n = 0; while (__q.length && n++ < 100000) { var f = __q.shift(); try { typeof f === "function" ? f() : eval(f); } catch (e) { __log.push("T " + e.message); } } return n; }
`;

/**
 * @param password 사업자번호 10자리 (숫자만)
 */
export function decryptVestMail(html: string, password: string, opts: { timeoutMs?: number } = {}): VestMailResult {
  if (!isVestMail(html)) return { ok: false, error: "VestMail 보안메일 형식이 아닙니다" };
  const timeout = opts.timeoutMs ?? 20_000;
  const scripts: string[] = [];
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/\ssrc\s*=/i.test(m[1])) scripts.push(m[2]);

  const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: true, wasm: false } });
  const run = (code: string) => vm.runInContext(code, ctx, { timeout });
  try {
    run(STUB);
    for (const code of scripts) {
      try {
        run(code);
      } catch {
        /* 화면 꾸밈 스크립트의 흉내 화면 오류는 무시 — 결과는 아래에서 판정 */
      }
    }
    run(`vestmail_onstart = function () {}; vestmail_onend = function () {}; org = __el("org");
         __el("password").value = ${JSON.stringify(password)};
         if (typeof doAction !== "function") throw new Error("doAction 없음");
         doAction(); __drain();`);
    const out = String(run("String(__out)"));
    const log = String(run('__log.join("\\n")'));
    if (/ALERT/.test(log) && /비밀번호/.test(log)) return { ok: false, error: "비밀번호(사업자번호)가 맞지 않습니다", wrongPassword: true };
    if (!out) return { ok: false, error: `풀린 내용이 없습니다${log ? ` (${log.slice(0, 200)})` : ""}` };
    return { ok: true, html: out };
  } catch (e) {
    return { ok: false, error: `VestMail 해독 실패: ${e instanceof Error ? e.message : String(e)}` };
  }
}
