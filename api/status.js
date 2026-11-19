// GET  /api/status                      -> { open, changedAt, group, best, limit, keyRequired }
// POST /api/status {limit:초, key}         -> 게임 제한 시간 설정 (10~3600초)
// POST /api/status {open:true, group, key} -> 운영 시작 (단체명 필수, 이번 운영 최고 점수는 0부터)
// POST /api/status {open:false, key}       -> 운영 종료 (이번 운영 최고 점수는 지워지고 역대 기록은 남음)
// ADMIN_KEY 환경변수를 설정했다면 POST 에는 key 가 필요하다 (연속 5번 틀리면 1분간 429).
const store = require('../lib/store');
const { keyRequired, bodyOf, guard } = require('../lib/auth');

const GROUP_MAX = 20;
function cleanGroup(v) {
  if (typeof v !== 'string') return '';
  // 제어 문자 제거, 공백 정리, 최대 20자(글자 단위)
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, GROUP_MAX).join('');
}
function view(s, kr) {
  const o = { open: s.open, changedAt: s.changedAt, group: s.group, best: s.best, limit: s.limit, keyRequired: kr };
  if (s.resumed) o.resumed = true;
  return o;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const kr = keyRequired();
  try {
    if (req.method === 'GET') {
      const out = view(await store.getState(), kr);
      // 수백 명이 3초마다 확인하므로 CDN 이 2초간 같은 답을 나눠 준다 (브라우저는 캐시하지 않음). 오류 응답은 no-store 그대로
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=2');
      return res.status(200).json(out);
    }
    if (req.method === 'POST') {
      const body = bodyOf(req);
      if (body.limit !== undefined && body.open === undefined) {   // 제한 시간 설정
        const lim = Math.round(Number(body.limit));
        if (!Number.isFinite(lim) || lim < store.LIMIT_MIN || lim > store.LIMIT_MAX) return res.status(400).json({ error: 'invalid_limit', keyRequired: kr });
        const g0 = await guard(body.key);
        if (g0) return res.status(g0.status).json(g0.body);
        await store.setLimit(lim);
        return res.status(200).json(view(await store.getState(), kr));
      }
      if (typeof body.open !== 'boolean') return res.status(400).json({ error: 'open must be boolean', keyRequired: kr });
      const group = cleanGroup(body.group);
      if (body.open && !group) return res.status(400).json({ error: 'group_required', keyRequired: kr });
      const g = await guard(body.key);
      if (g) return res.status(g.status).json(g.body);
      const cur = await store.getState();
      if (body.open && cur.open) return res.status(409).json({ error: 'already_open', keyRequired: kr });
      const s = body.open ? await store.startOperation(group) : await store.stopOperation();
      return res.status(200).json(view(s, kr));
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(500).json({ error: e && e.code === 'STORAGE' ? 'storage_not_configured' : 'storage_error', keyRequired: kr });
  }
};
