// 달력 화면: 한 달의 날짜별 분량과 읽음 상태

import { formatSegments } from '../bible.js';
import { addMonths, compareDate, daysInMonth, formatMonth, today, weekday, WEEKDAYS, ymKey } from '../dates.js';
import { getPlan } from '../db.js';
import { html, setHTML } from '../ui.js';
import { accountPrefix, bindReadToggles, dayRow, progressOf, readHref } from './common.js';

export async function calendarView(root, [y, m]) {
  if (!(m >= 1 && m <= 12)) {
    location.replace('#/');
    return;
  }
  const prev = addMonths(y, m, -1);
  const next = addMonths(y, m, 1);

  const render = () => {
    const now = today();
    const plan = getPlan(y, m);
    const head = html`<header class="page-head month-head">
      <a class="icon-btn" href="#/month/${ymKey(prev.y, prev.m)}" aria-label="이전 달">‹</a>
      <h1>${formatMonth(y, m)}</h1>
      <a class="icon-btn" href="#/month/${ymKey(next.y, next.m)}" aria-label="다음 달">›</a>
    </header>`;

    if (!plan) {
      setHTML(
        root,
        html`${head}
          <section class="empty">
            <h2>${accountPrefix()}이 달의 읽기 계획이 없습니다</h2>
            <p>범위를 고르면 ${m}월 1일부터 ${daysInMonth(y, m)}일까지 날마다 읽을 분량을 정해 드립니다.</p>
            <a class="btn btn-primary" href="#/new/${ymKey(y, m)}">${m}월 계획 만들기</a>
          </section>`,
      );
      return;
    }

    const progress = progressOf(plan);
    const offset = weekday(y, m, 1);
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(html`<span class="cal-cell is-blank" aria-hidden="true"></span>`);
    for (const entry of plan.days) {
      const date = { y, m, d: entry.day };
      const rest = entry.segments.length === 0;
      const cmp = compareDate(date, now);
      const cls = [
        entry.readAt ? 'is-read' : rest ? 'is-rest' : cmp < 0 ? 'is-missed' : '',
        cmp === 0 ? 'is-today' : '',
        ['sun', '', '', '', '', '', 'sat'][weekday(y, m, entry.day)],
      ].join(' ');
      const label = `${m}월 ${entry.day}일 ${rest ? '쉬는 날' : formatSegments(entry.segments)}${entry.readAt ? ', 읽음' : ''}`;
      cells.push(
        rest
          ? html`<span class="cal-cell ${cls}" aria-label="${label}"><b>${entry.day}</b></span>`
          : html`<a class="cal-cell ${cls}" href="${readHref(y, m, entry.day)}" aria-label="${label}">
              <b>${entry.day}</b><small>${formatSegments(entry.segments, { short: true })}</small>
            </a>`,
      );
    }

    setHTML(
      root,
      html`${head}
        <div class="plan-summary">
          <b>${accountPrefix()}${plan.title}</b>
          <span>${progress.done}/${progress.total}일 읽음 · ${progress.percent}%</span>
        </div>
        <div class="cal" role="grid">
          <div class="cal-week">${WEEKDAYS.map((w) => html`<span>${w}</span>`)}</div>
          <div class="cal-grid">${cells}</div>
        </div>
        <section class="block">
          <h2 class="block-title">날짜별 분량</h2>
          <ul class="day-list">${plan.days.map((d) => dayRow(plan, d, now))}</ul>
        </section>
        <div class="footer-actions">
          <a class="btn btn-ghost" href="#/new/${ymKey(y, m)}">계획 다시 만들기</a>
        </div>`,
    );
  };

  bindReadToggles(root, render);
  render();
}
