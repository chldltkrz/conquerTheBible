// 묵상 메모·저장한 구절 내보내기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { useIndex } from '../app/js/bible.js';
import { createAccount, saveDayNote, saveVerseNote, saveVerseToday, switchAccount, useMemoryDatabase } from '../app/js/db.js';
import { exportCounts, exportFileName, exportHtml, exportText } from '../app/js/notesexport.js';

const INDEX_PATH = new URL('../app/data/index.json', import.meta.url);
const skip = !fs.existsSync(INDEX_PATH) && 'app/data/index.json 없음';
if (!skip) useIndex(JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')));

const initSqlJs = createRequire(import.meta.url)('sql.js');
const SQL = await initSqlJs();

const NOW = { y: 2026, m: 10, d: 17 };

async function sample() {
  useMemoryDatabase(new SQL.Database());
  await saveDayNote({ y: 2026, m: 10, d: 2 }, '창세기 4–6장', '둘째 날 메모');
  await saveDayNote({ y: 2026, m: 10, d: 1 }, '창세기 1–3장', '첫날 메모\n두 줄');
  await saveVerseToday({ b: 'psa', c: 23, v: 1, t: '주님은 나의 목자시니, 내게 부족함 없어라.' });
  await saveVerseToday({ b: 'gen', c: 1, v: 1, t: '태초에 하나님이 천지를 창조하셨다.' });
  await saveVerseNote('psa', 23, 1, '목자 되신 주님');
}

test('묵상 메모는 쓴 날 순서로, 저장한 구절은 성경 순서로, 구절 메모를 함께', { skip }, async () => {
  await sample();
  assert.deepEqual(exportCounts(), { notes: 3, saved: 2 });
  const text = exportText({}, NOW);
  const at = (s) => text.indexOf(s);
  assert.ok(text.startsWith('맛있는만나 · 묵상 메모와 저장한 구절\n2026년 10월 17일에 내보냄\n'));
  assert.ok(at('■ 묵상 메모 (3개)') < at('■ 저장한 구절 (2구절)'));
  assert.ok(at('2026년 10월 1일 (목) · 창세기 1–3장\n첫날 메모\n두 줄') > 0, '여러 줄 메모는 그대로');
  assert.ok(at('10월 1일') < at('10월 2일'), '오래된 메모부터');
  assert.ok(at('시편 23:1 · 구절 메모\n주님은 나의 목자시니, 내게 부족함 없어라.\n메모: 목자 되신 주님') > 0);
  const savedPart = text.slice(at('■ 저장한 구절'));
  assert.ok(savedPart.indexOf('창세기 1:1') < savedPart.indexOf('시편 23:1'), '성경 순서');
  assert.ok(savedPart.includes('시편 23:1\n주님은 나의 목자시니, 내게 부족함 없어라.\n메모: 목자 되신 주님'));
  assert.ok(text.trimEnd().endsWith('BSB(Berean Standard Bible)는 퍼블릭 도메인'), '본문이 있으면 저작권 표시');
});

test('고른 것만 내보내고, 계정이 여럿이면 계정 이름을 적는다', { skip }, async () => {
  await sample();
  const notesOnly = exportText({ saved: false }, NOW);
  assert.ok(notesOnly.startsWith('맛있는만나 · 묵상 메모\n'));
  assert.ok(!notesOnly.includes('■ 저장한 구절'));
  const savedOnly = exportText({ notes: false }, NOW);
  assert.ok(!savedOnly.includes('■ 묵상 메모') && savedOnly.includes('■ 저장한 구절'));
  assert.equal(exportFileName({ saved: false }, NOW), '맛있는만나-묵상메모-2026-10-17.txt');
  assert.equal(exportFileName({}, NOW), '맛있는만나-묵상메모와구절-2026-10-17.txt');

  const other = await createAccount('둘째');
  await switchAccount(other);
  const empty = exportText({}, NOW);
  assert.ok(empty.includes('둘째 · 2026년 10월 17일에 내보냄'));
  assert.ok(empty.includes('■ 묵상 메모 (0개)') && !empty.includes('첫날 메모'), '지금 계정의 기록만');
  assert.ok(!empty.includes('대한성서공회'), '본문이 없으면 저작권 표시도 없다');
});

test('인쇄용 화면: 메모의 글자는 이스케이프한다', { skip }, async () => {
  await sample();
  await saveDayNote({ y: 2026, m: 10, d: 3 }, '창세기 7장', '<b>굵게</b> & 끝');
  const markup = String(exportHtml({}, NOW));
  assert.ok(markup.includes('<h2>묵상 메모 (4개)</h2>'));
  assert.ok(markup.includes('&lt;b&gt;굵게&lt;/b&gt; &amp; 끝'));
  assert.ok(markup.includes('<p class="px-note"><b>메모</b>목자 되신 주님</p>'));
});
