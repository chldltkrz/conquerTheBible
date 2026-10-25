import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rememberBook, segmentVerses, shareText, useIndex } from '../app/js/bible.js';

const INDEX_PATH = new URL('../app/data/index.json', import.meta.url);
const GAE_DIR = new URL('../app/data/gae/books/', import.meta.url);
const skip =
  (!fs.existsSync(INDEX_PATH) && 'app/data/index.json 없음') || (!fs.existsSync(GAE_DIR) && '개역개정 데이터 없음 (npm run gae)');
const index = skip ? null : useIndex(JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')));
const gae = (code) => JSON.parse(fs.readFileSync(new URL(`${code}.json`, GAE_DIR), 'utf8'));

test('개역개정 66권: 장 수가 새번역과 같고, 모든 절에 본문이 있고, HTML이 남지 않았다', { skip }, () => {
  for (const b of index.books) {
    const data = gae(b.code);
    assert.equal(data.code, b.code);
    assert.ok(data.name, `${b.code} 책 이름`);
    assert.equal(data.chapters.length, b.chapters.length, `${b.code} 장 수`);
    data.chapters.forEach((ch, i) => {
      assert.equal(ch.c, i + 1, `${b.code} 장 순서`);
      assert.ok(ch.verses.length, `${b.code} ${ch.c} 절 없음`);
      for (const x of [...ch.verses, ...ch.heads, ...ch.notes]) {
        assert.ok(x.t && !/[<>&$]|nbsp/.test(x.t), `${b.code} ${ch.c}:${x.v} ${JSON.stringify(x.t)}`);
      }
    });
  }
});

test('개역개정 책 이름과 시편 표제', { skip }, () => {
  assert.deepEqual(['jos', 'mat', 'rev'].map((c) => gae(c).name), ['여호수아', '마태복음', '요한계시록']);
  // 시편 표제는 단락 제목이 아니라 표제로 둔다
  assert.deepEqual(gae('psa').chapters[2].heads, [{ v: 1, kind: 'title', t: '다윗이 그의 아들 압살롬을 피할 때에 지은 시' }]);
});

test('구간의 절: 개역개정에서 묶인 절(신 6:18-19)은 앞 구간에 든다', { skip }, () => {
  const deu = gae('deu');
  const nums = (list) => list.map((x) => (x.e ? `${x.v}-${x.e}` : `${x.v}`));
  assert.deepEqual(nums(segmentVerses({ b: 'deu', c: 6, from: 16, to: 18 }, deu)), ['16', '17', '18-19']);
  assert.deepEqual(nums(segmentVerses({ b: 'deu', c: 6, from: 19, to: 21 }, deu)), ['20', '21']);
  // 새번역에 없는 절(마 17:21 "(없음)")도 장 안에서는 그대로 보인다
  assert.equal(segmentVerses({ b: 'mat', c: 17, from: 20, to: 22 }, gae('mat')).length, 3);
});

test('개역개정 공유: 개역개정 책 이름과 (개역개정)', { skip }, () => {
  rememberBook(gae('psa'), 'gae');
  rememberBook(gae('mat'), 'gae');
  const psa23 = gae('psa').chapters[22].verses[0];
  assert.equal(
    shareText([{ b: 'psa', c: 23, v: 1, t: psa23.t }], { translation: 'gae' }),
    '여호와는 나의 목자시니 내게 부족함이 없으리로다 - 시편 23:1 (개역개정)',
  );
  assert.match(shareText([{ b: 'mat', c: 5, v: 3, t: '심령이 가난한 자는 복이 있나니' }], { translation: 'gae' }), / - 마태복음 5:3 \(개역개정\)$/);
  // 새번역 공유는 새번역 책 이름 그대로
  assert.match(shareText([{ b: 'mat', c: 5, v: 3, t: '마음이 가난한 사람은 복이 있다' }]), / - 마태복음서 5:3$/);
});
