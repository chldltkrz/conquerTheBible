// 선택한 장들을 한 달의 날 수만큼 연속된 묶음으로 고르게 나눈다.
// DOM에 의존하지 않는 순수 모듈이라 Node 테스트에서도 그대로 불러 쓴다.

/** 묶음이 이 경계에서 시작할 때의 벌점 계수. 하루 목표 분량 T에 대해 벌점 = 2·(x·T)².
 *  두 경계의 x²차이만큼 분량이 어긋나는 것을 감수하고 더 좋은 경계에서 끊는다.
 *  예) 장 경계(0.08)와 아무 절(0.35) 사이: 약 34%까지 분량이 달라져도 장 경계에서 끊는다. */
const BREAK_X = { book: 0, chapter: 0.08, section: 0.25, verse: 0.35 };

/**
 * weights를 순서대로 k개의 비어 있지 않은 연속 구간으로 나눈다.
 * 비용 = Σ(구간 합)² + Σ(구간 시작 위치의 벌점). 합계가 고정이므로 구간 합의 제곱합이
 * 작을수록 각 구간이 평균에 가깝다. 분할 정복 DP 최적화로 O(k·n·log n).
 * (벌점은 시작 위치에만 의존하므로 비용 함수의 사각 부등식이 유지되어 이 최적화가 성립한다.)
 *
 * @param {ArrayLike<number>} weights
 * @param {number} k 1 ≤ k ≤ weights.length
 * @param {ArrayLike<number>} [penalty] penalty[j] = j번째 항목에서 구간을 시작할 때의 벌점
 * @returns {number[]} 각 구간의 시작 인덱스 (길이 k, 오름차순, 첫 값은 0)
 */
export function partition(weights, k, penalty) {
  const n = weights.length;
  if (!(k >= 1 && k <= n)) throw new RangeError(`구간 수 ${k}는 1 이상 ${n} 이하여야 합니다`);

  const P = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) P[i + 1] = P[i] + weights[i];
  const pen = (j) => (penalty && j > 0 ? penalty[j] : 0);

  let prev = new Float64Array(n + 1).fill(Infinity);
  prev[0] = 0;
  const choice = [];

  for (let g = 1; g <= k; g++) {
    const cur = new Float64Array(n + 1).fill(Infinity);
    const arg = new Int32Array(n + 1);
    // cur[i] = 앞의 i개 항목을 g개 구간으로 나누는 최소 비용, arg[i] = 마지막 구간의 시작
    const solve = (lo, hi, optLo, optHi) => {
      if (lo > hi) return;
      const mid = (lo + hi) >> 1;
      let best = Infinity;
      let bestJ = optLo;
      const jHi = Math.min(mid - 1, optHi);
      for (let j = optLo; j <= jHi; j++) {
        const d = P[mid] - P[j];
        const c = prev[j] + d * d + pen(j);
        if (c < best) {
          best = c;
          bestJ = j;
        }
      }
      cur[mid] = best;
      arg[mid] = bestJ;
      solve(lo, mid - 1, optLo, bestJ);
      solve(mid + 1, hi, bestJ, optHi);
    };
    // 남은 k-g개 구간이 각각 최소 1개씩 가져갈 수 있도록 범위를 제한한다.
    solve(g, n - (k - g), g - 1, n - (k - g) - 1);
    choice.push(arg);
    prev = cur;
  }

  const starts = new Array(k);
  for (let g = k, i = n; g >= 1; g--) {
    i = choice[g - 1][i];
    starts[g - 1] = i;
  }
  return starts;
}

/** 장 메타데이터의 절 번호 목록 (빠진 절이 있는 장만 v가 따로 있다) */
export function verseNumbers(ch) {
  return ch.v ?? Array.from({ length: ch.w.length }, (_, i) => i + 1);
}

/**
 * 읽기 계획을 만든다.
 *
 * @param {{books: Array<{code: string, chapters: Array<{w: number[], h: number[], v?: number[]}>}>}} index
 * @param {Array<{b: string, c: number, from?: number, to?: number}>} chapters 선택한 장 (읽을 순서대로).
 *   from/to가 있으면 그 장의 그 절 범위만 (다시 나누기에서 장의 일부가 남았을 때)
 * @param {number} days 그 달의 날 수
 * @param {{splitChapters?: boolean}} [opts] false면 장 중간에서 끊지 않는다
 * @returns {Array<{segments: Array<{b: string, c: number, from?: number, to?: number}>, chars: number}>}
 *   길이 = days. segment에 from/to가 없으면 그 장 전체.
 *   선택한 분량이 날 수보다 적으면 읽기가 없는 날(segments가 빈 배열)이 고르게 섞인다.
 */
export function buildPlan(index, chapters, days, { splitChapters = true } = {}) {
  const books = new Map(index.books.map((b) => [b.code, b]));

  // 나눌 수 있는 최소 단위: 절(기본) 또는 장
  const units = [];
  let prevEnd = null; // 앞 항목의 마지막 절 {b, c, v}
  for (const { b, c, from, to } of chapters) {
    const ch = books.get(b)?.chapters[c - 1];
    if (!ch) throw new Error(`없는 장입니다: ${b} ${c}`);
    const nums = verseNumbers(ch);
    const lo = from ?? nums[0];
    const hi = to ?? nums.at(-1);
    const sections = new Set(ch.h);
    // 앞 항목에 바로 이어지면 장 경계(또는 장 안의 단락·절), 아니면(책이 바뀌거나 건너뛰면) 책 경계처럼 다룬다.
    const continues = prevEnd && followsVerse(books, prevEnd, { b, c, v: lo });
    const firstBreak = !continues ? 'book' : lo === nums[0] ? 'chapter' : sections.has(lo) ? 'section' : 'verse';
    prevEnd = { b, c, v: hi };

    if (!splitChapters) {
      // 장 단위. 이미 일부만 남은 장은 그 범위를 한 단위로 둔다.
      const w = sum(nums.map((v, i) => (v >= lo && v <= hi ? ch.w[i] : 0)));
      const whole = lo === nums[0] && hi === nums.at(-1);
      units.push(whole ? { b, c, w, brk: firstBreak } : { b, c, from: lo, to: hi, w, brk: firstBreak });
      continue;
    }
    nums.forEach((v, i) => {
      if (v < lo || v > hi) return;
      const brk = v === lo ? firstBreak : sections.has(v) ? 'section' : 'verse';
      units.push({ b, c, v, w: ch.w[i], brk });
    });
  }

  const result = Array.from({ length: days }, () => ({ segments: [], chars: 0 }));
  if (units.length === 0 || days <= 0) return result;

  const k = Math.min(days, units.length);
  const total = sum(units.map((u) => u.w));
  const T = total / k;
  const penalty = units.map((u) => 2 * (BREAK_X[u.brk] * T) ** 2);
  const starts = partition(
    units.map((u) => u.w),
    k,
    penalty,
  );

  for (let g = 0; g < k; g++) {
    const group = units.slice(starts[g], g + 1 < k ? starts[g + 1] : units.length);
    // 묶음 수가 날 수보다 적으면 달 전체에 고르게 흩어 놓는다.
    const day = Math.floor((g * days) / k);
    result[day] = { segments: toSegments(group, books), chars: sum(group.map((u) => u.w)) };
  }
  return result;
}

/**
 * 병렬 읽기: 고른 책마다 따로 기간 전체에 나눈다. 날마다 책마다 조금씩 함께 읽게 된다.
 * @returns {Array<{b: string, days: ReturnType<typeof buildPlan>}>} 책 순서는 chapters에 처음 나온 순서
 */
export function buildParallelPlan(index, chapters, days, opts) {
  const byBook = new Map();
  for (const ch of chapters) {
    if (!byBook.has(ch.b)) byBook.set(ch.b, []);
    byBook.get(ch.b).push(ch);
  }
  const books = [...byBook.keys()];
  return buildGroupPlan(index, [...byBook.values()], days, opts).map((days, i) => ({ b: books[i], days }));
}

/**
 * 그룹으로 읽기: 묶음(그룹)마다 그 장들을 이어 붙여 따로 기간 전체에 나눈다.
 * 그룹 안에서는 이어서 읽고, 날마다 그룹마다 조금씩 함께 읽게 된다.
 * @param {Array<Array<{b: string, c: number}>>} groups 그룹마다 읽을 순서대로의 장
 * @returns {Array<ReturnType<typeof buildPlan>>} 그룹마다 날짜별 분량
 */
export function buildGroupPlan(index, groups, days, opts) {
  return groups.map((chapters) => buildPlan(index, chapters, days, opts));
}

/**
 * 밀린 분량 다시 나누기 (묶음 하나).
 * 아직 안 읽은 날의 분량을 모두 모아, 오늘(from)부터 끝까지 안 읽은 날에 기존 알고리즘으로 다시 고르게 나눈다.
 * 읽은 날은 그대로 두고, 오늘 전의 안 읽은 날은 비운다(뒤로 옮겨짐).
 *
 * @param {Array<{segments: Array, chars: number, read: boolean}>} days 그 묶음의 날짜별 분량 (계획 첫날부터)
 * @param {number} from 오늘이 몇 번째 날인지 (0부터)
 * @param {{splitChapters?: boolean}} [opts]
 * @returns {Array<{index: number, segments: Array, chars: number, moved: boolean}> | null}
 *   바뀌는 날만 (moved: 분량을 뒤로 옮겨 비운 지난 날). 다시 나눌 남은 날이 없으면 null
 */
export function rebalanceTrack(index, days, from, opts) {
  const targets = [];
  days.forEach((d, i) => {
    if (i >= from && !d.read) targets.push(i);
  });
  if (!targets.length) return null;

  const books = new Map(index.books.map((b) => [b.code, b]));
  const pool = mergeSegments(
    books,
    days.filter((d) => !d.read).flatMap((d) => d.segments),
  );
  const spread = buildPlan(index, pool, targets.length, opts);

  const changes = [];
  days.forEach((d, i) => {
    if (i < from && !d.read && d.segments.length) changes.push({ index: i, segments: [], chars: 0, moved: true });
  });
  targets.forEach((i, j) => changes.push({ index: i, ...spread[j], moved: false }));
  return changes.sort((a, b) => a.index - b.index);
}

/** y가 x 바로 다음 절인지 (빠진 절은 건너뛴다) */
function followsVerse(books, x, y) {
  if (x.b !== y.b) return false;
  const chapters = books.get(x.b).chapters;
  const xs = verseNumbers(chapters[x.c - 1]);
  if (x.c === y.c) return xs.indexOf(y.v) === xs.indexOf(x.v) + 1;
  return y.c === x.c + 1 && x.v === xs.at(-1) && y.v === verseNumbers(chapters[y.c - 1])[0];
}

/** 같은 장에서 바로 이어지는 구간들을 하나로 합친다. 장 전체가 되면 from/to를 지운다. */
function mergeSegments(books, segments) {
  const out = [];
  for (const s of segments) {
    const nums = verseNumbers(books.get(s.b).chapters[s.c - 1]);
    const lo = s.from ?? nums[0];
    const hi = s.to ?? nums.at(-1);
    const last = out.at(-1);
    if (last && last.b === s.b && last.c === s.c && followsVerse(books, { b: s.b, c: s.c, v: last.to }, { b: s.b, c: s.c, v: lo })) {
      last.to = hi;
    } else {
      out.push({ b: s.b, c: s.c, from: lo, to: hi });
    }
  }
  for (const s of out) {
    const nums = verseNumbers(books.get(s.b).chapters[s.c - 1]);
    if (s.from === nums[0] && s.to === nums.at(-1)) {
      delete s.from;
      delete s.to;
    }
  }
  return out;
}

function toSegments(group, books) {
  const segs = [];
  for (const u of group) {
    const last = segs.at(-1);
    if (last && last.b === u.b && last.c === u.c && u.v != null) {
      last.to = u.v;
    } else if (u.v != null) {
      segs.push({ b: u.b, c: u.c, from: u.v, to: u.v });
    } else {
      // 장 단위(장을 나누지 않는 계획). 일부만 남은 장이면 그 범위
      segs.push(u.from == null ? { b: u.b, c: u.c } : { b: u.b, c: u.c, from: u.from, to: u.to });
    }
  }
  // 한 장을 처음부터 끝까지 다 읽는 구간은 장 전체로 표시한다.
  for (const s of segs) {
    if (s.from == null) continue;
    const nums = verseNumbers(books.get(s.b).chapters[s.c - 1]);
    if (s.from === nums[0] && s.to === nums.at(-1)) {
      delete s.from;
      delete s.to;
    }
  }
  return segs;
}

function sum(arr) {
  let s = 0;
  for (const x of arr) s += x;
  return s;
}
