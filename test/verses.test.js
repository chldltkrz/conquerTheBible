import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { book, useIndex } from '../app/js/bible.js';
import { verseNumbers } from '../app/js/planner.js';
import { DAILY_VERSES, dailyVerseRef, passageRef, passageText, YEAR_SUGGESTIONS } from '../app/js/verses.js';

const INDEX_PATH = new URL('../app/data/index.json', import.meta.url);
const skip = !fs.existsSync(INDEX_PATH) && 'app/data/index.json 없음';
if (!skip) useIndex(JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')));

/** 테스트에서는 책 파일을 직접 읽는다 */
const bookFile = (code) => JSON.parse(fs.readFileSync(new URL(`../app/data/books/${code}.json`, import.meta.url), 'utf8'));
const textOf = ({ b, c, v, to }) =>
  bookFile(b)
    .chapters.find((ch) => ch.c === c)
    .verses.filter((x) => (x.e ?? x.v) >= v && x.v <= to)
    .map((x) => x.t)
    .join(' ');

test('오늘의 말씀·올해의 말씀 추천은 모두 새번역에 있는 절이고, 카드에 들어갈 만큼 짧다', { skip }, () => {
  const seen = new Set();
  for (const ref of [...DAILY_VERSES, ...YEAR_SUGGESTIONS]) {
    const name = `${ref.b} ${ref.c}:${ref.v}-${ref.to}`;
    const b = book(ref.b);
    assert.ok(b, `없는 책: ${name}`);
    const ch = b.chapters[ref.c - 1];
    assert.ok(ch, `없는 장: ${name}`);
    const nums = verseNumbers(ch);
    for (let v = ref.v; v <= ref.to; v++) assert.ok(nums.includes(v), `없는 절: ${name} (${v}절)`);
    const text = textOf(ref);
    assert.ok(text.length > 5 && text.length <= 260, `${name}: ${text.length}자`);
    if (DAILY_VERSES.includes(ref)) {
      assert.ok(!seen.has(name), `겹침: ${name}`);
      seen.add(name);
    }
  }
  assert.ok(DAILY_VERSES.length >= 120);
});

test('오늘의 말씀은 날짜마다 정해지고, 다음 날에는 바뀐다', { skip }, () => {
  const a = dailyVerseRef({ y: 2026, m: 10, d: 17 });
  assert.equal(dailyVerseRef({ y: 2026, m: 10, d: 17 }), a);
  assert.notEqual(dailyVerseRef({ y: 2026, m: 10, d: 18 }), a);
  assert.notEqual(dailyVerseRef({ y: 2027, m: 10, d: 17 }), a, '해가 바뀌면 같은 날짜라도 다른 말씀');
  assert.equal(passageRef({ b: 'psa', c: 23, v: 1, to: 1 }), '시편 23:1');
  assert.equal(passageRef({ b: 'php', c: 4, v: 6, to: 7 }), '빌립보서 4:6-7');
});

test('카드 본문: 앞뒤 절로 이어지는 인용의 남는 따옴표는 뺀다', { skip }, () => {
  const t = (s) => passageText([{ t: s }]);
  assert.equal(t('"수고하며 무거운 짐을 진 사람은 모두 내게로 오너라. 내가 너희를 쉬게 하겠다.'), '수고하며 무거운 짐을 진 사람은 모두 내게로 오너라. 내가 너희를 쉬게 하겠다.');
  assert.equal(t('항상 기뻐하십시오.'), '항상 기뻐하십시오.');
  assert.equal(t('예수께서 말씀하셨다. "나는 길이요."'), '예수께서 말씀하셨다. "나는 길이요."', '짝이 맞으면 그대로');
  for (const ref of DAILY_VERSES) {
    const verses = bookFile(ref.b).chapters.find((ch) => ch.c === ref.c).verses.filter((x) => (x.e ?? x.v) >= ref.v && x.v <= ref.to);
    const text = passageText(verses);
    for (const q of ['"', "'"]) {
      const odd = text.split(q).length % 2 === 0;
      assert.ok(!(odd && (text.startsWith(q) || text.endsWith(q))), `${ref.b} ${ref.c}:${ref.v} 남는 따옴표: ${text}`);
    }
  }
});

test('새번역 에스겔서 15장은 8절까지 (사이트에 빠진 8절 번호를 crawl.mjs가 나눈다)', { skip }, () => {
  assert.deepEqual(verseNumbers(book('ezk').chapters[14]), [1, 2, 3, 4, 5, 6, 7, 8]);
  const [v7, v8] = bookFile('ezk').chapters[14].verses.slice(6);
  assert.match(v7.t, /내가 주인 줄 알 것이다\.$/);
  assert.match(v8.t, /^그들이 크게 배신하였기 때문에, .* 나 주 하나님의 말이다\."$/);
});
