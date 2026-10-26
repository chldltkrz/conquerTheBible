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
  currentAccount,
  getPlan,
  renameAccount,
  listPlans,
  planOn,
  planTrackDays,
  rebalancePlan,
  roomMemberships,
  savePlan,
  saveRoomMembership,
  setRead,
  switchAccount,
  syncCollect,
  syncStart,
  useMemoryDatabase,
} from '../app/js/db.js';
import { buildGroupPlan, buildPlan } from '../app/js/planner.js';
import {
  adoptAccountNames,
  checkReading,
  checkRoomPlan,
  configureRooms,
  createRoom,
  deleteRoom,
  isRoomActive,
  joinProblem,
  joinRoom,
  leaveRoom,
  lookupRoom,
  memberStatus,
  plansForRoom,
  refreshRooms,
  removeRoomMember,
  renameInRoom,
  followAccountRename,
  roomData,
  roomMembers,
  roomPlanOf,
  roomPlanTracks,
  roomTally,
  statusFor,
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

/** 누가복음 1–6장을 열흘에 나눈 계획. split: 장 중간에서도 나누기 */
async function lukePlan({ mode = 'sequential', title = '누가복음', split = true } = {}) {
  const sel = { luk: [1, 2, 3, 4, 5, 6] };
  const opts = { splitChapters: split };
  const tracks =
    mode === 'sequential'
      ? [{ title, days: buildPlan(getIndex(), selectionToChapters(sel), 10, opts) }]
      : buildGroupPlan(getIndex(), [selectionToChapters({ luk: [1, 2, 3] }), selectionToChapters({ luk: [4, 5, 6] })], 10, opts).map(
          (days, i) => ({ title: i ? '누가복음 4–6장' : '누가복음 1–3장', days }),
        );
  return savePlan({ start: START, end: END, title, selection: sel, splitChapters: split, mode, tracks });
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

test('각자 계획 방: 계획 정의는 {kind: "own"}뿐이고, 기간 없이 오늘까지 최근 14일과 오늘 계획의 진도를 올린다', { skip: noIndex }, async () => {
  assert.deepEqual(checkRoomPlan({ kind: 'own' }), { kind: 'own' });
  assert.equal(checkRoomPlan({ kind: 'own', title: 1 }).kind, 'own');
  device();
  const id = await lukePlan();
  assert.equal(checkRoomPlan(roomPlanOf(getPlan(id))).kind, 'same');
  await setRead(id, 1, true);

  await saveRoomMembership({ accountId: 1, code: 'OWNR-ROOM-CODE', memberId: 'M', memberKey: 'K', name: '각자', memberName: '나', kind: 'own', start: today() });
  const [m] = roomMemberships();
  assert.equal(m.kind, 'own');
  assert.equal(m.end, null, '각자 계획 방은 기간이 없다');
  assert.equal(isRoomActive(m, addDays(today(), 500)), true);

  // 계획이 그저께 시작했으므로 그저께부터 오늘까지 사흘. 진도는 오늘 읽는 계획의 것
  let s = statusFor(m);
  assert.deepEqual(Object.keys(s.days), [toISO(START), toISO(addDays(START, 1)), toISO(today())]);
  assert.equal(s.days[toISO(START)], 100);
  assert.equal(s.progress, memberStatus(1, START, END).progress);
  // 계획이 끝나고 20일 뒤: 14일 안에 분량이 있는 날이 없고 오늘 계획도 없다
  s = statusFor(m, addDays(END, 20));
  assert.deepEqual(s, { days: {}, progress: null, reading: null });
  // 지금 읽는 계획: 이름·범위·기간·읽는 방식을 올리고, 받은 것은 확인해서 날짜로 바꾼다
  const reading = statusFor(m).reading;
  assert.deepEqual(reading, { title: '누가복음', range: '누가복음서 1–6장', start: toISO(START), end: toISO(END), mode: 'sequential' });
  assert.deepEqual(checkReading(reading).start, START);
  assert.equal(checkReading({ ...reading, start: '어제' }), null);
  assert.equal(checkReading({ ...reading, mode: 'x' }), null);
  assert.equal(checkReading(null), null);
  // 같은 계획 방은 지금처럼 방의 기간으로
  await saveRoomMembership({ accountId: 1, code: 'SAME-ROOM-CODE', memberId: 'N', memberKey: 'K', name: '같이', memberName: '나', start: START, end: END });
  const same = roomMemberships().find((x) => x.code === 'SAME-ROOM-CODE');
  assert.equal(same.kind, 'same');
  assert.equal(Object.keys(statusFor(same).days).length, 10);
  assert.equal('reading' in statusFor(same), false, '같은 계획 방은 계획을 올리지 않는다');
});

test('방에서 보일 내 이름: 계정 이름이나 예전 기본 이름 "나"를 쓰던 방은 계정 이름을 따라가고, 따로 지은 이름은 그대로', { skip: noIndex }, async () => {
  device();
  const me = currentAccount().id;
  const join = (code, memberName) =>
    saveRoomMembership({ accountId: me, code, memberId: code.slice(0, 4), memberKey: 'K', name: code, memberName, kind: 'own', start: today() });
  await renameAccount(me, '나');
  await join('AAAA-ROOM-0001', '나'); // 예전에 '나'로 들어간 방
  await join('BBBB-ROOM-0002', '김집사'); // 방에서 따로 지은 이름
  // 계정 이름을 이미 바꿔 두었으면 기기를 열 때 '나'인 방만 계정 이름으로
  await renameAccount(me, '으으');
  await adoptAccountNames();
  const names = () => Object.fromEntries(roomMemberships().map((m) => [m.code, m.memberName]));
  assert.deepEqual(names(), { 'AAAA-ROOM-0001': '으으', 'BBBB-ROOM-0002': '김집사' });
  // 계정 이름을 바꾸면 그 이름을 쓰던 방도 바뀐다
  await renameAccount(me, '기쁜 수달');
  assert.equal(await followAccountRename(me, '으으', '기쁜 수달'), 1);
  assert.deepEqual(names(), { 'AAAA-ROOM-0001': '기쁜 수달', 'BBBB-ROOM-0002': '김집사' });
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
async function openRoom({ name = '사랑구역', split = true } = {}) {
  const a = device();
  const id = await lukePlan({ split });
  await setRead(id, 1, true);
  const code = await createRoom(getPlan(id), { name, memberName: '김집사' });
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

t('같은 계획을 읽는 두 방에 함께 들어가면 계획 하나를 같이 쓰고, 한 번 읽은 것이 두 방에 다 올라간다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const one = await openRoom({ name: '사랑구역' });
  const two = await openRoom({ name: '우리 가족' });
  const b = device();
  assert.equal(await joinRoom(await lookupRoom(one.code), '엄마'), 'saved');
  const found = await lookupRoom(two.code);
  assert.equal(joinProblem(found), null);
  assert.equal(await joinRoom(found, '엄마'), 'same');
  assert.equal(listPlans().length, 1, '계획은 하나');
  assert.deepEqual(roomMemberships().map((m) => m.name).sort(), ['사랑구역', '우리 가족']);

  /** 그 방장의 기기에서 본 엄마의 오늘 읽음 */
  const momToday = async (room) => {
    room.a.use();
    await refreshRooms();
    const [m] = roomMemberships();
    return roomMembers(m, roomData(room.code).room).find((x) => x.name === '엄마').pct;
  };
  b.use();
  await setRead(planOn(today()).id, 3, true); // 오늘 분량을 한 번 읽는다
  await uploadRooms();
  assert.equal(await momToday(one), 100);
  assert.equal(await momToday(two), 100);

  // 한 방에서 나와도 계획과 다른 방은 그대로 이어진다
  b.use();
  await leaveRoom(roomMemberships().find((m) => m.code === one.code));
  assert.deepEqual(roomMemberships().map((m) => m.code), [two.code]);
  assert.equal(listPlans().length, 1);
  await setRead(planOn(today()).id, 3, false);
  await uploadRooms();
  assert.equal(await momToday(two), 0, '남은 방에는 계속 올라간다');
});

t('장 중간에서도 나누기만 다른 계획은 같은 계획으로 보지 않아, 다른 방에서 읽는 기간이면 들어가지 못한다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const one = await openRoom({ name: '사랑구역' }); // 장 중간에서도 나눈다
  const two = await openRoom({ name: '우리 가족', split: false }); // 장으로만 나눈다
  device();
  await joinRoom(await lookupRoom(one.code), '엄마');
  const found = await lookupRoom(two.code);
  assert.equal(plansForRoom(found.plan).same, null);
  assert.match(joinProblem(found), /사랑구역 방에서 다른 계획/);
  await assert.rejects(joinRoom(found, '엄마'), { code: 'blocked' });
  assert.equal(roomMemberships().length, 1);
  assert.equal((await lookupRoom(two.code)).members.length, 1, '서버에도 들어가지 않았다');
  assert.equal(planOn(today()).splitChapters, true, '내 계획은 그대로');

  // 같은 기간에 들어간 방이 없으면 들어갈 수 있고, 계획이 방의 나누기로 바뀐다
  device();
  await lukePlan();
  assert.equal(await joinRoom(found, '이웃'), 'saved');
  assert.equal(planOn(today()).splitChapters, false);
});

t('각자 계획 방: 들어와도 계획은 그대로이고, 서로 그날 읽은 퍼센트와 진도만 본다. 같은 계획 방과도 함께 들어간다', async (ctx) => {
  if (skip) return ctx.skip(skip);
  const a = device();
  const lukeId = await lukePlan();
  await setRead(lukeId, 3, true); // 오늘 분량
  const code = await createRoom(null, { name: '각자 읽기', memberName: '김집사' });
  assert.deepEqual(roomMemberships().map((m) => [m.kind, m.end]), [['own', null]]);

  // 다른 기간·다른 본문의 계획을 읽는 사람. 같은 계획 방에도 들어가 있다
  const sameRoom = await openRoom({ name: '사랑구역' });
  const b = device();
  await joinRoom(await lookupRoom(sameRoom.code), '엄마');
  const psalms = await savePlan({
    start: addDays(END, 1),
    end: addDays(END, 5),
    title: '시편',
    selection: { psa: [1, 2, 3, 4, 5] },
    splitChapters: true,
    mode: 'sequential',
    tracks: [{ title: '시편', days: buildPlan(getIndex(), selectionToChapters({ psa: [1, 2, 3, 4, 5] }), 5) }],
  });
  const found = await lookupRoom(code);
  assert.deepEqual(found.plan, { kind: 'own' });
  assert.equal(joinProblem(found), null, '같은 계획 방과 부딪히지 않는다');
  assert.equal(await joinRoom(found, '엄마'), 'own');
  assert.deepEqual(listPlans().map((p) => p.title).sort(), ['시편', '누가복음'].sort(), '계획을 만들거나 바꾸지 않는다');
  assert.ok(getPlan(psalms));
  assert.deepEqual(roomMemberships().map((m) => [m.name, m.kind]).sort(), [['각자 읽기', 'own'], ['사랑구역', 'same']]);

  // 오늘 계획이 없는 사람
  const c = device();
  await joinRoom(await lookupRoom(code), '이웃');

  b.use();
  await setRead(planOn(today()).id, 3, true);
  await uploadRooms();
  c.use();
  await uploadRooms();

  a.use();
  await refreshRooms();
  const [m] = roomMemberships();
  const members = roomMembers(m, roomData(code).room);
  assert.deepEqual(
    members.map((x) => [x.name, x.pct, x.progress == null]),
    [
      ['김집사', 100, false],
      ['엄마', 100, false],
      ['이웃', null, true],
    ],
  );
  assert.deepEqual(roomTally(members), { reading: 2, read: 2 }, '오늘 분량이 없는 사람은 세지 않는다');
  // 방에서 보일 내 이름은 같은 방의 다른 사람과 겹치지 않게만 바꾼다. 계정 이름을 바꿔도 그 방에 같은 이름이 있으면 그대로
  await assert.rejects(renameInRoom(m, '엄마'), { code: 'name_taken' });
  assert.equal(await followAccountRename(m.accountId, '김집사', '엄마'), 0);
  await renameInRoom(m, '김권사');
  assert.equal(roomMemberships()[0].memberName, '김권사');
  await refreshRooms();
  assert.equal(roomData(code).room.members.find((x) => x.id === m.memberId).name, '김권사', '서버에도 올라갔다');
  // 멤버를 누르면 보이는 지금 읽는 계획. 엄마는 오늘 사랑구역 방의 누가복음을 읽는다(시편은 그 뒤에 시작). 이웃은 계획이 없다
  assert.deepEqual(
    members.map((x) => checkReading(x.reading) && [checkReading(x.reading).title, checkReading(x.reading).range]),
    [['누가복음', '누가복음서 1–6장'], ['누가복음', '누가복음서 1–6장'], null],
  );
  assert.deepEqual(Object.keys(roomData(code).room.members[1].days).length, 3, '엄마는 그저께부터 사흘');
});
