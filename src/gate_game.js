/* ---------- 게임 페이지 운영 상태 확인 ----------
   /game 은 서버가 '운영 중'일 때만 이 페이지를 내려준다. 상태는 페이지를 열거나 새로고침할 때 한 번만 확인한다 (자동 갱신 없음).
   - 첫 확인이 실패하면 3초 간격으로 다시 시도하고, 연속 3번 실패하면 "연결할 수 없습니다"를 띄운다.
   - 운영 중이 아니면 흰 화면으로 덮는다. 덮인 뒤에는 새로고침하기 전까지 다시 확인하지 않는다.
   - 점수는 게임이 끝날 때만 서버로 보내며, 그때 '운영 중 아님'(403) 응답이 오면 game.js 가 window.__gate.close() 로 즉시 덮는다. */
(function () {
'use strict';
function $(id) { return document.getElementById(id); }
var cover = $('cover'), coverMsg = $('coverMsg'), appEl = $('app');
var RETRY = 3000, MAX_FAILS = 3;
var fails = 0, covered = false;

function setCovered(on, msg) {
  covered = on;
  if (on) { cover.classList.remove('hidden'); appEl.classList.add('hidden'); coverMsg.textContent = msg || ''; }
  else { cover.classList.add('hidden'); appEl.classList.remove('hidden'); }
  var g = window.__game;
  if (g) { if (on) g.stop(); else g.start(); }
}

function check() {
  if (covered) return;
  fetch('/api/status', { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }).then(function (s) {
    if (covered) return;
    if (!(s && s.open === true)) { setCovered(true, '현재 운영 중이 아닙니다'); return; }
    if (window.__game && window.__game.setInfo) window.__game.setInfo({ group: s.group || '', best: Number(s.best) || 0, limit: Number(s.limit) || 0 });
  }).then(null, function () {
    if (covered) return;
    fails++;
    if (fails >= MAX_FAILS) { setCovered(true, '연결할 수 없습니다'); return; }
    setTimeout(check, RETRY);
  });
}
// 점수 전송에서 '운영 중 아님' 응답을 받았을 때 game.js 가 부른다: 바로 덮는다
window.__gate = { close: function (msg) { if (!covered) setCovered(true, msg || '현재 운영 중이 아닙니다'); } };

setCovered(false);   // 서버가 열려 있다고 확인하고 내려준 페이지이므로 바로 시작
check();
})();
