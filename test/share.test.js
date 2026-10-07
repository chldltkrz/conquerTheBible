import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shareText, useIndex } from '../app/js/bible.js';

const INDEX_PATH = new URL('../app/data/index.json', import.meta.url);
const skip = !fs.existsSync(INDEX_PATH) && 'app/data/index.json 없음';
if (!skip) useIndex(JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')));

const v = (b, c, n, t = `${b}${c}:${n}`, e) => ({ b, c, v: n, t, ...(e ? { e } : {}) });

test('한 절: "말씀 - 책 장:절"', { skip }, () => {
  assert.equal(
    shareText([v('psa', 23, 1, '주님은 나의 목자시니, 내게 부족함 없어라.')]),
    '주님은 나의 목자시니, 내게 부족함 없어라. - 시편 23:1',
  );
});

test('이어진 절은 범위로, 떨어진 절은 쉼표로 (순서는 성경 순서로 맞춘다)', { skip }, () => {
  assert.equal(shareText([v('mat', 5, 4, 'B'), v('mat', 5, 3, 'A')]), 'A B - 마태복음서 5:3-4');
  assert.equal(shareText([v('mat', 5, 3, 'A'), v('mat', 5, 4, 'B'), v('mat', 5, 9, 'C')]), 'A B … C - 마태복음서 5:3-4, 9');
});

test('장이 바뀌거나 책이 바뀌면 세미콜론으로 나눈다', { skip }, () => {
  assert.equal(shareText([v('mat', 5, 3, 'A'), v('mat', 6, 33, 'B')]), 'A … B - 마태복음서 5:3; 6:33');
  assert.equal(shareText([v('jhn', 3, 16, 'B'), v('psa', 23, 1, 'A')]), 'A … B - 시편 23:1; 요한복음서 3:16');
});

test('장 경계를 넘어 이어지는 절', { skip }, () => {
  // 룻기 1장은 22절까지
  assert.equal(shareText([v('rut', 1, 22, 'A'), v('rut', 2, 1, 'B')]), 'A B - 룻기 1:22-2:1');
});

test('사본 문제로 빠진 절은 건너뛰어도 이어진 것으로, 묶인 절은 끝 번호까지', { skip }, () => {
  // 마태복음서 17:21은 새번역에 없다
  assert.equal(shareText([v('mat', 17, 20, 'A'), v('mat', 17, 22, 'B')]), 'A B - 마태복음서 17:20-22');
  // 예레미야서 29:30-32는 한 절로 묶여 있다
  assert.equal(shareText([v('jer', 29, 29, 'A'), v('jer', 29, 30, 'B', 32)]), 'A B - 예레미야서 29:29-32');
  assert.equal(shareText([v('jer', 29, 30, 'B', 32)]), 'B - 예레미야서 29:30-32');
});
