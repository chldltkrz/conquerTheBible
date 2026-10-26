// 함께 읽기 방 서버(server/rooms.mjs) 테스트.
// PostgreSQL 테스트 DB가 있어야 한다 (test/sync.test.js와 같이):
//   set -a; . /etc/conquer-the-bible/sync.env; set +a; npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let server = null;
let skip = false;
if (!process.env.TEST_DATABASE_URL) skip = 'TEST_DATABASE_URL 없음 (PostgreSQL 테스트 DB)';

let MAX_MEMBERS = 30;

before(async () => {
  if (skip) return;
  let startServer;
  try {
    ({ startServer } = await import('../server/sync-server.mjs'));
    ({ MAX_MEMBERS } = await import('../server/rooms.mjs'));
  } catch (err) {
    skip = `동기화 서버를 불러오지 못함 (${err.message}). server/에서 npm install`;
    return;
  }
  server = await startServer({ databaseUrl: process.env.TEST_DATABASE_URL, port: 0 });
  await server.pool.query('TRUNCATE reading_rooms CASCADE');
});

after(async () => {
  await server?.close();
});

/** code: 초대 코드, member: {id, key} */
async function api(method, path, { body, code, member } = {}) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(code ? { Authorization: `Bearer ${code}` } : {}),
      ...(member ? { 'X-Room-Member': `${member.id}:${member.key}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

const PLAN = { title: '누가복음', start: '2026-10-01', end: '2026-10-31', mode: 'sequential', tracks: [{ title: '누가복음', selection: { luk: [1, 2, 3] } }] };

async function createRoom(name = '사랑구역', owner = '김집사') {
  const res = await api('POST', '/api/rooms', { body: { name, plan: PLAN, member: { name: owner, color: '#2f6a55' } } });
  assert.equal(res.status, 201);
  return res.body;
}

const join = (code, name, color = '#3b64b0') => api('POST', '/api/rooms/members', { code, body: { name, color } });
const room = async (code) => (await api('GET', '/api/rooms/room', { code })).body;
const put = (code, member, over = {}) =>
  api('PUT', '/api/rooms/members/me', { code, member, body: { name: '이름', color: '#2f6a55', days: {}, progress: null, ...over } });

test('방을 만들면 초대 코드와 방장 멤버 키를 받고, 코드로 방과 계획을 본다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { code, member } = await createRoom();
  assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  assert.match(member.id, /^[0-9A-Z]{10}$/);
  assert.match(member.key, /^[0-9A-Z]{26}$/);
  const r = await room(code.toLowerCase().replace(/-/g, ''));
  assert.equal(r.name, '사랑구역');
  assert.deepEqual(r.plan, PLAN);
  assert.equal(r.members.length, 1);
  assert.deepEqual(
    { id: r.members[0].id, name: r.members[0].name, owner: r.members[0].owner, days: r.members[0].days },
    { id: member.id, name: '김집사', owner: true, days: {} },
  );
  assert.ok(!('key' in r.members[0]) && !('key_hash' in r.members[0]), '멤버 키는 돌려주지 않는다');
  const stored = (await server.pool.query('SELECT code_hash FROM reading_rooms')).rows.map((x) => x.code_hash.toString());
  assert.ok(!stored.some((h) => h.includes(code.replace(/-/g, ''))), '코드는 해시만 둔다');
});

test('들어온 멤버는 자기 상태만 올리고, 다른 멤버도 그것을 본다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { code, member: owner } = await createRoom();
  const { body: mom } = await join(code, '엄마');
  assert.equal((await put(code, mom, { name: '엄마', days: { '2026-10-21': 100, '2026-10-22': 40 }, progress: 70 })).status, 204);
  const r = await room(code);
  assert.deepEqual(
    r.members.map((m) => [m.name, m.owner, m.days, m.progress]),
    [
      ['김집사', true, {}, null],
      ['엄마', false, { '2026-10-21': 100, '2026-10-22': 40 }, 70],
    ],
  );
  // 다른 멤버 번호에 내 키를 붙이거나, 다른 방의 코드로는 고치지 못한다
  assert.equal((await put(code, { id: owner.id, key: mom.key })).body.error, 'no_member');
  const other = await createRoom('다른 방');
  assert.equal((await put(other.code, mom)).body.error, 'no_member');
  assert.equal((await put(code, null)).status, 401);
});

test('틀린 코드, 틀린 값은 받지 않는다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  assert.equal((await api('GET', '/api/rooms/room')).body.error, 'no_code');
  assert.equal((await api('GET', '/api/rooms/room', { code: 'ABCD-EFGH-JKLM' })).body.error, 'no_room');
  const create = async (body) => (await api('POST', '/api/rooms', { body })).body.error;
  const member = { name: '나', color: '#2f6a55' };
  assert.equal(await create({ name: '', plan: PLAN, member }), 'bad_name');
  assert.equal(await create({ name: '가'.repeat(31), plan: PLAN, member }), 'bad_name');
  assert.equal(await create({ name: '방', plan: [1], member }), 'bad_plan');
  assert.equal(await create({ name: '방', plan: { big: 'x'.repeat(70000) }, member }), 'plan_too_large');
  assert.equal(await create({ name: '방', plan: PLAN, member: { name: '나', color: 'red' } }), 'bad_color');

  const { code, member: me } = await createRoom();
  assert.equal((await join(code, '\n\t ')).body.error, 'bad_name');
  assert.equal((await put(code, me, { days: { tomorrow: 1 } })).body.error, 'bad_days');
  assert.equal((await put(code, me, { days: { '2026-10-22': 101 } })).body.error, 'bad_days');
  assert.equal((await put(code, me, { days: { '2026-10-22': 1.5 } })).body.error, 'bad_days');
  assert.equal((await put(code, me, { progress: -1 })).body.error, 'bad_progress');
  // 이름의 줄바꿈은 빼고 앞뒤 공백을 지운다
  assert.equal((await put(code, me, { name: '  김\n집사 ' })).status, 204);
  assert.equal((await room(code)).members[0].name, '김집사');
});

test(`방에는 ${30}명까지 들어온다`, async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { code } = await createRoom();
  const results = await Promise.all(Array.from({ length: MAX_MEMBERS + 2 }, (_, i) => join(code, `멤버${i}`)));
  assert.equal(results.filter((r) => r.status === 201).length, MAX_MEMBERS - 1);
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.body.error === 'room_full'));
  assert.equal((await room(code)).members.length, MAX_MEMBERS);
});

test('방장이 나가면 먼저 들어온 멤버가 방장이 되고, 모두 나가면 방이 없어진다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { code, member: owner } = await createRoom();
  const { body: a } = await join(code, '먼저');
  const { body: b } = await join(code, '나중');
  assert.equal((await api('DELETE', '/api/rooms/members/me', { code, member: owner })).status, 204);
  assert.deepEqual(
    (await room(code)).members.map((m) => [m.name, m.owner]),
    [
      ['먼저', true],
      ['나중', false],
    ],
  );
  assert.equal((await api('DELETE', '/api/rooms/members/me', { code, member: owner })).body.error, 'no_member');
  await api('DELETE', '/api/rooms/members/me', { code, member: a });
  await api('DELETE', '/api/rooms/members/me', { code, member: b });
  assert.equal((await api('GET', '/api/rooms/room', { code })).body.error, 'no_room');
});

test('방장만 멤버를 내보내고 방을 없앤다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { code, member: owner } = await createRoom();
  const { body: a } = await join(code, '가');
  const { body: b } = await join(code, '나');
  const kick = (who, id) => api('DELETE', `/api/rooms/members/${id}`, { code, member: who });
  assert.equal((await kick(a, b.id)).body.error, 'not_owner');
  assert.equal((await kick(owner, owner.id)).body.error, 'is_owner');
  assert.equal((await kick(owner, b.id)).status, 204);
  assert.equal((await kick(owner, b.id)).body.error, 'no_such_member');
  assert.equal((await put(code, b)).body.error, 'no_member', '내보낸 멤버는 상태를 올리지 못한다');
  assert.deepEqual((await room(code)).members.map((m) => m.name), ['김집사', '가']);

  assert.equal((await api('DELETE', '/api/rooms/room', { code, member: a })).body.error, 'not_owner');
  assert.equal((await api('DELETE', '/api/rooms/room', { code, member: owner })).status, 204);
  assert.equal((await api('GET', '/api/rooms/room', { code })).body.error, 'no_room');
  assert.equal(
    (await server.pool.query('SELECT count(*)::int AS n FROM room_members WHERE id = $1', [a.id])).rows[0].n,
    0,
    '방을 없애면 멤버도 지운다',
  );
});

test('오래 아무도 쓰지 않은 방은 새 방을 만들 때 지운다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { code } = await createRoom('오래된 방');
  await server.pool.query("UPDATE reading_rooms SET seen_at = now() - interval '401 days' WHERE name = '오래된 방'");
  await createRoom();
  assert.equal((await api('GET', '/api/rooms/room', { code })).body.error, 'no_room');
});

test('각자 계획 방: 멤버가 지금 읽는 계획(reading)을 올리면 다른 멤버도 본다. 보내지 않으면(예전 앱) 비운다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { code, member } = await createRoom();
  const reading = { title: '사복음서 한 달 통독', range: '복음서', start: '2026-10-01', end: '2026-10-31', mode: 'sequential' };
  assert.equal((await put(code, member, { reading })).status, 204);
  assert.deepEqual((await room(code)).members[0].reading, reading);
  // 글자 수·꼴이 맞지 않으면 받지 않는다
  for (const bad of [
    { ...reading, title: 'x'.repeat(101) },
    { ...reading, start: '10월 1일' },
    { ...reading, mode: 'random' },
    [reading],
    '복음서',
  ]) {
    assert.equal((await put(code, member, { reading: bad })).body.error, 'bad_reading', JSON.stringify(bad).slice(0, 40));
  }
  assert.equal((await put(code, member)).status, 204);
  assert.equal((await room(code)).members[0].reading, null);
});
