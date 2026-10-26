// 서버 저장 공간 한도: 줄 하나·공간 하나·데이터베이스 전체, 오래된 공간 지우기, 방 계획의 \u0000.
// PostgreSQL 테스트 DB가 있어야 한다 (test/sync.test.js와 같이):
//   set -a; . /etc/conquer-the-bible/sync.env; set +a; npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';

let skip = false;
if (!process.env.TEST_DATABASE_URL) skip = 'TEST_DATABASE_URL 없음 (PostgreSQL 테스트 DB)';

let server = null; // 공간 하나를 작게(20KB, 6줄) 둔 서버
let full = null; // 데이터베이스가 가득 찬 것으로 보는 서버
let hashCode = null;
let newCode = null;
let createHandler = null;

before(async () => {
  if (skip) return;
  let startServer;
  try {
    ({ startServer, createHandler } = await import('../server/sync-server.mjs'));
    ({ hashCode, newCode } = await import('../server/code.mjs'));
  } catch (err) {
    skip = `동기화 서버를 불러오지 못함 (${err.message}). server/에서 npm install`;
    return;
  }
  const databaseUrl = process.env.TEST_DATABASE_URL;
  server = await startServer({ databaseUrl, port: 0, limits: { maxSpaceBytes: 20 * 1024, maxSpaceRows: 6 } });
  full = await startServer({ databaseUrl, port: 0, limits: { maxDbBytes: 1 } });
  await server.pool.query('TRUNCATE sync_spaces CASCADE');
  await server.pool.query('TRUNCATE reading_rooms CASCADE');
});

after(async () => {
  await server?.close();
  await full?.close();
});

async function api(base, method, path, { body, code } = {}) {
  const res = await fetch(`${base.url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(code ? { Authorization: `Bearer ${code}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const newSpace = async (base = server) => (await api(base, 'POST', '/api/sync/spaces')).body.code;
const push = (base, code, changes, cursor = 0) => api(base, 'POST', '/api/sync', { code, body: { v: 1, cursor, changes } });
// 압축되지 않는 글자 (PostgreSQL은 큰 값을 압축해 둔다)
const noise = (length) => crypto.randomBytes(length).toString('base64').slice(0, length);
const note = (i, length) => ({ t: 'day_notes', k: JSON.stringify([1, `2026-10-${String(i).padStart(2, '0')}`]), d: { text: noise(length) } });
const dayNotes = async (code) => (await api(server, 'GET', '/api/sync/space', { code })).body.counts.day_notes ?? 0;

const t = (name, fn) => test(name, async (ctx) => (skip ? ctx.skip(skip) : fn(ctx)));

t('줄 하나는 64KB까지 받는다 (성경 전체를 하루에 읽는 계획의 분량은 약 3만 자)', async () => {
  const code = await newSpace();
  // 60KB 줄은 줄 한도는 지나고 이 서버의 공간 한도(20KB)에서 걸린다
  assert.equal((await push(server, code, [note(1, 60 * 1024)])).body.error, 'space_full');
  const res = await push(server, code, [note(1, 70 * 1024)]);
  assert.equal(res.status, 413);
  assert.equal(res.body.error, 'row_too_large');
});

t('공간 하나가 한도를 넘으면 그 요청을 되돌리고, 지우기만 하는 요청은 받는다', async () => {
  const code = await newSpace();
  assert.equal((await push(server, code, [note(1, 8000)])).status, 200);
  assert.equal((await push(server, code, [note(2, 8000)])).status, 200);
  // 같은 줄을 고치는 것은 늘지 않으므로 받는다
  assert.equal((await push(server, code, [note(1, 8000)])).status, 200);

  const over = await push(server, code, [note(3, 8000)]);
  assert.equal(over.status, 413);
  assert.equal(over.body.error, 'space_full');
  assert.equal(await dayNotes(code), 2, '넘긴 줄은 저장되지 않는다');

  // 지우면 다시 넣을 수 있다
  assert.equal((await push(server, code, [{ ...note(1, 0), d: null }])).status, 200);
  assert.equal((await push(server, code, [note(3, 8000)])).status, 200);
});

t('서버에 없던 줄을 지운 것으로 보내도 줄 수 한도는 넘지 못한다', async () => {
  const code = await newSpace();
  const gone = (i) => ({ ...note(i, 0), d: null });
  assert.equal((await push(server, code, [1, 2, 3, 4, 5, 6].map(gone))).status, 200);
  const res = await push(server, code, [gone(7)]);
  assert.equal(res.status, 413);
  assert.equal(res.body.error, 'space_full');
});

t('90일 지난 지운 줄은 정리해서, 지운 줄로 가득 찬 공간도 다시 쓴다', async () => {
  const code = await newSpace();
  const gone = (i) => ({ ...note(i, 0), d: null });
  assert.equal((await push(server, code, [1, 2, 3, 4, 5, 6].map(gone))).status, 200);
  assert.equal((await push(server, code, [note(7, 100)])).body.error, 'space_full');
  await server.pool.query(
    `UPDATE sync_rows SET changed_at = now() - interval '91 days'
      WHERE space_id = (SELECT id FROM sync_spaces WHERE code_hash = $1)`,
    [hashCode(code)],
  );
  await server.pool.query('UPDATE sync_spaces SET pruned_at = NULL WHERE code_hash = $1', [hashCode(code)]);
  const res = await push(server, code, [note(7, 100)], 6);
  assert.equal(res.status, 200);
  // 정리한 지운 줄(1–6번)을 받지 못한 기기는 처음부터 다시 받아야 한다
  const behind = await push(server, code, [], 3);
  assert.equal(behind.status, 409);
  assert.equal(behind.body.error, 'cursor_stale');
  const again = await api(server, 'POST', '/api/sync', { code, body: { v: 1, cursor: 0, full: true, changes: [] } });
  assert.equal(again.status, 200);
  assert.deepEqual(
    again.body.rows.map((r) => r.k),
    [note(7, 0).k],
  );
});

t('데이터베이스가 한도를 넘으면 새 공간·방과 값이 든 줄은 받지 않고, 지우는 것과 읽는 것은 받는다', async () => {
  const code = await newSpace(); // 한도가 넉넉한 서버에서 만든 공간
  assert.equal((await push(server, code, [note(1, 100)])).status, 200);

  const space = await api(full, 'POST', '/api/sync/spaces');
  assert.equal(space.status, 507);
  assert.equal(space.body.error, 'server_full');
  const room = await api(full, 'POST', '/api/rooms', {
    body: { name: '방', plan: { kind: 'own' }, member: { name: '나', color: '#2f6a55' } },
  });
  assert.equal(room.status, 507);
  assert.equal((await push(full, code, [note(2, 100)])).status, 507);
  assert.equal((await push(full, code, [{ ...note(1, 0), d: null }])).status, 200, '지우는 것은 받는다');
  assert.equal((await api(full, 'GET', '/api/sync/space', { code })).status, 200);
});

t('연결이 하나뿐인 서버에서도 값이 든 동기화가 멈추지 않는다 (저장 공간은 연결을 쥐기 전에 잰다)', async () => {
  const pg = createRequire(new URL('../server/package.json', import.meta.url))('pg');
  const app = `ctb-test-one-${process.pid}`;
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1, application_name: app });
  pool.on('error', () => {}); // 아래에서 끊는 연결
  const one = http.createServer(createHandler(pool)); // 새 처리기라 아직 크기를 재지 않았다
  await new Promise((resolve) => one.listen(0, '127.0.0.1', resolve));
  try {
    // 공간을 API로 만들면 그때 크기를 재므로 직접 넣는다
    const codes = [newCode(), newCode()];
    for (const code of codes) await pool.query('INSERT INTO sync_spaces (code_hash) VALUES ($1)', [hashCode(code)]);
    const base = { url: `http://127.0.0.1:${one.address().port}` };
    const timeout = new Promise((resolve) => setTimeout(() => resolve('멈춤'), 5000));
    const done = Promise.all(codes.map((code) => push(base, code, [note(1, 100)]).then((r) => r.status)));
    assert.deepEqual(await Promise.race([done, timeout]), [200, 200]);
  } finally {
    // 멈췄으면 쥔 연결이 풀리지 않으므로 끊고 닫는다
    one.closeAllConnections();
    await server.pool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1', [app]);
    await new Promise((resolve) => one.close(resolve));
    await pool.end();
  }
});

t('400일 동안 아무 기기도 오지 않은 공간은 새 공간을 만들 때 지운다', async () => {
  const old = await newSpace();
  const recent = await newSpace();
  const age = (code, days) =>
    server.pool.query(`UPDATE sync_spaces SET seen_at = now() - $2 * interval '1 day' WHERE code_hash = $1`, [hashCode(code), days]);
  await age(old, 401);
  await age(recent, 399);
  await newSpace();
  assert.equal((await api(server, 'GET', '/api/sync/space', { code: old })).status, 404);
  assert.equal((await api(server, 'GET', '/api/sync/space', { code: recent })).status, 200);
});

t('방 계획 글자에 \\u0000이 있거나 역슬래시가 있어도 만든다', async () => {
  const make = (title) =>
    api(server, 'POST', '/api/rooms', {
      body: { name: '방', plan: { title, 'k\u0000': 1 }, member: { name: '나', color: '#2f6a55' } },
    });
  const res = await make('C:\\u0000 a\u0000b');
  assert.equal(res.status, 201);
  const room = await api(server, 'GET', '/api/rooms/room', { code: res.body.code });
  assert.equal(room.body.plan.title, 'C:\\u0000 ab', '역슬래시 글자는 그대로, 진짜 \\u0000만 뺀다');
  assert.deepEqual(Object.keys(room.body.plan).sort(), ['k', 'title']);
});
