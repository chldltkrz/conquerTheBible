// 오늘의 말씀(읽기 계획이 없는 날)과 올해의 말씀에 쓰는 구절

import { book, loadBook } from './bible.js';
import { daysBetween } from './dates.js';

/**
 * 날마다 돌아가며 보여 줄 말씀 [책, 장, 절, 끝 절?]. 짧고 널리 사랑받는 구절로 골랐다.
 * (test/verses.test.js가 모두 새번역 본문에 있는 절인지 확인한다)
 */
export const DAILY_VERSES = [
  ['gen', 1, 1], ['gen', 12, 2], ['gen', 28, 15], ['exo', 14, 14], ['exo', 15, 2], ['num', 6, 24, 26],
  ['deu', 6, 5], ['deu', 31, 6], ['deu', 31, 8], ['jos', 1, 9], ['1sa', 16, 7], ['2sa', 22, 31],
  ['1ch', 16, 34], ['2ch', 7, 14], ['neh', 8, 10], ['job', 23, 10],
  ['psa', 4, 8], ['psa', 16, 8], ['psa', 18, 1, 2], ['psa', 19, 14], ['psa', 23, 1], ['psa', 23, 4],
  ['psa', 27, 1], ['psa', 30, 5], ['psa', 32, 8], ['psa', 34, 8], ['psa', 37, 4], ['psa', 37, 5],
  ['psa', 46, 1], ['psa', 46, 10], ['psa', 51, 10], ['psa', 55, 22], ['psa', 62, 1], ['psa', 73, 26],
  ['psa', 84, 10], ['psa', 90, 12], ['psa', 91, 1, 2], ['psa', 100, 4], ['psa', 103, 2], ['psa', 118, 24],
  ['psa', 119, 105], ['psa', 121, 1, 2], ['psa', 126, 5], ['psa', 127, 1], ['psa', 139, 23, 24], ['psa', 145, 18],
  ['psa', 147, 3], ['pro', 3, 5, 6], ['pro', 4, 23], ['pro', 16, 3], ['pro', 16, 9], ['pro', 18, 10],
  ['ecc', 3, 1], ['isa', 9, 6], ['isa', 26, 3], ['isa', 30, 15], ['isa', 40, 8], ['isa', 40, 31],
  ['isa', 41, 10], ['isa', 43, 1], ['isa', 43, 19], ['isa', 53, 5], ['isa', 55, 8, 9], ['isa', 58, 11],
  ['isa', 60, 1], ['jer', 17, 7], ['jer', 29, 11], ['jer', 31, 3], ['jer', 33, 3], ['lam', 3, 22, 23],
  ['ezk', 36, 26], ['hos', 6, 3], ['mic', 6, 8], ['hab', 3, 17, 18], ['zep', 3, 17], ['zec', 4, 6],
  ['mat', 4, 4], ['mat', 5, 9], ['mat', 5, 14], ['mat', 5, 16], ['mat', 6, 33], ['mat', 6, 34],
  ['mat', 7, 7], ['mat', 11, 28], ['mat', 16, 24], ['mat', 22, 37, 38], ['mat', 28, 20], ['mrk', 9, 23],
  ['mrk', 10, 45], ['luk', 1, 37], ['luk', 6, 31], ['jhn', 1, 1], ['jhn', 1, 12], ['jhn', 3, 16],
  ['jhn', 8, 32], ['jhn', 10, 10], ['jhn', 11, 25], ['jhn', 13, 34], ['jhn', 14, 1], ['jhn', 14, 6],
  ['jhn', 14, 27], ['jhn', 15, 5], ['jhn', 15, 13], ['jhn', 16, 33], ['act', 1, 8], ['act', 16, 31],
  ['rom', 1, 16], ['rom', 5, 8], ['rom', 8, 1], ['rom', 8, 18], ['rom', 8, 28], ['rom', 8, 38, 39],
  ['rom', 10, 17], ['rom', 12, 2], ['rom', 12, 12], ['rom', 15, 13], ['1co', 10, 13], ['1co', 13, 4],
  ['1co', 13, 13], ['1co', 15, 58], ['1co', 16, 14], ['2co', 4, 16], ['2co', 4, 18], ['2co', 5, 7],
  ['2co', 5, 17], ['2co', 12, 9], ['gal', 2, 20], ['gal', 5, 22, 23], ['gal', 6, 9], ['eph', 2, 8],
  ['eph', 2, 10], ['eph', 3, 20], ['eph', 4, 32], ['eph', 6, 10], ['php', 1, 6], ['php', 3, 13, 14],
  ['php', 4, 4], ['php', 4, 6, 7], ['php', 4, 13], ['php', 4, 19], ['col', 3, 2], ['col', 3, 15],
  ['col', 3, 23], ['1th', 5, 16, 18], ['2ti', 1, 7], ['2ti', 3, 16], ['heb', 4, 16], ['heb', 10, 23],
  ['heb', 11, 1], ['heb', 12, 2], ['heb', 13, 8], ['jas', 1, 2, 3], ['jas', 1, 5], ['jas', 4, 8],
  ['1pe', 2, 9], ['1pe', 5, 7], ['1jn', 1, 9], ['1jn', 4, 7], ['1jn', 4, 18], ['1jn', 4, 19],
  ['rev', 3, 20], ['rev', 21, 4],
].map(([b, c, v, to]) => ({ b, c, v, to: to ?? v }));

/** 올해의 말씀을 정할 때 먼저 보여 주는 구절 */
export const YEAR_SUGGESTIONS = [
  ['isa', 43, 19], ['jer', 29, 11], ['pro', 16, 9], ['php', 4, 13], ['jos', 1, 9], ['isa', 40, 31], ['rom', 8, 28], ['psa', 23, 1],
].map(([b, c, v, to]) => ({ b, c, v, to: to ?? v }));

/** 그날의 말씀. 1년 중 몇째 날인지로 고르고, 해마다 시작 위치를 옮겨 같은 날짜에 같은 말씀만 나오지 않게 한다. */
export function dailyVerseRef(date) {
  const day = daysBetween({ y: date.y, m: 1, d: 1 }, date);
  return DAILY_VERSES[(day + date.y * 37) % DAILY_VERSES.length];
}

/** "시편 23:1", "빌립보서 4:6-7" */
export const passageRef = ({ b, c, v, to }) => `${book(b).name} ${c}:${v}${to && to !== v ? `-${to}` : ''}`;

/**
 * 카드에 보여 줄 본문. 인용이 앞 절에서 시작하거나 뒤 절에서 끝나 따옴표가 짝이 안 맞으면
 * 맨 앞(또는 맨 뒤)의 남는 따옴표를 뺀다. 예) 마 11:28 "수고하며 … 쉬게 하겠다. → 수고하며 … 쉬게 하겠다.
 */
export function passageText(verses) {
  let text = verses.map((x) => x.t).join(' ');
  for (const q of ['"', "'"]) {
    if (text.split(q).length % 2 === 1) continue; // 짝이 맞는다
    if (text.startsWith(q)) text = text.slice(1);
    else if (text.endsWith(q)) text = text.slice(0, -1);
  }
  return text.trim();
}

/**
 * 구절 본문 [{b, c, v, e?, t}]. 묶인 절(22-23)은 범위에 걸치면 함께 가져온다.
 * 없는 장·절이면 빈 배열
 */
export async function loadPassage({ b, c, v, to = v }) {
  const data = await loadBook(b);
  const chapter = data.chapters.find((ch) => ch.c === c);
  if (!chapter) return [];
  return chapter.verses.filter((x) => (x.e ?? x.v) >= v && x.v <= to).map((x) => ({ b, c, ...x }));
}
