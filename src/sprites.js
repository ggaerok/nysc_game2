/* 천체 그림: Cosmos Ball(nysc_game1)의 그리기 코드를 그대로 사용 */
var TWO_PI = Math.PI * 2;
/* ---------- 작은 도구들 ---------- */
function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function circlePath(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TWO_PI); }
function blobPath(c, cx, cy, rad, rand, irreg, n) {
  n = n || 10;
  var p = [], i, a, k;
  for (i = 0; i < n; i++) {
    a = i / n * TWO_PI; k = 1 - irreg + rand() * irreg * 2;
    p.push([cx + Math.cos(a) * rad * k, cy + Math.sin(a) * rad * k]);
  }
  c.beginPath();
  c.moveTo((p[n - 1][0] + p[0][0]) / 2, (p[n - 1][1] + p[0][1]) / 2);
  for (i = 0; i < n; i++) {
    var q = p[i], b = p[(i + 1) % n];
    c.quadraticCurveTo(q[0], q[1], (q[0] + b[0]) / 2, (q[1] + b[1]) / 2);
  }
  c.closePath();
}
function craters(c, r, rand, n, minR, maxR, fill, rim) {
  for (var i = 0; i < n; i++) {
    var d = Math.sqrt(rand()) * r * 0.9, a = rand() * TWO_PI;
    var x = Math.cos(a) * d, y = Math.sin(a) * d, cr = r * (minR + rand() * (maxR - minR));
    circlePath(c, x, y, cr); c.fillStyle = fill; c.fill();
    c.strokeStyle = rim; c.lineWidth = Math.max(0.5, cr * 0.2);
    c.beginPath(); c.arc(x, y, cr, Math.PI * 0.75, Math.PI * 1.75); c.stroke();
  }
}
function band(c, r, y0, y1, color, amp, freq, phase) {
  var n = 16, i, x, y;
  c.fillStyle = color; c.beginPath();
  for (i = 0; i <= n; i++) {
    x = -r + 2 * r * i / n; y = y0 * r + Math.sin(x / r * freq + phase) * r * amp;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  for (i = n; i >= 0; i--) {
    x = -r + 2 * r * i / n; y = y1 * r + Math.sin(x / r * freq + phase + 0.8) * r * amp;
    c.lineTo(x, y);
  }
  c.closePath(); c.fill();
}
function ringArc(c, rx, ry, rot, front, color, lw) {
  c.beginPath();
  c.ellipse(0, 0, rx, ry, rot, front ? 0 : Math.PI, front ? Math.PI : TWO_PI);
  c.strokeStyle = color; c.lineWidth = lw; c.stroke();
}
function ellipseFill(c, x, y, rx, ry, rot, fill) {
  c.beginPath(); c.ellipse(x, y, rx, ry, rot || 0, 0, TWO_PI); c.fillStyle = fill; c.fill();
}

/* ---------- 캐릭터풍 천체 그림 ----------
   원(판정 영역) 안은 평평한 색 + 간단한 무늬, 굵은 외곽선, 하이라이트, 얼굴.
   고리(토성·목성·천왕성·해왕성)와 태양의 홍염은 원 밖으로 나와 있고 충돌 판정에는 쓰이지 않는다.
   그림은 3겹: back(고리 뒤쪽) -> art(무늬, 몸과 함께 회전) -> front(음영·외곽선·얼굴·고리 앞쪽, 회전하지 않음) */
var INK = '#1b1330';
function fillP(c, d, fill, alpha) { c.globalAlpha = alpha == null ? 1 : alpha; c.fillStyle = fill; c.fill(new Path2D(d)); c.globalAlpha = 1; }
function strokeP(c, d, color, lw, alpha) { c.globalAlpha = alpha == null ? 1 : alpha; c.strokeStyle = color; c.lineWidth = lw; c.lineCap = 'round'; c.stroke(new Path2D(d)); c.globalAlpha = 1; }
function ell(c, x, y, rx, ry, fill, alpha) { c.globalAlpha = alpha == null ? 1 : alpha; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TWO_PI); c.fillStyle = fill; c.fill(); c.globalAlpha = 1; }
// 가로 띠(물결): y 위치, 높이, 진하기
function waveBand(c, y, h, color, alpha, amp) {
  amp = amp == null ? 8 : amp;
  fillP(c, 'M-46 ' + y + ' Q-15 ' + (y - amp) + ' 10 ' + y + ' T46 ' + y + ' L46 ' + (y + h) + ' Q15 ' + (y + h - amp) + ' -10 ' + (y + h) + ' T-46 ' + (y + h) + 'Z', color, alpha);
}
function flatBand(c, y, h, color, alpha) { c.globalAlpha = alpha; c.fillStyle = color; c.fillRect(-46, y, 92, h); c.globalAlpha = 1; }
// 표면 그리기 공통: 단색 바탕을 깔고, 반지름 42 기준 좌표로 무늬를 그린다
function surface(c, r, base, fn) {
  c.fillStyle = base; c.fillRect(-r, -r, 2 * r, 2 * r);
  c.save(); c.scale(r / 42, r / 42); fn(c); c.restore();
}
function moonCraters(c, dk) {
  var L = [[-14, -12, 7], [12, -18, 5], [10, 10, 9], [-18, 14, 5], [0, -2, 3.5]];
  for (var i = 0; i < L.length; i++) { ell(c, L[i][0], L[i][1], L[i][2], L[i][2], dk, .45); }
}

function drawMoon(c, r) {
  surface(c, r, '#bdbab4', function (c) {
    // 달의 어두운 바다(마리아)와 크레이터
    ell(c, -10, -8, 13, 10, '#8f8d89', .55); ell(c, 8, -16, 8, 6, '#8f8d89', .5); ell(c, 14, 6, 10, 8, '#8f8d89', .45);
    ell(c, -16, 16, 6, 6, '#a3a19c', .8); ell(c, 4, 20, 4, 4, '#a3a19c', .8); ell(c, -2, 2, 3, 3, '#a3a19c', .8);
  });
}
function drawMercury(c, r) {
  surface(c, r, '#9a918a', function (c) { moonCraters(c, '#5f5852'); });
}
function drawMars(c, r) {
  surface(c, r, '#c4764a', function (c) {
    fillP(c, 'M-32 4 Q-14 -8 6 6 Q22 16 36 2 L36 14 Q16 28 -6 20 Q-22 14 -32 16Z', '#7f4a30', .55);
    ell(c, -14, -12, 9, 5, '#7f4a30', .4); ell(c, 18, -8, 6, 4, '#e0a070', .5);
    ell(c, 0, -38, 14, 6, '#f4efe8', .95); ell(c, 4, 40, 8, 3.5, '#f4efe8', .8);
  });
}
function drawVenus(c, r) {
  surface(c, r, '#eadbb0', function (c) {
    waveBand(c, -26, 7, '#cdb27a', .4); waveBand(c, -10, 8, '#f6efd6', .6); waveBand(c, 6, 9, '#cdb27a', .38); waveBand(c, 24, 7, '#f6efd6', .5);
  });
}
/* 지구: 위도·경도 윤곽(대략)을 정사영으로 구에 투영해 실제 대륙 모습을 그린다 */
var EARTH_LAND = [
  [[-168,66],[-160,70],[-140,70],[-125,70],[-95,72],[-80,70],[-65,60],[-55,52],[-67,45],[-76,38],[-81,31],[-80,25],[-84,30],[-90,29],[-97,26],[-97,20],[-90,21],[-87,21],[-88,15],[-83,10],[-78,8],[-80,8],[-86,12],[-92,15],[-105,20],[-112,29],[-117,33],[-124,40],[-124,48],[-135,58],[-150,60],[-165,60]],
  [[-80,8],[-72,12],[-62,10],[-50,0],[-35,-6],[-39,-15],[-48,-26],[-58,-35],[-65,-42],[-68,-52],[-72,-50],[-74,-40],[-71,-28],[-70,-18],[-76,-14],[-81,-5],[-78,2]],
  [[-17,21],[-10,30],[-6,36],[10,37],[20,32],[32,31],[35,28],[43,12],[51,12],[40,-3],[40,-15],[35,-24],[26,-34],[18,-34],[12,-18],[9,-2],[9,4],[-8,4],[-17,14]],
  [[-9,37],[-9,43],[-2,44],[-5,48],[2,51],[8,54],[10,57],[5,62],[15,69],[30,71],[40,66],[40,55],[30,46],[28,41],[22,37],[15,38],[12,44],[3,43],[-5,36]],
  [[28,41],[40,55],[40,66],[60,70],[100,77],[140,72],[170,70],[160,60],[140,52],[135,35],[122,30],[120,22],[108,12],[104,1],[98,8],[92,22],[80,8],[72,20],[58,22],[52,16],[43,12],[35,28],[36,36]],
  [[-55,60],[-45,60],[-20,70],[-20,80],[-60,82],[-72,78],[-55,68]],
  [[114,-22],[122,-18],[131,-12],[142,-11],[146,-19],[153,-27],[150,-37],[140,-38],[130,-32],[115,-34]]
];
function earthProject(lon, lat, lon0, lat0) {
  var d2r = Math.PI / 180, la = lat * d2r, dl = (lon - lon0) * d2r, p0 = lat0 * d2r;
  var x = Math.cos(la) * Math.sin(dl);
  var y = Math.cos(p0) * Math.sin(la) - Math.sin(p0) * Math.cos(la) * Math.cos(dl);
  var vis = Math.sin(p0) * Math.sin(la) + Math.cos(p0) * Math.cos(la) * Math.cos(dl);
  if (vis < 0) { var m = Math.sqrt(x * x + y * y) || 1; x /= m; y /= m; }
  return [x, -y];   // 화면 y는 아래쪽이 +
}
function earthPoly(c, poly, lon0, lat0, R) {
  var pts = [], i, j, a, b, n, t;
  for (i = 0; i < poly.length; i++) {
    a = poly[i]; b = poly[(i + 1) % poly.length];
    n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / 3));
    for (j = 0; j < n; j++) { t = j / n; pts.push(earthProject(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, lon0, lat0)); }
  }
  c.beginPath();
  for (i = 0; i < pts.length; i++) { if (i) c.lineTo(pts[i][0] * R, pts[i][1] * R); else c.moveTo(pts[i][0] * R, pts[i][1] * R); }
  c.closePath();
}
function drawEarth(c, r) {
  surface(c, r, '#2f6db5', function (c) {
    var R = 42, k;
    for (k = 0; k < EARTH_LAND.length; k++) { earthPoly(c, EARTH_LAND[k], -5, 15, R); c.fillStyle = '#5c9e4b'; c.fill(); }
    // 사하라·아라비아 사막 색
    earthPoly(c, [[-15,28],[-5,32],[10,32],[25,30],[34,27],[38,18],[20,16],[0,16],[-15,18]], -5, 15, R); c.fillStyle = '#cdb36a'; c.globalAlpha = .9; c.fill(); c.globalAlpha = 1;
    // 남극·북극 얼음
    earthPoly(c, [[-180,-72],[-90,-72],[0,-72],[90,-72],[179,-72],[179,-90],[-180,-90]], -5, 15, R); c.fillStyle = '#f3f6fa'; c.fill();
    earthPoly(c, [[-180,82],[-90,82],[0,82],[90,82],[179,82],[179,90],[-180,90]], -5, 15, R); c.fillStyle = '#f3f6fa'; c.fill();
    // 구름
    strokeP(c, 'M-30 -14 Q-16 -22 -4 -14', '#fff', 4, .75);
    strokeP(c, 'M8 -30 Q22 -34 32 -24', '#fff', 3.6, .7);
    strokeP(c, 'M-26 16 Q-12 8 2 16', '#fff', 3.6, .7);
    strokeP(c, 'M14 22 Q26 18 34 26', '#fff', 3.4, .65);
  });
}
function drawNeptune(c, r) {
  surface(c, r, '#5f9fd0', function (c) {
    flatBand(c, -26, 8, '#3e78ad', .3); flatBand(c, -8, 6, '#3e78ad', .22); flatBand(c, 14, 10, '#3e78ad', .28);
    ell(c, -10, -2, 9, 5.5, '#2d5f93', .6); ell(c, 22, -18, 7, 2.6, '#fff', .5);
  });
}
function drawUranus(c, r) {
  surface(c, r, '#aedfe0', function (c) {
    flatBand(c, -30, 5, '#7fb8bd', .2); flatBand(c, -12, 6, '#7fb8bd', .14); flatBand(c, 8, 5, '#7fb8bd', .2); flatBand(c, 24, 6, '#7fb8bd', .14);
  });
}
function drawSaturn(c, r) {
  surface(c, r, '#e8dcc0', function (c) {
    flatBand(c, -46, 14, '#b9a47c', .55); flatBand(c, -30, 6, '#c9b48a', .5); flatBand(c, -20, 8, '#d8c7a0', .5);
    flatBand(c, -6, 6, '#f3ead2', .8); flatBand(c, 2, 9, '#d9b97c', .55); flatBand(c, 14, 7, '#efe3c6', .7);
    flatBand(c, 24, 6, '#c9b48a', .45); flatBand(c, 32, 12, '#a9b3b5', .4);
  });
}
/* 목성: 실제 사진의 줄무늬 순서 (북쪽 극지방 -> 북온대대 -> 북적도대(가장 진함) -> 적도대(밝음) -> 남적도대 + 대적점 -> 남온대대 -> 남극지방) */
function drawJupiter(c, r) {
  surface(c, r, '#ebdfc9', function (c) {
    flatBand(c, -46, 14, '#c3a47c', .6);
    waveBand(c, -33, 4, '#b98a62', .55, 3);
    waveBand(c, -22, 4, '#b4794f', .5, 3);
    waveBand(c, -14, 10, '#c07f52', .85, 4);
    ell(c, -16, -9, 6, 2, '#fff', .55); ell(c, 4, -10, 7, 2.2, '#fff', .5); ell(c, 24, -8, 5, 1.8, '#fff', .5);
    waveBand(c, 1, 3, '#a88a6c', .6, 5);
    waveBand(c, 8, 7, '#b8714e', .75, 3);
    ell(c, 13, 14, 11.5, 7.5, '#f4ead6', .8); ell(c, 13, 14, 8.5, 5.2, '#d85f2e'); ell(c, 13, 14, 4, 2.4, '#ea8d58', .8);
    waveBand(c, 26, 3, '#b99572', .6, 3);
    flatBand(c, 31, 16, '#c3a47c', .6);
  });
}
function drawSun(c, r) {
  surface(c, r, '#ffc93c', function (c) {
    ell(c, 14, 16, 6, 6, '#ff9f1c', .45); ell(c, -20, 14, 4, 4, '#ff9f1c', .4); ell(c, -8, -18, 5, 5, '#ff9f1c', .35); ell(c, 22, -10, 3.5, 3.5, '#ff9f1c', .4);
  });
}

/* 고리: 토성은 실제처럼 여러 띠와 틈이 있는 넓은 고리, 나머지는 흰색 선 하나 */
function drawRing(c, r, spec, front) {
  var a0 = front ? 0 : Math.PI, a1 = front ? Math.PI : TWO_PI, i, b;
  function arc(k, w, color, alpha, extra) {
    c.beginPath(); c.ellipse(0, 0, r * k, r * k * spec.flat, spec.rot, a0, a1);
    c.globalAlpha = alpha == null ? 1 : alpha; c.strokeStyle = color; c.lineWidth = w + (extra || 0); c.lineCap = 'butt'; c.stroke(); c.globalAlpha = 1;
  }
  if (spec.kind === 'saturn') {
    var ol = Math.max(2, r * .045);
    for (i = 0; i < spec.bands.length; i++) { b = spec.bands[i]; arc(b[0], b[1] * r, INK, 1, ol * 2); }
    for (i = 0; i < spec.bands.length; i++) { b = spec.bands[i]; arc(b[0], b[1] * r, b[2], b[3]); }
  } else {
    var w = Math.max(1.8, r * .04);
    arc(spec.k, w, INK, .55, Math.max(2, r * .05));
    arc(spec.k, w, '#ffffff', 1);
  }
}
function drawRays(c, r) {   // 태양의 홍염: 12개의 불꽃(길고 짧은 것이 번갈아, 끝이 한쪽으로 휘어 소용돌이치듯)
  var i, a, len, bend, hw, p0, p1, tip;
  function flame(scale, fill, outline) {
    for (i = 0; i < 12; i++) {
      a = i / 12 * TWO_PI + .13; len = (i % 2 ? 1.26 : 1.38) * scale + (scale < 1 ? .0 : 0); bend = .2; hw = .17;
      var ca = Math.cos(a), sa = Math.sin(a), cp = Math.cos(a + Math.PI / 2), sp = Math.sin(a + Math.PI / 2);
      var rin = r * .95, rout = r * (i % 2 ? 1.27 : 1.39);
      if (scale < 1) { rout = rin + (rout - rin) * .62; hw *= .55; }
      var bx0 = ca * rin - cp * r * hw, by0 = sa * rin - sp * r * hw, bx1 = ca * rin + cp * r * hw, by1 = sa * rin + sp * r * hw;
      var tx = ca * rout + cp * r * bend * (scale < 1 ? .5 : 1), ty = sa * rout + sp * r * bend * (scale < 1 ? .5 : 1);
      c.beginPath(); c.moveTo(bx0, by0);
      c.bezierCurveTo(ca * r * 1.1 - cp * r * hw * 1.5, sa * r * 1.1 - sp * r * hw * 1.5, ca * rout * .92 - cp * r * .02, sa * rout * .92 - sp * r * .02, tx, ty);
      c.bezierCurveTo(ca * rout * .86 + cp * r * hw * 1.0, sa * rout * .86 + sp * r * hw * 1.0, ca * r * 1.06 + cp * r * hw * 1.2, sa * r * 1.06 + sp * r * hw * 1.2, bx1, by1);
      c.closePath();
      if (outline) { c.lineJoin = 'round'; c.strokeStyle = INK; c.lineWidth = Math.max(2, r * .075); c.stroke(); }
      c.fillStyle = fill; c.fill();
    }
  }
  flame(1, '#ff8a1c', true);      // 바깥 불꽃 (윤곽선 + 주황)
  flame(.99, '#ff8a1c', false);
  flame(.7, '#ffd24a', false);    // 안쪽 불꽃 (밝은 노랑)
}
/* 음영(고정 조명) + 외곽선 + 얼굴 */
function drawFront(c, r, def) {
  var u = r / 42, dark = def.dark;
  // 오른쪽의 그림자 초승달 (빛은 왼쪽 위에서)
  if (!def.photo) { c.save(); circlePath(c, 0, 0, r - .3); c.clip(); c.scale(u, u);
  fillP(c, 'M10.5 -42 A42 42 0 0 1 10.5 42 A50 42 0 0 0 10.5 -42Z', '#000', dark ? .22 : .13);
  c.restore(); }
  // 외곽선 (바깥 경계가 곧 판정 원)
  var lw = Math.max(2, 4.5 * u);
  if (!def.photo) { c.beginPath(); c.arc(0, 0, r - lw / 2, 0, TWO_PI); c.strokeStyle = INK; c.lineWidth = lw; c.stroke(); }
  if (def.noFace) return;
  // 얼굴
  c.save(); c.scale(u, u);
  if (dark) {
    ell(c, -13, -3, 6, 6, '#fff'); ell(c, 13, -3, 6, 6, '#fff'); ell(c, -12, -3, 3.4, 3.4, INK); ell(c, 14, -3, 3.4, 3.4, INK);
  } else {
    ell(c, -13, -3, 5, 5, INK); ell(c, 13, -3, 5, 5, INK); ell(c, -11.5, -4.8, 1.8, 1.8, '#fff'); ell(c, 14.5, -4.8, 1.8, 1.8, '#fff');
  }
  strokeP(c, 'M-7 8 Q0 15 7 8', dark ? '#ffd0e0' : INK, 3, 1);
  ell(c, -22, 6, 5, 3.2, '#ff8fa3', .7); ell(c, 22, 6, 5, 3.2, '#ff8fa3', .7);
  c.restore();
  if (def.ring) drawRing(c, r, def.ring, true);
}

// 블랙홀: 고화질 사진의 줄무늬 흐름을 금빛 6톤으로 단순화한 그림.
// 판정 원은 아래쪽 호의 바깥 테두리(그림 중심), 위로 솟은 원반과 가로 퍼진 원반은 원 밖으로 뻗는 겹쳐 보이기 전용이다(판정 없음)
var SATURN_RING_DEF = { kind: 'saturn', flat: .3, rot: -27 * Math.PI / 180, bands: [[1.12, .07, '#8c8272', .75], [1.3, .22, '#f6f1e4', 1], [1.455, .04, '#3a3340', 1], [1.575, .15, '#e6e0d0', 1]] };
/* 태양 → 해왕성 순서 (r 은 그림 비율용, 칸 크기에 맞춰 다시 줄인다) */
var BODIES = [
  { name: '태양',   r: 95,  color: '#ffd54a', draw: drawSun,     ext: 1.5, rays: true },
  { name: '수성',   r: 19,  color: '#a89b90', draw: drawMercury, ext: 1 },
  { name: '금성',   r: 32,  color: '#e9c98e', draw: drawVenus,   ext: 1 },
  { name: '지구',   r: 40,  color: '#3a8cf0', draw: drawEarth,   ext: 1 },
  { name: '화성',   r: 25,  color: '#cf6a43', draw: drawMars,    ext: 1 },
  { name: '목성',   r: 81,  color: '#d6a77e', draw: drawJupiter, ext: 1.36, tilt: 3, ring: { kind: 'line', k: 1.3, flat: .26, rot: -3 * Math.PI / 180 } },
  { name: '토성',   r: 69,  color: '#e6cf9a', draw: drawSaturn,  ext: 1.78, tilt: 27, ring: SATURN_RING_DEF },
  { name: '천왕성', r: 58,  color: '#8fe0e6', draw: drawUranus,  ext: 1.36, tilt: 98, ring: { kind: 'line', k: 1.3, flat: .22, rot: -98 * Math.PI / 180 } },
  { name: '해왕성', r: 49,  color: '#3550d8', draw: drawNeptune, ext: 1.36, tilt: 28, ring: { kind: 'line', k: 1.3, flat: .24, rot: -28 * Math.PI / 180 } }
];
/* 한 천체를 한 장의 그림으로 만든다. 판정 원의 지름이 200px 이 되도록 그린다 (ext 만큼 고리·불꽃이 바깥으로 나온다) */
function makeSprite(def) {
  var r = def.r, E = def.ext * r, k = 100 / r, S = Math.ceil(2 * E * k);
  function mk() {
    var cv = document.createElement('canvas'); cv.width = cv.height = S;
    var cx = cv.getContext('2d'); cx.scale(S / (2 * E), S / (2 * E)); cx.translate(E, E);
    return { cv: cv, cx: cx };
  }
  var back = mk();
  if (def.ring) drawRing(back.cx, r, def.ring, false);
  var art = mk();
  if (def.rays) drawRays(art.cx, r);
  art.cx.save(); circlePath(art.cx, 0, 0, r - .3); art.cx.clip(); if (def.tilt) art.cx.rotate(-def.tilt * Math.PI / 180); def.draw(art.cx, r); art.cx.restore();
  var front = mk(); drawFront(front.cx, r, def);
  var out = document.createElement('canvas'); out.width = out.height = S; var oc = out.getContext('2d');
  oc.drawImage(back.cv, 0, 0); oc.drawImage(art.cv, 0, 0); oc.drawImage(front.cv, 0, 0);
  return { cv: out, ext: def.ext, name: def.name, size: S };
}
