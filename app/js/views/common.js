// 여러 화면에서 함께 쓰는 조각들

import { formatSegments, readingMinutes } from '../bible.js';
import { compareDate, weekday, WEEKDAYS, ymKey } from '../dates.js';
import { readDates, scheduledDates, setRead } from '../db.js';
import { html, toast } from '../ui.js';

export const readHref = (y, m, d) => `#/read/${ymKey(y, m)}/${d}`;

export const checkIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>`;

/** 날짜별 분량 한 줄: 날짜 · 범위 · 분 · 읽음 버튼 */
export function dayRow(plan, entry, now) {
  const { year: y, month: m } = plan;
  const date = { y, m, d: entry.day };
  const rest = entry.segments.length === 0;
  const cmp = compareDate(date, now);
  const state = entry.readAt ? 'read' : rest ? 'rest' : cmp < 0 ? 'missed' : cmp === 0 ? 'today' : 'upcoming';
  const wd = weekday(y, m, entry.day);
  return html`<li class="day-row is-${state}">
    <a class="day-link" href="${rest ? '#' : readHref(y, m, entry.day)}" ${rest ? html`aria-disabled="true"` : ''}>
      <span class="day-date ${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}">
        <b>${entry.day}</b><small>${WEEKDAYS[wd]}</small>
      </span>
      <span class="day-ref">${rest ? '쉬는 날' : formatSegments(entry.segments)}</span>
      ${rest ? '' : html`<span class="day-min">${readingMinutes(entry.chars)}분</span>`}
    </a>
    ${rest
      ? ''
      : html`<button class="check ${entry.readAt ? 'on' : ''}" data-action="toggle-read"
          data-plan="${plan.id}" data-day="${entry.day}" data-read="${entry.readAt ? 1 : 0}"
          aria-pressed="${entry.readAt ? 'true' : 'false'}" aria-label="${entry.day}일 읽음 표시">${checkIcon}</button>`}
  </li>`;
}

/**
 * 화면 안의 읽음 버튼(data-action="toggle-read") 처리. 기록을 바꾼 뒤 onChange를 부른다.
 * 루트 요소에 한 번만 연결된다.
 */
export function bindReadToggles(root, onChange) {
  root.onclick = async (e) => {
    const btn = e.target.closest('[data-action="toggle-read"]');
    if (!btn) return;
    e.preventDefault();
    btn.disabled = true;
    const day = Number(btn.dataset.day);
    const read = btn.dataset.read !== '1';
    try {
      await setRead(Number(btn.dataset.plan), day, read);
      toast(read ? `${day}일 분량을 읽음으로 기록했습니다` : `${day}일 읽음 표시를 지웠습니다`);
      await onChange();
    } catch (err) {
      btn.disabled = false;
      toast(`저장하지 못했습니다: ${err.message}`);
    }
  };
}

/**
 * 연속으로 읽은 날 수. 오늘(아직 안 읽었으면 어제)부터 거슬러 올라가며
 * 분량이 있는 날을 모두 읽었으면 이어진다. 쉬는 날은 건너뛰고, 계획이 없는 날에서 끊긴다.
 */
export function readingStreak(now) {
  const key = (y, m, d) => `${y}-${m}-${d}`;
  const read = new Set(readDates().map((r) => key(r.y, r.m, r.d)));
  const scheduled = scheduledDates();
  const planned = new Set(scheduled.map((r) => `${r.y}-${r.m}`));
  const due = new Set(scheduled.map((r) => key(r.y, r.m, r.d)));

  let streak = 0;
  const date = new Date(now.y, now.m - 1, now.d);
  if (due.has(key(now.y, now.m, now.d)) && !read.has(key(now.y, now.m, now.d))) date.setDate(date.getDate() - 1);
  for (let i = 0; i < 4000; i++) {
    const [y, m, d] = [date.getFullYear(), date.getMonth() + 1, date.getDate()];
    if (!planned.has(`${y}-${m}`)) break;
    const k = key(y, m, d);
    if (due.has(k)) {
      if (!read.has(k)) break;
      streak++;
    }
    date.setDate(date.getDate() - 1);
  }
  return streak;
}

export function progressOf(plan) {
  const reading = plan.days.filter((d) => d.segments.length);
  const done = reading.filter((d) => d.readAt);
  const readChars = done.reduce((s, d) => s + d.chars, 0);
  return {
    total: reading.length,
    done: done.length,
    percent: plan.totalChars ? Math.round((readChars / plan.totalChars) * 100) : 0,
  };
}
