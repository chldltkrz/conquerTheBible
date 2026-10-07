import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { useIndex } from '../app/js/bible.js';
import { addDays, today } from '../app/js/dates.js';
import { getPlan, listPlans, savePlan, setRead, useMemoryDatabase } from '../app/js/db.js';
import { openedProps, readingEventProps } from '../app/js/views/common.js';

const INDEX_PATH = new URL('../app/data/index.json', import.meta.url);
const skip = !fs.existsSync(INDEX_PATH) && 'app/data/index.json 없음';
if (!skip) useIndex(JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')));

const initSqlJs = createRequire(import.meta.url)('sql.js');
const SQL = await initSqlJs();

/** 어제 시작한 3일 계획: 유다서 1장을 사흘에 나눠 읽고, 첫날은 읽었다 */
async function judePlan() {
  useMemoryDatabase(new SQL.Database());
  const start = addDays(today(), -1);
  const part = (from, to) => ({ segments: [{ b: 'jud', c: 1, from, to }], chars: 100 });
  await savePlan({
    start,
    end: addDays(start, 2),
    title: '사용자가 지은 이름',
    selection: { jud: [1] },
    splitChapters: true,
    mode: 'sequential',
    tracks: [{ title: '사용자가 지은 이름', days: [part(1, 8), part(9, 16), part(17, 25)] }],
  });
  const id = listPlans()[0].id;
  await setRead(id, 1, true);
  return id;
}

test('읽음 이벤트 속성: 몇째 날, 며칠 늦었는지, 책 코드, 자동으로 지은 범위 이름', { skip }, async () => {
  const id = await judePlan();
  const props = readingEventProps(getPlan(id), 1);
  assert.equal(props.plan_day, 1);
  assert.equal(props.days_late, 1);
  assert.equal(props.book, 'jud');
  assert.deepEqual(props.books, ['jud']);
  assert.equal(props.scope, 'day');
  assert.equal(props.plan_length, 3);
  assert.equal(props.plan_scope, '유다서');
  assert.ok(!JSON.stringify(props).includes('사용자가 지은 이름'), '계획 이름은 보내지 않는다');
});

test('앱을 열 때의 속성: 오늘 분량, 밀린 날, 연속 기록', { skip }, async () => {
  await judePlan();
  const props = openedProps();
  assert.equal(props.today_status, 'todo');
  assert.equal(props.plan_day, 2);
  assert.equal(props.missed_days, 0);
  assert.equal(props.streak, 1);
  assert.equal(props.plan_length, 3);
});

test('계획이 없으면 no_plan', { skip }, () => {
  useMemoryDatabase(new SQL.Database());
  assert.deepEqual(openedProps(), { today_status: 'no_plan', streak: 0 });
});

test('getPlan: 없는 id면 null', () => {
  useMemoryDatabase(new SQL.Database());
  assert.equal(getPlan(999), null);
});
