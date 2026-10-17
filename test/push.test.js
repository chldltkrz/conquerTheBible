// 읽기 알림 서버(server/push.mjs) 테스트. 실제로 보내지 않고 가짜 sender가 받은 것을 본다.
// PostgreSQL 테스트 DB가 있어야 한다 (test/sync.test.js와 같이):
//   set -a; . /etc/conquer-the-bible/sync.env; set +a; npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let server = null;
let skip = false;
if (!process.env.TEST_DATABASE_URL) skip = 'TEST_DATABASE_URL 없음 (PostgreSQL 테스트 DB)';

const sent = []; // 가짜 sender가 받은 알림
let failNext = null; // 다음 알림을 이 statusCode로 실패시킨다

before(async () => {
  if (skip) return;
  let startServer;
  try {
    ({ startServer } = await import('../server/sync-server.mjs'));
  } catch (err) {
    skip = `동기화 서버를 불러오지 못함 (${err.message}). server/에서 npm install`;
    return;
  }
  const sender = async (sub, payload, opts) => {
    if (failNext) {
      const err = Object.assign(new Error('push service'), { statusCode: failNext });
      failNext = null;
      throw err;
    }
    sent.push({ endpoint: sub.endpoint, payload, opts });
  };
  server = await startServer({
    databaseUrl: process.env.TEST_DATABASE_URL,
    port: 0,
    push: { publicKey: 'BTestPublicKey', sender, interval: 0 },
  });
  await server.pool.query('TRUNCATE push_subscriptions');
});

after(async () => {
  await server?.close();
});

const TZ = 'Asia/Seoul';
const endpoint = (name) => `https://fcm.googleapis.com/fcm/send/${name}`;
const subscription = (name) => ({ endpoint: endpoint(name), keys: { p256dh: `BKey-${name}`, auth: `auth-${name}` } });

async function api(method, path, body, code = null) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(code ? { Authorization: `Bearer ${code}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

/** 구독을 올린다 */
const put = (name, { time = '21:00', tz = TZ, days = {} } = {}, code = null) =>
  api('PUT', '/api/push/subscription', { subscription: subscription(name), time, tz, days }, code);

/** 그 구독의 알림 시각을 지나간 때로 당기고, 그 알림이 가리키는 그 시간대의 날짜를 돌려준다 */
async function makeDue(name, ago = '1 minute') {
  const r = await server.pool.query(
    `UPDATE push_subscriptions SET next_at = now() - interval '${ago}' WHERE endpoint = $1
     RETURNING to_char(next_at AT TIME ZONE tz, 'YYYY-MM-DD') AS date`,
    [endpoint(name)],
  );
  return r.rows[0].date;
}

const row = async (name) =>
  (await server.pool.query('SELECT *, next_at > now() AS upcoming FROM push_subscriptions WHERE endpoint = $1', [endpoint(name)]))
    .rows[0];

const sentTo = (name) => sent.filter((s) => s.endpoint === endpoint(name));

test('VAPID 공개 키', async (ctx) => {
  if (skip) return ctx.skip(skip);
  assert.deepEqual(await api('GET', '/api/push/key'), { status: 200, body: { key: 'BTestPublicKey' } });
});

test('푸시 서비스가 아닌 주소, 틀린 시각·시간대·날짜는 받지 않는다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const body = (over) => ({ subscription: subscription('bad'), time: '21:00', tz: TZ, days: {}, ...over });
  const status = async (over) => (await api('PUT', '/api/push/subscription', body(over))).body.error;
  const sub = (url) => ({ subscription: { endpoint: url, keys: { p256dh: 'BKey', auth: 'auth' } } });
  assert.equal(await status(sub('https://evil.example.com/fcm/send/x')), 'bad_subscription');
  assert.equal(await status(sub('http://fcm.googleapis.com/fcm/send/x')), 'bad_subscription');
  assert.equal(await status(sub('https://fcm.googleapis.com.evil.example/x')), 'bad_subscription');
  assert.equal(await status(sub('https://127.0.0.1:5432/')), 'bad_subscription');
  assert.equal(await status({ time: '25:00' }), 'bad_time');
  assert.equal(await status({ tz: 'Mars/Olympus' }), 'bad_tz');
  assert.equal(await status({ days: { tomorrow: { text: '', done: false } } }), 'bad_days');
  assert.equal(await status({ days: { '2026-10-17': { text: 1, done: false } } }), 'bad_days');
  assert.equal(await row('bad'), undefined);
});

test('다음 알림 시각은 그 시간대의 정한 시각', async (ctx) => {
  if (skip) return ctx.skip(skip);
  assert.equal((await put('next', { time: '06:30', tz: 'America/New_York' })).status, 204);
  const r = (
    await server.pool.query(
      `SELECT to_char(next_at AT TIME ZONE tz, 'HH24:MI') AS local, next_at > now() AS upcoming,
              next_at - now() <= interval '1 day' AS within_day
         FROM push_subscriptions WHERE endpoint = $1`,
      [endpoint('next')],
    )
  ).rows[0];
  assert.deepEqual(r, { local: '06:30', upcoming: true, within_day: true });
});

test('알림 시각에 그날 분량을 다 읽지 않았으면 보내고 다음 날로 옮긴다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  await put('todo');
  const date = await makeDue('todo');
  await put('todo', { days: { [date]: { text: '창세기 1–3장 · 약 12분', done: false } } });
  await server.reminders.tick();
  const [msg] = sentTo('todo');
  assert.equal(msg.payload.body, '창세기 1–3장 · 약 12분');
  assert.equal(msg.payload.tag, 'reminder');
  assert.ok(msg.opts.ttl > 0);
  assert.equal((await row('todo')).upcoming, true);
  await server.reminders.tick();
  assert.equal(sentTo('todo').length, 1, '한 번만 보낸다');
});

test('다 읽은 날, 분량이 없는 날, 너무 늦게 찾은 알림은 보내지 않는다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  await put('done');
  const date = await makeDue('done');
  await put('done', { days: { [date]: { text: '', done: true } } });
  await put('rest');
  await makeDue('rest');
  await put('late');
  const lateDate = await makeDue('late', '3 hours');
  await put('late', { days: { [lateDate]: { text: '창세기 1장', done: false } } });
  await server.reminders.tick();
  assert.deepEqual([sentTo('done'), sentTo('rest'), sentTo('late')], [[], [], []]);
  assert.equal((await row('late')).upcoming, true, '보내지 않아도 다음 알림 시각으로 옮긴다');
});

test('같은 동기화 공간의 다른 기기가 그날 다 읽었으면 보내지 않는다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { code } = (await api('POST', '/api/sync/spaces')).body;
  await put('phone', {}, code);
  const date = await makeDue('phone');
  await put('phone', { days: { [date]: { text: '창세기 1장', done: false } } }, code);
  await put('tablet', { days: { [date]: { text: '', done: true } } }, code);
  assert.equal((await row('phone')).space_id, (await row('tablet')).space_id);
  await server.reminders.tick();
  assert.deepEqual(sentTo('phone'), []);
});

test('푸시 서비스가 구독이 없다고 하면(410) 지운다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  await put('gone');
  const date = await makeDue('gone');
  await put('gone', { days: { [date]: { text: '창세기 1장', done: false } } });
  failNext = 410;
  await server.reminders.tick();
  assert.equal(await row('gone'), undefined);
});

test('시각을 바꿨을 때만 다음 알림 시각을 다시 정한다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  await put('move');
  await makeDue('move');
  await put('move');
  assert.equal((await row('move')).upcoming, false, '같은 시각이면 그대로 (오늘 보낸 알림을 또 보내지 않도록)');
  await put('move', { time: '07:00' });
  assert.equal((await row('move')).upcoming, true);
});

test('시험 알림: 바로 보내고, 잇달아 누르면 잠시 막는다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  await put('test');
  assert.equal((await api('POST', '/api/push/test', { endpoint: endpoint('test') })).status, 204);
  assert.equal(sentTo('test')[0].payload.tag, 'reminder-test');
  assert.equal((await api('POST', '/api/push/test', { endpoint: endpoint('test') })).body.error, 'busy');
  assert.equal((await api('POST', '/api/push/test', { endpoint: endpoint('nobody') })).body.error, 'no_subscription');
});

test('구독 바꾸기와 지우기', async (ctx) => {
  if (skip) return ctx.skip(skip);
  await put('old', { time: '08:15' });
  const res = await api('POST', '/api/push/renew', { old: endpoint('old'), subscription: subscription('new') });
  assert.equal(res.status, 204);
  assert.equal(await row('old'), undefined);
  assert.equal((await row('new')).remind_at, '08:15:00', '시각과 내용은 그대로');
  assert.equal((await api('DELETE', '/api/push/subscription', { endpoint: endpoint('new') })).status, 204);
  assert.equal(await row('new'), undefined);
});
