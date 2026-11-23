/* ---------- 게임 페이지 운영 상태 확인 ----------
   /game 은 서버가 '운영 중'일 때만 이 페이지를 내려준다. 이미 열려 있는 동안에도 주기적으로
   /api/status 를 확인해서, 운영이 종료되면 흰 화면으로 덮고 게임을 멈춘다.
   - 확인 간격은 10분이다. 대신 점수를 서버로 보낼 때 '운영 중이 아님'(403) 응답이 오면 game.js 가 window.__gate.close() 를 불러 즉시 덮는다.
   - 흰 화면(덮개)이 뜨면 상태 확인을 완전히 멈춘다. 다시 확인하려면 사용자가 새로고침해야 한다.
   - 상태를 연속으로 확인하지 못하면(연결 끊김 등) 닫힘으로 본다. 실패했을 때만 5초 뒤 다시 확인한다. */
(function () {
'use strict';
function $(id) { return document.getElementById(id); }
var cover = $('cover'), coverMsg = $('coverMsg'), appEl = $('app');
var POLL = Math.max(500, parseInt(new URLSearchParams(location.search).get('poll') || '600000', 10) || 600000);   // 10분
var RETRY = 5000, RETURN_MIN = 60000;   // 실패 시 재시도 간격 / 화면으로 돌아왔을 때 이전 확인이 이만큼 지났으면 다시 확인
var MAX_FAILS = 3;

var open = true, fails = 0, covered = false, lastCheck = 0, timer = 0;

function setCovered(on, msg) {
  covered = on;
  if (on) clearTimeout(timer);   // 덮개가 뜨면 더 이상 확인하지 않는다
  if (on) { cover.classList.remove('hidden'); appEl.classList.add('hidden'); coverMsg.textContent = msg || ''; }
  else { cover.classList.add('hidden'); appEl.classList.remove('hidden'); }
  var g = window.__game;
  if (g) { if (on) g.stop(); else g.start(); }
}

function schedule(ms) { clearTimeout(timer); if (covered) return; timer = setTimeout(function () { if (document.hidden) schedule(POLL); else check(); }, ms); }
function check() {
  if (covered) return;
  lastCheck = Date.now();
  fetch('/api/status').then(function (r) {
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }).then(function (s) {
    if (covered) return;
    fails = 0;
    open = s && s.open === true;
    if (open && window.__game && window.__game.setInfo) window.__game.setInfo({ group: s.group || '', best: Number(s.best) || 0, limit: Number(s.limit) || 0 });
    if (!open) { setCovered(true, '현재 운영 중이 아닙니다'); return; }
    schedule(POLL);
  }).then(null, function () {
    if (covered) return;
    fails++;
    if (fails >= MAX_FAILS) { setCovered(true, '연결할 수 없습니다'); return; }
    schedule(RETRY);
  });
}
// 점수 전송에서 '운영 중이 아님' 응답을 받았을 때 game.js 가 부른다: 기다리지 않고 바로 덮는다
window.__gate = { close: function (msg) { open = false; if (!covered) setCovered(true, msg || '현재 운영 중이 아닙니다'); } };

setCovered(false);            // 서버가 열려 있다고 확인하고 내려준 페이지이므로 바로 시작
check();   // 이후 10분마다 (숨은 탭은 건너뛴다)
document.addEventListener('visibilitychange', function () { if (!document.hidden && !covered && Date.now() - lastCheck >= RETURN_MIN) check(); });
})();
