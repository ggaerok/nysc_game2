/* ---------- Solar System 게임 ----------
   칸에 놓인 천체를 태양→수성→금성→지구→화성→목성→토성→천왕성→해왕성 순서대로 드래그해서 잇는다.
   2개 이상 이으면 사라지고, 위의 천체가 내려오며, 맨 윗줄은 미리보기(선택 불가)다. */
(function () {
'use strict';
function $(id) { return document.getElementById(id); }

/* ---------- 설정 (여기 값만 바꾸면 규칙이 바뀐다) ---------- */
var SIZES = [7, 9, 11];
var ALLOW_DIAGONAL = false;            // true 로 바꾸면 대각선으로도 이을 수 있다
var DEFAULT_LIMIT = 120;               // 서버에서 값을 받기 전 기본 제한 시간(초)
function pointsFor(n) { return 10 * Math.pow(2, n - 1) * n; }   // 2개 40, 3개 120, 4개 320 … 9개 23,040 (복리)

var sprites = BODIES.map(makeSprite);
var LAST = BODIES.length - 1;
var TWO = Math.PI * 2;

/* ---------- 상태 ---------- */
var N = 7;
try { var q = parseInt(new URLSearchParams(location.search).get('n'), 10); if (SIZES.indexOf(q) >= 0) N = q; } catch (e) {}
var grid = [];                     // grid[r][c] = {lv, y, v, a} , r=0 은 미리보기 줄
var path = [];                     // 드래그로 고른 칸 [{r,c}]
var dragging = false;
var state = 'ready';               // ready | play | over
var limit = DEFAULT_LIMIT, timeLeft = DEFAULT_LIMIT, lastNow = 0;
var score = 0, best = 0, sentMax = 0, lastSend = 0, sendTimer = 0;
var fx = [], pops = [], toast = null;
var running = false, uiOpen = 0, loopToken = 0;
var cell = 40, M = 12, cw = 0, ch = 0, dpr = 1;

/* ---------- 화면 요소 ---------- */
var cv = $('board'), ctx = cv.getContext('2d');
var elScore = $('score'), elBest = $('best'), elTimer = $('timer'), elOrg = $('org');
var elGoalName = $('goalName'), elGoalLab = $('goalLab'), goalCv = $('goalCv'), elProg = $('prog');

function rnd(n) { return Math.floor(Math.random() * n); }
function mk(lv, r, y) { return { lv: lv, r: r, y: y, v: 0, a: 1 }; }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function mmss(s) { s = Math.max(0, Math.ceil(s)); return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); }
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/* ---------- 판 만들기 ---------- */
function adjacent(a, b) {
  var dr = Math.abs(a.r - b.r), dc = Math.abs(a.c - b.c);
  return ALLOW_DIAGONAL ? (dr <= 1 && dc <= 1 && dr + dc > 0) : (dr + dc === 1);
}
function hasMove() {
  for (var r = 1; r <= N; r++) for (var c = 0; c < N; c++) {
    var a = grid[r][c]; if (!a) continue;
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue; if (!ALLOW_DIAGONAL && dr && dc) continue;
      var rr = r + dr, cc = c + dc; if (rr < 1 || rr > N || cc < 0 || cc >= N) continue;
      var b = grid[rr][cc]; if (b && b.lv === a.lv + 1) return true;
    }
  }
  return false;
}
function fillBoard() {
  grid = [];
  for (var r = 0; r <= N; r++) { var row = []; for (var c = 0; c < N; c++) row.push(mk(rnd(9), r, r)); grid.push(row); }
  var guard = 0;
  while (!hasMove() && guard++ < 50) for (var r2 = 1; r2 <= N; r2++) for (var c2 = 0; c2 < N; c2++) grid[r2][c2].lv = rnd(9);
}
function reshuffle() {
  var guard = 0;
  do { for (var r = 1; r <= N; r++) for (var c = 0; c < N; c++) if (grid[r][c]) grid[r][c].lv = rnd(9); } while (!hasMove() && guard++ < 50);
  toast = { text: '천체를 다시 섞었어요', t: 0 };
}
function busy() {
  for (var r = 1; r <= N; r++) for (var c = 0; c < N; c++) { var g = grid[r][c]; if (g && g.y < g.r - 0.02) return true; }
  return false;
}

/* ---------- 점수 보내기 (기존 Cosmos Ball 과 같은 방식) ---------- */
function showScore() { elScore.textContent = fmt(score); elBest.textContent = fmt(Math.max(best, score)); }
function setBest(v) { best = Number(v) || 0; showScore(); }
function sendScore() {
  lastSend = Date.now(); sendTimer = 0;
  if (score <= sentMax) return;
  var s = score;
  try {
    fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ score: s }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && typeof j.best === 'number') { sentMax = Math.max(sentMax, s); setBest(j.best); } })
      .then(null, function () {});
  } catch (e) {}
}
function maybeSend(force) {
  if (score <= sentMax) return;
  var wait = force ? 0 : Math.max(0, 1500 - (Date.now() - lastSend));
  if (!wait) { clearTimeout(sendTimer); sendScore(); }
  else if (!sendTimer) sendTimer = setTimeout(sendScore, wait);
}

/* ---------- 상단 표시 (목표 천체 / 진행 막대) ---------- */
function drawIconTo(canvas, lv, circleD) {
  var sp = sprites[lv], w = Math.round(circleD * sp.ext), d2 = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * d2); canvas.height = Math.round(w * d2);
  canvas.style.width = w + 'px'; canvas.style.height = w + 'px';
  var c = canvas.getContext('2d'); c.clearRect(0, 0, canvas.width, canvas.height);
  c.imageSmoothingQuality = 'high'; c.drawImage(sp.cv, 0, 0, canvas.width, canvas.height);
}
var progSegs = [];
(function buildProg() { for (var i = 0; i < 9; i++) { var s = document.createElement('i'); elProg.appendChild(s); progSegs.push(s); } })();
function updateGoal() {
  var lo = -1, hi = -1;
  if (path.length) { hi = grid[path[path.length - 1].r][path[path.length - 1].c].lv; lo = grid[path[0].r][path[0].c].lv; }
  for (var i = 0; i < 9; i++) progSegs[i].className = (i >= lo && i <= hi && lo >= 0) ? 'on' : '';
  var lv, lab, name;
  if (!path.length) { lv = 0; lab = '태양부터 순서대로 이어요'; name = BODIES[0].name; }
  else if (hi >= LAST) { lv = LAST; lab = '끝까지 이었어요!'; name = BODIES[LAST].name; }
  else { lv = hi + 1; lab = '이어서 선택할 천체'; name = BODIES[lv].name; }
  elGoalLab.textContent = lab; elGoalName.textContent = name;
  if (goalCv.dataset.lv !== String(lv)) { goalCv.dataset.lv = lv; drawIconTo(goalCv, lv, 40); }
}
function buildLegend() {
  var box = $('legend'); box.textContent = '';
  for (var i = 0; i < 9; i++) {
    var it = document.createElement('div'); it.className = 'it';
    var c = document.createElement('canvas'); drawIconTo(c, i, 21); it.appendChild(c);
    var sp = document.createElement('span'); sp.textContent = BODIES[i].name; it.appendChild(sp);
    box.appendChild(it);
    if (i < 8) { var ar = document.createElement('b'); ar.textContent = '›'; box.appendChild(ar); }
  }
}

/* ---------- 크기 맞추기 ---------- */
function fit() {
  var st = $('stage'), aw = st.clientWidth - 16, ah = st.clientHeight - 12;
  var frame = 2 * (3.5 + 3);                 // 테두리 + 안쪽 여백
  var c1 = (aw - frame) / (N + 0.6), c2 = (ah - frame) / (N + 1 + 0.6);
  cell = Math.max(18, Math.floor(Math.min(c1, c2)));
  M = Math.round(cell * 0.3);
  cw = N * cell + 2 * M; ch = (N + 1) * cell + 2 * M;
  dpr = Math.min(3, window.devicePixelRatio || 1);
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
}

/* ---------- 입력 ---------- */
function cellAt(e) {
  var rc = cv.getBoundingClientRect();
  var x = (e.clientX - rc.left) * (cw / rc.width) - M, y = (e.clientY - rc.top) * (ch / rc.height) - M;
  var c = Math.floor(x / cell), r = Math.floor(y / cell);
  if (r < 1 || r > N || c < 0 || c >= N) return null;
  var dx = x - (c + .5) * cell, dy = y - (r + .5) * cell;
  if (Math.sqrt(dx * dx + dy * dy) > cell * 0.46) return null;   // 칸 모서리를 스치면 선택하지 않는다
  var g = grid[r][c]; if (!g || g.y < g.r - 0.3) return null;     // 아직 떨어지는 중인 천체는 고르지 않는다
  return { r: r, c: c };
}
function lvOf(p) { return grid[p.r][p.c].lv; }
function onDown(e) {
  if (state !== 'play' || uiOpen || busy()) return;
  var p = cellAt(e); if (!p) return;
  dragging = true; path = [p]; try { cv.setPointerCapture(e.pointerId); } catch (er) {}
  if (navigator.vibrate) navigator.vibrate(8);
  updateGoal(); e.preventDefault();
}
function onMove(e) {
  if (!dragging) return;
  var p = cellAt(e); if (!p) return;
  var last = path[path.length - 1];
  if (p.r === last.r && p.c === last.c) return;
  if (path.length >= 2) { var prev = path[path.length - 2]; if (prev.r === p.r && prev.c === p.c) { path.pop(); updateGoal(); return; } }
  if (!adjacent(last, p)) return;
  for (var i = 0; i < path.length; i++) if (path[i].r === p.r && path[i].c === p.c) return;
  if (lvOf(p) !== lvOf(last) + 1) return;
  path.push(p); if (navigator.vibrate) navigator.vibrate(5);
  updateGoal();
}
function onUp(e) {
  if (!dragging) return;
  dragging = false;
  if (path.length >= 2 && state === 'play') commit(path); 
  path = []; updateGoal();
}
cv.addEventListener('pointerdown', onDown);
cv.addEventListener('pointermove', onMove);
cv.addEventListener('pointerup', onUp);
cv.addEventListener('pointercancel', function () { dragging = false; path = []; updateGoal(); });

/* ---------- 이어서 없애기 ---------- */
var COLORS = BODIES.map(function (b) { return b.color; });
function commit(p) {
  var n = p.length, pts = pointsFor(n), i, g, k;
  for (i = 0; i < n; i++) {
    g = grid[p[i].r][p[i].c];
    for (k = 0; k < 7; k++) { var a = Math.random() * TWO, s = (0.6 + Math.random() * 1.6) * cell; fx.push({ x: (p[i].c + .5) * cell, y: (p[i].r + .5) * cell, vx: Math.cos(a) * s, vy: Math.sin(a) * s - cell * .6, t: 0, life: .5 + Math.random() * .3, col: COLORS[g.lv], r: cell * (.05 + Math.random() * .07) }); }
    grid[p[i].r][p[i].c] = null;
  }
  var e = p[n - 1];
  pops.push({ x: (e.c + .5) * cell, y: (e.r + .5) * cell, text: '+' + fmt(pts), sub: n >= 9 ? 'PERFECT!' : n + '연결', t: 0, big: n >= 5 });
  score += pts; showScore(); maybeSend(false);
  collapse();
}
function collapse() {
  for (var c = 0; c < N; c++) {
    var keep = [];
    for (var r = 1; r <= N; r++) if (grid[r][c]) keep.push(grid[r][c]);
    var k = N - keep.length; if (!k) continue;
    var col = [], j;
    for (j = 1; j <= k; j++) col.push(j === k ? grid[0][c] : mk(rnd(9), 0, j - k));   // 맨 아래 빈칸은 미리보기 천체가 내려온다
    col = col.concat(keep);
    for (j = 0; j < N; j++) { grid[j + 1][c] = col[j]; col[j].r = j + 1; }
    grid[0][c] = mk(rnd(9), 0, 0); grid[0][c].a = 0;                                    // 새 미리보기
  }
}

/* ---------- 그리기 ---------- */
function planetAt(c, g, x, y, alpha) {
  var sp = sprites[g.lv], d = cell * 0.86, w = d * sp.ext;
  c.globalAlpha = alpha; c.drawImage(sp.cv, x - w / 2, y - w / 2, w, w); c.globalAlpha = 1;
}
function draw() {
  var c = ctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, cw, ch);
  c.save(); c.translate(M, M); c.imageSmoothingQuality = 'high';
  // 미리보기 줄 구분선
  c.strokeStyle = 'rgba(255,233,168,.45)'; c.lineWidth = 2; c.setLineDash([6, 6]);
  c.beginPath(); c.moveTo(cell * .1, cell); c.lineTo(N * cell - cell * .1, cell); c.stroke(); c.setLineDash([]);
  var sel = {}, i, r, cc, g;
  for (i = 0; i < path.length; i++) sel[path[i].r + ',' + path[i].c] = 1;
  // 선택 표시(밝은 바탕 원)
  for (i = 0; i < path.length; i++) { c.beginPath(); c.arc((path[i].c + .5) * cell, (path[i].r + .5) * cell, cell * .48, 0, TWO); c.fillStyle = 'rgba(255,255,255,.38)'; c.fill(); }
  var list = [];
  for (r = 0; r <= N; r++) for (cc = 0; cc < N; cc++) { g = grid[r][cc]; if (g) list.push({ g: g, c: cc, r: r }); }
  list.sort(function (a, b) { return a.g.y - b.g.y; });
  for (i = 0; i < list.length; i++) {
    g = list[i].g; var al = g.r === 0 ? 0.42 * g.a : 1;
    planetAt(c, g, (list[i].c + .5) * cell, (g.y + .5) * cell, al);
  }
  // 반투명 연결선
  if (path.length > 1) {
    c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath();
    for (i = 0; i < path.length; i++) { var px = (path[i].c + .5) * cell, py = (path[i].r + .5) * cell; if (i) c.lineTo(px, py); else c.moveTo(px, py); }
    c.strokeStyle = 'rgba(255,255,255,.38)'; c.lineWidth = cell * .34; c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.72)'; c.lineWidth = cell * .1; c.stroke();
  }
  // 반짝임
  for (i = 0; i < fx.length; i++) { var f = fx[i]; c.globalAlpha = Math.max(0, 1 - f.t / f.life); c.beginPath(); c.arc(f.x, f.y, f.r, 0, TWO); c.fillStyle = f.col; c.fill(); }
  c.globalAlpha = 1;
  // 점수 팝업
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  for (i = 0; i < pops.length; i++) {
    var p = pops[i], k = Math.min(1, p.t / .18), a = p.t > 1.1 ? Math.max(0, 1 - (p.t - 1.1) / .4) : 1;
    var sc = (0.7 + 0.3 * k) * (p.big ? 1.25 : 1), x = Math.min(N * cell - cell * 1.1, Math.max(cell * 1.1, p.x)), y = p.y - cell * (.7 + p.t * .5);
    c.globalAlpha = a; c.font = Math.round(cell * .62 * sc) + 'px Jua, sans-serif';
    c.lineWidth = cell * .2; c.strokeStyle = '#1b1330'; c.strokeText(p.text, x, y); c.fillStyle = '#ffd23f'; c.fillText(p.text, x, y);
    c.font = Math.round(cell * .36 * sc) + 'px Jua, sans-serif'; c.lineWidth = cell * .14; c.strokeText(p.sub, x, y - cell * .5 * sc); c.fillStyle = '#fff3cf'; c.fillText(p.sub, x, y - cell * .5 * sc);
  }
  c.globalAlpha = 1;
  if (toast) { c.globalAlpha = Math.max(0, Math.min(1, 2 - toast.t)); c.font = Math.round(cell * .5) + 'px Jua, sans-serif'; c.lineWidth = cell * .16; c.strokeStyle = '#1b1330'; c.strokeText(toast.text, N * cell / 2, (N + 1) * cell / 2); c.fillStyle = '#fff3cf'; c.fillText(toast.text, N * cell / 2, (N + 1) * cell / 2); c.globalAlpha = 1; }
  c.restore();
}

/* ---------- 움직임 / 시간 ---------- */
function update(dt, now) {
  var r, c, g, i;
  for (r = 0; r <= N; r++) for (c = 0; c < N; c++) {
    g = grid[r][c]; if (!g) continue;
    if (g.a < 1) g.a = Math.min(1, g.a + dt * 3);
    if (g.y < g.r) { g.v += 70 * dt; g.y = Math.min(g.r, g.y + g.v * dt); if (g.y >= g.r) g.v = 0; }
  }
  for (i = fx.length - 1; i >= 0; i--) { var f = fx[i]; f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += cell * 5 * dt; if (f.t > f.life) fx.splice(i, 1); }
  for (i = pops.length - 1; i >= 0; i--) { pops[i].t += dt; if (pops[i].t > 1.5) pops.splice(i, 1); }
  if (toast) { toast.t += dt; if (toast.t > 2) toast = null; }
  if (state === 'play') {
    if (!uiOpen) timeLeft -= (now - lastNow) / 1000;
    if (!busy() && !dragging && !hasMove()) reshuffle();
    var tl = Math.max(0, timeLeft);
    elTimer.textContent = mmss(tl); elTimer.parentNode.className = 'pill' + (tl <= 10 ? ' urgent' : '');
    if (timeLeft <= 0) endGame();
  }
}
function endGame() {
  state = 'over'; dragging = false; path = []; updateGoal(); maybeSend(true);
  $('finalScore').textContent = fmt(score); $('finalBest').textContent = fmt(Math.max(best, score));
  $('over').classList.remove('hidden');
}

/* ---------- 시작 화면 (칸 수 선택) ---------- */
function drawSizeButtons() {
  var btns = document.querySelectorAll('#sizes button');
  for (var i = 0; i < btns.length; i++) btns[i].className = (+btns[i].dataset.n === N) ? 'on' : '';
  $('readyLimit').textContent = mmss(limit);
}
function newBoard() {
  fillBoard(); path = []; dragging = false; fx = []; pops = []; toast = null;
  score = 0; sentMax = 0; showScore(); updateGoal(); fit();
}
function showReady() {
  state = 'ready'; newBoard(); timeLeft = limit; elTimer.textContent = mmss(limit); elTimer.parentNode.className = 'pill';
  $('over').classList.add('hidden'); $('ready').classList.remove('hidden'); drawSizeButtons();
}
function beginPlay() {
  $('ready').classList.add('hidden'); state = 'play'; timeLeft = limit; lastNow = Date.now();
}
Array.prototype.forEach.call(document.querySelectorAll('#sizes button'), function (b) {
  b.addEventListener('click', function () { N = +b.dataset.n; newBoard(); drawSizeButtons(); });
});
$('btnStart').addEventListener('click', beginPlay);
$('restart').addEventListener('click', showReady);

/* ---------- 창(역대 기록 / 확인) ---------- */
var elDlg = $('dlg'), elDlgCard = $('dlgCard');
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function openDlg() { uiOpen = 1; dragging = false; path = []; elDlg.classList.remove('hidden'); }
function closeDlg() { uiOpen = 0; lastNow = Date.now(); elDlg.classList.add('hidden'); elDlgCard.textContent = ''; }
function confirmDlg(title, msg, okLabel, onOk) {
  elDlgCard.textContent = ''; elDlgCard.appendChild(el('h2', '', title)); elDlgCard.appendChild(el('p', 'sm', msg));
  var row = el('div', 'row');
  var no = el('button', 'sec', '취소'); no.type = 'button'; no.addEventListener('click', closeDlg);
  var ok = el('button', '', okLabel); ok.type = 'button'; ok.addEventListener('click', function () { closeDlg(); onOk(); });
  row.appendChild(no); row.appendChild(ok); elDlgCard.appendChild(row); openDlg();
}
function fmtAt(ts) { var d = new Date(ts); return pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function hallDlg() {
  elDlgCard.textContent = ''; elDlgCard.appendChild(el('h2', '', '역대 최고기록'));
  var body = el('div', 'empty', '불러오는 중…'); elDlgCard.appendChild(body);
  var row = el('div', 'row'); var close = el('button', '', '닫기'); close.type = 'button'; close.addEventListener('click', closeDlg);
  row.appendChild(close); elDlgCard.appendChild(row); openDlg();
  fetch('/api/hall', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); }).then(function (j) {
    if (!uiOpen || !elDlgCard.contains(body)) return;
    var list = (j && j.entries) || [];
    if (!list.length) { body.textContent = '아직 기록이 없습니다.'; return; }
    var ol = el('ol');
    list.forEach(function (e, i) {
      var li = el('li', e.live ? 'live' : ''); li.appendChild(el('span', 'rk', String(i + 1)));
      var nm = el('span', 'nm', e.name); nm.appendChild(el('small', '', e.live ? '진행 중' : fmtAt(e.at)));
      li.appendChild(nm); li.appendChild(el('span', 'pt', fmt(e.score))); ol.appendChild(li);
    });
    body.replaceWith(ol);
  }).then(null, function () { if (elDlgCard.contains(body)) body.textContent = '기록을 불러오지 못했습니다.'; });
}
$('btnHall').addEventListener('click', hallDlg);
$('btnHome').addEventListener('click', function () {
  function go() { location.href = '/play' + location.search; }
  if (state === 'play' && score > 0) confirmDlg('처음으로', '처음 화면으로 돌아갑니다. 진행 중인 게임은 사라집니다.', '돌아가기', go); else go();
});
$('btnRefresh').addEventListener('click', function () {
  if (state === 'play' && score > 0) confirmDlg('다시 시작', '지금 게임을 끝내고 처음부터 다시 시작합니다.', '다시 시작', showReady); else showReady();
});
document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

/* ---------- 메인 루프 / 입구 스크립트와의 연결 ---------- */
var lastT = 0;
function start() {
  if (running) return;
  running = true; buildLegend(); showReady(); lastT = 0;
  var token = ++loopToken;
  function f(t) {
    if (!running || token !== loopToken) return; requestAnimationFrame(f);
    var now = Date.now(), dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0; lastT = t;
    update(dt, now); lastNow = now; draw();
  }
  requestAnimationFrame(f);
}
function stop() {
  if (!running) return;
  running = false; dragging = false; path = []; state = 'ready'; closeDlg();
  $('over').classList.add('hidden'); $('ready').classList.add('hidden');
}
window.__game = { start: start, stop: stop, isRunning: function () { return running; },
  setInfo: function (o) {
    if (!o) return;
    if (typeof o.group === 'string') $('orgName').textContent = o.group;
    if (typeof o.best === 'number') setBest(o.best);
    if (typeof o.limit === 'number' && o.limit >= 10 && o.limit !== limit) { limit = o.limit; if (state === 'ready') { timeLeft = limit; elTimer.textContent = mmss(limit); drawSizeButtons(); } }
  } };
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', function () { setTimeout(fit, 200); });
if (window.ResizeObserver) new ResizeObserver(fit).observe($('stage'));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {});

/* 개발·검증용 훅 (주소에 ?dev=1 이 있을 때만) */
if (/[?&]dev=1/.test(location.search)) window.__co = {
  grid: function () { return grid.map(function (row) { return row.map(function (g) { return g ? g.lv : -1; }); }); },
  setGrid: function (rows) { for (var r = 0; r < rows.length; r++) for (var c = 0; c < rows[r].length; c++) { grid[r][c].lv = rows[r][c]; } },
  info: function () { return { N: N, state: state, score: score, cell: cell, M: M, timeLeft: timeLeft, limit: limit }; },
  setTime: function (s) { timeLeft = s; }, canvasRect: function () { return cv.getBoundingClientRect().toJSON(); }
};
})();
