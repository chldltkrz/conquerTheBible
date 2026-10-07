// 달력 화면: 한 달의 날짜별 분량과 읽음 상태. 기간을 정한 계획은 그 달에 걸친 날만 보인다.

import { formatSegments } from '../bible.js';
import {
  addDays,
  addMonths,
  compareDate,
  daysInMonth,
  formatMonth,
  monthEnd,
  monthStart,
  today,
  toISO,
  weekday,
  WEEKDAYS,
  ymKey,
} from '../dates.js';
import { plansOverlapping } from '../db.js';
import { html, setHTML } from '../ui.js';
import {
  accountPrefix,
  bindReadToggles,
  bookProgress,
  bookProgressList,
  dayList,
  dayRow,
  isMonthPlan,
  modeLabel,
  newPlanHref,
  periodLabel,
  progressOf,
  readHref,
} from './common.js';

export async function calendarView(root, [y, m]) {
  if (!(m >= 1 && m <= 12)) {
    location.replace('#/');
    return;
  }
  const prev = addMonths(y, m, -1);
  const next = addMonths(y, m, 1);
  const first = monthStart(y, m);
  const last = monthEnd(y, m);

  const render = () => {
    const now = today();
    const plans = plansOverlapping(first, last);
    const head = html`<header class="page-head month-head">
      <a class="icon-btn" href="#/month/${ymKey(prev.y, prev.m)}" aria-label="이전 달">‹</a>
      <h1>${formatMonth(y, m)}</h1>
      <a class="icon-btn" href="#/month/${ymKey(next.y, next.m)}" aria-label="다음 달">›</a>
    </header>`;

    if (!plans.length) {
      // 기간을 정해서 만들 때는 이번 달이면 오늘부터, 아니면 그 달 1일부터 30일
      const start = y === now.y && m === now.m ? now : first;
      setHTML(
        root,
        html`${head}
          <section class="empty">
            <h2>${accountPrefix()}이 달의 읽기 계획이 없습니다</h2>
            <p>범위를 고르면 ${m}월 1일부터 ${daysInMonth(y, m)}일까지 날마다 읽을 분량을 정해 드립니다. 기간을 직접 정할 수도 있습니다.</p>
            <div class="button-row is-center">
              <a class="btn btn-primary" href="#/new/${ymKey(y, m)}">${m}월 계획 만들기</a>
              <a class="btn btn-ghost" href="${newPlanHref(start, addDays(start, 29))}">기간 정해서 만들기</a>
            </div>
          </section>`,
      );
      return;
    }

    // 이 달에 걸친 날만. 한 계정의 계획은 기간이 겹치지 않으므로 날짜마다 계획은 하나다.
    const inMonth = (entry) => entry.date.y === y && entry.date.m === m;
    const byDate = new Map(plans.flatMap((p) => p.days.filter(inMonth).map((entry) => [toISO(entry.date), entry])));
    const several = plans.length > 1;

    const cells = [];
    for (let i = 0; i < weekday(y, m, 1); i++) cells.push(html`<span class="cal-cell is-blank" aria-hidden="true"></span>`);
    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const date = { y, m, d };
      const entry = byDate.get(toISO(date));
      const cmp = compareDate(date, now);
      const dayCls = ['sun', '', '', '', '', '', 'sat'][weekday(y, m, d)];
      if (!entry) {
        cells.push(html`<span class="cal-cell is-off ${cmp === 0 ? 'is-today' : ''} ${dayCls}"
          aria-label="${m}월 ${d}일 계획 없음"><b>${d}</b></span>`);
        continue;
      }
      const rest = entry.segments.length === 0;
      const cls = [
        entry.readAt ? 'is-read' : rest ? 'is-rest' : cmp < 0 ? 'is-missed' : '',
        !entry.readAt && entry.readParts ? 'is-partial' : '',
        cmp === 0 ? 'is-today' : '',
        dayCls,
      ].join(' ');
      const label = `${m}월 ${d}일 ${rest ? '쉬는 날' : formatSegments(entry.segments)}${entry.readAt ? ', 읽음' : entry.readParts ? `, ${entry.readParts}/${entry.parts.length}권 읽음` : ''}`;
      cells.push(
        rest
          ? html`<span class="cal-cell ${cls}" aria-label="${label}"><b>${d}</b></span>`
          : html`<a class="cal-cell ${cls}" href="${readHref(date)}" aria-label="${label}">
              <b>${d}</b><small>${formatSegments(entry.segments, { short: true })}</small>
            </a>`,
      );
    }

    // 계획마다: 요약(기간을 정한 계획은 기간도), 책별 진도, 이 달의 날짜별 분량
    const planSummary = (plan) => {
      const progress = progressOf(plan);
      return html`<div class="plan-summary">
        <b>${accountPrefix()}${plan.title}${modeLabel(plan) ? ` · ${modeLabel(plan)}` : ''}</b>
        <span>${isMonthPlan(plan) ? '' : `${periodLabel(plan)} · `}${progress.done}/${progress.total}일 읽음 · ${progress.percent}%</span>
      </div>`;
    };
    const planDetails = (plan) => html`${bookProgress(plan).length > 1
        ? html`<section class="block">
            <h2 class="block-title">책별 진도${several ? ` · ${plan.title}` : ''}</h2>
            ${bookProgressList(plan)}
          </section>`
        : ''}
      <section class="block">
        <h2 class="block-title">날짜별 분량${several ? ` · ${plan.title}` : ''}</h2>
        ${dayList(plan.days.filter(inMonth), (entry) => dayRow(plan, entry, now))}
      </section>`;

    setHTML(
      root,
      html`${head}
        ${plans.map(planSummary)}
        <div class="cal" role="grid">
          <div class="cal-week">${WEEKDAYS.map((w) => html`<span>${w}</span>`)}</div>
          <div class="cal-grid">${cells}</div>
        </div>
        ${plans.map(planDetails)}
        <div class="footer-actions">
          ${plans.map(
            (plan) => html`<a class="btn btn-ghost" href="${newPlanHref(plan.start, plan.end)}">
              ${several ? `${plan.title} ` : '계획 '}다시 만들기</a>`,
          )}
        </div>`,
    );
  };

  bindReadToggles(root, render);
  render();
}
