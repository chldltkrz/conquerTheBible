// 이번 달에 계획이 없을 때 처음 권할 기간 (오늘 화면의 첫 버튼, 새 계획 화면의 기본값)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toISO } from '../app/js/dates.js';
import { startingPeriod } from '../app/js/views/common.js';

const at = (y, m, d) => {
  const p = startingPeriod({ y, m, d });
  return [p.kind, toISO(p.start), toISO(p.end)];
};

test('달 초(3일까지)는 이번 달 전체', () => {
  assert.deepEqual(at(2026, 10, 1), ['month', '2026-10-01', '2026-10-31']);
  assert.deepEqual(at(2026, 10, 3), ['month', '2026-10-01', '2026-10-31']);
});

test('그 뒤로는 오늘부터 이달 말까지 (지난 날짜가 밀린 읽기로 쌓이지 않게)', () => {
  assert.deepEqual(at(2026, 10, 4), ['rest', '2026-10-04', '2026-10-31']);
  assert.deepEqual(at(2026, 10, 22), ['rest', '2026-10-22', '2026-10-31'], '남은 날 10일');
  assert.deepEqual(at(2026, 2, 19), ['rest', '2026-02-19', '2026-02-28']);
});

test('남은 날이 열흘보다 적으면 오늘부터 30일 (달·해를 넘어도)', () => {
  assert.deepEqual(at(2026, 10, 23), ['thirty', '2026-10-23', '2026-11-21'], '남은 날 9일');
  assert.deepEqual(at(2026, 12, 31), ['thirty', '2026-12-31', '2027-01-29']);
});
