// 로컬 개발용 서버 (Vercel 의 동작을 흉내 낸다): npm run dev  ->  http://localhost:3000
//   /            관리 페이지 (public/index.html)
//   /play        게임 페이지 (public/play.html)
//   /game        운영 중일 때만 게임 (api/game.js)
//   /api/status  상태 API (api/status.js)
// 저장소 환경변수가 없으면 .dev-status.json 파일에 상태를 저장한다.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const hasRedis = !!(process.env.REDIS_URL || (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
                    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN));
if (!hasRedis && !process.env.STATUS_FILE && !process.env.NO_STORAGE) process.env.STATUS_FILE = path.join(root, '.dev-status.json');

const status = require('../api/status');
const game = require('../api/game');
const score = require('../api/score');
const hall = require('../api/hall');
const auth = require('../api/auth');

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
                '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

function shim(res) {
  res.status = function (c) { res.statusCode = c; return res; };
  res.json = function (o) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); return res; };
  res.send = function (b) { res.end(b); return res; };
}

const server = http.createServer((req, res) => {
  shim(res);
  const pathname = new URL(req.url, 'http://localhost').pathname;
  function run(handler) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if (raw && String(req.headers['content-type'] || '').includes('json')) {
        try { req.body = JSON.parse(raw); } catch (e) { req.body = {}; }
      }
      Promise.resolve(handler(req, res)).catch(() => { res.statusCode = 500; res.end('error'); });
    });
  }
  if (pathname === '/api/status') return run(status);
  if (pathname === '/api/score') return run(score);
  if (pathname === '/api/hall') return run(hall);
  if (pathname === '/api/auth') return run(auth);
  if (pathname === '/game' || pathname === '/api/game') return run(game);
  let p = pathname === '/' ? '/index' : pathname;
  if (!path.extname(p)) p += '.html';
  const pub = path.join(root, 'public');
  const file = path.join(pub, path.normalize(p));
  if (!file.startsWith(pub + path.sep)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(buf);
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, '127.0.0.1', () => console.log('http://localhost:' + port + '  (관리: /   게임 페이지: /play)'));
