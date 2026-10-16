import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { addDays, compareDate, today, weekday } from '../app/js/dates.js';
import { listPlans, savePlan, setRead, useMemoryDatabase } from '../app/js/db.js';
import { readingStreak, streakStats } from '../app/js/views/common.js';

const initSqlJs = createRequire(import.meta.url)('sql.js');
const SQL = await initSqlJs();

/** 9일 전에 시작한 10일 계획(오늘이 10일째). read에 든 날(1부터)을 읽음으로 표시한다. */
async function tenDays(read) {
  useMemoryDatabase(new SQL.Database());
  const start = addDays(today(), -9);
  await savePlan({
    start,
    end: addDays(start, 9),
    title: '10일',
    selection: {},
    splitChapters: true,
    mode: 'sequential',
    tracks: [{ title: '10일', days: Array.from({ length: 10 }, (_, i) => ({ segments: [{ b: 'gen', c: i + 1 }], chars: 10 })) }],
  });
  const id = listPlans()[0].id;
  for (const day of read) await setRead(id, day, true);
}

test('연속 읽기 자세히: 오늘 아직 안 읽었으면 어제까지 센다', async () => {
  await tenDays([1, 2, 3, 5, 6, 7, 8, 9]);
  const s = streakStats();
  assert.equal(s.current, 5);
  assert.equal(s.current, readingStreak(today()));
  assert.equal(s.best, 5);
  assert.equal(s.total, 8);
  assert.equal(s.dueToday, true);
  assert.equal(s.readToday, false);
});

test('최고 기록은 끊기기 전의 더 긴 기록을 기억한다', async () => {
  await tenDays([1, 2, 3, 4, 5, 6, 8, 9, 10]);
  const s = streakStats();
  assert.equal(s.current, 3);
  assert.equal(s.best, 6);
  assert.equal(s.readToday, true);
});

test('최근 5주: 이번 주 토요일까지 35일, 날짜마다 상태', async () => {
  await tenDays([1, 2, 4]);
  const now = today();
  const { recent } = streakStats();
  assert.equal(recent.length, 35);
  const last = recent.at(-1).date;
  assert.equal(weekday(last.y, last.m, last.d), 6);
  const stateOn = (date) => recent.find((x) => compareDate(x.date, date) === 0)?.state;
  assert.equal(stateOn(now), 'today');
  assert.equal(stateOn(addDays(now, -9)), 'read'); // 1일째
  assert.equal(stateOn(addDays(now, -7)), 'missed'); // 3일째
  assert.equal(stateOn(addDays(now, -10)), 'off', '계획 시작 전');
  if (compareDate(addDays(now, 1), last) <= 0) assert.equal(stateOn(addDays(now, 1)), 'future');
});
