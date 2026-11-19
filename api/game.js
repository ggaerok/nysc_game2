// GET /game (vercel.json 의 rewrite) -> 운영 중일 때만 게임 페이지(game/game.html)를 내려준다.
// 운영 중이 아니거나 상태를 확인할 수 없으면 흰 화면(403)만 준다. 게임 코드는 아예 전송되지 않는다.
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');

let cached = null;
function loadGame() {
  if (cached) return cached;
  const candidates = [
    path.join(process.cwd(), 'game', 'game.html'),
    path.join(__dirname, '..', 'game', 'game.html'),
  ];
  for (const p of candidates) {
    try { cached = fs.readFileSync(p, 'utf8'); return cached; } catch (e) { /* 다음 후보 */ }
  }
  throw new Error('game/game.html not found');
}

const WHITE = '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title></title>' +
  '<style>html,body{margin:0;height:100%;background:#fff;color:#b8b8b8;font:13px sans-serif}' +
  'body{display:flex;align-items:center;justify-content:center}</style></head><body>MSG</body></html>';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex');
  let open = false, msg = '현재 운영 중이 아닙니다';
  try { open = (await store.getStatus()).open === true; } catch (e) { msg = '연결할 수 없습니다'; }
  if (!open) return res.status(403).send(WHITE.replace('MSG', msg));
  try {
    return res.status(200).send(loadGame());
  } catch (e) {
    return res.status(500).send(WHITE.replace('MSG', '오류가 발생했습니다'));
  }
};
