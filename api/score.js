// POST /api/score { score } -> { best, group }  이번 운영의 최고 점수보다 높을 때만 기록되고 역대 기록(상위 10)에도 반영된다.
// 운영 중이 아니면 403.
const store = require('../lib/store');
const { bodyOf } = require('../lib/auth');

const MAX_SCORE = 500000;   // 이보다 큰 값은 잘못된 값으로 본다

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  const score = bodyOf(req).score;
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return res.status(400).json({ error: 'invalid_score' });
  try {
    const r = await store.submitScore(score);
    if (!r) return res.status(403).json({ error: 'closed' });
    return res.status(200).json(r);
  } catch (e) {
    return res.status(500).json({ error: e && e.code === 'STORAGE' ? 'storage_not_configured' : 'storage_error' });
  }
};
