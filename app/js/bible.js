// 새번역 데이터 불러오기와 성경 구절 표기

import { verseNumbers } from './planner.js';

/** 공백을 뺀 글자 수 기준, 1분에 읽는 양 (소리 내지 않고 차분히 읽는 속도) */
const CHARS_PER_MINUTE = 500;

let index = null;
let byCode = new Map();
const bookCache = new Map();

export async function loadIndex() {
  const res = await fetch('data/index.json');
  if (!res.ok) throw new Error(`성경 데이터(index.json)를 불러오지 못했습니다 (${res.status})`);
  index = await res.json();
  byCode = new Map(index.books.map((b, i) => [b.code, { ...b, order: i }]));
  return index;
}

export const getIndex = () => index;
export const allBooks = () => [...byCode.values()];
export const book = (code) => byCode.get(code);

/** 책 한 권의 본문. 서비스 워커가 캐시하므로 한 번 읽은 책은 오프라인에서도 열린다. */
export function loadBook(code) {
  if (!bookCache.has(code)) {
    const p = fetch(`data/books/${code}.json`).then((res) => {
      if (!res.ok) throw new Error(`${book(code)?.name ?? code} 본문을 불러오지 못했습니다`);
      return res.json();
    });
    p.catch(() => bookCache.delete(code));
    bookCache.set(code, p);
  }
  return bookCache.get(code);
}

export const chapterUnit = (code) => (code === 'psa' ? '편' : '장');

export const readingMinutes = (chars) => Math.max(1, Math.round(chars / CHARS_PER_MINUTE));

export function chapterChars(code, c) {
  return book(code).chapters[c - 1].w.reduce((a, b) => a + b, 0);
}

// ── 선택 범위 ───────────────────────────────────────────────

export const PRESETS = [
  { name: '성경 전체', from: 'gen', to: 'rev' },
  { name: '구약', from: 'gen', to: 'mal' },
  { name: '신약', from: 'mat', to: 'rev' },
  { name: '모세오경', from: 'gen', to: 'deu' },
  { name: '역사서', from: 'jos', to: 'est' },
  { name: '시가서', from: 'job', to: 'sng' },
  { name: '예언서', from: 'isa', to: 'mal' },
  { name: '복음서', from: 'mat', to: 'jhn' },
  { name: '바울서신', from: 'rom', to: 'phm' },
  { name: '일반서신', from: 'heb', to: 'jud' },
  { name: '시편', from: 'psa', to: 'psa' },
  { name: '잠언', from: 'pro', to: 'pro' },
];

export function presetBooks(preset) {
  const books = allBooks();
  return books.slice(book(preset.from).order, book(preset.to).order + 1);
}

/** 선택 {code: [장...]} → 성경 순서대로 [{b, c}] */
export function selectionToChapters(selection) {
  return allBooks().flatMap((b) =>
    [...new Set(selection[b.code] ?? [])].sort((x, y) => x - y).map((c) => ({ b: b.code, c })),
  );
}

/** [1,2,3,5,7,8] → "1–3, 5, 7–8" */
export function compactNumbers(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return parts.join(', ');
}

/** 계획 이름으로 쓸 선택 범위 요약: "신약", "창세기–신명기", "시편 1–50편", "로마서 외 3권" */
export function describeSelection(selection) {
  const books = allBooks().filter((b) => selection[b.code]?.length);
  if (books.length === 0) return '';
  const isFull = (b) => new Set(selection[b.code]).size === b.chapters.length;

  for (const p of PRESETS) {
    const pb = presetBooks(p);
    if (pb.length === books.length && pb.every((b, i) => b.code === books[i].code) && books.every(isFull)) {
      return p.name;
    }
  }
  const first = books[0];
  const last = books.at(-1);
  if (books.length > 1 && books.every(isFull) && last.order - first.order === books.length - 1) {
    return `${first.name}–${last.name}`;
  }
  if (books.length <= 2) {
    return books
      .map((b) => (isFull(b) ? b.name : `${b.name} ${compactNumbers(selection[b.code])}${chapterUnit(b.code)}`))
      .join(' · ');
  }
  return `${first.name} 외 ${books.length - 1}권`;
}

// ── 구절 표기 ───────────────────────────────────────────────

/**
 * 하루 분량 표기. segments = [{b, c, from?, to?}] (from/to가 없으면 장 전체)
 *   [{b:'gen',c:1},{b:'gen',c:2}]                → "창세기 1–2장"
 *   [{b:'psa',c:119,from:1,to:48}]               → "시편 119:1–48"
 *   [{b:'rut',c:1,from:19,to:22},{b:'rut',c:2,from:1,to:3}] → "룻기 1:19–2:3"
 * short: true → "창 1–2", "시 119:1–48"
 */
export function formatSegments(segments, { short = false } = {}) {
  const ranges = [];
  for (const s of segments) {
    const ch = book(s.b).chapters[s.c - 1];
    const nums = verseNumbers(ch);
    const sv = s.from == null || s.from === nums[0] ? null : s.from;
    const ev = s.to == null || s.to === nums.at(-1) ? null : s.to;
    const r = ranges.at(-1);
    if (r && r.b === s.b && r.ec + 1 === s.c && r.ev == null && sv == null) {
      r.ec = s.c;
      r.ev = ev;
    } else {
      ranges.push({ b: s.b, sc: s.c, sv, ec: s.c, ev });
    }
  }

  const groups = [];
  for (const r of ranges) {
    const text = formatRange(r, short);
    const g = groups.at(-1);
    if (g && g.b === r.b) g.parts.push(text);
    else groups.push({ b: r.b, parts: [text] });
  }
  return groups
    .map((g) => `${short ? book(g.b).short : book(g.b).name} ${g.parts.join(', ')}`)
    .join(short ? ' · ' : ', ');
}

function formatRange({ b, sc, sv, ec, ev }, short) {
  const unit = short ? '' : chapterUnit(b);
  if (sv == null && ev == null) return sc === ec ? `${sc}${unit}` : `${sc}–${ec}${unit}`;
  const startCh = book(b).chapters[sc - 1];
  const endCh = book(b).chapters[ec - 1];
  const startV = sv ?? verseNumbers(startCh)[0];
  const lastV = ev ?? verseNumbers(endCh).at(-1);
  const endV = endCh.e?.[lastV] ?? lastV; // 묶인 절(예: 30-32)이면 끝 번호까지
  if (sc === ec) return startV === endV ? `${sc}:${startV}` : `${sc}:${startV}–${endV}`;
  return `${sc}:${startV}–${ec}:${endV}`;
}
