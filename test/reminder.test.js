// 읽기 알림: 기기가 서버에 올리는 "날마다 알릴 내용" 계산
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { useIndex } from '../app/js/bible.js';
import { addDays } from '../app/js/dates.js';
import { createAccount, listPlans, resetAll, savePlan, setRead, setSetting, switchAccount, useMemoryDatabase } from '../app/js/db.js';
import { configureReminder, refreshReminder, reminderDays, reminderSetting, timeLabel } from '../app/js/reminder.js';

const INDEX_PATH = new URL('../app/data/index.json', import.meta.url);
const skip = !fs.existsSync(INDEX_PATH) && 'app/data/index.json 없음';
if (!skip) useIndex(JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')));

const initSqlJs = createRequire(import.meta.url)('sql.js');
const SQL = await initSqlJs();

const START = { y: 2026, m: 3, d: 1 };
const part = (b, c, chars = 900) => ({ segments: [{ b, c }], chars });
const rest = { segments: [], chars: 0 };

/** START부터 days.length일 동안의 계획 (tracks가 둘 이상이면 여러 권 동시에) */
async function plan(...tracks) {
  await savePlan({
    start: START,
    end: addDays(START, tracks[0].length - 1),
    title: '계획',
    selection: {},
    splitChapters: false,
    mode: tracks.length > 1 ? 'parallel' : 'sequential',
    tracks: tracks.map((days, i) => ({ title: `묶음 ${i}`, days })),
  });
  return listPlans()[0].id;
}

test('읽을 분량이 있는 날만, 다 읽은 날은 done', { skip }, async () => {
  useMemoryDatabase(new SQL.Database());
  assert.deepEqual(reminderDays(START, 5), {}, '계획이 없으면 알릴 날이 없다');

  const id = await plan([part('gen', 1), rest, part('gen', 2, 1800)]);
  await setRead(id, 1, true);
  const days = reminderDays(START, 5);
  assert.deepEqual(Object.keys(days), ['2026-03-01', '2026-03-03'], '쉬는 날과 계획이 끝난 뒤는 뺀다');
  assert.deepEqual(days['2026-03-01'], { text: '', done: true });
  assert.equal(days['2026-03-03'].done, false);
  assert.match(days['2026-03-03'].text, /^창세기 2장 · 약 \d+분$/);
});

test('여러 권 동시에: 남은 묶음만 알린다', { skip }, async () => {
  useMemoryDatabase(new SQL.Database());
  const id = await plan([part('gen', 1)], [part('mat', 1)]);
  await setRead(id, 1, true, 0);
  const day = reminderDays(START, 1)['2026-03-01'];
  assert.equal(day.done, false);
  assert.match(day.text, /^마태복음서 1장 · /);
  assert.ok(!day.text.includes('창세기'));
});

test('계정이 여럿이면 분량이 있는 계정이 모두 읽어야 done, 이름은 보내지 않는다', { skip }, async () => {
  useMemoryDatabase(new SQL.Database());
  const first = await plan([part('gen', 1)]);
  const other = await createAccount('둘째');
  await switchAccount(other);
  const second = await plan([part('psa', 23)]);

  let day = reminderDays(START, 1)['2026-03-01'];
  assert.deepEqual(day, { text: '계정 2개의 오늘 분량이 남아 있습니다', done: false });

  await setRead(second, 1, true);
  day = reminderDays(START, 1)['2026-03-01'];
  assert.match(day.text, /^창세기 1장 · /, '남은 계정 하나의 분량');
  assert.ok(!day.text.includes('둘째'));

  await setRead(first, 1, true);
  assert.deepEqual(reminderDays(START, 1)['2026-03-01'], { text: '', done: true });
});

test('알림 시각 표시', () => {
  assert.equal(timeLabel('00:00'), '오전 12시');
  assert.equal(timeLabel('09:05'), '오전 9시 5분');
  assert.equal(timeLabel('12:00'), '오후 12시');
  assert.equal(timeLabel('21:30'), '오후 9시 30분');
});

/** 브라우저의 서비스 워커·푸시 구독 흉내. sub가 null이면 구독이 없다 */
function fakeBrowser(endpoint) {
  const browser = {
    unsubscribed: 0,
    sub: { endpoint, unsubscribe: async () => ((browser.unsubscribed += 1), (browser.sub = null), true) },
  };
  const registration = { pushManager: { getSubscription: async () => browser.sub } };
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { serviceWorker: { getRegistration: async () => registration } },
  });
  browser.restore = () => (before ? Object.defineProperty(globalThis, 'navigator', before) : delete globalThis.navigator);
  return browser;
}

test('알림을 켠 채 모든 기록을 지우면(설정이 꺼짐이 된다) 남은 구독을 서버와 브라우저에서 지운다', async () => {
  useMemoryDatabase(new SQL.Database(), SQL);
  const calls = [];
  configureReminder({
    url: 'http://push.test/api/push',
    fetch: async (url, init) => {
      calls.push([init.method, url.replace('http://push.test', ''), init.body && JSON.parse(init.body)]);
      return new Response(null, { status: 204 });
    },
  });
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
  const browser = fakeBrowser(endpoint);
  try {
    await setSetting('reminder', { on: true, time: '21:00' });
    await resetAll();
    assert.equal(reminderSetting().on, false, '설정도 함께 지워졌다');
    await refreshReminder();
    assert.deepEqual(calls, [['DELETE', '/api/push/subscription', { endpoint }]]);
    assert.equal(browser.unsubscribed, 1);

    // 남은 구독이 없으면 아무 요청도 하지 않는다
    calls.length = 0;
    await refreshReminder();
    assert.deepEqual(calls, []);
  } finally {
    browser.restore();
  }
});
