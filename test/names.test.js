import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ADJECTIVES, ANIMALS, randomName } from '../app/js/names.js';
import { currentAccount, listAccounts, useMemoryDatabase } from '../app/js/db.js';

const SQL = await createRequire(import.meta.url)('sql.js')();

test('기본 이름 낱말: 형용사·동물 각각 100개 넘게, 겹치지 않고, 이름은 20자 안', () => {
  for (const list of [ADJECTIVES, ANIMALS]) {
    assert.ok(list.length >= 100, `${list.length}개`);
    assert.equal(new Set(list).size, list.length, '겹치는 낱말');
    for (const w of list) assert.match(w, /^[가-힣]+$/, w);
  }
  const longest = Math.max(...ADJECTIVES.map((a) => a.length)) + 1 + Math.max(...ANIMALS.map((n) => n.length));
  assert.ok(longest <= 20, '계정·방 이름은 20자까지');
});

test('randomName: "형용사 동물"이고, 이미 쓰는 이름은 피한다 (거의 다 썼어도 남은 것을 찾는다)', () => {
  const name = randomName();
  const [a, n] = name.split(' ');
  assert.ok(ADJECTIVES.includes(a) && ANIMALS.includes(n), name);
  // 늘 같은 수를 내는 random이면 첫 이름이 정해진다. 그 이름을 쓰고 있으면 다른 이름
  const first = randomName([], () => 0);
  assert.equal(first, `${ADJECTIVES[0]} ${ANIMALS[0]}`);
  assert.notEqual(randomName([first], () => 0), first);
  const all = ADJECTIVES.flatMap((x) => ANIMALS.map((y) => `${x} ${y}`));
  const left = all[1234];
  assert.equal(randomName(all.filter((x) => x !== left)), left);
});

test('처음 만드는 데이터베이스의 기본 계정은 "나" 대신 형용사 + 동물 이름', () => {
  useMemoryDatabase(new SQL.Database());
  const [acc] = listAccounts();
  assert.equal(listAccounts().length, 1);
  assert.notEqual(acc.name, '나');
  const [a, n] = acc.name.split(' ');
  assert.ok(ADJECTIVES.includes(a) && ANIMALS.includes(n), acc.name);
  assert.equal(currentAccount().name, acc.name);
});
