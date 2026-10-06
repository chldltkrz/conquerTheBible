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
 * @param {Array<{b: string, c: number}>} chapters 선택한 장 (읽을 순서대로)
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
  let prevRef = null;
  for (const { b, c } of chapters) {
    const ch = books.get(b)?.chapters[c - 1];
    if (!ch) throw new Error(`없는 장입니다: ${b} ${c}`);
    // 바로 앞 장과 이어지지 않으면(책이 바뀌거나 장을 건너뛰면) 책 경계처럼 다룬다.
    const continues = prevRef && prevRef.b === b && prevRef.c === c - 1;
    const chapterBreak = continues ? 'chapter' : 'book';
    prevRef = { b, c };

    if (!splitChapters) {
      units.push({ b, c, w: sum(ch.w), brk: chapterBreak });
      continue;
    }
    const nums = verseNumbers(ch);
    const sections = new Set(ch.h);
    nums.forEach((v, i) => {
      const brk = i === 0 ? chapterBreak : sections.has(v) ? 'section' : 'verse';
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
 * 병렬 읽기: 고른 책마다 따로 한 달에 나눈다. 날마다 책마다 조금씩 함께 읽게 된다.
 * @returns {Array<{b: string, days: ReturnType<typeof buildPlan>}>} 책 순서는 chapters에 처음 나온 순서
 */
export function buildParallelPlan(index, chapters, days, opts) {
  const byBook = new Map();
  for (const ch of chapters) {
    if (!byBook.has(ch.b)) byBook.set(ch.b, []);
    byBook.get(ch.b).push(ch);
  }
  return [...byBook].map(([b, list]) => ({ b, days: buildPlan(index, list, days, opts) }));
}

function toSegments(group, books) {
  const segs = [];
  for (const u of group) {
    const last = segs.at(-1);
    if (last && last.b === u.b && last.c === u.c && u.v != null) {
      last.to = u.v;
    } else {
      segs.push(u.v == null ? { b: u.b, c: u.c } : { b: u.b, c: u.c, from: u.v, to: u.v });
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
