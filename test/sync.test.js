// 기기 간 동기화 테스트.
// 기기 하나는 sql.js 데이터베이스 하나다. db.js는 데이터베이스를 하나만 쥐므로 device.use()로 바꿔 가며 쓴다.
// 서버와 주고받는 테스트는 PostgreSQL 테스트 DB가 있어야 한다:
//   set -a; . /etc/conquer-the-bible/sync.env; set +a; npm test     (TEST_DATABASE_URL, README 참고)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import {
  createAccount,
  currentAccount,
  deleteAccount,
  deletePlan,
  exportBackup,
  exportFile,
  getDayNote,
  getSetting,
  importFile,
  listAccounts,
  listPlans,
  listSavedVerses,
  newId,
  onRoomsDropped,
  planOn,
  renameAccount,
  resetAll,
  roomMemberships,
  saveDayNote,
  savePlan,
  saveReadingProgress,
  saveRoomMembership,
  saveVerses,
  saveYearVerse,
  setRead,
  setSetting,
  switchAccount,
  SYNC_TABLES,
  syncApply,
  syncCollect,
  syncInfo,
  syncStart,
  useMemoryDatabase,
  yearVerse,
} from '../app/js/db.js';
import {
  configureSync,
  joinSync,
  leaveSync,
  lookupSync,
  normalizeCode,
  startNewSync,
  syncNow,
  syncState,
} from '../app/js/sync.js';

const initSqlJs = createRequire(import.meta.url)('sql.js');
const SQL = await initSqlJs();

const rows = (db, sql) => db.exec(sql)[0]?.values ?? [];

/** 기기 하나 (빈 데이터베이스) */
function device() {
  const d = {
    db: new SQL.Database(),
    use() {
      useMemoryDatabase(d.db, SQL);
      return d;
    },
    /** 백업 가져오기·모두 지우기는 데이터베이스를 새로 만든다. 그것을 이 기기 것으로 삼는다 */
    keepCurrent() {
      d.db = new SQL.Database(exportFile());
      return d.use();
    },
  };
  d.use();
  // 처음 만든 기본 계정은 "기쁜 수달" 같은 무작위 이름이다. 기기끼리 견주기 쉽게 예전 기본 이름으로 둔다
  d.db.run("UPDATE accounts SET name = '나'");
  return d;
}

/** 계정 이름들 (같은 초에 만든 계정은 차례가 정해지지 않으므로 이름 순으로) */
const accountNames = () => listAccounts().map((x) => x.name).sort();
const accountByName = (name) => listAccounts().find((x) => x.name === name).id;

const oct1 = { y: 2026, m: 10, d: 1 };
const oct3 = { y: 2026, m: 10, d: 3 };
const seg = (b, c) => [{ b, c }];

/** 10월 1–3일 계획: 마가복음 1–3장, 하루 한 장 */
const markPlan = (title = '마가복음') => ({
  start: oct1,
  end: oct3,
  title,
  selection: { mrk: [1, 2, 3] },
  splitChapters: true,
  mode: 'sequential',
  tracks: [{ title, days: [1, 2, 3].map((c) => ({ segments: seg('mrk', c), chars: 100 })) }],
});

const verse = (v) => ({ b: 'mrk', c: 1, v, t: `마가복음 1장 ${v}절` });

// ── 서버 없이 ──────────────────────────────────────────────

test('새 번호는 예전 자동 번호와 겹치지 않고 JS 숫자로 정확하다', () => {
  for (let i = 0; i < 1000; i++) {
    const id = newId();
    assert.ok(Number.isSafeInteger(id) && id >= 2 ** 32, String(id));
  }
});

test('동기화 코드: 소문자·띄어쓰기는 고치고, 헷갈리는 글자(0, O, 1, I)가 들어가면 받지 않는다', () => {
  assert.equal(normalizeCode(' abcd efgh-jkmn '), 'ABCD-EFGH-JKMN');
  assert.equal(normalizeCode('ABCDEFGHJKMN'), 'ABCD-EFGH-JKMN');
  assert.equal(normalizeCode('ABCD-EFGH-JKM0'), null);
  assert.equal(normalizeCode('ABCD-EFGH-JKMI'), null);
  assert.equal(normalizeCode('ABCD-EFGH'), null);
});

test('동기화하지 않을 때는 바뀐 줄을 적지 않고, 시작하면 모든 기록을 보낼 것으로 적는다', async () => {
  const a = device();
  await savePlan(markPlan());
  assert.equal(rows(a.db, 'SELECT COUNT(*) FROM sync_outbox')[0][0], 0);
  assert.equal(syncInfo(), null);

  await syncStart('ABCD-EFGH-JKMN');
  const info = syncInfo();
  assert.equal(info.replace, true);
  assert.equal(info.cursor, 0);
  // 계정 1 + 계획 1 + 묶음 1 + 날 3
  assert.equal(info.pending, 6);
  // 예전 자동 번호였던 기본 계정도 무작위 번호로 바뀌고, 계획은 그 계정에 그대로 붙어 있다
  const account = currentAccount();
  assert.ok(account.id >= 2 ** 32);
  assert.equal(planOn(oct1).accountId, account.id);
});

test('보낼 것은 줄마다 지금 값 하나로, 지운 줄은 null로 모으고, 크기를 넘으면 나눈다', async () => {
  const a = device();
  await syncStart('ABCD-EFGH-JKMN');
  const { upTo } = syncCollect();
  await syncApply({ upTo, rows: [], cursor: 1, replaced: true });
  assert.equal(syncInfo().pending, 0);

  const id = await savePlan(markPlan());
  await setRead(id, 1, true);
  await setRead(id, 1, false);
  await setRead(id, 1, true);
  await setRead(id, 2, true);
  await setRead(id, 2, false);
  const { changes, more } = syncCollect();
  assert.equal(more, false);
  const readings = changes.filter((c) => c.t === 'readings');
  assert.deepEqual(
    readings.map((c) => [c.k, c.d ? 'read' : null]),
    [
      [`[${id},0,1]`, 'read'],
      [`[${id},0,2]`, null],
    ],
  );
  // 기기마다 다른 설정은 보내지 않는다
  await setSetting('fontSize', 22);
  await switchAccount(currentAccount().id);
  assert.ok(syncCollect().changes.every((c) => c.t !== 'settings'));
  await saveYearVerse({ year: 2026, text: '말씀', ref: '시편 23:1' });
  assert.ok(syncCollect().changes.some((c) => c.t === 'settings' && c.k.startsWith('["yearVerse:')));

  const small = syncCollect(200);
  assert.equal(small.more, true);
  assert.ok(small.changes.length < changes.length);
});

test('백업 파일에는 동기화 코드와 보내지 않은 변경이 들어가지 않는다', async () => {
  device();
  await syncStart('ABCD-EFGH-JKMN');
  const backup = new SQL.Database(exportBackup());
  assert.deepEqual(rows(backup, 'SELECT COUNT(*) FROM sync_state'), [[0]]);
  assert.deepEqual(rows(backup, 'SELECT COUNT(*) FROM sync_outbox'), [[0]]);
  assert.equal(syncInfo().code, 'ABCD-EFGH-JKMN', '이 기기는 계속 동기화한다');
});

/** 동기화를 시작하고 보낼 것을 모두 보낸 것으로 한다 (서버가 모든 표를 받는다고 알린다) */
async function synced() {
  await syncStart('ABCD-EFGH-JKMN');
  await syncApply({ upTo: syncCollect().upTo, rows: [], cursor: 1, replaced: true, tables: SYNC_TABLES.map((t) => t.name) });
}

const syncRow = (t, k, d) => ({ t, k: JSON.stringify(k), d });

test('나눠 받을 때 부모 줄(계정)이 다음 묶음에 오면 자식 줄(계획)을 미뤄 두었다가 함께 넣고, 다 받았는데도 없으면 버린다', async () => {
  const d = device();
  await synced();
  const mom = newId();
  const plan = newId();
  const planRow = (title) =>
    syncRow('plans', [plan], {
      id: plan,
      account_id: mom,
      start_date: '2026-10-01',
      end_date: '2026-10-01',
      title,
      mode: 'sequential',
      selection: '{"mrk":[1]}',
      split_chapters: 1,
      total_chars: 10,
      created_at: '2026-10-01 08:00:00',
    });
  const page1 = [
    planRow('엄마 계획'),
    syncRow('plan_tracks', [plan, 0], { plan_id: plan, track: 0, title: '엄마 계획', total_chars: 10 }),
    syncRow('plan_days', [plan, 0, 1], { plan_id: plan, track: 0, day: 1, segments: '[{"b":"mrk","c":1}]', chars: 10, moved: 0 }),
  ];
  await syncApply({ rows: page1, cursor: 4, more: true });
  assert.equal(rows(d.db, 'SELECT COUNT(*) FROM plans')[0][0], 0, '계정이 아직 없다');

  // 다음 묶음: 계정과, 그사이 고친 계획 (새로 온 줄이 미뤄 둔 줄보다 앞선다)
  const account = syncRow('accounts', [mom], { id: mom, name: '어머니', color: '#3b64b0', created_at: '2026-10-01 08:00:00' });
  await syncApply({ rows: [account, planRow('엄마 계획 (고침)')], cursor: 6, more: false });
  await switchAccount(mom);
  assert.deepEqual(
    listPlans().map((p) => p.title),
    ['엄마 계획 (고침)'],
  );
  assert.equal(planOn(oct1).days[0].segments[0].b, 'mrk');
  assert.equal(rows(d.db, "SELECT COUNT(*) FROM sync_state WHERE key = 'deferred'")[0][0], 0);

  // 다 받았는데도 부모가 없으면 버린다 (다른 기기에서 지운 계정)
  const lone = syncRow('plans', [newId()], { ...planRow('').d, id: newId(), account_id: newId() });
  lone.k = JSON.stringify([lone.d.id]);
  await syncApply({ rows: [lone], cursor: 7, more: false });
  assert.equal(rows(d.db, `SELECT COUNT(*) FROM plans WHERE id = ${lone.d.id}`)[0][0], 0);
  assert.equal(rows(d.db, "SELECT COUNT(*) FROM sync_state WHERE key = 'deferred'")[0][0], 0);
});

test('받은 기록이나 기록을 통째로 바꿔 빠진 함께 읽기 방을 알린다 (나눠 받는 사이 다시 오면 알리지 않는다)', async () => {
  const dropped = [];
  onRoomsDropped((list) => dropped.push(...list.map((m) => `${m.code} ${m.memberId}`)));
  device();
  await synced();
  const backup = exportBackup(); // 방에 들어가기 전
  await saveRoomMembership({
    accountId: currentAccount().id,
    code: 'ABCD-EFGH-JKMN',
    memberId: 'M000000001',
    memberKey: 'K'.repeat(26),
    name: '방',
    memberName: '나',
    kind: 'own',
    start: oct1,
  });
  const { upTo, changes } = syncCollect();
  await syncApply({ upTo, rows: [], cursor: 2, tables: SYNC_TABLES.map((t) => t.name) });
  const row = changes.find((c) => c.t === 'room_memberships');
  const gone = { ...row, d: null };

  // 나눠 받는 중에 지운 줄이 먼저 오고 같은 멤버가 다음 묶음에 다시 오면 (다른 기기가 기록을 통째로 바꿨을 때) 그대로
  await syncApply({ rows: [gone], cursor: 3, more: true });
  assert.equal(roomMemberships().length, 0);
  await syncApply({ rows: [row], cursor: 4, more: false });
  assert.equal(roomMemberships().length, 1);
  assert.deepEqual(dropped, []);

  // 다 받은 뒤에도 빠졌으면 알린다
  await syncApply({ rows: [gone], cursor: 5, more: false });
  assert.deepEqual(dropped, ['ABCD-EFGH-JKMN M000000001']);

  // 백업을 가져와 빠져도
  dropped.length = 0;
  await syncApply({ rows: [row], cursor: 6, more: false });
  await importFile(backup);
  assert.equal(roomMemberships().length, 0);
  assert.deepEqual(dropped, ['ABCD-EFGH-JKMN M000000001']);
});

// ── 서버와 주고받기 ────────────────────────────────────────

let server = null;
let skip = false;
if (!process.env.TEST_DATABASE_URL) skip = 'TEST_DATABASE_URL 없음 (PostgreSQL 테스트 DB)';
else {
  try {
    await import('pg');
  } catch {
    // server/node_modules에 있다
  }
}

before(async () => {
  if (skip) return;
  let startServer;
  try {
    ({ startServer } = await import('../server/sync-server.mjs'));
  } catch (err) {
    skip = `동기화 서버를 불러오지 못함 (${err.message}). server/에서 npm install`;
    return;
  }
  server = await startServer({ databaseUrl: process.env.TEST_DATABASE_URL, port: 0 });
  await server.pool.query('TRUNCATE sync_spaces CASCADE');
  configureSync({ url: `${server.url}/api/sync` });
});

after(async () => {
  await server?.close();
});

/** 기기 하나에서 동기화한다. 실패하면 상태의 오류를 던진다 */
async function sync(d) {
  d.use();
  await syncNow();
  const s = syncState();
  if (s.status === 'error' || s.status === 'offline') throw new Error(`동기화 실패: ${s.error}`);
}

/** a에서 동기화를 시작하고 b가 코드로 받는다 */
async function pair(a, b) {
  a.use();
  const code = await startNewSync();
  b.use();
  const remote = await lookupSync(code.toLowerCase().replace(/-/g, ' '));
  await joinSync(remote.code, 'server');
  return code;
}

const t = (name, fn) => test(name, fn); // 서버가 없으면 테스트 안에서 건너뛴다 (before가 끝나야 알 수 있다)

t('코드로 연결한 기기는 모든 계정의 기록을 받고, 그 뒤로 바꾼 것은 양쪽으로 간다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const a = device();
  const mom = await createAccount('엄마');
  const planId = await savePlan(markPlan());
  await setRead(planId, 1, true);
  await saveVerses(planId, 1, [verse(1)]);
  await saveDayNote(oct1, '마가복음 1장', '첫 묵상');
  await saveYearVerse({ year: 2026, text: '주님은 나의 목자시니', ref: '시편 23:1' });
  await switchAccount(mom);
  await savePlan(markPlan('엄마 계획'));
  await setSetting('fontSize', 24);

  const b = device();
  const code = await pair(a, b);
  assert.deepEqual(accountNames(), ['나', '엄마']);
  assert.equal(syncInfo().code, code);
  assert.equal(getSetting('fontSize'), null, '글자 크기는 기기마다 따로');
  const me = accountByName('나');
  await switchAccount(me);
  const plan = planOn(oct1);
  assert.equal(plan.title, '마가복음');
  assert.ok(plan.days[0].readAt);
  assert.equal(listSavedVerses().length, 1);
  assert.equal(getDayNote(oct1).text, '첫 묵상');
  assert.equal(yearVerse().ref, '시편 23:1');

  // b에서 읽음 표시, a에서 메모 고치기
  await setRead(plan.id, 2, true);
  await sync(b);
  a.use();
  await switchAccount(me);
  await saveDayNote(oct1, '마가복음 1장', '고친 묵상');
  await sync(a);
  assert.ok(planOn(oct1).days[1].readAt, 'a가 b의 읽음 표시를 받았다');
  await sync(b);
  assert.equal(getDayNote(oct1).text, '고친 묵상', 'b가 a의 메모를 받았다');

  // 지운 것도 간다
  a.use();
  await deletePlan(plan.id);
  await sync(a);
  await sync(b);
  assert.equal(planOn(oct1), null);
  assert.equal(rows(b.db, `SELECT COUNT(*) FROM readings WHERE plan_id = ${plan.id}`)[0][0], 0);
  assert.equal(listSavedVerses().length, 1, '계획을 지워도 저장한 구절은 남는다');
});

t('하루 분량을 어디까지 읽었는지도 다른 기기로 간다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const a = device();
  const id = await savePlan(markPlan());
  const b = device();
  await pair(a, b);

  a.use();
  await sync(a); // 첫 응답에서 서버가 받는 표를 알려 준다
  await saveReadingProgress(id, 1, 0, { b: 'mrk', c: 1, v: 20 });
  await sync(a);
  await sync(b);
  const p = planOn(oct1).days[0].parts[0].progress;
  assert.deepEqual([p.b, p.c, p.v], ['mrk', 1, 20]);
});

t('읽던 계획을 고쳐 저장해도 다른 기기에 읽음 기록이 이어진다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const a = device();
  const id = await savePlan(markPlan());
  await setRead(id, 1, true);
  const b = device();
  await pair(a, b);

  a.use();
  const p = markPlan('마가복음 + 유다서');
  p.tracks.push({ title: '유다서', days: [seg('jud', 1), [], []].map((segments) => ({ segments, chars: 10 })) });
  p.mode = 'parallel';
  await savePlan(p);
  await sync(a);
  await sync(b);
  const plan = planOn(oct1);
  assert.equal(plan.title, '마가복음 + 유다서');
  assert.equal(listPlans().length, 1);
  assert.deepEqual(
    plan.days[0].parts.map((x) => [x.title, !!x.readAt]),
    [
      ['마가복음 + 유다서', true],
      ['유다서', false],
    ],
  );
});

t('보내는 사이 이 기기에서 또 바꾼 줄은 받은 값으로 덮어쓰지 않고 다음에 보낸다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const a = device();
  const id = await savePlan(markPlan());
  const b = device();
  await pair(a, b);

  // a: 1일 읽음 → 보내는 도중에(요청이 서버에 닿기 전) 1일 읽음 취소
  a.use();
  await setRead(id, 1, true);
  let midway = async () => {
    midway = null;
    await setRead(id, 1, false);
  };
  configureSync({
    fetch: async (url, init) => {
      if (midway && init.method === 'POST' && JSON.parse(init.body).changes.length) await midway();
      return fetch(url, init);
    },
  });
  try {
    await sync(a);
  } finally {
    configureSync({ fetch: (...x) => fetch(...x) });
  }
  assert.equal(planOn(oct1).days[0].readAt, null, '이 기기에서 마지막으로 한 것(취소)이 남는다');
  await sync(b);
  assert.equal(planOn(oct1).days[0].readAt, null, '다른 기기에도 취소가 간다');
});

t('같은 날 같은 구절을 두 기기에서 따로 저장해도 하나만 남는다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const a = device();
  const id = await savePlan(markPlan());
  const b = device();
  await pair(a, b);

  a.use();
  await saveVerses(id, 1, [verse(3)]);
  b.use();
  await saveVerses(id, 1, [verse(3)]);
  await sync(a);
  await sync(b);
  await sync(a);
  await sync(b);
  for (const d of [a, b]) {
    d.use();
    assert.deepEqual(
      listSavedVerses().map((x) => [x.v, x.times]),
      [[3, 1]],
    );
  }
  assert.deepEqual(rows(a.db, 'SELECT id FROM saved_verses'), rows(b.db, 'SELECT id FROM saved_verses'));
});

t('두 기기에서 같은 기간 계획을 따로 만들면 나중에 만든 계획이 남고, 읽은 기록은 그 계획으로 옮긴다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const a = device();
  const b = device();
  await pair(a, b);

  a.use();
  const first = await savePlan(markPlan('먼저 만든 계획'));
  await setRead(first, 1, true);
  // created_at은 초 단위라, 나중에 만든 것이 분명하도록 시각을 앞당긴다
  a.db.run("UPDATE plans SET created_at = '2026-09-30 08:00:00' WHERE id = ?", [first]);
  b.use();
  await savePlan(markPlan('나중에 만든 계획'));

  await sync(a);
  await sync(b);
  await sync(a);
  for (const d of [a, b]) {
    d.use();
    assert.deepEqual(
      listPlans().map((p) => p.title),
      ['나중에 만든 계획'],
    );
    assert.ok(planOn(oct1).days[0].readAt, '먼저 만든 계획에서 읽은 날(같은 범위)이 이어진다');
  }
});

t('계정을 지우면 다른 기기에서도 지워지고, 지금 쓰던 계정이면 다른 계정으로 바뀐다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const a = device();
  const dad = await createAccount('아빠');
  const b = device();
  await pair(a, b);
  await switchAccount(dad);

  a.use();
  await deleteAccount(dad);
  await sync(a);
  await sync(b);
  assert.deepEqual(accountNames(), ['나']);
  assert.equal(currentAccount().name, '나');
});

t('이 기기 기록을 남기며 연결하면 다른 기기들의 기록이 이 기기 것으로 바뀐다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const a = device();
  await savePlan(markPlan('a의 계획'));
  a.use();
  const code = await startNewSync();

  const c = device();
  await createAccount('c의 계정');
  await savePlan(markPlan('c의 계획'));
  await joinSync(code, 'device');
  assert.ok(rows(c.db, 'SELECT id FROM accounts').every(([id]) => id >= 2 ** 32), '번호를 새로 받는다');

  await sync(a);
  assert.deepEqual(accountNames(), ['c의 계정', '나']);
  await switchAccount(accountByName('나'));
  assert.deepEqual(
    listPlans().map((p) => p.title),
    ['c의 계획'],
  );
  assert.deepEqual(rows(a.db, 'SELECT id, name FROM accounts ORDER BY id'), rows(c.db, 'SELECT id, name FROM accounts ORDER BY id'));
});

t('동기화 중에 백업을 가져오거나 모두 지우면 다른 기기도 그렇게 바뀐다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const a = device();
  await savePlan(markPlan('지울 계획'));
  const b = device();
  await pair(a, b);

  // 다른 곳에서 만든 백업 (예전 자동 번호)
  const other = device();
  await createAccount('백업 계정');
  await savePlan(markPlan('백업 계획'));
  other.db.run('UPDATE accounts SET id = 2 WHERE name = ?', ['백업 계정']);
  const backup = exportBackup();

  a.use();
  await importFile(backup);
  a.keepCurrent();
  await sync(a);
  await sync(b);
  assert.deepEqual(accountNames(), ['나', '백업 계정']);
  await switchAccount(accountByName('나')); // 쓰던 계정이 지워져 다른 계정으로 바뀌었을 수 있다
  assert.deepEqual(
    listPlans().map((p) => p.title),
    ['백업 계획'],
  );

  a.use();
  await resetAll();
  a.keepCurrent();
  assert.ok(syncInfo(), '모두 지워도 동기화는 이어진다');
  const fresh = accountNames();
  assert.equal(fresh.length, 1);
  assert.match(fresh[0], /^[가-힣]+ [가-힣]+$/, '새 기본 계정은 "형용사 동물" 이름');
  await sync(a);
  await sync(b);
  assert.deepEqual(accountNames(), fresh);
  assert.equal(listPlans().length, 0);
});

t('모든 기기에서 끄면 서버 기록이 지워지고, 다른 기기도 멈추되 기록은 남는다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const a = device();
  await savePlan(markPlan());
  const b = device();
  const code = await pair(a, b);

  a.use();
  await leaveSync({ everywhere: true });
  assert.equal(syncInfo(), null);
  await assert.rejects(lookupSync(code), /코드로 시작한 동기화가 없습니다/);

  b.use();
  await syncNow();
  assert.equal(syncInfo(), null);
  assert.equal(syncState().status, 'off');
  assert.equal(listPlans().length, 1);
});

t('서버가 오래된 지운 줄을 정리하면, 그보다 오래 오지 않은 기기는 모두 다시 받아 맞추고 보내지 않은 변경은 이어서 보낸다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const a = device();
  const id = await savePlan(markPlan('지울 계획'));
  const b = device();
  const code = await pair(a, b);
  b.use();
  assert.equal(listPlans().length, 1);
  await saveDayNote(oct1, '마가복음 1장', 'b의 메모'); // 아직 보내지 않았다

  a.use();
  await deletePlan(id);
  await sync(a);
  // 지운 줄이 90일 지난 것으로 하고 다음 요청에서 정리하게 한다
  const hash = crypto.createHash('sha256').update(code.replace(/-/g, '')).digest();
  const space = (await server.pool.query('SELECT id FROM sync_spaces WHERE code_hash = $1', [hash])).rows[0].id;
  await server.pool.query(`UPDATE sync_rows SET changed_at = now() - interval '91 days' WHERE space_id = $1 AND data IS NULL`, [space]);
  await server.pool.query('UPDATE sync_spaces SET pruned_at = NULL WHERE id = $1', [space]);
  await sync(a); // 정리한다. a는 다 받았으므로 그대로 이어진다
  const left = await server.pool.query('SELECT count(*)::int AS n FROM sync_rows WHERE space_id = $1 AND data IS NULL', [space]);
  assert.equal(left.rows[0].n, 0);

  await sync(b); // 지운 계획을 알 수 없다 → 모두 다시 받아 맞춘다
  assert.equal(listPlans().length, 0, '서버에 없는 계획은 지운다');
  assert.equal(getDayNote(oct1).text, 'b의 메모', '보내지 않은 변경은 남는다');
  assert.equal(syncInfo().pending, 0, '이어서 보냈다');
  await sync(a);
  assert.equal(getDayNote(oct1).text, 'b의 메모');
});

t('부모 줄(계정)을 자식 줄(계획)보다 나중에 고쳐도, 나눠 받는 기기에 계획이 빠지지 않는다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { startServer } = await import('../server/sync-server.mjs');
  const small = await startServer({ databaseUrl: process.env.TEST_DATABASE_URL, port: 0, limits: { pageRows: 2 } });
  configureSync({ url: `${small.url}/api/sync` });
  try {
    const a = device();
    const b = device();
    await pair(a, b);
    a.use();
    const mom = await createAccount('엄마');
    await switchAccount(mom);
    await savePlan(markPlan('엄마 계획'));
    await sync(a);
    await renameAccount(mom, '어머니'); // 계정 줄이 서버에서 가장 뒤 번호가 된다
    await sync(a);

    await sync(b); // 두 줄씩 받는다: 계획이 계정보다 먼저 온다
    await switchAccount(accountByName('어머니'));
    assert.deepEqual(
      listPlans().map((p) => p.title),
      ['엄마 계획'],
    );
    assert.equal(planOn(oct1).days.length, 3);
  } finally {
    configureSync({ url: `${server.url}/api/sync` });
    await small.close();
  }
});

t('기록이 많으면 나누어 보내고 나누어 받는다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const a = device();
  // 1년 동안 18권을 동시에: 날마다 분량 6570줄 (서버는 응답 하나에 5천 줄까지)
  const start = { y: 2027, m: 1, d: 1 };
  const end = { y: 2027, m: 12, d: 31 };
  const books = ['gen', 'exo', 'lev', 'num', 'deu', 'jos', 'jdg', 'rut', '1sa', '2sa', '1ki', '2ki', '1ch', '2ch'];
  books.push('ezr', 'neh', 'est', 'job');
  const days = (b) => Array.from({ length: 365 }, (_, i) => ({ segments: seg(b, (i % 20) + 1), chars: 50 }));
  const id = await savePlan({
    start,
    end,
    title: '1년',
    selection: {},
    splitChapters: true,
    mode: 'parallel',
    tracks: books.map((b) => ({ title: b, days: days(b) })),
  });
  await setRead(id, 1, true);
  const b = device();
  await pair(a, b);
  assert.equal(rows(b.db, 'SELECT COUNT(*) FROM plan_days')[0][0], 18 * 365);
  assert.equal(rows(b.db, 'SELECT COUNT(*) FROM readings')[0][0], 18);
  assert.equal(syncInfo().pending, 0);
});
