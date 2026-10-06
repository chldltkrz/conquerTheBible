import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  MIGRATIONS,
  migrate,
  useMemoryDatabase,
  savePlan,
  getPlan,
  setRead,
  listPlans,
  readDates,
  scheduledDates,
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
  assert.deepEqual(rows(db, 'SELECT id, account_id, year, month, title FROM plans'), [[7, 1, 2026, 10, '신약']]);
  assert.equal(rows(db, 'SELECT COUNT(*) FROM plan_days')[0][0], 3);
  assert.equal(rows(db, 'SELECT COUNT(*) FROM readings')[0][0], 2);
  assert.deepEqual(rows(db, 'PRAGMA foreign_key_check'), []);
  // 이미 최신이면 다시 적용하지 않는다
  assert.equal(migrate(db), false);
});

test('계정마다 같은 달에 계획을 하나씩 가질 수 있다', () => {
  const db = v1Database();
  migrate(db);
  db.exec("INSERT INTO accounts (id, name, color, created_at) VALUES (2, '엄마', '#3b64b0', 'now')");
  db.exec(`INSERT INTO plans (account_id, year, month, title, selection, total_chars, created_at)
           VALUES (2, 2026, 10, '시편', '{}', 0, 'now')`);
  assert.throws(() =>
    db.exec(`INSERT INTO plans (account_id, year, month, title, selection, total_chars, created_at)
             VALUES (2, 2026, 10, '중복', '{}', 0, 'now')`),
  );
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
  const plan = getPlan(2026, 10);
  assert.equal(plan.mode, 'sequential');
  assert.deepEqual(plan.tracks, [{ track: 0, title: '신약', totalChars: 300 }]);
  assert.deepEqual(
    plan.days.map((d) => [d.day, d.readAt != null]),
    [
      [1, true],
      [2, true],
      [3, false],
    ],
  );
  assert.equal(plan.days[0].parts.length, 1);
});

// 병렬 계획: 창세기·출애굽기 두 묶음, 3일. 출애굽기는 3일째가 쉬는 날.
const seg = (b, c) => [{ b, c }];
const parallel = {
  year: 2026,
  month: 11,
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

  let plan = getPlan(2026, 11);
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
  plan = getPlan(2026, 11);
  assert.equal(plan.days[0].readParts, 1);
  assert.equal(plan.days[0].readAt, null);
  assert.deepEqual(readDates(), []);

  // 1일: 출애굽기도 읽음 → 완료
  await setRead(plan.id, 1, true, 1);
  // 3일: 그날 전체 읽음 (분량 있는 창세기만 기록된다)
  await setRead(plan.id, 3, true);
  plan = getPlan(2026, 11);
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
  plan = getPlan(2026, 11);
  assert.deepEqual(plan.days[0].parts.map((p) => p.readAt), [null, null]);
});

test('같은 달 계획을 다시 저장하면 이전 묶음과 읽음 기록이 함께 지워진다', async () => {
  useMemoryDatabase(new SQL.Database());
  await savePlan(parallel);
  await setRead(getPlan(2026, 11).id, 1, true);
  await savePlan({ ...parallel, mode: 'sequential', tracks: [parallel.tracks[0]] });
  const plan = getPlan(2026, 11);
  assert.equal(plan.tracks.length, 1);
  assert.ok(plan.days.every((d) => d.readAt == null));
  assert.deepEqual(readDates(), []);
});
