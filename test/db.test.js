import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  MAX_PLAN_DAYS,
  createAccount,
  deleteAccount,
  getSetting,
  saveYearVerse,
  switchAccount,
  yearVerse,
  MIGRATIONS,
  migrate,
  useMemoryDatabase,
  savePlan,
  planOn,
  plansOverlapping,
  setRead,
  listPlans,
  readDates,
  scheduledDates,
  rebalancePlan,
  movedDates,
  getDayNote,
  saveDayNote,
  saveVerseNote,
  verseNotes,
  listNotes,
  saveVerseToday,
  deleteSavedVerse,
  listSavedVerses,
  exportBackup,
  importFile,
  listAccounts,
} from '../app/js/db.js';

const initSqlJs = createRequire(import.meta.url)('sql.js');
const SQL = await initSqlJs();

const rows = (db, sql) => {
  const r = db.exec(sql)[0];
  return r ? r.values : [];
};

/** v1 스키마에 계획 하나(3일, 2일 읽음)가 있는 데이터베이스 */
function v1Database() {
  const db = new SQL.Database();
  db.exec(MIGRATIONS[0]);
  db.exec('PRAGMA user_version = 1');
  db.exec(`
    INSERT INTO plans (id, year, month, title, selection, total_chars, created_at)
    VALUES (7, 2026, 10, '신약', '{"mat":[1,2,3]}', 300, '2026-10-01 08:00:00');
    INSERT INTO plan_days VALUES (7, 1, '[{"b":"mat","c":1}]', 100), (7, 2, '[{"b":"mat","c":2}]', 100), (7, 3, '[{"b":"mat","c":3}]', 100);
    INSERT INTO readings VALUES (7, 1, '2026-10-01 21:00:00'), (7, 2, '2026-10-02 21:00:00');
    INSERT INTO settings VALUES ('fontSize', '20');
  `);
  return db;
}

test('v1 기록을 기본 계정으로 옮기며 아무것도 잃지 않는다', () => {
  const db = v1Database();
  assert.equal(migrate(db), true);
  assert.equal(rows(db, 'PRAGMA user_version')[0][0], MIGRATIONS.length);
  assert.deepEqual(rows(db, 'SELECT id, name FROM accounts'), [[1, '나']]);
  // 달 계획은 그 달 1일부터 말일까지의 기간이 된다
  assert.deepEqual(rows(db, 'SELECT id, account_id, start_date, end_date, title FROM plans'), [
    [7, 1, '2026-10-01', '2026-10-31', '신약'],
  ]);
  assert.equal(rows(db, 'SELECT COUNT(*) FROM plan_days')[0][0], 3);
  assert.equal(rows(db, 'SELECT COUNT(*) FROM readings')[0][0], 2);
  assert.deepEqual(rows(db, 'PRAGMA foreign_key_check'), []);
  // 이미 최신이면 다시 적용하지 않는다
  assert.equal(migrate(db), false);
});

test('2월 계획은 윤년에 맞춰 말일까지 옮겨진다', () => {
  const db = v1Database();
  db.exec(`INSERT INTO plans (id, year, month, title, selection, total_chars, created_at)
           VALUES (8, 2028, 2, '시편', '{}', 0, 'now'), (9, 2027, 12, '잠언', '{}', 0, 'now')`);
  migrate(db);
  assert.deepEqual(rows(db, 'SELECT id, start_date, end_date FROM plans WHERE id > 7 ORDER BY id'), [
    [8, '2028-02-01', '2028-02-29'],
    [9, '2027-12-01', '2027-12-31'],
  ]);
});

test('저장한 구절: 같은 날 한 번, 계획을 지워도 남고, 계정을 지우면 함께 지워진다', () => {
  const db = v1Database();
  migrate(db);
  const save = (plan, day) =>
    db.exec(`INSERT OR IGNORE INTO saved_verses (account_id, book, chapter, verse, text, plan_id, day, saved_at)
             VALUES (1, 'mat', 1, 1, '본문', ${plan}, ${day}, 'now')`);
  save(7, 1);
  save(7, 1); // 같은 날 다시 저장해도 한 번
  save(7, 2);
  assert.equal(rows(db, 'SELECT COUNT(*) FROM saved_verses')[0][0], 2);

  db.exec('DELETE FROM plans WHERE id = 7');
  assert.equal(rows(db, 'SELECT COUNT(*) FROM readings')[0][0], 0, '읽음 기록은 계획과 함께 지워진다');
  assert.deepEqual(rows(db, 'SELECT plan_id FROM saved_verses'), [[null], [null]], '구절은 남는다');

  db.exec('DELETE FROM accounts WHERE id = 1');
  assert.equal(rows(db, 'SELECT COUNT(*) FROM saved_verses')[0][0], 0);
});

test('이전 버전 읽음 기록은 묶음 0으로 옮겨져 그대로 보인다', () => {
  useMemoryDatabase(v1Database());
  const plan = planOn({ y: 2026, m: 10, d: 2 });
  assert.equal(plan.mode, 'sequential');
  assert.deepEqual([plan.start, plan.end, plan.length], [{ y: 2026, m: 10, d: 1 }, { y: 2026, m: 10, d: 31 }, 31]);
  assert.deepEqual(plan.tracks, [{ track: 0, title: '신약', totalChars: 300 }]);
  assert.deepEqual(
    plan.days.map((d) => [d.day, d.date.d, d.readAt != null]),
    [
      [1, 1, true],
      [2, 2, true],
      [3, 3, false],
    ],
  );
  assert.equal(plan.days[0].parts.length, 1);
  assert.equal(planOn({ y: 2026, m: 11, d: 1 }), null);
});

// 병렬 계획: 창세기·출애굽기 두 묶음, 11월 1일부터 3일. 출애굽기는 3일째가 쉬는 날.
const seg = (b, c) => [{ b, c }];
const nov1 = { y: 2026, m: 11, d: 1 };
const parallel = {
  start: { y: 2026, m: 11, d: 1 },
  end: { y: 2026, m: 11, d: 3 },
  title: '창세기 · 출애굽기',
  selection: { gen: [1, 2, 3], exo: [1, 2] },
  splitChapters: true,
  mode: 'parallel',
  tracks: [
    { title: '창세기', days: [1, 2, 3].map((c) => ({ segments: seg('gen', c), chars: 100 })) },
    {
      title: '출애굽기',
      days: [
        { segments: seg('exo', 1), chars: 50 },
        { segments: seg('exo', 2), chars: 50 },
        { segments: [], chars: 0 },
      ],
    },
  ],
};

test('병렬 계획: 묶음마다 따로 읽음 표시하고, 모두 읽은 날만 완료로 센다', async () => {
  useMemoryDatabase(new SQL.Database());
  await savePlan(parallel);

  let plan = planOn(nov1);
  assert.equal(plan.mode, 'parallel');
  assert.deepEqual(
    plan.tracks.map((t) => [t.title, t.totalChars]),
    [
      ['창세기', 300],
      ['출애굽기', 100],
    ],
  );
  assert.deepEqual(
    plan.days.map((d) => d.parts.length),
    [2, 2, 1],
    '쉬는 날인 묶음은 parts에서 빠진다',
  );
  assert.deepEqual(plan.days[0].segments, [...seg('gen', 1), ...seg('exo', 1)]);
  assert.equal(plan.days[0].chars, 150);

  // 1일: 창세기만 읽음 → 아직 완료 아님
  assert.ok(await setRead(plan.id, 1, true, 0));
  plan = planOn(nov1);
  assert.equal(plan.days[0].readParts, 1);
  assert.equal(plan.days[0].readAt, null);
  assert.deepEqual(readDates(), []);

  // 1일: 출애굽기도 읽음 → 완료
  await setRead(plan.id, 1, true, 1);
  // 3일: 그날 전체 읽음 (분량 있는 창세기만 기록된다)
  await setRead(plan.id, 3, true);
  plan = planOn(nov1);
  assert.ok(plan.days[0].readAt);
  assert.deepEqual(plan.days[2].parts.map((p) => p.readAt != null), [true]);
  assert.deepEqual(readDates(), [
    { y: 2026, m: 11, d: 1 },
    { y: 2026, m: 11, d: 3 },
  ]);
  assert.equal(scheduledDates().length, 3);
  assert.deepEqual(
    listPlans().map((p) => [p.readDays, p.readingDays]),
    [[2, 3]],
  );

  // 그날 전체 취소
  await setRead(plan.id, 1, false);
  plan = planOn(nov1);
  assert.deepEqual(plan.days[0].parts.map((p) => p.readAt), [null, null]);
});

test('같은 기간 계획을 다시 저장하면 이전 묶음은 지우고, 같은 날짜에 같은 범위를 읽은 기록만 옮긴다', async () => {
  useMemoryDatabase(new SQL.Database());
  await savePlan(parallel);
  const id = planOn(nov1).id;
  await setRead(id, 1, true); // 첫날: 창세기·출애굽기 모두
  await setRead(id, 2, true, 0); // 둘째 날: 창세기만

  // 읽던 계획에 레위기를 더하고 출애굽기는 뺀다. 레위기가 앞 묶음이 되어 창세기의 묶음 번호가 바뀐다.
  const lev = { title: '레위기', days: [1, 2, 3].map((c) => ({ segments: seg('lev', c), chars: 80 })) };
  await savePlan({ ...parallel, selection: { gen: [1, 2, 3], lev: [1, 2, 3] }, tracks: [lev, parallel.tracks[0]] });
  let plan = planOn(nov1);
  assert.deepEqual(plan.tracks.map((t) => t.title), ['레위기', '창세기']);
  assert.deepEqual(
    plan.days.map((d) => d.parts.map((p) => [p.title, !!p.readAt])),
    [
      [['레위기', false], ['창세기', true]],
      [['레위기', false], ['창세기', true]],
      [['레위기', false], ['창세기', false]],
    ],
    '창세기 진도는 남고, 새로 더한 레위기는 안 읽은 분량이 된다',
  );
  assert.deepEqual(readDates(), [], '새 책을 더한 날은 아직 다 읽은 날이 아니다');
  await setRead(plan.id, 1, true, 0);
  assert.deepEqual(readDates(), [nov1]);

  // 범위가 바뀐 날의 기록은 옮기지 않는다. 다시 나누기로 비운 날(moved)은 그대로 저장한다.
  await savePlan({
    ...parallel,
    mode: 'sequential',
    tracks: [
      {
        title: '창세기',
        days: [
          { segments: [{ b: 'gen', c: 1, from: 1, to: 10 }], chars: 50 },
          { segments: [], chars: 0, moved: true },
          { segments: seg('gen', 3), chars: 100 },
        ],
      },
    ],
  });
  plan = planOn(nov1);
  assert.equal(plan.tracks.length, 1);
  assert.ok(plan.days.every((d) => d.readAt == null));
  assert.deepEqual(plan.days.map((d) => d.moved), [false, true, false]);
  assert.deepEqual(readDates(), []);
});

/** 이어서 읽기 계획: 하루에 창세기 한 장씩 */
const simple = (title, start, end, length) => ({
  start,
  end,
  title,
  selection: {},
  splitChapters: true,
  mode: 'sequential',
  tracks: [{ title, days: Array.from({ length }, (_, i) => ({ segments: seg('gen', i + 1), chars: 10 })) }],
});
const oct = (d) => ({ y: 2026, m: 10, d });
const nov = (d) => ({ y: 2026, m: 11, d });

test('기간을 정한 계획은 달을 넘어가도 날짜마다 찾고 기록한다', async () => {
  useMemoryDatabase(new SQL.Database());
  await savePlan(simple('40일', oct(30), nov(2), 4));

  const plan = planOn(nov(2));
  assert.equal(plan.title, '40일');
  assert.equal(plan.length, 4);
  assert.equal(planOn(oct(30)).id, plan.id);
  assert.equal(planOn(oct(29)), null);
  assert.equal(planOn(nov(3)), null);
  assert.deepEqual(
    plan.days.map((d) => [d.day, d.date]),
    [
      [1, oct(30)],
      [2, oct(31)],
      [3, nov(1)],
      [4, nov(2)],
    ],
  );

  await setRead(plan.id, 3, true);
  assert.deepEqual(readDates(), [nov(1)]);
  assert.deepEqual(scheduledDates(), [oct(30), oct(31), nov(1), nov(2)]);
  assert.deepEqual(plansOverlapping(nov(1), nov(30)).map((p) => p.id), [plan.id]);
  assert.deepEqual(plansOverlapping(oct(1), oct(29)), []);
});

test('기간이 겹치는 계획만 지우고, 붙어 있는 계획과 다른 계정의 계획은 남긴다', async () => {
  useMemoryDatabase(new SQL.Database());
  await savePlan(simple('10월', oct(1), oct(31), 31));
  await savePlan(simple('11월 초', nov(1), nov(3), 3));
  assert.deepEqual(listPlans().map((p) => p.title), ['11월 초', '10월'], '맞붙은 기간은 겹치지 않는다');

  const other = await createAccount('엄마');
  await switchAccount(other);
  await savePlan(simple('엄마 10월', oct(1), oct(31), 31));
  await switchAccount(1);

  // 10월 25일 ~ 11월 1일은 두 계획과 모두 겹친다
  await savePlan(simple('8일', oct(25), nov(1), 8));
  assert.deepEqual(listPlans().map((p) => p.title), ['8일']);
  assert.equal(planOn(oct(2)), null);
  assert.equal(planOn(oct(2), other).title, '엄마 10월');
});

test('기간이 맞지 않는 계획은 저장하지 않는다', async () => {
  useMemoryDatabase(new SQL.Database());
  assert.throws(() => savePlan(simple('짧음', oct(1), oct(5), 4)), /기간과 맞지 않습니다/);
  assert.throws(() => savePlan(simple('거꾸로', oct(5), oct(1), 1)), /기간은/);
  const end = { y: 2027, m: 10, d: 2 }; // 367일
  assert.throws(() => savePlan(simple('너무 김', oct(1), end, MAX_PLAN_DAYS + 1)), /기간은/);
  assert.deepEqual(listPlans(), []);
});

test('그룹 계획: 그룹마다 여러 책을 묶음 하나로 저장하고 그룹마다 따로 읽음 표시한다', async () => {
  useMemoryDatabase(new SQL.Database());
  await savePlan({
    start: nov(1),
    end: nov(2),
    title: '시편 · 복음서',
    selection: { psa: [1, 2], mat: [1], mrk: [1] },
    splitChapters: true,
    mode: 'group',
    tracks: [
      { title: '시편 1–2편', days: [{ segments: seg('psa', 1), chars: 10 }, { segments: seg('psa', 2), chars: 10 }] },
      { title: '마태복음서 · 마가복음서', days: [{ segments: seg('mat', 1), chars: 30 }, { segments: seg('mrk', 1), chars: 30 }] },
    ],
  });
  let plan = planOn(nov(1));
  assert.equal(plan.mode, 'group');
  assert.deepEqual(plan.tracks.map((t) => t.title), ['시편 1–2편', '마태복음서 · 마가복음서']);
  assert.deepEqual(plan.days[1].parts.map((p) => p.segments[0].b), ['psa', 'mrk']);

  await setRead(plan.id, 1, true, 1);
  plan = planOn(nov(1));
  assert.deepEqual([plan.days[0].readParts, plan.days[0].readAt], [1, null], '한 그룹만 읽으면 아직 그날 완료가 아니다');
  await setRead(plan.id, 1, true, 0);
  assert.deepEqual(readDates(), [nov(1)]);
  assert.deepEqual(listPlans().map((p) => [p.mode, p.readDays, p.readingDays]), [['group', 1, 2]]);
});

// ── 다시 나누기·묵상 메모·검색에서 저장 (v5) ─────────────────

test('다시 나누기 결과를 저장하면 옮긴 날은 비고, 연속 읽기용 날짜에 남는다', async () => {
  useMemoryDatabase(new SQL.Database());
  await savePlan(parallel);
  const plan = planOn(nov1);
  await setRead(plan.id, 1, true); // 1일 모두 읽음

  // 출애굽기 2일째를 3일째로 옮긴다 (2일째는 비우고 moved)
  await rebalancePlan(plan.id, [
    {
      track: 1,
      changes: [
        { index: 1, segments: [], chars: 0, moved: true },
        { index: 2, segments: seg('exo', 2), chars: 50, moved: false },
      ],
    },
  ]);
  const after = planOn(nov1);
  assert.deepEqual(
    after.days.map((d) => [d.parts.map((p) => p.title).join('+'), d.moved]),
    [
      ['창세기+출애굽기', false],
      ['창세기', true],
      ['창세기+출애굽기', false],
    ],
  );
  assert.equal(after.days[0].readAt != null, true, '읽은 날은 그대로');
  assert.deepEqual(movedDates(), [{ y: 2026, m: 11, d: 2 }]);
  assert.equal(after.totalChars, 400, '분량 합계는 그대로');
});

test('묵상 메모: 날짜별 메모는 계획을 다시 만들어도 남고, 빈 글이면 지운다', async () => {
  useMemoryDatabase(new SQL.Database());
  await savePlan(parallel);
  assert.equal(getDayNote(nov1), null);
  assert.ok(await saveDayNote(nov1, '창세기 1장, 출애굽기 1장', '빛이 생겨라'));
  await saveDayNote(nov1, '창세기 1장, 출애굽기 1장', '빛이 생겨라 하시니');
  assert.equal(getDayNote(nov1).text, '빛이 생겨라 하시니');

  await savePlan({ ...parallel, title: '다시 만든 계획' });
  assert.equal(getDayNote(nov1).text, '빛이 생겨라 하시니', '계획을 다시 만들어도 남는다');

  await saveDayNote(nov1, '', '   ');
  assert.equal(getDayNote(nov1), null);
});

test('구절 메모와 메모 목록, 저장한 구절을 지우면 메모도 지운다', async () => {
  useMemoryDatabase(new SQL.Database());
  await saveVerseToday({ b: 'psa', c: 23, v: 1, t: '주님은 나의 목자시니' });
  await saveVerseNote('psa', 23, 1, '부족함이 없다');
  await saveDayNote(nov1, '창세기 1장', '첫날 메모');
  assert.equal(verseNotes().get('psa:23:1').text, '부족함이 없다');

  const notes = listNotes();
  assert.deepEqual(
    notes.map((n) => n.kind).sort(),
    ['day', 'verse'],
  );
  const verse = notes.find((n) => n.kind === 'verse');
  assert.equal(verse.verseText, '주님은 나의 목자시니');

  await deleteSavedVerse('psa', 23, 1);
  assert.equal(verseNotes().size, 0);
  assert.deepEqual(
    listNotes().map((n) => n.kind),
    ['day'],
  );
});

test('검색에서 저장: 같은 날 같은 절은 한 번만 센다', async () => {
  useMemoryDatabase(new SQL.Database());
  const x = { b: 'jhn', c: 3, v: 16, t: '하나님이 세상을 이처럼 사랑하셔서' };
  assert.equal(await saveVerseToday(x), true);
  assert.equal(await saveVerseToday(x), false);
  assert.equal(listSavedVerses()[0].times, 1);
});

test('올해의 말씀은 계정마다 따로 두고, 계정을 지우면 함께 지운다', async () => {
  useMemoryDatabase(new SQL.Database());
  assert.equal(yearVerse(), null);
  await saveYearVerse({ year: 2026, text: '내가 이제 새 일을 하려고 한다.', ref: '이사야서 43:19' });
  assert.equal(yearVerse().ref, '이사야서 43:19');

  const mom = await createAccount('엄마');
  await switchAccount(mom);
  assert.equal(yearVerse(), null, '다른 계정에는 없다');
  await saveYearVerse({ year: 2026, text: '주님은 나의 목자시니', ref: '시편 23:1' });
  await switchAccount(1);
  assert.equal(yearVerse().ref, '이사야서 43:19');

  await deleteAccount(mom);
  assert.equal(getSetting(`yearVerse:${mom}`), null);
  await saveYearVerse(null);
  assert.equal(yearVerse(), null);
});

test('v9: 에스겔서 15장을 7절(예전 끝)까지 읽던 구간을 8절까지로 고치고, 동기화 중이면 보낼 줄로 적는다', async () => {
  const db = new SQL.Database();
  useMemoryDatabase(db);
  const days = [
    [{ b: 'ezk', c: 14 }, { b: 'ezk', c: 15, from: 1, to: 4 }], // 끝까지가 아니면 그대로
    [{ b: 'ezk', c: 15, from: 5, to: 7 }, { b: 'ezk', c: 16, from: 1, to: 20 }],
    [{ b: 'ezk', c: 15, from: 7, to: 7 }],
    [{ b: 'ezk', c: 15, from: 1, to: 7 }],
    [{ b: 'isa', c: 15, from: 5, to: 7 }], // 다른 책은 그대로
  ];
  const planId = await savePlan({
    ...simple('에스겔서', nov(1), nov(5), 5),
    tracks: [{ title: '에스겔서', days: days.map((segments) => ({ segments, chars: 10 })) }],
  });
  db.run("INSERT INTO sync_state (key, value) VALUES ('tracking', '1')");
  db.exec(MIGRATIONS[8]); // v9만 다시 (뒤의 마이그레이션은 이미 적용된 표를 바꾼다)

  const segs = rows(db, `SELECT segments FROM plan_days WHERE plan_id = ${planId} ORDER BY day`).map(([s]) => JSON.parse(s));
  assert.deepEqual(segs, [
    days[0],
    [{ b: 'ezk', c: 15, from: 5, to: 8 }, { b: 'ezk', c: 16, from: 1, to: 20 }],
    [{ b: 'ezk', c: 15, from: 7, to: 8 }],
    [{ b: 'ezk', c: 15 }],
    days[4],
  ]);
  const sent = rows(db, "SELECT DISTINCT key FROM sync_outbox WHERE tbl = 'plan_days'").map(([k]) => JSON.parse(k).at(-1));
  assert.deepEqual(sent.sort(), [2, 3, 4]);
});

test('백업 가져오기: 새 버전의 앱이 만든 파일과 계정이 없는 파일은 거절하고 지금 기록을 그대로 둔다', async () => {
  useMemoryDatabase(new SQL.Database(), SQL);
  await createAccount('엄마');
  const backup = exportBackup();
  const names = listAccounts().map((a) => a.name);

  const newer = new SQL.Database(backup);
  newer.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
  await assert.rejects(importFile(newer.export()), /더 새 버전의 앱/);

  const empty = new SQL.Database(backup);
  empty.exec('PRAGMA foreign_keys = OFF; DELETE FROM accounts;');
  await assert.rejects(importFile(empty.export()), /계정이 하나도 없습니다/);

  await assert.rejects(importFile(new TextEncoder().encode('백업 아님')), /이 앱의 백업 파일이 아닙니다/);
  assert.deepEqual(
    listAccounts().map((a) => a.name),
    names,
    '거절하면 아무것도 바꾸지 않는다',
  );

  await importFile(backup);
  assert.deepEqual(
    listAccounts().map((a) => a.name),
    names,
  );
});
