// 오늘 화면: 오늘 분량, 진행률, 밀린 읽기, 다른 계정의 오늘 상태

import { formatSegments, readingMinutes } from '../bible.js';
import {
  addDays,
  compareDate,
  daysBetween,
  formatDate,
  formatDay,
  formatMonth,
  monthEnd,
  monthStart,
  today,
  ymKey,
} from '../dates.js';
import { currentAccount, listAccounts, listPlans, planOn, plansOverlapping, rebalancePlan } from '../db.js';
import { confirmDialog, html, setHTML, formatNumber, toast } from '../ui.js';
import {
  accountChip,
  accountStatus,
  avatar,
  bindReadToggles,
  checkIcon,
  dayLabel,
  dayList,
  dayRow,
  entryOn,
  isMonthPlan,
  isParallel,
  modeLabel,
  newPlanHref,
  partUnit,
  periodLabel,
  planRebalance,
  progressOf,
  progressSection,
  readHref,
  readingStreak,
} from './common.js';

export async function todayView(root) {
  const render = () => {
    const now = today();
    const plan = planOn(now);

    const head = html`<header class="page-head head-row">
      <div>
        <p class="eyebrow">${formatDay(now.y, now.m, now.d)}</p>
        <h1>오늘의 읽기</h1>
      </div>
      ${accountChip()}
    </header>`;

    // 계획이 일주일 안에 끝나는데 바로 다음 날부터 이어지는 계획이 없으면 다음 계획을 권한다.
    // 한 달 계획이면 다음 달, 기간을 정한 계획이면 같은 길이로 이어서.
    let nextCard = '';
    if (plan && daysBetween(now, plan.end) < 7) {
      const start = addDays(plan.end, 1);
      if (!planOn(start)) {
        const monthly = isMonthPlan(plan);
        const end = monthly ? monthEnd(start.y, start.m) : addDays(start, plan.length - 1);
        nextCard = html`<a class="card card-link" href="${newPlanHref(start, end)}">
          <span>${monthly
            ? html`<b>${start.m}월 계획을 준비하세요</b><small>다음 달 1일부터 읽을 범위를 고릅니다</small>`
            : html`<b>다음 계획을 준비하세요</b><small>지금 계획이 ${formatDate(plan.end)}에 끝납니다. 이어서 ${plan.length}일 동안 읽을 범위를 고릅니다</small>`}</span>
          <span class="chev" aria-hidden="true">›</span>
        </a>`;
      }
    }

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
      // 앞으로 시작할 계획 중 가장 가까운 것 (listPlans는 늦게 시작하는 계획부터)
      const upcomingPlan = listPlans()
        .filter((p) => compareDate(p.start, now) > 0)
        .at(-1);
      // 이 달이 비어 있으면 한 달 계획을, 이 달에 다른 계획이 있으면 오늘부터 30일(다음 계획이 있으면 그 전날까지)을 권한다.
      const monthFree = !plansOverlapping(monthStart(now.y, now.m), monthEnd(now.y, now.m)).length;
      const thirty = addDays(now, 29);
      const beforeNext = upcomingPlan && addDays(upcomingPlan.start, -1);
      const fromToday = newPlanHref(now, beforeNext && compareDate(beforeNext, thirty) < 0 ? beforeNext : thirty);
      setHTML(
        root,
        html`${head}
          <section class="empty">
            <img class="empty-mark" src="icons/icon.svg" alt="" />
            <h2>오늘 읽을 계획이 없습니다</h2>
            <p>읽고 싶은 성경 범위를 고르면 날마다 고르게 나누어 드립니다. 기본은 한 달이고, 기간을 직접 정할 수도 있습니다.</p>
            <div class="button-row is-center">
              ${monthFree
                ? html`<a class="btn btn-primary" href="#/new/${ymKey(now.y, now.m)}">${now.m}월 계획 만들기</a>
                    <a class="btn btn-ghost" href="${fromToday}">기간 정해서 만들기</a>`
                : html`<a class="btn btn-primary" href="${fromToday}">오늘부터 계획 만들기</a>`}
            </div>
          </section>
          ${upcomingPlan
            ? html`<a class="card card-link" href="#/month/${ymKey(upcomingPlan.start.y, upcomingPlan.start.m)}">
                <span><b>${upcomingPlan.title} 계획이 ${formatDate(upcomingPlan.start)}에 시작합니다</b>
                  <small>${periodLabel(upcomingPlan)} · ${daysBetween(now, upcomingPlan.start)}일 남았습니다</small></span>
                <span class="chev" aria-hidden="true">›</span>
              </a>`
            : ''}
          ${othersBlock}`,
      );
      return;
    }

    const entry = entryOn(plan, now);
    const progress = progressOf(plan);
    const streak = readingStreak(now);
    const missed = plan.days.filter((d) => d.day < entry.day && d.segments.length && !d.readAt);
    const upcoming = plan.days.filter((d) => d.day > entry.day && d.segments.length).slice(0, 3);
    const when = formatDate(now);

    let todayCard;
    if (!entry.segments.length) {
      todayCard = html`<article class="today-card is-rest">
        <p class="today-meta">${plan.title}</p>
        <h2 class="today-ref">오늘은 쉬는 날입니다</h2>
        <p class="muted">선택한 분량이 날 수보다 적어 읽을 분량이 없는 날이에요.</p>
      </article>`;
    } else if (isParallel(plan)) {
      // 병렬 읽기: 책마다 오늘 읽을 곳과 따로 읽음 표시
      const done = !!entry.readAt;
      todayCard = html`<article class="today-card ${done ? 'is-done' : ''}">
        <p class="today-meta">${plan.title} · ${modeLabel(plan)} · ${dayLabel(plan, entry)}</p>
        <ul class="part-list">
          ${entry.parts.map(
            (p) => html`<li class="${p.readAt ? 'is-read' : ''}">
              <a href="${readHref(now, p.track)}">
                <b>${formatSegments(p.segments)}</b><small>약 ${readingMinutes(p.chars)}분</small>
              </a>
              <button class="check ${p.readAt ? 'on' : ''}" data-action="toggle-read" data-plan="${plan.id}"
                data-day="${entry.day}" data-when="${when}" data-track="${p.track}" data-label="${p.title}"
                data-read="${p.readAt ? 1 : 0}" aria-pressed="${!!p.readAt}" aria-label="${p.title} 읽음 표시">${checkIcon}</button>
            </li>`,
          )}
        </ul>
        <p class="today-sub">모두 약 ${readingMinutes(entry.chars)}분 · ${entry.readParts}/${entry.parts.length}${partUnit(plan)} 읽음</p>
        <div class="today-actions">
          <a class="btn ${done ? 'btn-ghost' : 'btn-primary'}" href="${readHref(now)}">
            ${done ? '다시 읽기' : '읽으러 가기'}
          </a>
          <button class="btn ${done ? 'btn-done' : 'btn-ghost'}" data-action="toggle-read" data-plan="${plan.id}"
            data-day="${entry.day}" data-when="${when}" data-read="${done ? 1 : 0}" aria-pressed="${done}">
            ${checkIcon}<span>${done ? '모두 읽음' : '모두 읽음 표시'}</span>
          </button>
        </div>
      </article>`;
    } else {
      const done = !!entry.readAt;
      todayCard = html`<article class="today-card ${done ? 'is-done' : ''}">
        <p class="today-meta">${plan.title} · ${dayLabel(plan, entry)}</p>
        <h2 class="today-ref">${formatSegments(entry.segments)}</h2>
        <p class="today-sub">약 ${readingMinutes(entry.chars)}분 · ${formatNumber(entry.chars)}자</p>
        <div class="today-actions">
          <a class="btn ${done ? 'btn-ghost' : 'btn-primary'}" href="${readHref(now)}">
            ${done ? '다시 읽기' : '읽으러 가기'}
          </a>
          <button class="btn ${done ? 'btn-done' : 'btn-ghost'}" data-action="toggle-read" data-plan="${plan.id}"
            data-day="${entry.day}" data-when="${when}" data-read="${done ? 1 : 0}" aria-pressed="${done}">
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
          <div class="stat"><b>${progress.percent}<small>%</small></b><span>${isMonthPlan(plan) ? `${plan.start.m}월 진행` : '계획 진행'}</span></div>
        </section>
        <div class="progress" role="progressbar" aria-valuenow="${progress.percent}" aria-valuemin="0" aria-valuemax="100">
          <span style="width:${progress.percent}%"></span>
        </div>
        ${isParallel(plan) ? progressSection(plan) : ''}
        ${othersBlock}
        ${missed.length
          ? html`<section class="block">
              <h2 class="block-title">밀린 읽기 <span class="badge">${missed.length}</span></h2>
              ${dayList(missed, (d) => dayRow(plan, d, now))}
              <div class="rebalance">
                <p>밀린 분량을 오늘부터 ${formatDate(plan.end)}까지 남은 날에 고르게 다시 나눌 수 있습니다.</p>
                <button class="btn btn-ghost btn-sm" data-action="rebalance">남은 기간에 다시 나누기</button>
              </div>
            </section>`
          : ''}
        ${upcoming.length
          ? html`<section class="block">
              <h2 class="block-title">다가오는 읽기</h2>
              ${dayList(upcoming, (d) => dayRow(plan, d, now))}
              <a class="more-link" href="#/month/${ymKey(now.y, now.m)}">${isMonthPlan(plan)
                ? `${formatMonth(now.y, now.m)} 전체 일정 보기`
                : '달력에서 일정 보기'} ›</a>
            </section>`
          : ''}
        ${nextCard}`,
    );
  };

  const rebalance = async () => {
    const now = today();
    const plan = planOn(now);
    const result = plan && planRebalance(plan, now);
    if (!result) {
      toast('다시 나눌 남은 날이 없습니다');
      return;
    }
    const ok = await confirmDialog({
      title: '밀린 분량을 다시 나눌까요?',
      message:
        `밀린 ${result.missedDays}일 치를 포함해 아직 안 읽은 분량을 오늘부터 ${formatDate(plan.end)}까지 ` +
        `${result.targetDays}일에 고르게 나눕니다. 하루 약 ${result.beforeMinutes}분 → ${result.afterMinutes}분. ` +
        '이미 읽은 날은 그대로 두고, 지난 날짜에는 "분량을 뒤로 옮김"으로 남습니다.',
      confirmText: '다시 나누기',
    });
    if (!ok) return;
    try {
      await rebalancePlan(plan.id, result.trackChanges);
    } catch (err) {
      toast(`다시 나누지 못했습니다: ${err.message}`);
      return;
    }
    toast('남은 기간에 다시 나눴습니다');
    render();
  };

  bindReadToggles(root, render);
  const onToggle = root.onclick;
  root.onclick = (e) => {
    if (e.target.closest('[data-action="rebalance"]')) return rebalance();
    return onToggle(e);
  };
  render();
}
