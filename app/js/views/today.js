// 오늘 화면: 오늘 분량, 진행률, 밀린 읽기, 다른 계정의 오늘 상태

import { formatSegments, readingMinutes } from '../bible.js';
import { addMonths, daysInMonth, formatDay, formatMonth, today, ymKey } from '../dates.js';
import { currentAccount, getPlan, listAccounts } from '../db.js';
import { html, setHTML, formatNumber } from '../ui.js';
import {
  accountChip,
  accountStatus,
  avatar,
  bindReadToggles,
  checkIcon,
  dayRow,
  progressOf,
  readHref,
  readingStreak,
} from './common.js';

export async function todayView(root) {
  const render = () => {
    const now = today();
    const plan = getPlan(now.y, now.m);
    const next = addMonths(now.y, now.m, 1);
    const nearMonthEnd = daysInMonth(now.y, now.m) - now.d < 7;
    const nextPlanMissing = nearMonthEnd && !getPlan(next.y, next.m);

    const head = html`<header class="page-head head-row">
      <div>
        <p class="eyebrow">${formatDay(now.y, now.m, now.d)}</p>
        <h1>오늘의 읽기</h1>
      </div>
      ${accountChip()}
    </header>`;

    const nextCard = nextPlanMissing
      ? html`<a class="card card-link" href="#/new/${ymKey(next.y, next.m)}">
          <span><b>${next.m}월 계획을 준비하세요</b><small>다음 달 1일부터 읽을 범위를 고릅니다</small></span>
          <span class="chev" aria-hidden="true">›</span>
        </a>`
      : '';

    // 계정을 돌려 가며 읽을 수 있도록 다른 계정들의 오늘 상태를 보여 준다.
    const me = currentAccount().id;
    const others = listAccounts().filter((a) => a.id !== me);
    const othersBlock = others.length
      ? html`<section class="block">
          <h2 class="block-title">다른 계정</h2>
          <ul class="account-list is-inline">
            ${others.map((acc) => {
              const status = accountStatus(acc.id, now);
              return html`<li>
                <button class="account-item" data-switch-to="${acc.id}" aria-label="${acc.name} 계정으로 바꾸기">
                  ${avatar(acc)}
                  <span class="account-text"><b>${acc.name}</b><small class="is-${status.state}">${status.text}</small></span>
                  ${status.state === 'read' ? html`<span class="account-check">${checkIcon}</span>` : html`<span class="chev" aria-hidden="true">›</span>`}
                </button>
              </li>`;
            })}
          </ul>
        </section>`
      : '';

    if (!plan) {
      setHTML(
        root,
        html`${head}
          <section class="empty">
            <img class="empty-mark" src="icons/icon.svg" alt="" />
            <h2>${now.m}월 읽기 계획이 없습니다</h2>
            <p>읽고 싶은 성경 범위를 고르면 ${now.m}월 1일부터 ${daysInMonth(now.y, now.m)}일까지 고르게 나누어 드립니다.</p>
            <a class="btn btn-primary" href="#/new/${ymKey(now.y, now.m)}">${now.m}월 계획 만들기</a>
          </section>
          ${othersBlock} ${nextCard}`,
      );
      return;
    }

    const entry = plan.days[now.d - 1];
    const progress = progressOf(plan);
    const streak = readingStreak(now);
    const missed = plan.days.filter((d) => d.day < now.d && d.segments.length && !d.readAt);
    const upcoming = plan.days.filter((d) => d.day > now.d && d.segments.length).slice(0, 3);

    let todayCard;
    if (!entry.segments.length) {
      todayCard = html`<article class="today-card is-rest">
        <p class="today-meta">${plan.title}</p>
        <h2 class="today-ref">오늘은 쉬는 날입니다</h2>
        <p class="muted">선택한 분량이 날 수보다 적어 읽을 분량이 없는 날이에요.</p>
      </article>`;
    } else {
      const done = !!entry.readAt;
      todayCard = html`<article class="today-card ${done ? 'is-done' : ''}">
        <p class="today-meta">${plan.title} · ${now.d}일째</p>
        <h2 class="today-ref">${formatSegments(entry.segments)}</h2>
        <p class="today-sub">약 ${readingMinutes(entry.chars)}분 · ${formatNumber(entry.chars)}자</p>
        <div class="today-actions">
          <a class="btn ${done ? 'btn-ghost' : 'btn-primary'}" href="${readHref(now.y, now.m, now.d)}">
            ${done ? '다시 읽기' : '읽으러 가기'}
          </a>
          <button class="btn ${done ? 'btn-done' : 'btn-ghost'}" data-action="toggle-read"
            data-plan="${plan.id}" data-day="${now.d}" data-read="${done ? 1 : 0}" aria-pressed="${done}">
            ${checkIcon}<span>${done ? '읽음' : '읽음 표시'}</span>
          </button>
        </div>
      </article>`;
    }

    setHTML(
      root,
      html`${head}
        ${todayCard}
        <section class="stats" aria-label="진행 상황">
          <div class="stat"><b>${progress.done}<small>/${progress.total}일</small></b><span>읽은 날</span></div>
          <div class="stat"><b>${streak}<small>일</small></b><span>연속 읽기</span></div>
          <div class="stat"><b>${progress.percent}<small>%</small></b><span>${now.m}월 진행</span></div>
        </section>
        <div class="progress" role="progressbar" aria-valuenow="${progress.percent}" aria-valuemin="0" aria-valuemax="100">
          <span style="width:${progress.percent}%"></span>
        </div>
        ${othersBlock}
        ${missed.length
          ? html`<section class="block">
              <h2 class="block-title">밀린 읽기 <span class="badge">${missed.length}</span></h2>
              <ul class="day-list">${missed.map((d) => dayRow(plan, d, now))}</ul>
            </section>`
          : ''}
        ${upcoming.length
          ? html`<section class="block">
              <h2 class="block-title">다가오는 읽기</h2>
              <ul class="day-list">${upcoming.map((d) => dayRow(plan, d, now))}</ul>
              <a class="more-link" href="#/month/${ymKey(now.y, now.m)}">${formatMonth(now.y, now.m)} 전체 일정 보기 ›</a>
            </section>`
          : ''}
        ${nextCard}`,
    );
  };

  bindReadToggles(root, render);
  render();
}
