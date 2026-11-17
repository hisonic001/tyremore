/**
 * ⭐ 타이어모어 메일 자동 수집 — Google Apps Script (info@psiauto.co.kr 계정에서 돈다) (2026-11-17, D-41)
 *
 *   run()      10분마다 정해진 발신처의 **새 메일**을 앱(/api/intake)으로 보낸다(장부에 반영).
 *   backfill() 설치 전 **지난 메일**을 「검토」로 보낸다 — 앱은 해석만 하고 장부에 넣지 않는다.
 *              사장님이 보고서를 보고 승인하면 그때 반영(scripts/intake-review.ts --apply). docs/21 3장.
 *
 *   보낸 메일 묶음에는 라벨을 붙여 다시 보내지 않는다 — 새 메일 「앱수집」 · 지난 메일 「앱수집-과거」.
 *   (앱도 같은 메일을 두 번 받지 않는다 — 메일ID 로 막는다.)
 *
 *   🔴 run() 은 설치한 순간(START) **이후에 온 메일만** 보낸다 — 지난 메일을 곧장 반영하면
 *      이미 도착해 팔린 타이어가 「입고 예정」으로 뜬다 (2026-08-02 사고, docs/14). 지난 것은 backfill()(검토)로만.
 *
 *   설치 (docs/21-자동수집-설정.md 2장)
 *     1) script.google.com → 프로젝트 → 이 파일 전체를 붙여넣기
 *     2) 프로젝트 설정 → 스크립트 속성: INTAKE_URL = https://tyremore.vercel.app/api/intake
 *                                        INTAKE_TOKEN = (Vercel 에 넣은 것과 같은 비밀키)
 *     3) 함수 「setup」 실행 → 권한 허용 (10분 주기 실행이 걸린다)
 *     4) (지난 메일) 함수 「backfill」 실행 — 「남은 것 없음」이 나올 때까지 여러 번 (한 번에 5분까지)
 */

/** 보내는 대상 — 발신처와 무엇을 보낼지 (files = 첨부 · note = 본문 HTML) */
var SOURCES = [
  { from: 'contactus.kr@michelin.com', what: 'files' },                 // 미쉐린 인보이스 PDF → 입고 대기
  { from: 'hometaxadmin@hometax.go.kr', what: 'files' },                // 홈택스 전자세금계산서 (보안메일) → 계산서 장부
  { from: 'wooricard@wooricard.com', what: 'files' },                   // 우리카드 이용대금명세서 (VestMail) → 법인카드
  { from: 'shinhancard@mail3.shinhancard.com', what: 'files' },         // 신한카드 법인 이용대금명세서 → 법인카드
  { from: 'popbill@popbill.com', what: 'note' },                        // 발행 대행 메일 → 계산서 도착 알림(대조용)
  { from: 'mailing@businesson.co.kr', what: 'note' },                   //   스마트빌
  { from: 'webmaster@bill36524.com', what: 'note' },                    //   bill36524 (WEHAGO)
  { from: 'baro@barobill.co.kr', what: 'note' },                        //   바로빌
  { from: 'ecount.com', what: 'note' },                                 //   이카운트 (발신 주소가 거래처마다 다르다)
  // 쓰지 않기로 한 것 (D-41): 콘티넨탈 Proforma(누적 청구서) · KICC 결제 알림(통장 출금으로 이미 대조)
];
var LABEL = '앱수집';
var LABEL_PAST = '앱수집-과거';
var FILE_RE = /\.(pdf|xlsx?|html?)$/i;
var MAX_BYTES = 4 * 1024 * 1024;
var MAX_RUN_MS = 5 * 60 * 1000; // 구글 스크립트는 한 번에 6분까지

function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('START')) p.setProperty('START', String(Math.floor(Date.now() / 1000)));
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(10).create();
  label_(LABEL);
  Logger.log('설치 완료 — ' + new Date(Number(p.getProperty('START')) * 1000) + ' 이후 메일부터 보냅니다');
}

/** 새 메일 → 반영 */
function run() {
  var c = conf_();
  var label = label_(LABEL);
  var t0 = Date.now();
  SOURCES.forEach(function (src) {
    var threads = GmailApp.search('from:' + src.from + ' after:' + c.start + ' -label:' + LABEL, 0, 30);
    threads.forEach(function (th) {
      if (Date.now() - t0 > MAX_RUN_MS) return;
      if (sendThread_(c, src, th, 'apply', c.start)) th.addLabel(label);
    });
  });
}

/**
 * 지난 메일 → 「검토」(장부에 넣지 않음). 스크립트 속성 BACKFILL_FROM(기본 2026/07/01) ~ START.
 * 5분이 넘으면 멈춘다 — 「남은 것 없음」이 나올 때까지 다시 실행.
 */
function backfill() {
  var c = conf_();
  var p = PropertiesService.getScriptProperties();
  var from = p.getProperty('BACKFILL_FROM') || '2026/07/01';
  var label = label_(LABEL_PAST);
  var t0 = Date.now();
  var sent = 0, left = 0;
  SOURCES.forEach(function (src) {
    var q = 'from:' + src.from + ' after:' + from + ' before:' + c.start + ' -label:' + LABEL_PAST + ' -label:' + LABEL;
    var threads = GmailApp.search(q, 0, 100);
    threads.forEach(function (th) {
      if (Date.now() - t0 > MAX_RUN_MS) { left++; return; }
      if (sendThread_(c, src, th, 'review', 0)) { th.addLabel(label); sent++; } else left++;
    });
  });
  Logger.log('검토로 보냄 ' + sent + '건 · ' + (left ? '남은 것 ' + left + '건 — 다시 실행해 주세요' : '남은 것 없음'));
}

/** 메일 묶음 하나를 보낸다. 하나라도 실패하면 false(라벨을 안 붙여 다음에 다시 보낸다) */
function sendThread_(c, src, th, mode, minEpoch) {
  var ok = true;
  th.getMessages().forEach(function (m) {
    if (minEpoch && m.getDate().getTime() / 1000 < minEpoch) return;
    var base = { messageId: m.getId(), sender: src.from, subject: m.getSubject(), mode: mode };
    if (src.what === 'note') {
      ok = send_(c, merge_(base, { type: 'mail-note', body: m.getBody().slice(0, 200000) })) && ok;
      return;
    }
    m.getAttachments({ includeInlineImages: false }).forEach(function (a, i) {
      var name = a.getName();
      if (!FILE_RE.test(name) || a.getSize() > MAX_BYTES) return;
      ok = send_(c, merge_(base, {
        type: 'mail-file', index: i, fileName: name, mime: a.getContentType(),
        base64: Utilities.base64Encode(a.getBytes()),
      })) && ok;
    });
  });
  return ok;
}

function conf_() {
  var p = PropertiesService.getScriptProperties();
  var c = { url: p.getProperty('INTAKE_URL'), token: p.getProperty('INTAKE_TOKEN'), start: Number(p.getProperty('START') || 0) };
  if (!c.url || !c.token || !c.start) throw new Error('스크립트 속성 INTAKE_URL·INTAKE_TOKEN·START 를 확인해 주세요 (setup 실행)');
  return c;
}

function send_(c, payload) {
  var r = UrlFetchApp.fetch(c.url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + c.token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = r.getResponseCode();
  var what = payload.fileName || payload.subject;
  if (code !== 200) {
    Logger.log('실패 ' + code + ' ' + what + ' — ' + r.getContentText().slice(0, 300));
    return false;
  }
  Logger.log('보냄 ' + what + ' — ' + r.getContentText().slice(0, 300));
  return true;
}

function label_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function merge_(a, b) {
  var o = {};
  Object.keys(a).forEach(function (k) { o[k] = a[k]; });
  Object.keys(b).forEach(function (k) { o[k] = b[k]; });
  return o;
}
