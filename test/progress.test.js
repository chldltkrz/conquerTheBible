// 하루 분량을 어디까지 읽었는지: 비율 계산, 기록·지우기·이어 가기, 동기화에서 서버가 아는 표만 보내기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { progressRatio, useIndex } from '../app/js/bible.js';
import {
  MIGRATIONS,
  deletePlan,
  migrate,
  planOn,
  rebalancePlan,
  savePlan,
  saveReadingProgress,
  setRead,
  syncApply,
  syncCollect,
  syncStart,
  useMemoryDatabase,
} from '../app/js/db.js';
import { readPercent } from '../app/js/views/common.js';

const INDEX_PATH = new URL('../app/data/index.json', import.meta.url);
const skip = !fs.existsSync(INDEX_PATH) && 'app/data/index.json 없음';
if (!skip) useIndex(JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')));

const initSqlJs = createRequire(import.meta.url)('sql.js');
const SQL = await initSqlJs();

// 룻기 1장 1469자(22절), 2장 1777자(23절)
const ruth12 = [
  { b: 'rut', c: 1 },
  { b: 'rut', c: 2 },
];

test('읽은 비율은 분량의 글자 수로 재고, 분량 밖의 절이면 null', { skip }, () => {
  assert.equal(progressRatio(ruth12, { b: 'rut', c: 1, v: 22 }), 1469 / (1469 + 1777));
  assert.equal(progressRatio(ruth12, { b: 'rut', c: 2, v: 23 }), 1);
  assert.ok(progressRatio(ruth12, { b: 'rut', c: 2, v: 1 }) > 1469 / (1469 + 1777));
  assert.equal(progressRatio(ruth12, { b: 'gen', c: 1, v: 1 }), null);

  // 장의 일부: 시편 119:1–48 중 24절까지면 절반 가까이, 구간 앞의 절은 null
  const psalm = [{ b: 'psa', c: 119, from: 1, to: 48 }];
  const half = progressRatio(psalm, { b: 'psa', c: 119, v: 24 });
  assert.ok(half > 0.4 && half < 0.6, String(half));
  assert.equal(progressRatio([{ b: 'psa', c: 119, from: 49, to: 96 }], { b: 'psa', c: 119, v: 10 }), null);
});

test('퍼센트는 묶음마다 글자 수로 더하고, 읽음 표시 전에는 99를 넘지 않는다', { skip }, () => {
  const part = (b, c, chars, extra = {}) => ({ segments: [{ b, c }], chars, readAt: null, progress: null, ...extra });
  const entry = {
    parts: [
      part('rut', 1, 1469, { progress: { b: 'rut', c: 1, v: 22 } }), // 끝까지 읽었지만 읽음 표시는 안 함
      part('rut', 2, 1777),
    ],
  };
  assert.equal(readPercent(entry), Math.floor((1469 / (1469 + 1777)) * 100));
  assert.equal(readPercent(entry, [entry.parts[0]]), 99);
  entry.parts[0].readAt = '2026-11-01 08:00:00';
  entry.parts[1].readAt = '2026-11-01 08:10:00';
  assert.equal(readPercent(entry), 100);
});

const nov1 = { y: 2026, m: 11, d: 1 };
const twoDays = {
  start: nov1,
  end: { y: 2026, m: 11, d: 2 },
  title: '룻기',
  selection: { rut: [1, 2] },
  splitChapters: true,
  mode: 'sequential',
  tracks: [
    {
      title: '룻기',
      days: [
        { segments: [{ b: 'rut', c: 1 }], chars: 1469 },
        { segments: [{ b: 'rut', c: 2 }], chars: 1777 },
      ],
    },
  ],
};

test('어디까지 읽었는지 기록하면 계획의 그날 묶음에 붙어 나온다', async () => {
  useMemoryDatabase(new SQL.Database());
  await savePlan(twoDays);
  const plan = planOn(nov1);
  assert.equal(plan.days[0].parts[0].progress, null);

  await saveReadingProgress(plan.id, 1, 0, { b: 'rut', c: 1, v: 10 });
  await saveReadingProgress(plan.id, 1, 0, { b: 'rut', c: 1, v: 15 });
  const p = planOn(nov1).days[0].parts[0].progress;
  assert.deepEqual([p.b, p.c, p.v], ['rut', 1, 15]);
  assert.match(p.updatedAt, /^\d{4}-\d{2}-\d{2} /);

  // 없는 날(계획 밖)은 기록하지 않는다
  await saveReadingProgress(plan.id, 9, 0, { b: 'rut', c: 1, v: 1 });
  assert.equal(planOn(nov1).days.length, 2);

  // 읽음 표시를 해도 기록은 남는다 (취소하면 다시 이어 읽는다)
  await setRead(plan.id, 1, true);
  await setRead(plan.id, 1, false);
  assert.equal(planOn(nov1).days[0].parts[0].progress.v, 15);

  // 계획을 지우면 함께 지워진다
  await deletePlan(plan.id);
  useMemoryDatabase(new SQL.Database());
});

test('다시 나누기로 분량이 바뀐 날은 지우고, 같은 분량으로 다시 만든 계획에는 이어 간다', async () => {
  useMemoryDatabase(new SQL.Database());
  await savePlan(twoDays);
  let plan = planOn(nov1);
  await saveReadingProgress(plan.id, 1, 0, { b: 'rut', c: 1, v: 15 });
  await saveReadingProgress(plan.id, 2, 0, { b: 'rut', c: 2, v: 5 });

  // 같은 기간·같은 분량으로 다시 저장(읽던 계획에 책 더하기 등): 그대로 이어 간다
  await savePlan({ ...twoDays, title: '다시 만든 계획' });
  plan = planOn(nov1);
  assert.equal(plan.title, '다시 만든 계획');
  assert.deepEqual(
    plan.days.map((d) => d.parts[0].progress?.v ?? null),
    [15, 5],
  );

  // 둘째 날 분량이 바뀌면 그날 기록만 지운다
  await rebalancePlan(plan.id, [
    { track: 0, changes: [{ index: 1, segments: [{ b: 'rut', c: 2, from: 1, to: 10 }], chars: 700, moved: false }] },
  ]);
  plan = planOn(nov1);
  assert.deepEqual(
    plan.days.map((d) => d.parts[0].progress?.v ?? null),
    [15, null],
  );
});

test('v6 데이터베이스에 표와 동기화 트리거를 더한다', () => {
  const db = new SQL.Database();
  for (const sql of MIGRATIONS.slice(0, 6)) db.exec(sql);
  db.exec('PRAGMA user_version = 6');
  assert.equal(migrate(db), true);
  const names = db.exec("SELECT name FROM sqlite_master WHERE name LIKE '%reading_progress%' ORDER BY name")[0].values.flat();
  assert.deepEqual(names, [
    'reading_progress',
    'sqlite_autoindex_reading_progress_1',
    'sync_reading_progress_delete',
    'sync_reading_progress_insert',
    'sync_reading_progress_update',
  ]);
});

test('동기화: 서버가 이 표를 안다고 알려 준 뒤에만 보낸다 (예전 서버는 모르는 표가 든 요청을 거절한다)', async () => {
  useMemoryDatabase(new SQL.Database(), SQL);
  await savePlan(twoDays);
  const plan = planOn(nov1);
  await syncStart('ABCD-EFGH-JKLM');
  const id = plan.id;

  await saveReadingProgress(id, 1, 0, { b: 'rut', c: 1, v: 15 });
  let sent = syncCollect();
  assert.equal(sent.changes.filter((c) => c.t === 'reading_progress').length, 0, '서버가 표를 알려 주기 전');
  assert.ok(sent.changes.some((c) => c.t === 'plans'));

  // 예전 서버(tables 없음)의 응답: 보낸 것은 지우고, 이 표의 변경은 보내지 않은 채 버린다
  await syncApply({ upTo: sent.upTo, rows: [], cursor: 1, replaced: true });
  assert.equal(syncCollect().changes.length, 0);

  // 새 서버의 응답 뒤로는 보낸다
  await syncApply({ upTo: 0, rows: [], cursor: 1, tables: ['plans', 'plan_days', 'reading_progress'] });
  await saveReadingProgress(id, 1, 0, { b: 'rut', c: 1, v: 20 });
  sent = syncCollect();
  const change = sent.changes.find((c) => c.t === 'reading_progress');
  assert.deepEqual(JSON.parse(change.k), [id, 0, 1]);
  assert.equal(change.d.verse, 20);
});

test('동기화를 시작하며 예전 자동 번호를 바꿀 때 어디까지 읽었는지도 따라간다', async () => {
  // 예전 버전에서 만든 계획(작은 번호 7)
  const db = new SQL.Database();
  for (const sql of MIGRATIONS.slice(0, 5)) db.exec(sql);
  db.exec(`
    INSERT INTO plans (id, account_id, start_date, end_date, title, mode, selection, total_chars, created_at)
    VALUES (7, 1, '2026-11-01', '2026-11-01', '룻기', 'sequential', '{"rut":[1]}', 1469, '2026-10-30 08:00:00');
    INSERT INTO plan_tracks VALUES (7, 0, '룻기', 1469);
    INSERT INTO plan_days (plan_id, track, day, segments, chars) VALUES (7, 0, 1, '[{"b":"rut","c":1}]', 1469);
    PRAGMA user_version = 5;
  `);
  useMemoryDatabase(db, SQL);
  await saveReadingProgress(7, 1, 0, { b: 'rut', c: 1, v: 12 });
  await syncStart('ABCD-EFGH-JKLM');
  const plan = planOn(nov1);
  assert.notEqual(plan.id, 7);
  assert.equal(plan.days[0].parts[0].progress.v, 12);
});
