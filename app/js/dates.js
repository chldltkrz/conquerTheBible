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

export function compareDate(a, b) {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

export const formatMonth = (y, m) => `${y}년 ${m}월`;
export const formatDay = (y, m, d) => `${m}월 ${d}일 (${WEEKDAYS[weekday(y, m, d)]})`;

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
