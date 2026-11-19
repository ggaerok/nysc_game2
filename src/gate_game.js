/* ---------- 게임 페이지 운영 상태 확인 ----------
   /game 은 서버가 '운영 중'일 때만 이 페이지를 내려준다. 이미 열려 있는 동안에도 주기적으로
   /api/status 를 확인해서, 운영이 종료되면 흰 화면으로 덮고 게임을 멈춘다.
   - 상태를 연속으로 확인하지 못하면(연결 끊김 등) 닫힘으로 본다. */
(function () {
'use strict';
function $(id) { return document.getElementById(id); }
var cover = $('cover'), coverMsg = $('coverMsg'), appEl = $('app');
var POLL = Math.max(500, parseInt(new URLSearchParams(location.search).get('poll') || '3000', 10) || 3000);
var MAX_FAILS = 3;

var open = true, fails = 0, covered = false;

function setCovered(on, msg) {
  covered = on;
  if (on) { cover.classList.remove('hidden'); appEl.classList.add('hidden'); coverMsg.textContent = msg || ''; }
  else { cover.classList.add('hidden'); appEl.classList.remove('hidden'); }
  var g = window.__game;
  if (g) { if (on) g.stop(); else g.start(); }
}

function check() {
  fetch('/api/status', { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }).then(function (s) {
    fails = 0;
    open = s && s.open === true;
    if (open && window.__game && window.__game.setInfo) window.__game.setInfo({ group: s.group || '', best: Number(s.best) || 0, limit: Number(s.limit) || 0 });
    if (!open) { if (!covered) setCovered(true, '현재 운영 중이 아닙니다'); else coverMsg.textContent = '현재 운영 중이 아닙니다'; }
    else if (covered) { location.replace('/play' + location.search); }   // 다시 열리면 입구부터
  }).then(null, function () {
    fails++;
    if (fails >= MAX_FAILS) setCovered(true, '연결할 수 없습니다');
  });
}

setCovered(false);            // 서버가 열려 있다고 확인하고 내려준 페이지이므로 바로 시작
check();
setInterval(check, POLL);
document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
})();
