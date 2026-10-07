// 날짜 도우미. 월(m)은 모두 1~12, 날짜는 기기의 현지 시간 기준이다.

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const pad = (n) => String(n).padStart(2, '0');

export function today() {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

export function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

/** 0=일요일 */
export function weekday(y, m, d) {
  return new Date(y, m - 1, d).getDay();
}

export function addMonths(y, m, delta) {
  const i = y * 12 + (m - 1) + delta;
  return { y: Math.floor(i / 12), m: (i % 12) + 1 };
}

export const ymKey = (y, m) => `${y}-${pad(m)}`;

/** {y, m, d} → "2026-10-06" (SQLite에 저장하는 날짜 형식, 문자열 비교로 순서를 알 수 있다) */
export const toISO = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;

export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

export function compareDate(a, b) {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

/** n일 뒤(음수면 앞) 날짜. 달·해 경계와 윤년을 따른다. */
export function addDays({ y, m, d }, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** a에서 b까지 며칠인지 (b가 뒤면 양수) */
export function daysBetween(a, b) {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

export const monthStart = (y, m) => ({ y, m, d: 1 });
export const monthEnd = (y, m) => ({ y, m, d: daysInMonth(y, m) });

/** 기간이 어느 한 달의 1일부터 말일까지인지 */
export const isWholeMonth = (start, end) =>
  start.d === 1 && end.y === start.y && end.m === start.m && end.d === daysInMonth(end.y, end.m);

export const formatMonth = (y, m) => `${y}년 ${m}월`;
export const formatDay = (y, m, d) => `${m}월 ${d}일 (${WEEKDAYS[weekday(y, m, d)]})`;
export const formatDate = ({ y, m, d }, { year = false } = {}) => `${year ? `${y}년 ` : ''}${m}월 ${d}일`;

/**
 * 기간 표기. 한 달 전체면 "2026년 10월", 아니면 "10월 15일 – 11월 23일".
 * year: true면 시작일에 연도를 붙이고, 해가 바뀌는 기간은 year와 관계없이 양쪽에 붙인다.
 */
export function formatPeriod(start, end, { year = false } = {}) {
  if (isWholeMonth(start, end)) return formatMonth(start.y, start.m);
  const crossYear = start.y !== end.y;
  return `${formatDate(start, { year: year || crossYear })} – ${formatDate(end, { year: crossYear })}`;
}

/** SQLite에 저장할 현지 시각 "2026-10-06 21:30:05" */
export function localTimestamp(date = new Date()) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** "2026-10-06 21:30:05" → "10월 6일 오후 9:30" */
export function formatTimestamp(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(ts ?? '');
  if (!m) return '';
  const h = Number(m[4]);
  const ampm = h < 12 ? '오전' : '오후';
  return `${Number(m[2])}월 ${Number(m[3])}일 ${ampm} ${h % 12 || 12}:${m[5]}`;
}
