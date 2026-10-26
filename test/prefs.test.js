import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setSetting, useMemoryDatabase } from '../app/js/db.js';
import { pageMode, readingMode, setReadingMode, translationsFor } from '../app/js/prefs.js';

const SQL = await createRequire(import.meta.url)('sql.js')();

test('역본 보기: 처음에는 새번역만', () => {
  useMemoryDatabase(new SQL.Database());
  assert.deepEqual(readingMode(), { main: 'saenew', companion: null });
  assert.deepEqual(translationsFor(), ['saenew']);
});

test('역본 보기: 예전 설정 "both"는 새번역 + BSB, 모르는 값은 새번역', async () => {
  useMemoryDatabase(new SQL.Database());
  await setSetting('translation', 'both');
  assert.deepEqual(readingMode(), { main: 'saenew', companion: 'bsb' });
  assert.deepEqual(translationsFor(), ['saenew', 'bsb']);
  await setSetting('translation', 'bsb');
  assert.deepEqual(readingMode(), { main: 'bsb', companion: null });
  await setSetting('translation', 'nkrv');
  assert.deepEqual(readingMode(), { main: 'saenew', companion: null });
});

test('역본 보기: 본문 역본과 함께 볼 역본을 따로 바꾼다', async () => {
  useMemoryDatabase(new SQL.Database());
  await setSetting('translation', 'both');
  // 예전 "both"에서 본문만 바꾸면 BSB 함께 보기는 남는다
  await setReadingMode({ main: 'gae' });
  assert.deepEqual(readingMode(), { main: 'gae', companion: 'bsb' });
  await setReadingMode({ companion: 'saenew' });
  assert.deepEqual(translationsFor(), ['gae', 'saenew']);
  // 함께 보던 역본을 본문으로 고르면 함께 보기는 없고, 다시 돌아가면 살아난다
  await setReadingMode({ main: 'saenew' });
  assert.deepEqual(readingMode(), { main: 'saenew', companion: null });
  await setReadingMode({ main: 'gae' });
  assert.deepEqual(readingMode(), { main: 'gae', companion: 'saenew' });
  await setReadingMode({ companion: null });
  assert.deepEqual(readingMode(), { main: 'gae', companion: null });
});

test('넘기는 방식: 처음에는 위아래로, 모르는 값도 위아래로', async () => {
  useMemoryDatabase(new SQL.Database());
  assert.equal(pageMode(), 'scroll');
  await setSetting('pageMode', 'chapter');
  assert.equal(pageMode(), 'chapter');
  await setSetting('pageMode', 'swipe');
  assert.equal(pageMode(), 'scroll');
});
