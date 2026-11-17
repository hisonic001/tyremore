/**
 * ⭐ 타이어모어 메일 자동 수집 — Google Apps Script (info@psiauto.co.kr 계정에서 돈다) (2026-11-17, D-41)
 *
 *   10분마다 정해진 발신처의 새 메일을 찾아 첨부·본문을 앱(/api/intake)으로 보낸다.
 *   보낸 메일 묶음에는 「앱수집」 라벨을 붙여 다시 보내지 않는다(앱도 같은 메일을 두 번 받지 않는다).
 *
 *   🔴 설치한 순간 **이후에 온 메일만** 보낸다 — 지난 메일을 한꺼번에 올리면
 *      이미 도착해 팔린 타이어가 「입고 예정」으로 뜬다 (2026-08-02 사고, docs/14).
 *      지난 것을 일부러 보내려면 「설정 → 스크립트 속성」의 START 를 앞당긴다.
 *
 *   설치 (docs/21-자동수집-설정.md 2장)
 *     1) script.google.com → 새 프로젝트 → 이 파일 전체를 붙여넣기
 *     2) 프로젝트 설정 → 스크립트 속성: INTAKE_URL = https://tyremore.vercel.app/api/intake
 *                                        INTAKE_TOKEN = (Vercel 에 넣은 것과 같은 비밀키)
 *     3) 함수 「setup」 실행 → 권한 허용 (10분 주기 실행이 걸린다)
 */

/** 보내는 대상 — 발신처와 무엇을 보낼지 */
var SOURCES = [
  { from: 'contactus.kr@michelin.com', what: 'files' },                 // 미쉐린 인보이스 PDF
  { from: 'TI_Z3_SM_noreply.sap-p52@continental.com', what: 'files' },  // 콘티넨탈 Proforma Invoice PDF
  { from: 'hometaxadmin@hometax.go.kr', what: 'files' },                // 홈택스 전자세금계산서 (보안메일)
  { from: 'wooricard@wooricard.com', what: 'files' },                   // 우리카드 이용대금명세서 (보안메일)
  { from: 'shinhancard@mail3.shinhancard.com', what: 'files' },         // 신한카드 법인 이용대금명세서
  { from: 'easypay_noreturn@easypay.co.kr', what: 'note' },             // 미쉐린 가상계좌 결제 알림 (본문)
];
var LABEL = '앱수집';
var FILE_RE = /\.(pdf|xlsx?|html?)$/i;
var MAX_BYTES = 4 * 1024 * 1024;

function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('START')) p.setProperty('START', String(Math.floor(Date.now() / 1000)));
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(10).create();
  getLabel_();
  Logger.log('설치 완료 — ' + new Date(Number(p.getProperty('START')) * 1000) + ' 이후 메일부터 보냅니다');
}

function run() {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('INTAKE_URL');
  var token = p.getProperty('INTAKE_TOKEN');
  var start = Number(p.getProperty('START') || 0);
  if (!url || !token || !start) throw new Error('스크립트 속성 INTAKE_URL·INTAKE_TOKEN·START 를 확인해 주세요 (setup 실행)');
  var label = getLabel_();

  SOURCES.forEach(function (src) {
    var q = 'from:' + src.from + ' after:' + start + ' -label:' + LABEL;
    var threads = GmailApp.search(q, 0, 30);
    threads.forEach(function (th) {
      var allOk = true;
      th.getMessages().forEach(function (m) {
        if (m.getDate().getTime() / 1000 < start) return;
        var base = { messageId: m.getId(), sender: src.from, subject: m.getSubject() };
        if (src.what === 'note') {
          allOk = send_(url, token, merge_(base, { type: 'mail-note', body: m.getPlainBody().slice(0, 20000) })) && allOk;
          return;
        }
        m.getAttachments({ includeInlineImages: false }).forEach(function (a, i) {
          var name = a.getName();
          if (!FILE_RE.test(name) || a.getSize() > MAX_BYTES) return;
          allOk = send_(url, token, merge_(base, {
            type: 'mail-file', index: i, fileName: name, mime: a.getContentType(),
            base64: Utilities.base64Encode(a.getBytes()),
          })) && allOk;
        });
      });
      // 하나라도 실패하면 라벨을 안 붙인다 → 다음 차례에 다시 보낸다 (앱이 이미 받은 것은 「중복」으로 넘긴다)
      if (allOk) th.addLabel(label);
    });
  });
}

function send_(url, token, payload) {
  var r = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = r.getResponseCode();
  if (code !== 200) {
    Logger.log('실패 ' + code + ' ' + (payload.fileName || payload.subject) + ' — ' + r.getContentText().slice(0, 300));
    return false;
  }
  Logger.log('보냄 ' + (payload.fileName || payload.subject) + ' — ' + r.getContentText().slice(0, 300));
  return true;
}

function getLabel_() {
  return GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
}

function merge_(a, b) {
  var o = {};
  Object.keys(a).forEach(function (k) { o[k] = a[k]; });
  Object.keys(b).forEach(function (k) { o[k] = b[k]; });
  return o;
}
