// 운영 상태, 이번 운영의 최고 점수, 역대 기록(상위 10)을 저장하고 읽는다.
// 저장소 선택 (위에서부터 먼저 있는 것):
//   1) TURSO_DATABASE_URL + TURSO_AUTH_TOKEN   (Turso, libSQL over HTTPS)  <- 배포에서 쓰는 것
//   2) STATUS_FILE                             (로컬 개발/시험용 파일. 배포에서는 쓰지 않음)
// 아무것도 없으면 오류(code 'STORAGE')를 던지고, 호출하는 쪽은 '운영 종료'로 취급한다 (fail-closed).
// 시험용으로 TURSO_DATABASE_URL=file:/경로/test.db (토큰 불필요) 도 쓸 수 있다.
//
// 테이블 (처음 쓸 때 자동으로 만든다. 이름 앞에 TABLE_PREFIX 가 붙어 한 DB 를 여러 게임이 나눠 써도 겹치지 않는다)
//   <P>_kv    (k, v)                  status(운영 상태 JSON), best(이번 운영 최고 점수), limit(제한 시간 초)
//   <P>_hall  (name, score, at)       역대 기록, 단체당 한 줄, 항상 상위 10개만 유지
//   <P>_auth  (id, n, exp, lock_until) 관리 번호 틀린 횟수와 잠금
const fs = require('fs');

const TABLE_PREFIX = process.env.TABLE_PREFIX || 'solar';
const T_KV = TABLE_PREFIX + '_kv', T_HALL = TABLE_PREFIX + '_hall', T_AUTH = TABLE_PREFIX + '_auth';
const LIMIT_MIN = 10, LIMIT_MAX = 3600, LIMIT_DEFAULT = 120;
const HALL_SIZE = 10;
// 관리 번호 입력 제한: 연속 5번 틀리면 1분간 입력을 막는다 (틀린 횟수는 10분 뒤 사라진다)
const AUTH_MAX_FAILS = 5;
const AUTH_FAIL_TTL = 600000;
function authLockMs() { return Number(process.env.AUTH_LOCK_MS) > 0 ? Number(process.env.AUTH_LOCK_MS) : 60000; }

function notConfigured() {
  const e = new Error('storage_not_configured');
  e.code = 'STORAGE';
  return e;
}

/* ---------- Turso ---------- */
let client = null, ready = null;
function tursoConfig() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url) return null;
  if (/^file:/.test(url)) return { url, token: undefined };
  return token ? { url, token } : null;
}
function getClient(cfg) {
  if (client) return client;
  if (/^file:/.test(cfg.url)) {
    client = require('@libsql/client').createClient({ url: cfg.url });
  } else {
    // 서버리스에서는 연결을 붙들지 않는 순수 HTTP 클라이언트가 가볍고 안전하다
    client = require('@libsql/client/web').createClient({ url: cfg.url.replace(/^libsql:/, 'https:'), authToken: cfg.token });
  }
  return client;
}
// 테이블이 없으면 만든다 (인스턴스당 한 번). 실패하면 다음 호출에서 다시 시도한다
function db() {
  const cfg = tursoConfig();
  if (!cfg) return Promise.resolve(null);
  const c = getClient(cfg);
  if (!ready) {
    ready = c.batch([
      'CREATE TABLE IF NOT EXISTS ' + T_KV + ' (k TEXT PRIMARY KEY, v TEXT)',
      'CREATE TABLE IF NOT EXISTS ' + T_HALL + ' (name TEXT PRIMARY KEY, score INTEGER NOT NULL, at INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS ' + T_AUTH + ' (id INTEGER PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, exp INTEGER NOT NULL DEFAULT 0, lock_until INTEGER NOT NULL DEFAULT 0)',
      'INSERT OR IGNORE INTO ' + T_AUTH + ' (id, n, exp, lock_until) VALUES (1, 0, 0, 0)',
    ], 'write').catch((e) => { ready = null; throw e; });
  }
  return ready.then(() => c);
}
async function kvAll(c) {
  const r = await c.execute({ sql: 'SELECT k, v FROM ' + T_KV + " WHERE k IN ('status','best','limit')", args: [] });
  const m = {};
  for (const row of r.rows) m[row[0]] = row[1];
  return m;
}
const KV_SET = 'INSERT INTO ' + T_KV + ' (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v';

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
// -> { open, changedAt, group, sid, best, limit }
async function getState() {
  const c = await db();
  if (c) {
    const m = await kvAll(c);
    const st = parseStatus(m.status);
    return Object.assign(st, { best: st.open ? parseBest(m.best) : 0, limit: parseLimit(m.limit) });
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
  const c = await db();
  if (c) {
    const r = await c.execute({ sql: 'SELECT score FROM ' + T_HALL + ' WHERE name = ?', args: [st.group] });
    const prev = parseBest(r.rows[0] && r.rows[0][0]);
    await c.batch([
      { sql: KV_SET, args: ['best', String(prev)] },
      { sql: KV_SET, args: ['status', JSON.stringify(st)] },
    ], 'write');
    const m = await kvAll(c);
    return Object.assign(st, { best: prev, resumed: prev > 0, limit: parseLimit(m.limit) });
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
  const c = await db();
  if (c) {
    await c.batch([
      { sql: KV_SET, args: ['status', JSON.stringify(st)] },
      { sql: 'DELETE FROM ' + T_KV + " WHERE k = 'best'", args: [] },
    ], 'write');
    return Object.assign(st, { best: 0, limit: prev.limit });
  }
  if (process.env.STATUS_FILE) {
    const d = fileRead();
    fileWrite({ status: st, best: 0, hall: d.hall, limit: d.limit });
    return Object.assign(st, { best: 0, limit: parseLimit(d.limit) });
  }
  throw notConfigured();
}

// 점수 제출. 운영 중이 아니면 null, 아니면 갱신된 이번 운영 최고 점수를 돌려준다
// Turso: 한 번의 batch(=하나의 트랜잭션)로 '최고보다 높을 때만' 최고·역대 기록을 올린다 (동시에 여러 명이 보내도 안전)
async function submitScore(score) {
  const st = await getState();
  if (!st.open) return null;
  const member = st.group;
  const c = await db();
  if (c) {
    const now = Date.now();
    const rs = await c.batch([
      { sql: 'INSERT INTO ' + T_KV + " (k, v) VALUES ('best', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v WHERE CAST(" + T_KV + '.v AS INTEGER) < CAST(excluded.v AS INTEGER)', args: [String(score)] },
      { sql: 'INSERT INTO ' + T_HALL + ' (name, score, at) SELECT ?, ?, ? WHERE changes() > 0 ON CONFLICT(name) DO UPDATE SET score = excluded.score, at = excluded.at', args: [member, score, now] },
      { sql: 'DELETE FROM ' + T_HALL + ' WHERE name NOT IN (SELECT name FROM ' + T_HALL + ' ORDER BY score DESC, at ASC LIMIT ' + HALL_SIZE + ')', args: [] },
      { sql: 'SELECT v FROM ' + T_KV + " WHERE k = 'best'", args: [] },
    ], 'write');
    const row = rs[3].rows[0];
    return { best: parseBest(row && row[0]), group: st.group };
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
  const c = await db();
  if (c) { await c.execute({ sql: KV_SET, args: ['limit', String(v)] }); return v; }
  if (process.env.STATUS_FILE) { const d = fileRead(); d.limit = v; fileWrite(d); return v; }
  throw notConfigured();
}

// 역대 기록 상위 10 -> [{ name, score, at }]  (점수 높은 순)
async function getHall() {
  const c = await db();
  if (c) {
    const r = await c.execute({ sql: 'SELECT name, score, at FROM ' + T_HALL + ' ORDER BY score DESC, at ASC LIMIT ' + HALL_SIZE, args: [] });
    return r.rows.map((row) => parseMember(row[0], row[1], row[2]));
  }
  if (process.env.STATUS_FILE) {
    return fileRead().hall.slice().sort((a, b) => b.score - a.score).slice(0, HALL_SIZE).map((h) => parseMember(h.name, h.score, h.at));
  }
  throw notConfigured();
}

async function clearHall() {
  const c = await db();
  if (c) { await c.execute({ sql: 'DELETE FROM ' + T_HALL, args: [] }); return; }
  if (process.env.STATUS_FILE) { const d = fileRead(); d.hall = []; fileWrite(d); return; }
  throw notConfigured();
}

/* ---------- 관리 번호 입력 제한 ---------- */
function authFile() { return process.env.STATUS_FILE + '.auth'; }
function authFileRead() { try { const v = JSON.parse(fs.readFileSync(authFile(), 'utf8')); return { n: Number(v.n) || 0, until: Number(v.until) || 0 }; } catch (e) { return { n: 0, until: 0 }; } }
// 잠겨 있으면 남은 시간(ms), 아니면 0
async function authLocked() {
  const c = await db();
  if (c) {
    const r = await c.execute({ sql: 'SELECT lock_until FROM ' + T_AUTH + ' WHERE id = 1', args: [] });
    const t = Number(r.rows[0] && r.rows[0][0]) - Date.now();
    return t > 0 ? t : 0;
  }
  if (process.env.STATUS_FILE) { const d = authFileRead(); return d.until > Date.now() ? d.until - Date.now() : 0; }
  throw notConfigured();
}
// 틀린 번호를 기록한다 -> { left: 남은 시도 횟수, lockedMs: 이번에 잠겼다면 잠금 시간 }
async function authFail() {
  const c = await db();
  if (c) {
    const now = Date.now();
    const rs = await c.batch([
      { sql: 'UPDATE ' + T_AUTH + ' SET n = CASE WHEN exp < ? THEN 1 ELSE n + 1 END, exp = ? WHERE id = 1', args: [now, now + AUTH_FAIL_TTL] },
      { sql: 'SELECT n FROM ' + T_AUTH + ' WHERE id = 1', args: [] },
    ], 'write');
    const n = Number(rs[1].rows[0] && rs[1].rows[0][0]) || 1;
    if (n >= AUTH_MAX_FAILS) {
      await c.execute({ sql: 'UPDATE ' + T_AUTH + ' SET n = 0, lock_until = ? WHERE id = 1', args: [now + authLockMs()] });
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
  const c = await db();
  if (c) { await c.execute({ sql: 'UPDATE ' + T_AUTH + ' SET n = 0 WHERE id = 1 AND n <> 0', args: [] }); return; }
  if (process.env.STATUS_FILE) { const d = authFileRead(); if (d.n) fs.writeFileSync(authFile(), JSON.stringify({ n: 0, until: d.until })); return; }
  throw notConfigured();
}

module.exports = { setLimit, LIMIT_MIN, LIMIT_MAX, authLocked, authFail, authOk, AUTH_MAX_FAILS, getStatus, getState, startOperation, stopOperation, submitScore, getHall, clearHall, HALL_SIZE };
