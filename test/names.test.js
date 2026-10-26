import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ADJECTIVES, ANIMALS, randomName, seededRandom } from '../app/js/names.js';
import { currentAccount, listAccounts, migrate, useMemoryDatabase } from '../app/js/db.js';

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

const isDefaultName = (name) => {
  const [a, n] = name.split(' ');
  return ADJECTIVES.includes(a) && ANIMALS.includes(n);
};

test('seededRandom: seed가 같으면 같은 차례, 다르면 다른 차례 (0 이상 1 미만)', () => {
  const take = (r) => Array.from({ length: 5 }, r);
  const id = 2 ** 40 + 12345;
  assert.deepEqual(take(seededRandom(id)), take(seededRandom(id)));
  assert.notDeepEqual(take(seededRandom(id)), take(seededRandom(id + 1)));
  for (const x of take(seededRandom(id))) assert.ok(x >= 0 && x < 1, String(x));
});

test('아직 예전 기본 이름 "나"인 계정은 열 때 이름이 붙고, 동기화하는 계정은 기기마다 같은 이름', () => {
  const big = 2 ** 40 + 777; // 동기화하는 계정의 번호 (무작위 큰 수)
  const openOld = () => {
    const db = new SQL.Database();
    migrate(db);
    db.run("UPDATE accounts SET name = '나', id = ?", [big]);
    db.run("INSERT INTO accounts (id, name, color, created_at) VALUES (5, '엄마', '#2f6a55', '2026-10-01 00:00:00')");
    return db;
  };
  const a = openOld();
  const b = openOld();
  assert.equal(migrate(a), true, '이름을 붙였으면 저장한다');
  assert.equal(migrate(b), true);
  const name = (db) => db.exec(`SELECT name FROM accounts WHERE id = ${big}`)[0].values[0][0];
  assert.ok(isDefaultName(name(a)), name(a));
  assert.equal(name(a), name(b), '같은 계정을 가진 두 기기가 따로 붙여도 같은 이름');
  assert.equal(a.exec('SELECT name FROM accounts WHERE id = 5')[0].values[0][0], '엄마', '지은 이름은 그대로');
  assert.equal(migrate(a), false, '한 번만');
});
