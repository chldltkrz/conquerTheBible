// 말씀 카드: 줄 나누기, 글자 크기 맞추기, 배치
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shareParts, useIndex } from '../app/js/bible.js';
import { cardFileName, fitText, layoutCard, pickIndex, pickTheme, RATIOS, wrapText } from '../app/js/card.js';

const INDEX_PATH = new URL('../app/data/index.json', import.meta.url);
const skip = !fs.existsSync(INDEX_PATH) && 'app/data/index.json 없음';
if (!skip) useIndex(JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')));

// 가짜 폭: 글자마다 size만큼 (띄어쓰기는 절반)
const measureAt = (size) => (s) => [...s].reduce((w, ch) => w + (ch === ' ' ? size / 2 : size), 0);

test('띄어쓰기에서 줄을 나누고, 줄보다 긴 낱말은 글자 단위로 자른다', () => {
  const m = measureAt(10);
  assert.deepEqual(wrapText('주님은 나의 목자시니 내게 부족함 없어라', 100, m), ['주님은 나의 목자시니', '내게 부족함 없어라']);
  assert.deepEqual(wrapText('가나다라마바사아자차카타', 50, m), ['가나다라마', '바사아자차', '카타']);
  assert.deepEqual(wrapText('첫 줄\n둘째 줄', 1000, m), ['첫 줄', '둘째 줄']);
});

test('들어가는 가장 큰 글자 크기를 고르고, 가장 작은 크기로도 넘치면 …로 줄인다', () => {
  const short = fitText('짧은 말씀', { width: 500, height: 300, max: 60, min: 30, lineHeight: 1.5 }, measureAt);
  assert.equal(short.size, 60);
  assert.equal(short.truncated, false);

  const long = '가나다 '.repeat(40).trim();
  const fitted = fitText(long, { width: 300, height: 400, max: 60, min: 30, lineHeight: 1.5 }, measureAt);
  assert.ok(fitted.size < 60 && fitted.size >= 30);
  assert.ok(fitted.lines.length * fitted.size * 1.5 <= 400);

  const huge = fitText('가나다 '.repeat(400).trim(), { width: 300, height: 200, max: 60, min: 30, lineHeight: 1.5 }, measureAt);
  assert.equal(huge.truncated, true);
  assert.equal(huge.lines.length, Math.floor(200 / 45));
  assert.ok(huge.lines.at(-1).endsWith('…'));
  assert.ok(measureAt(30)(huge.lines.at(-1)) <= 300);
});

test('줄 길이를 고르게 나눈다 (마지막 줄만 짧게 남기지 않는다)', () => {
  const box = { width: 120, height: 1000, max: 10, min: 10, lineHeight: 1.5 };
  const { lines } = fitText('주님은 나의 목자시니 내게 부족함 없어라', box, measureAt);
  assert.deepEqual(lines, ['주님은 나의 목자시니', '내게 부족함 없어라'], '같은 두 줄이라도 가운데에서 나눈다');
  const { lines: three } = fitText('가나 다라 마바 사아 자차 카타 파하', { ...box, width: 80 }, measureAt);
  const widths = three.map((l) => measureAt(10)(l));
  assert.ok(Math.max(...widths) - Math.min(...widths) <= 30, `고른 줄: ${three.join(' / ')}`);
});

test('카드 배치: 말씀과 출처를 한 덩어리로 가운데에, 출처는 말씀 아래', () => {
  for (const ratio of Object.keys(RATIOS)) {
    const { h } = RATIOS[ratio];
    const layout = layoutCard({ text: '주님은 나의 목자시니, 내게 부족함 없어라.', ref: '시편 23:1 · 새번역', ratio }, (_, size) =>
      measureAt(size),
    );
    const textTop = layout.text.y - layout.text.lineHeight / 2;
    const textBottom = textTop + layout.text.lines.length * layout.text.lineHeight;
    const refBottom = layout.ref.y + layout.ref.lineHeight / 2;
    assert.ok(layout.ref.y > textBottom, `${ratio}: 출처가 말씀 아래`);
    assert.ok(Math.abs(textTop - (h - refBottom)) < 60, `${ratio}: 위아래 여백이 비슷하다`);
  }
});

test('공유할 말씀과 출처를 따로 (카드용)', { skip }, () => {
  const v = (b, c, n, t) => ({ b, c, v: n, t });
  assert.deepEqual(shareParts([v('mat', 5, 4, 'B'), v('mat', 5, 3, 'A')]), { text: 'A B', ref: '마태복음서 5:3-4' });
});

test('말씀에 어울리는 주제: 어절 첫머리에서만 찾고, 가장 많이 맞는 주제', () => {
  const themes = [
    { id: 'pasture', keywords: ['목자', '양을', '쉴 만한'] },
    { id: 'light', keywords: ['빛', '등불', 'light'] },
    { id: 'path', keywords: ['길'] },
  ];
  assert.equal(pickTheme('주님은 나의 목자시니, 내게 부족함 없어라.', themes), 'pasture');
  assert.equal(pickTheme('주님의 말씀은 내 발의 등불이요, 내 길의 빛입니다.', themes), 'light', '빛 2 : 길 1');
  assert.equal(pickTheme('그가 나를 쉴 만한 물가로 인도하신다', themes), 'pasture', '띄어쓰기가 든 낱말');
  assert.equal(pickTheme('주님을 찬양을 드립니다', themes), null, '"찬양을"은 "양을"이 아니다');
  assert.equal(pickTheme('Your word is a lamp to my feet and a Light to my path.', themes), 'light', '영어는 대소문자를 가리지 않는다');
  assert.equal(pickTheme('하나님이 세상을 이처럼 사랑하셔서', themes), null);
});

const CARD_INDEX = new URL('../app/img/cards/index.json', import.meta.url);
test('실제 배경 목록으로 고른 주제', { skip: !fs.existsSync(CARD_INDEX) && 'app/img/cards/index.json 없음' }, () => {
  const { themes } = JSON.parse(fs.readFileSync(CARD_INDEX, 'utf8'));
  assert.equal(pickTheme('주님은 나의 목자시니, 내게 부족함 없어라.', themes), 'pasture');
  assert.equal(pickTheme('주님의 말씀은 내 발을 비추는 등불이요, 내 길을 밝히는 빛입니다.', themes), 'light');
  assert.equal(pickTheme('오직 주님을 소망으로 삼는 사람은 새 힘을 얻으리니, 독수리가 날개를 치며 솟아오르듯 올라갈 것이요', themes), 'sky');
  assert.equal(pickTheme('나는 포도나무요, 너희는 가지다. 사람이 내 안에 머물러 있고 내가 그 안에 머물러 있으면, 그는 열매를 많이 맺는다.', themes), 'harvest');
  assert.equal(pickTheme('강하고 담대하여라. 두려워하지 말며 놀라지 말아라.', themes), null, '"강하고"는 강물이 아니다');
  for (const t of themes) assert.ok(t.backgrounds.length > 0, `${t.id}: 배경이 있다`);
});

test('말씀마다 늘 같은 배경 순번', () => {
  assert.equal(pickIndex('시편 23:1', 5), pickIndex('시편 23:1', 5));
  assert.ok(pickIndex('시편 23:1', 5) >= 0 && pickIndex('시편 23:1', 5) < 5);
  assert.equal(pickIndex('아무거나', 0), 0);
});

test('저장할 파일 이름', () => {
  assert.equal(cardFileName('시편 23:1'), '맛있는만나-시편-23-1.png');
  assert.equal(cardFileName('마태복음서 5:3-4, 9'), '맛있는만나-마태복음서-5-3-4-9.png');
});
