import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { partition, buildPlan, buildParallelPlan, buildGroupPlan, verseNumbers } from '../app/js/planner.js';

// 모든 분할을 시도하는 O(n²k) 기준 구현
function bruteCost(w, k, pen = []) {
  const n = w.length;
  const P = [0];
  for (const x of w) P.push(P.at(-1) + x);
  let prev = Array(n + 1).fill(Infinity);
  prev[0] = 0;
  for (let g = 1; g <= k; g++) {
    const cur = Array(n + 1).fill(Infinity);
    for (let i = g; i <= n; i++) {
      for (let j = g - 1; j < i; j++) {
        cur[i] = Math.min(cur[i], prev[j] + (P[i] - P[j]) ** 2 + (j > 0 ? pen[j] ?? 0 : 0));
      }
    }
    prev = cur;
  }
  return prev[n];
}

function costOf(w, starts, pen = []) {
  let c = 0;
  starts.forEach((s, g) => {
    const e = g + 1 < starts.length ? starts[g + 1] : w.length;
    let sum = 0;
    for (let i = s; i < e; i++) sum += w[i];
    c += sum ** 2 + (s > 0 ? pen[s] ?? 0 : 0);
  });
  return c;
}

function rng(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

test('partition은 완전 탐색과 같은 최소 비용을 찾는다', () => {
  const rand = rng(42);
  for (let trial = 0; trial < 300; trial++) {
    const n = 1 + Math.floor(rand() * 40);
    const k = 1 + Math.floor(rand() * n);
    const w = Array.from({ length: n }, () => 1 + Math.floor(rand() * 100));
    const pen = trial % 2 ? Array.from({ length: n }, () => Math.floor(rand() * 3000)) : undefined;
    const starts = partition(w, k, pen);
    assert.equal(starts.length, k);
    assert.equal(starts[0], 0);
    for (let g = 1; g < k; g++) assert.ok(starts[g] > starts[g - 1], '구간은 비어 있지 않아야 한다');
    const got = costOf(w, starts, pen);
    const want = bruteCost(w, k, pen);
    assert.ok(Math.abs(got - want) < 1e-6, `n=${n} k=${k}: ${got} != ${want}`);
  }
});

test('partition은 잘못된 구간 수를 거부한다', () => {
  assert.throws(() => partition([1, 2], 3), RangeError);
  assert.throws(() => partition([1, 2], 0), RangeError);
});

// ── buildPlan ────────────────────────────────────────────────

// 장마다 절 수만 다른 가상의 성경. 절마다 글자 수는 30~60.
function fakeIndex(spec) {
  const rand = rng(7);
  return {
    books: Object.entries(spec).map(([code, verseCounts]) => ({
      code,
      chapters: verseCounts.map((n) => ({
        w: Array.from({ length: n }, () => 30 + Math.floor(rand() * 30)),
        h: n > 10 ? [Math.ceil(n / 2)] : [],
      })),
    })),
  };
}

const chaptersOf = (index, code, from = 1, to = Infinity) =>
  index.books
    .find((b) => b.code === code)
    .chapters.map((_, i) => ({ b: code, c: i + 1 }))
    .filter((x) => x.c >= from && x.c <= to);

/** 계획을 절 목록으로 펼친다: ["gen 1:1", ...] */
function flatten(index, plan) {
  const books = new Map(index.books.map((b) => [b.code, b]));
  const out = [];
  for (const day of plan) {
    for (const s of day.segments) {
      const nums = verseNumbers(books.get(s.b).chapters[s.c - 1]);
      for (const v of nums) {
        if (s.from == null || (v >= s.from && v <= s.to)) out.push(`${s.b} ${s.c}:${v}`);
      }
    }
  }
  return out;
}

function expected(index, chapters) {
  const books = new Map(index.books.map((b) => [b.code, b]));
  return chapters.flatMap(({ b, c }) => verseNumbers(books.get(b).chapters[c - 1]).map((v) => `${b} ${c}:${v}`));
}

test('장이 많으면 날마다 고르게, 장 경계에서 나눈다', () => {
  const index = fakeIndex({ aaa: Array.from({ length: 120 }, (_, i) => 10 + ((i * 7) % 25)) });
  const chapters = chaptersOf(index, 'aaa');
  const plan = buildPlan(index, chapters, 31);

  assert.equal(plan.length, 31);
  assert.deepEqual(flatten(index, plan), expected(index, chapters), '빠짐도 중복도 없이 순서대로');
  for (const day of plan) {
    assert.ok(day.segments.length > 0);
    for (const s of day.segments) assert.equal(s.from, undefined, `장 중간에서 끊김: ${JSON.stringify(s)}`);
  }
  const chars = plan.map((d) => d.chars);
  assert.ok(Math.max(...chars) / Math.min(...chars) < 1.6, `분량 차이가 큼: ${chars}`);
});

test('장이 날 수보다 적으면 절 단위로 나누어 모든 날을 채운다', () => {
  const index = fakeIndex({ rut: [22, 23, 18, 22] });
  const chapters = chaptersOf(index, 'rut');
  const plan = buildPlan(index, chapters, 30);

  assert.deepEqual(flatten(index, plan), expected(index, chapters));
  assert.ok(plan.every((d) => d.segments.length > 0));
  const chars = plan.map((d) => d.chars);
  assert.ok(Math.max(...chars) / Math.min(...chars) < 2.5, `분량 차이가 큼: ${chars}`);
});

test('splitChapters=false면 장을 쪼개지 않고 읽는 날을 달 전체에 흩어 놓는다', () => {
  const index = fakeIndex({ rut: [22, 23, 18, 22] });
  const plan = buildPlan(index, chaptersOf(index, 'rut'), 30, { splitChapters: false });

  const days = plan.map((d, i) => (d.segments.length ? i + 1 : null)).filter(Boolean);
  assert.deepEqual(days, [1, 8, 16, 23]);
  assert.deepEqual(plan[7].segments, [{ b: 'rut', c: 2 }]);
});

test('절 수가 날 수보다 적어도 동작한다', () => {
  const index = fakeIndex({ oba: [21] });
  const plan = buildPlan(index, chaptersOf(index, 'oba'), 31);
  assert.equal(plan.filter((d) => d.segments.length).length, 21);
  assert.deepEqual(flatten(index, plan), expected(index, chaptersOf(index, 'oba')));
});

test('이어지지 않는 장 선택과 빠진 절을 처리한다', () => {
  const index = fakeIndex({ aaa: [10, 10, 10, 10, 10], bbb: [12, 12] });
  // 2장에는 7절이 없다 (사본 문제로 빠진 절)
  const ch2 = index.books[0].chapters[1];
  ch2.v = [1, 2, 3, 4, 5, 6, 8, 9, 10];
  ch2.w = ch2.w.slice(0, 9);
  const chapters = [...chaptersOf(index, 'aaa', 1, 2), ...chaptersOf(index, 'aaa', 5, 5), ...chaptersOf(index, 'bbb')];
  const plan = buildPlan(index, chapters, 5);
  assert.deepEqual(flatten(index, plan), expected(index, chapters));
  assert.ok(!flatten(index, plan).includes('aaa 2:7'));
});

test('병렬 읽기는 책마다 따로 한 달 전체에 나눈다', () => {
  const index = fakeIndex({
    gen: Array.from({ length: 50 }, (_, i) => 20 + (i % 15)),
    exo: Array.from({ length: 40 }, (_, i) => 25 + (i % 10)),
    lev: Array.from({ length: 27 }, (_, i) => 30 + (i % 8)),
  });
  const chapters = [...chaptersOf(index, 'gen'), ...chaptersOf(index, 'exo'), ...chaptersOf(index, 'lev')];
  const tracks = buildParallelPlan(index, chapters, 31);

  assert.deepEqual(
    tracks.map((t) => t.b),
    ['gen', 'exo', 'lev'],
  );
  for (const t of tracks) {
    const own = chapters.filter((x) => x.b === t.b);
    assert.equal(t.days.length, 31);
    assert.deepEqual(flatten(index, t.days), expected(index, own), `${t.b}: 빠짐없이 순서대로`);
    assert.ok(t.days.every((d) => d.segments.length && d.segments.every((s) => s.b === t.b)), `${t.b}: 날마다 자기 책만`);
  }
  // 이어서 읽기와 달리 1일에 세 책을 모두 읽는다
  assert.deepEqual(
    tracks.map((t) => t.days[0].segments[0].c),
    [1, 1, 1],
  );
});

test('그룹으로 읽기는 그룹마다 여러 책을 이어 붙여 따로 기간 전체에 나눈다', () => {
  const index = fakeIndex({
    psa: Array.from({ length: 150 }, (_, i) => 6 + (i % 12)),
    isa: Array.from({ length: 66 }, (_, i) => 15 + (i % 10)),
    jer: Array.from({ length: 52 }, (_, i) => 20 + (i % 9)),
    mat: Array.from({ length: 28 }, (_, i) => 25 + (i % 10)),
    mrk: Array.from({ length: 16 }, (_, i) => 30 + (i % 10)),
  });
  const groups = [
    chaptersOf(index, 'psa'),
    [...chaptersOf(index, 'mat'), ...chaptersOf(index, 'mrk')],
    [...chaptersOf(index, 'isa'), ...chaptersOf(index, 'jer')],
  ];
  const tracks = buildGroupPlan(index, groups, 40);

  assert.equal(tracks.length, 3);
  tracks.forEach((days, g) => {
    assert.equal(days.length, 40);
    assert.deepEqual(flatten(index, days), expected(index, groups[g]), `그룹 ${g + 1}: 빠짐없이 순서대로`);
    const own = new Set(groups[g].map((x) => x.b));
    assert.ok(days.every((d) => d.segments.length && d.segments.every((s) => own.has(s.b))), `그룹 ${g + 1}: 날마다 자기 책만`);
    const chars = days.map((d) => d.chars);
    const avg = chars.reduce((a, b) => a + b) / chars.length;
    for (const c of chars) assert.ok(Math.abs(c - avg) / avg < 0.35, `그룹 ${g + 1}: 평균 ${avg}에서 너무 벗어남: ${c}`);
  });
  // 그룹 안에서는 이어 읽는다: 마태복음을 다 읽은 뒤 마가복음으로
  const gospels = tracks[1].flatMap((d) => d.segments.map((s) => s.b));
  assert.equal(gospels.lastIndexOf('mat') < gospels.indexOf('mrk'), true);
  // 날마다 세 그룹을 모두 조금씩 읽는다
  assert.deepEqual(
    tracks.map((days) => days[0].segments[0].b),
    ['psa', 'mat', 'isa'],
  );
});

test('선택이 비어 있으면 빈 날만 돌려준다', () => {
  const plan = buildPlan(fakeIndex({ aaa: [5] }), [], 30);
  assert.equal(plan.length, 30);
  assert.ok(plan.every((d) => d.segments.length === 0 && d.chars === 0));
});

// ── 실제 새번역 데이터 (npm run crawl 이후에만) ────────────────
const INDEX_PATH = new URL('../app/data/index.json', import.meta.url);
const realIndex = fs.existsSync(INDEX_PATH) ? JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) : null;

test('새번역 전체를 31일로 나누기', { skip: !realIndex && 'app/data/index.json 없음' }, () => {
  const chapters = realIndex.books.flatMap((b) => b.chapters.map((_, i) => ({ b: b.code, c: i + 1 })));
  const t0 = performance.now();
  const plan = buildPlan(realIndex, chapters, 31);
  const ms = performance.now() - t0;

  assert.deepEqual(flatten(realIndex, plan), expected(realIndex, chapters));
  const chars = plan.map((d) => d.chars);
  const avg = chars.reduce((a, b) => a + b) / chars.length;
  // 책 경계에서 끊는 것을 조금 선호하므로 평균에서 약간 벗어날 수 있다.
  for (const c of chars) assert.ok(Math.abs(c - avg) / avg < 0.15, `평균 ${avg}에서 15% 넘게 벗어남: ${c}`);
  assert.ok(ms < 2000, `너무 느림: ${ms}ms`);
});

test('새번역 전체를 1년(366일)으로 나누기', { skip: !realIndex && 'app/data/index.json 없음' }, () => {
  const chapters = realIndex.books.flatMap((b) => b.chapters.map((_, i) => ({ b: b.code, c: i + 1 })));
  const t0 = performance.now();
  const plan = buildPlan(realIndex, chapters, 366);
  const ms = performance.now() - t0;

  assert.equal(plan.length, 366);
  assert.deepEqual(flatten(realIndex, plan), expected(realIndex, chapters));
  assert.ok(plan.every((d) => d.segments.length), '쉬는 날 없이 모든 날에 분량이 있다');
  const chars = plan.map((d) => d.chars);
  const avg = chars.reduce((a, b) => a + b) / chars.length;
  for (const c of chars) assert.ok(Math.abs(c - avg) / avg < 0.4, `평균 ${avg}에서 40% 넘게 벗어남: ${c}`);
  assert.ok(ms < 5000, `너무 느림: ${ms}ms`);
});

test('시편 119편이 들어 있으면 그 장은 여러 날로 나뉜다', { skip: !realIndex && 'app/data/index.json 없음' }, () => {
  const chapters = Array.from({ length: 31 }, (_, i) => ({ b: 'psa', c: 100 + i }));
  const plan = buildPlan(realIndex, chapters, 31);
  assert.deepEqual(flatten(realIndex, plan), expected(realIndex, chapters));
  const days119 = plan.filter((d) => d.segments.some((s) => s.c === 119));
  assert.ok(days119.length >= 4, `119편이 ${days119.length}일에만 배정됨`);
});
