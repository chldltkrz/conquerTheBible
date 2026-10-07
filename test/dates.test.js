import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, formatPeriod, fromISO, isWholeMonth, toISO } from '../app/js/dates.js';

test('addDays와 daysBetween은 달·해 경계와 윤년을 따른다', () => {
  assert.deepEqual(addDays({ y: 2026, m: 12, d: 31 }, 1), { y: 2027, m: 1, d: 1 });
  assert.deepEqual(addDays({ y: 2028, m: 2, d: 28 }, 1), { y: 2028, m: 2, d: 29 });
  assert.deepEqual(addDays({ y: 2027, m: 3, d: 1 }, -1), { y: 2027, m: 2, d: 28 });
  assert.deepEqual(addDays({ y: 2026, m: 2, d: 30 }, 0), { y: 2026, m: 3, d: 2 }, '없는 날짜는 실제 날짜로 맞춘다');
  assert.equal(daysBetween({ y: 2026, m: 1, d: 1 }, { y: 2027, m: 1, d: 1 }), 365);
  assert.equal(daysBetween({ y: 2028, m: 1, d: 1 }, { y: 2029, m: 1, d: 1 }), 366);
  assert.equal(daysBetween({ y: 2026, m: 11, d: 2 }, { y: 2026, m: 10, d: 30 }), -3);
  // 서머타임이 있는 지역에서도 하루는 하루다 (UTC로 계산)
  assert.equal(daysBetween({ y: 2026, m: 3, d: 1 }, { y: 2026, m: 4, d: 1 }), 31);
});

test('toISO와 fromISO', () => {
  assert.equal(toISO({ y: 2026, m: 3, d: 7 }), '2026-03-07');
  assert.deepEqual(fromISO('2026-03-07'), { y: 2026, m: 3, d: 7 });
});

test('기간 표기: 한 달 전체면 달, 아니면 시작일 – 마지막 날', () => {
  assert.equal(isWholeMonth({ y: 2026, m: 2, d: 1 }, { y: 2026, m: 2, d: 28 }), true);
  assert.equal(isWholeMonth({ y: 2026, m: 2, d: 1 }, { y: 2026, m: 2, d: 27 }), false);
  assert.equal(formatPeriod({ y: 2026, m: 10, d: 1 }, { y: 2026, m: 10, d: 31 }), '2026년 10월');
  assert.equal(formatPeriod({ y: 2026, m: 10, d: 15 }, { y: 2026, m: 11, d: 23 }), '10월 15일 – 11월 23일');
  assert.equal(
    formatPeriod({ y: 2026, m: 10, d: 15 }, { y: 2026, m: 11, d: 23 }, { year: true }),
    '2026년 10월 15일 – 11월 23일',
  );
  assert.equal(formatPeriod({ y: 2026, m: 12, d: 20 }, { y: 2027, m: 1, d: 10 }), '2026년 12월 20일 – 2027년 1월 10일');
});
