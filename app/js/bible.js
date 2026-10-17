// 성경 데이터(새번역, BSB) 불러오기와 성경 구절 표기

import { verseNumbers } from './planner.js';

/** 공백을 뺀 글자 수 기준, 1분에 읽는 양 (소리 내지 않고 차분히 읽는 속도) */
const CHARS_PER_MINUTE = 500;

let index = null;
let byCode = new Map();
const bookCache = new Map();

export async function loadIndex() {
  const res = await fetch('data/index.json');
  if (!res.ok) throw new Error(`성경 데이터(index.json)를 불러오지 못했습니다 (${res.status})`);
  return useIndex(await res.json());
}

/** 불러온 index.json을 쓴다. (테스트에서는 파일을 직접 읽어 넘긴다) */
export function useIndex(data) {
  index = data;
  byCode = new Map(index.books.map((b, i) => [b.code, { ...b, order: i }]));
  return index;
}

export const getIndex = () => index;
export const allBooks = () => [...byCode.values()];
export const book = (code) => byCode.get(code);

/**
 * 역본. 계획의 분량과 절 번호는 새번역을 기준으로 하고, 다른 역본은 같은 장·절을 보여 준다.
 * BSB(Berean Standard Bible)는 퍼블릭 도메인이다 (scripts/bsb.mjs로 만든다).
 */
export const TRANSLATIONS = {
  saenew: { id: 'saenew', name: '새번역', lang: 'ko-KR', dir: 'data/books' },
  bsb: { id: 'bsb', name: 'BSB', full: 'Berean Standard Bible', lang: 'en-US', dir: 'data/bsb/books' },
};

const englishNames = new Map(); // BSB 책 코드 → 영어 이름 (불러온 책만)

/** 책 한 권의 본문. 서비스 워커가 캐시하므로 한 번 읽은 책은 오프라인에서도 열린다. */
export function loadBook(code, translation = 'saenew') {
  const key = `${translation}:${code}`;
  if (!bookCache.has(key)) {
    const tr = TRANSLATIONS[translation];
    const p = fetch(bookUrl(code, translation))
      .then((res) => {
        if (!res.ok) throw new Error(`${book(code)?.name ?? code} ${translation === 'saenew' ? '' : `${tr.name} `}본문을 불러오지 못했습니다`);
        return res.json();
      })
      .then((data) => rememberBook(data, translation));
    p.catch(() => bookCache.delete(key));
    bookCache.set(key, p);
  }
  return bookCache.get(key);
}

/** 불러온 책의 이름을 기억해 둔다 (공유할 때 BSB 영어 이름). 테스트에서는 파일을 직접 읽어 넘긴다. */
export function rememberBook(data, translation = 'saenew') {
  if (translation === 'bsb') englishNames.set(data.code, data.name);
  return data;
}

/** 책 본문 파일 주소 (앱 기준 상대 경로) */
export const bookUrl = (code, translation = 'saenew') => `${TRANSLATIONS[translation].dir}/${code}.json`;

/** 역본에 맞는 책 이름. BSB면 영어 이름(불러온 책만, 아니면 새번역 이름) */
export const bookName = (code, translation = 'saenew') =>
  (translation === 'bsb' && englishNames.get(code)) || book(code).name;

/**
 * 구간 {b, c, from?, to?}(새번역 절 번호)에 드는 절들. 다른 역본은 절 번호가 조금 다른 장이 있어
 * (예: 고린도후서 13장은 BSB가 14절까지) 구간이 새번역 장의 첫 절·마지막 절에서 끝나면 그 장 처음·끝까지 담는다.
 */
export function segmentVerses(seg, bookData) {
  const ch = bookData.chapters[seg.c - 1];
  if (!ch) return [];
  if (seg.from == null) return ch.verses;
  const nums = verseNumbers(book(seg.b).chapters[seg.c - 1]);
  const lo = seg.from === nums[0] ? -Infinity : seg.from;
  const hi = seg.to === nums.at(-1) ? Infinity : seg.to;
  return ch.verses.filter((v) => v.v >= lo && v.v <= hi);
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

// ── 공유 ───────────────────────────────────────────────────

/** x가 p 바로 다음 절인지 (빠진 절·묶인 절은 성경 데이터의 절 목록을 따른다) */
function follows(p, x) {
  if (p.b !== x.b) return false;
  const chapters = book(p.b).chapters;
  const pNums = verseNumbers(chapters[p.c - 1]);
  if (p.c === x.c) return pNums.indexOf(x.v) === pNums.indexOf(p.v) + 1;
  return x.c === p.c + 1 && p.v === pNums.at(-1) && x.v === verseNumbers(chapters[x.c - 1])[0];
}

/**
 * 공유할 문구 "말씀 - 책 장:절". 여러 절이면 본문을 이어 붙이고 절 범위로 적는다.
 * 떨어진 절 사이의 본문은 " … "로 잇는다.
 *   시 23:1           → "주님은 나의 목자시니, 내게 부족함 없어라. - 시편 23:1"
 *   마 5:3, 5:4, 5:9  → "… … … … - 마태복음서 5:3-4, 9"
 *   시 23:1, 요 3:16  → "… … … - 시편 23:1; 요한복음서 3:16"
 * BSB 본문이면 책 이름을 영어로 쓰고 끝에 " (BSB)"를 붙인다: "The LORD is my shepherd; … - Psalm 23:1 (BSB)"
 * @param {Array<{b, c, v, e?, t}>} verses 순서는 상관없다 (성경 순서로 정렬한다)
 * @param {{translation?: 'saenew'|'bsb'}} [opts]
 */
export function shareText(verses, { translation = 'saenew' } = {}) {
  const { text, ref } = shareParts(verses, { translation });
  return `${text} - ${ref}${translation === 'saenew' ? '' : ` (${TRANSLATIONS[translation].name})`}`;
}

/** shareText의 두 부분 {text: 말씀, ref: "시편 23:1"} (말씀 카드는 둘을 따로 그린다) */
export function shareParts(verses, { translation = 'saenew' } = {}) {
  const sorted = [...verses].sort((x, y) => book(x.b).order - book(y.b).order || x.c - y.c || x.v - y.v);
  const runs = [];
  for (const x of sorted) {
    const run = runs.at(-1);
    if (run && follows(run.at(-1), x)) run.push(x);
    else runs.push([x]);
  }

  let ref = '';
  let last = null; // 앞 묶음의 마지막 절
  for (const run of runs) {
    const a = run[0];
    const z = run.at(-1);
    const end = z.e ?? z.v; // 묶인 절(30-32)이면 끝 번호까지
    const sameBook = last?.b === a.b;
    const sameChapter = sameBook && last.c === a.c;
    const start = sameChapter ? `${a.v}` : `${a.c}:${a.v}`;
    const tail = a.c !== z.c ? `-${z.c}:${end}` : end !== a.v ? `-${end}` : '';
    ref += (last ? (sameChapter ? ', ' : '; ') : '') + (sameBook ? '' : `${bookName(a.b, translation)} `) + start + tail;
    last = z;
  }
  return { text: runs.map((run) => run.map((x) => x.t).join(' ')).join(' … '), ref };
}
