// 운영 상태, 이번 운영의 최고 점수, 역대 기록(상위 10)을 저장하고 읽는다.
// 저장소 선택 (위에서부터 먼저 있는 것):
//   1) KV_REST_API_URL/TOKEN 또는 UPSTASH_REDIS_REST_URL/TOKEN  (Upstash REST)
//   2) REDIS_URL                                                 (Redis 공식 서비스, redis:// 접속)
//   3) STATUS_FILE                                               (로컬 개발/시험용 파일. 배포에서는 쓰지 않음)
// 아무것도 없으면 오류(code 'STORAGE')를 던지고, 호출하는 쪽은 '운영 종료'로 취급한다 (fail-closed).
//
// Redis 키
//   cosmos_order:status  운영 상태 JSON {open, changedAt, group, sid}
//   cosmos_order:best    이번 운영의 최고 점수 (운영 시작 때 그 단체의 역대 기록으로 시작, 없으면 0. 종료 때 삭제)
//   cosmos_order:hall    역대 기록 (sorted set, 멤버 = 단체명, 점수). 단체당 한 줄, 항상 상위 10개만 유지
//   cosmos_order:hallmeta 역대 기록을 세운 시각 (hash, 단체명 -> ms)
//   cosmos_order:limit 게임 제한 시간(초)
const fs = require('fs');

const K_STATUS = 'cosmos_order:status';
const K_BEST = 'cosmos_order:best';
const K_HALL = 'cosmos_order:hall';
const K_META = 'cosmos_order:hallmeta';
const K_LIMIT = 'cosmos_order:limit';          // 제한 시간(초). 운영을 끝내도 유지되는 설정
const LIMIT_MIN = 10, LIMIT_MAX = 3600, LIMIT_DEFAULT = 120;
const HALL_SIZE = 10;
// 관리 번호 입력 제한: 연속 5번 틀리면 1분간 입력을 막는다
const K_AFAIL = 'cosmos_order:authfail';
const K_ALOCK = 'cosmos_order:authlock';
const AUTH_MAX_FAILS = 5;
function authLockMs() { return Number(process.env.AUTH_LOCK_MS) > 0 ? Number(process.env.AUTH_LOCK_MS) : 60000; }

// 점수가 지금 최고보다 높을 때만 갱신하고 그 단체의 역대 기록도 같이 올린다 (동시에 여러 명이 보내도 안전)
// 최고 점수는 운영 시작 때 그 단체의 기록으로 시작하므로, 최고를 넘으면 곧 기록을 넘는 것이다
const LUA_SUBMIT = [
  "local cur = tonumber(redis.call('GET', KEYS[1]) or '0') or 0",
  "local s = tonumber(ARGV[1])",
  "if s > cur then",
  "  redis.call('SET', KEYS[1], ARGV[1])",
  "  redis.call('ZADD', KEYS[2], s, ARGV[2])",
  "  redis.call('HSET', KEYS[3], ARGV[2], ARGV[3])",
  "  redis.call('ZREMRANGEBYRANK', KEYS[2], 0, -" + (HALL_SIZE + 1) + ")",
  "  return s",
  "end",
  "return cur",
].join('\n');

function notConfigured() {
  const e = new Error('storage_not_configured');
  e.code = 'STORAGE';
  return e;
}

/* ---------- 명령 실행기 ---------- */
function restConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}
async function restRun(cfg, command) {
  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error('redis http ' + r.status);
  const j = await r.json();
  if (j && j.error) throw new Error('redis ' + j.error);
  return j ? j.result : null;
}

let tcp = null;
async function tcpClient(url) {
  if (tcp && tcp.isOpen && tcp.isReady) return tcp;
  if (tcp) { try { await tcp.disconnect(); } catch (e) {} tcp = null; }
  const { createClient } = require('redis');
  const c = createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: false } });
  c.on('error', () => {});
  await c.connect();
  tcp = c;
  return c;
}
async function tcpRun(url, command) {
  try {
    const c = await tcpClient(url);
    return await c.sendCommand(command.map(String));
  } catch (e) {
    if (tcp) { try { await tcp.disconnect(); } catch (e2) {} tcp = null; }
    throw e;
  }
}

// 레디스 계열이면 run(command) 함수를, 아니면 null
function redisRunner() {
  const cfg = restConfig();
  if (cfg) return (cmd) => restRun(cfg, cmd);
  if (process.env.REDIS_URL) return (cmd) => tcpRun(process.env.REDIS_URL, cmd);
  return null;
}

/* ---------- 값 해석 ---------- */
function parseStatus(raw) {
  const base = { open: false, changedAt: 0, group: '', sid: 0 };
  if (!raw) return base;
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!v) return base;
    return {
      open: v.open === true,
      changedAt: Number(v.changedAt) || 0,
      group: typeof v.group === 'string' ? v.group : '',
      sid: Number(v.sid) || 0,
    };
  } catch (e) {
    return base;
  }
}
function parseLimit(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= LIMIT_MIN && n <= LIMIT_MAX ? n : LIMIT_DEFAULT;
}
function parseBest(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
// 이전 형식의 기록("<시각>|<단체명>")도 읽을 수 있게 한다
function parseMember(member, score, at) {
  const m = String(member);
  const legacy = /^(\d{10,})\|/.exec(m);
  return {
    name: legacy ? m.slice(legacy[0].length) : m,
    score: Number(score) || 0,
    at: Number(at) || (legacy ? Number(legacy[1]) : 0),
  };
}

/* ---------- 파일 저장소 (로컬 시험용) ---------- */
function fileRead() {
  try {
    const v = JSON.parse(fs.readFileSync(process.env.STATUS_FILE, 'utf8'));
    // 이전 형식({open, changedAt})도 읽는다
    if (v && v.status === undefined && v.open !== undefined) return { status: v, best: 0, hall: [], limit: 0 };
    return { status: v.status || null, best: v.best || 0, limit: v.limit || 0, hall: Array.isArray(v.hall) ? v.hall.filter((h) => h && h.name) : [] };
  } catch (e) {
    return { status: null, best: 0, hall: [], limit: 0 };
  }
}
function fileWrite(d) { fs.writeFileSync(process.env.STATUS_FILE, JSON.stringify(d)); }

/* ---------- 공개 함수 ---------- */
// -> { open, changedAt, group, sid, best }
async function getState() {
  const run = redisRunner();
  if (run) {
    const arr = await run(['MGET', K_STATUS, K_BEST, K_LIMIT]);
    const st = parseStatus(arr && arr[0]);
    return Object.assign(st, { best: st.open ? parseBest(arr && arr[1]) : 0, limit: parseLimit(arr && arr[2]) });
  }
  if (process.env.STATUS_FILE) {
    const d = fileRead();
    const st = parseStatus(d.status);
    return Object.assign(st, { best: st.open ? parseBest(d.best) : 0, limit: parseLimit(d.limit) });
  }
  throw notConfigured();
}

async function getStatus() { return getState(); }

// 운영 시작: 이번 운영의 최고 점수를 그 단체의 역대 기록으로 시작한다 (처음 쓰는 단체명이면 0).
// 같은 단체명이 이미 역대 기록에 있으면 새로 쓰지 않고 그 기록을 이어서 쓴다 -> resumed: true
async function startOperation(group) {
  const now = Date.now();
  const st = { open: true, changedAt: now, group: String(group), sid: now };
  const run = redisRunner();
  if (run) {
    const prev = parseBest(await run(['ZSCORE', K_HALL, st.group]));
    await run(['SET', K_BEST, String(prev)]);
    await run(['SET', K_STATUS, JSON.stringify(st)]);
    return Object.assign(st, { best: prev, resumed: prev > 0, limit: parseLimit(await run(['GET', K_LIMIT])) });
  }
  if (process.env.STATUS_FILE) {
    const d = fileRead();
    const found = d.hall.find((h) => h.name === st.group);
    const prev = found ? parseBest(found.score) : 0;
    fileWrite({ status: st, best: prev, hall: d.hall, limit: d.limit });
    return Object.assign(st, { best: prev, resumed: prev > 0, limit: parseLimit(d.limit) });
  }
  throw notConfigured();
}

// 운영 종료: 이번 운영의 최고 점수는 지우고, 역대 기록은 남긴다
async function stopOperation() {
  const prev = await getState();
  const st = { open: false, changedAt: Date.now(), group: prev.group, sid: 0 };
  const run = redisRunner();
  if (run) {
    await run(['SET', K_STATUS, JSON.stringify(st)]);
    await run(['DEL', K_BEST]);
    return Object.assign(st, { best: 0, limit: parseLimit(await run(['GET', K_LIMIT])) });
  }
  if (process.env.STATUS_FILE) {
    const d = fileRead();
    fileWrite({ status: st, best: 0, hall: d.hall, limit: d.limit });
    return Object.assign(st, { best: 0, limit: parseLimit(d.limit) });
  }
  throw notConfigured();
}

// 점수 제출. 운영 중이 아니면 null, 아니면 갱신된 이번 운영 최고 점수를 돌려준다
async function submitScore(score) {
  const st = await getState();
  if (!st.open) return null;
  const member = st.group;
  const run = redisRunner();
  if (run) {
    const best = await run(['EVAL', LUA_SUBMIT, '3', K_BEST, K_HALL, K_META, String(score), member, String(Date.now())]);
    return { best: parseBest(best), group: st.group };
  }
  const d = fileRead();
  let best = parseBest(d.best);
  if (score > best) {
    best = score;
    const hall = d.hall.filter((h) => h.name !== member);
    hall.push({ name: member, score, at: Date.now() });
    hall.sort((a, b) => b.score - a.score);
    d.hall = hall.slice(0, HALL_SIZE);
    d.best = best;
    fileWrite(d);
  }
  return { best, group: st.group };
}

// 제한 시간(초)을 저장한다 (10초~60분). 운영 중이어도 바꿀 수 있고, 이미 시작한 판에는 적용되지 않고 다음 판부터 쓴다
async function setLimit(sec) {
  const v = Math.round(Number(sec));
  if (!Number.isFinite(v) || v < LIMIT_MIN || v > LIMIT_MAX) { const e = new Error('invalid_limit'); e.code = 'LIMIT'; throw e; }
  const run = redisRunner();
  if (run) { await run(['SET', K_LIMIT, String(v)]); return v; }
  if (process.env.STATUS_FILE) { const d = fileRead(); d.limit = v; fileWrite(d); return v; }
  throw notConfigured();
}

// 역대 기록 상위 10 -> [{ name, score, at }]  (점수 높은 순)
async function getHall() {
  const run = redisRunner();
  if (run) {
    const flat = (await run(['ZREVRANGE', K_HALL, '0', String(HALL_SIZE - 1), 'WITHSCORES'])) || [];
    const names = [];
    for (let i = 0; i + 1 < flat.length; i += 2) names.push(flat[i]);
    const ats = names.length ? (await run(['HMGET', K_META].concat(names))) || [] : [];
    const out = [];
    for (let i = 0; i < names.length; i++) out.push(parseMember(names[i], flat[i * 2 + 1], ats[i]));
    return out;
  }
  if (process.env.STATUS_FILE) {
    return fileRead().hall.slice().sort((a, b) => b.score - a.score).slice(0, HALL_SIZE).map((h) => parseMember(h.name, h.score, h.at));
  }
  throw notConfigured();
}

async function clearHall() {
  const run = redisRunner();
  if (run) { await run(['DEL', K_HALL, K_META]); return; }
  if (process.env.STATUS_FILE) { const d = fileRead(); d.hall = []; fileWrite(d); return; }
  throw notConfigured();
}

/* ---------- 관리 번호 입력 제한 ---------- */
function authFile() { return process.env.STATUS_FILE + '.auth'; }
function authFileRead() { try { const v = JSON.parse(fs.readFileSync(authFile(), 'utf8')); return { n: Number(v.n) || 0, until: Number(v.until) || 0 }; } catch (e) { return { n: 0, until: 0 }; } }
// 잠겨 있으면 남은 시간(ms), 아니면 0
async function authLocked() {
  const run = redisRunner();
  if (run) { const t = Number(await run(['PTTL', K_ALOCK])); return t > 0 ? t : 0; }
  if (process.env.STATUS_FILE) { const d = authFileRead(); return d.until > Date.now() ? d.until - Date.now() : 0; }
  throw notConfigured();
}
// 틀린 번호를 기록한다 -> { left: 남은 시도 횟수, lockedMs: 이번에 잠겼다면 잠금 시간 }
async function authFail() {
  const run = redisRunner();
  if (run) {
    const n = Number(await run(['INCR', K_AFAIL]));
    await run(['EXPIRE', K_AFAIL, '600']);
    if (n >= AUTH_MAX_FAILS) {
      await run(['SET', K_ALOCK, '1', 'PX', String(authLockMs())]);
      await run(['DEL', K_AFAIL]);
      return { left: 0, lockedMs: authLockMs() };
    }
    return { left: AUTH_MAX_FAILS - n, lockedMs: 0 };
  }
  if (process.env.STATUS_FILE) {
    const d = authFileRead(); d.n += 1;
    if (d.n >= AUTH_MAX_FAILS) { fs.writeFileSync(authFile(), JSON.stringify({ n: 0, until: Date.now() + authLockMs() })); return { left: 0, lockedMs: authLockMs() }; }
    fs.writeFileSync(authFile(), JSON.stringify({ n: d.n, until: 0 }));
    return { left: AUTH_MAX_FAILS - d.n, lockedMs: 0 };
  }
  throw notConfigured();
}
// 맞는 번호를 입력하면 틀린 횟수를 지운다
async function authOk() {
  const run = redisRunner();
  if (run) { await run(['DEL', K_AFAIL]); return; }
  if (process.env.STATUS_FILE) { const d = authFileRead(); if (d.n) fs.writeFileSync(authFile(), JSON.stringify({ n: 0, until: d.until })); return; }
  throw notConfigured();
}

module.exports = { setLimit, LIMIT_MIN, LIMIT_MAX, authLocked, authFail, authOk, AUTH_MAX_FAILS, getStatus, getState, startOperation, stopOperation, submitScore, getHall, clearHall, HALL_SIZE };
