// 함께 읽기 방, 기기 쪽(app/js/rooms.js): 방의 계획을 똑같이 다시 나누기, 날짜별 읽음 계산,
// 그리고 서버(server/rooms.mjs)와 두 기기가 주고받기. 서버 테스트는 PostgreSQL 테스트 DB가 있어야 한다:
//   set -a; . /etc/conquer-the-bible/sync.env; set +a; npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { getIndex, selectionToChapters, useIndex } from '../app/js/bible.js';
import { addDays, today, toISO } from '../app/js/dates.js';
import {
  createAccount,
  getPlan,
  listPlans,
  planOn,
  planTrackDays,
  rebalancePlan,
  roomMemberships,
  savePlan,
  setRead,
  switchAccount,
  syncCollect,
  syncStart,
  useMemoryDatabase,
} from '../app/js/db.js';
import { buildGroupPlan, buildPlan } from '../app/js/planner.js';
import {
  checkRoomPlan,
  configureRooms,
  createRoom,
  deleteRoom,
  joinRoom,
  leaveRoom,
  lookupRoom,
  memberStatus,
  plansForRoom,
  refreshRooms,
  removeRoomMember,
  roomData,
  roomMembers,
  roomPlanOf,
  roomPlanTracks,
  roomTally,
  uploadRooms,
} from '../app/js/rooms.js';

const INDEX_PATH = new URL('../app/data/index.json', import.meta.url);
const noIndex = !fs.existsSync(INDEX_PATH) && 'app/data/index.json 없음';
if (!noIndex) useIndex(JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')));

const initSqlJs = createRequire(import.meta.url)('sql.js');
const SQL = await initSqlJs();

/** 기기 하나 (빈 데이터베이스). db.js는 데이터베이스를 하나만 쥐므로 use()로 바꿔 가며 쓴다 */
function device() {
  const d = { db: new SQL.Database(), use: () => useMemoryDatabase(d.db, SQL) };
  d.use();
  return d;
}

const START = addDays(today(), -2); // 그저께 시작한 열흘 계획 (오늘은 3일째)
const END = addDays(START, 9);

/** 누가복음 1–6장을 열흘에 나눈 계획 */
async function lukePlan({ mode = 'sequential', title = '누가복음' } = {}) {
  const sel = { luk: [1, 2, 3, 4, 5, 6] };
  const tracks =
    mode === 'sequential'
      ? [{ title, days: buildPlan(getIndex(), selectionToChapters(sel), 10) }]
      : buildGroupPlan(getIndex(), [selectionToChapters({ luk: [1, 2, 3] }), selectionToChapters({ luk: [4, 5, 6] })], 10).map(
          (days, i) => ({ title: i ? '누가복음 4–6장' : '누가복음 1–3장', days }),
        );
  return savePlan({ start: START, end: END, title, selection: sel, splitChapters: true, mode, tracks });
}

const segmentsOf = (planId) => planTrackDays(planId).map((t) => t.days.map((d) => d.segments));

test('방의 계획 정의로 다시 나누면 처음 계획과 날짜별 분량이 같다 (이어서, 그룹별로)', { skip: noIndex }, async () => {
  for (const mode of ['sequential', 'group']) {
    device();
    const id = await lukePlan({ mode });
    const def = checkRoomPlan(JSON.parse(JSON.stringify(roomPlanOf(getPlan(id)))));
    assert.ok(def, mode);
    assert.equal(def.length, 10);
    assert.deepEqual(roomPlanTracks(def).map((t) => t.days.map((d) => d.segments)), segmentsOf(id), mode);
    assert.equal(plansForRoom(def).same?.id, id, '같은 계획이 이미 있다');
  }
});

test('밀린 분량을 다시 나눈 계획으로 만든 방도 처음 나눈 그대로 받고, 그 계획은 같은 계획으로 본다', { skip: noIndex }, async () => {
  device();
  const id = await lukePlan();
  const original = segmentsOf(id);
  // 첫날 분량을 둘째 날로 옮긴 것처럼 고친다
  const [day1, day2] = planTrackDays(id)[0].days;
  await rebalancePlan(id, [
    {
      track: 0,
      changes: [
        { index: 0, segments: [], chars: 0, moved: true },
        { index: 1, segments: [...day1.segments, ...day2.segments], chars: day1.chars + day2.chars, moved: false },
      ],
    },
  ]);
  const def = checkRoomPlan(roomPlanOf(getPlan(id)));
  assert.deepEqual(roomPlanTracks(def).map((t) => t.days.map((d) => d.segments)), original);
  assert.equal(plansForRoom(def).same?.id, id);
});

test('틀린 계획 정의는 받지 않는다', { skip: noIndex }, () => {
  const ok = { title: '룻기', start: '2026-10-01', end: '2026-10-04', mode: 'sequential', selection: { rut: [1] }, tracks: [{ title: '룻기', selection: { rut: [1] } }] };
  assert.ok(checkRoomPlan(ok));
  assert.equal(checkRoomPlan({ ...ok, end: '2026-02-30' }), null);
  assert.equal(checkRoomPlan({ ...ok, end: '2027-12-31' }), null, '366일보다 길다');
  assert.equal(checkRoomPlan({ ...ok, mode: 'random' }), null);
  assert.equal(checkRoomPlan({ ...ok, tracks: [{ title: 'x', selection: { rut: [5] } }] }), null, '룻기는 4장까지');
  assert.equal(checkRoomPlan({ ...ok, tracks: [{ title: 'x', selection: { xyz: [1] } }] }), null);
  assert.equal(checkRoomPlan({ ...ok, tracks: [] }), null);
});

test('올릴 읽음: 분량이 있는 날마다 퍼센트, 계획 전체 진도. 계획을 고쳐 저장해도 기간으로 이어진다', { skip: noIndex }, async () => {
  device();
  const id = await lukePlan();
  await setRead(id, 1, true);
  let s = memberStatus(1, START, END);
  assert.equal(Object.keys(s.days).length, 10);
  assert.equal(s.days[toISO(START)], 100);
  assert.equal(s.days[toISO(today())], 0);
  assert.ok(s.progress > 0 && s.progress < 100);
  // 같은 기간의 계획을 다시 저장하면(번호가 바뀐다) 같은 날짜·범위의 읽음은 이어진다
  const again = await lukePlan({ title: '고친 이름' });
  assert.notEqual(again, id);
  s = memberStatus(1, START, END);
  assert.equal(s.days[toISO(START)], 100);
  // 기간 밖(앞뒤)의 날은 넣지 않는다
  s = memberStatus(1, addDays(START, -3), addDays(END, 3));
  assert.equal(Object.keys(s.days).length, 10);
});

// ── 서버와 주고받기 ────────────────────────────────────────

let server = null;
let skip = noIndex;
if (!skip && !process.env.TEST_DATABASE_URL) skip = 'TEST_DATABASE_URL 없음 (PostgreSQL 테스트 DB)';

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
  configureRooms({ url: `${server.url}/api/rooms` });
});

after(async () => {
  await server?.close();
});

const t = (name, fn) => test(name, fn); // 서버가 없으면 테스트 안에서 건너뛴다 (before가 끝나야 알 수 있다)

/** a가 계획을 만들고 방을 연다 → {a, code} */
async function openRoom() {
  const a = device();
  const id = await lukePlan();
  await setRead(id, 1, true);
  const code = await createRoom(getPlan(id), { name: '사랑구역', memberName: '김집사' });
  return { a, code };
}

t('방이 없을 때 올리기·받기를 불러도, 그 뒤 방에 들어가면 올리고 받는다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  device();
  await uploadRooms(); // 앱을 켤 때처럼, 할 일 없이 바로 끝난다
  await refreshRooms();
  const { a, code } = await openRoom();
  device();
  assert.equal((await lookupRoom(code)).members[0].days[toISO(START)], 100, '방장의 읽음이 올라갔다');
  a.use();
  await refreshRooms();
  assert.equal(roomData(code)?.room?.name, '사랑구역', '방 소식을 받았다');
});

t('초대 코드로 들어가면 방의 계획이 생기고, 서로의 오늘 읽음이 "몇 명 중 몇 명"으로 보인다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { a, code } = await openRoom();

  const b = device();
  const found = await lookupRoom(code.toLowerCase());
  assert.equal(found.name, '사랑구역');
  assert.deepEqual(found.members.map((m) => m.name), ['김집사']);
  assert.equal(found.members[0].days[toISO(START)], 100, '방장의 읽음이 이미 올라가 있다');
  assert.equal(await joinRoom(found, '엄마'), 'saved');
  const plan = planOn(today());
  assert.equal(plan.title, '누가복음');
  assert.deepEqual(segmentsOf(plan.id), (a.use(), segmentsOf(planOn(today()).id)), '같은 날짜별 분량');

  b.use();
  await setRead(plan.id, 3, true); // 오늘 분량
  await uploadRooms();

  a.use();
  await refreshRooms();
  const [m] = roomMemberships();
  const { room } = roomData(code);
  const members = roomMembers(m, room);
  assert.deepEqual(
    members.map((x) => [x.name, x.me, x.owner, x.pct]),
    [
      ['김집사', true, true, 0],
      ['엄마', false, false, 100],
    ],
  );
  assert.deepEqual(roomTally(members), { reading: 2, read: 1 });
});

t('이미 같은 계획이 있으면 그대로 쓰고, 다른 계획이 겹치면 방의 계획으로 바꾼다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { code } = await openRoom();

  device();
  const mine = await lukePlan({ title: '내 누가복음' });
  await setRead(mine, 1, true);
  assert.equal(await joinRoom(await lookupRoom(code), '같은 계획'), 'same');
  assert.equal(listPlans().length, 1);
  assert.equal(planOn(today()).title, '내 누가복음', '내 계획을 그대로 둔다');

  device();
  const other = await savePlan({
    start: START,
    end: END,
    title: '다른 계획',
    selection: { luk: [1, 2] },
    splitChapters: true,
    mode: 'sequential',
    tracks: [{ title: '다른 계획', days: buildPlan(getIndex(), selectionToChapters({ luk: [1, 2] }), 10) }],
  });
  await setRead(other, 1, true);
  assert.equal(await joinRoom(await lookupRoom(code), '다른 계획'), 'saved');
  assert.equal(planOn(today()).title, '누가복음');
  assert.equal(listPlans().length, 1);
});

t('계정마다 따로 들어가고, 동기화할 때 방 목록도 보낸다 (서버가 그 표를 알 때)', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { code } = await openRoom();
  const b = device();
  const mom = await createAccount('엄마');
  await switchAccount(mom);
  await joinRoom(await lookupRoom(code), '엄마');
  assert.deepEqual(roomMemberships().map((m) => [m.accountId, m.memberName]), [[mom, '엄마']]);
  assert.deepEqual(roomMemberships(1), [], '다른 계정은 들어가지 않았다');

  await syncStart('TEST-CODE-ROOM');
  const sent = syncCollect().changes.filter((c) => c.t === 'room_memberships');
  assert.equal(sent.length, 0, '서버가 아직 모르는 표는 보내지 않는다');
  b.db.run(`INSERT INTO sync_state (key, value) VALUES ('tables', '["room_memberships"]')
            ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  const row = syncCollect().changes.find((c) => c.t === 'room_memberships');
  assert.equal(row.d.code, code);
  assert.equal(row.d.member_name, '엄마');
});

t('방에서 나가면 목록에서 빠지고 계획은 남는다. 방장이 내보내거나 방을 없애면 다음에 받을 때 빠진다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { a, code } = await openRoom();
  const b = device();
  await joinRoom(await lookupRoom(code), '나갈 사람');
  await leaveRoom(roomMemberships()[0]);
  assert.deepEqual(roomMemberships(), []);
  assert.ok(planOn(today()), '계획은 남는다');

  const c = device();
  await joinRoom(await lookupRoom(code), '내보낼 사람');
  a.use();
  await refreshRooms();
  const owner = roomMemberships()[0];
  const kicked = roomData(code).room.members.find((x) => x.name === '내보낼 사람');
  await removeRoomMember(owner, kicked.id);
  assert.deepEqual(roomData(code).room.members.map((x) => x.name), ['김집사']);
  c.use();
  await setRead(planOn(today()).id, 3, true);
  await uploadRooms();
  assert.deepEqual(roomMemberships(), [], '내보내진 기기는 올리다가 알고 뺀다');

  const d = device();
  await joinRoom(await lookupRoom(code), '남은 사람');
  a.use();
  await deleteRoom(roomMemberships()[0]);
  assert.deepEqual(roomMemberships(), []);
  d.use();
  await refreshRooms();
  assert.deepEqual(roomMemberships(), [], '없어진 방은 받다가 알고 뺀다');
});

t('아직 한 번도 올리지 않은 멤버는 방의 계획에 그날 분량이 있으면 "아직"으로 센다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const { code } = await openRoom();
  // 들어오자마자 인터넷이 끊긴 기기처럼, 들어오기만 하고 읽음은 올리지 않는다
  const res = await fetch(`${server.url}/api/rooms/members`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '새 사람', color: '#3b64b0' }),
  });
  assert.equal(res.status, 201);
  await refreshRooms();
  const [m] = roomMemberships();
  const { room } = roomData(code);
  const members = roomMembers(m, room);
  const fresh = members.find((x) => x.name === '새 사람');
  assert.equal(fresh.waiting, true);
  assert.equal(fresh.pct, 0);
  assert.deepEqual(roomTally(members), { reading: 2, read: 0 });
  const after = roomMembers(m, room, addDays(END, 1)).find((x) => x.name === '새 사람');
  assert.equal(after.pct, null, '계획 기간 밖의 날은 세지 않는다');
});
