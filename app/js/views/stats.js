// 오늘 화면의 진행 상황(읽은 날 · 연속 읽기 · 진행률)을 누르면 아래에서 올라오는 자세히 보기 창

import { readingMinutes } from '../bible.js';
import { compareDate, formatDate, today, weekday, WEEKDAYS, ymKey } from '../dates.js';
import { planOn } from '../db.js';
import { formatNumber, html, setHTML } from '../ui.js';
import {
  dayLabel,
  entryOn,
  isMonthPlan,
  periodLabel,
  progressItems,
  progressList,
  progressOf,
  readHref,
  STREAK_MILESTONES,
  streakStats,
} from './common.js';

const TABS = [
  ['days', '읽은 날'],
  ['streak', '연속 읽기'],
  ['progress', '진행'],
];

const flameIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12.2 2.2c.5 3 2.6 4.7 4.2 6.6a7.4 7.4 0 0 1 1.9 5A6.3 6.3 0 0 1 12 20.2a6.3 6.3 0 0 1-6.3-6.4c0-2.4 1.1-4.3 2.7-5.8.2 1.7.9 2.9 2.1 3.5-.2-3.2.4-6.4 1.7-9.3z" />
  <path class="flame-core" d="M12 20.2a3 3 0 0 1-3-3.1c0-1.4.8-2.4 1.8-3.3.2 1 .7 1.6 1.4 1.9.3-1.2.9-2.2 1.6-3 .9 1.2 1.2 2.5 1.2 3.9a3 3 0 0 1-3 3.6z" />
</svg>`;

const DAY_LABEL = {
  read: '다 읽음',
  missed: '밀림',
  today: '오늘',
  upcoming: '읽을 날',
  rest: '쉬는 날',
  moved: '분량을 뒤로 옮김',
};

const STREAK_LABEL = {
  read: '다 읽음',
  missed: '못 읽음',
  today: '오늘, 아직 안 읽음',
  moved: '분량을 뒤로 옮김',
  rest: '쉬는 날',
  off: '계획 없음',
  future: '',
};

/**
 * 진행 상황 자세히 보기 창을 연다. tab: 'days' | 'streak' | 'progress'
 * 연 순간의 상태를 보여 준다. 날짜나 링크를 눌러 다른 화면으로 가면 저절로 닫힌다.
 */
export function openStatSheet(tab = 'days') {
  const now = today();
  const plan = planOn(now);
  if (!plan) return;
  let active = TABS.some(([id]) => id === tab) ? tab : 'days';

  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  dlg.setAttribute('aria-labelledby', 'sheet-title');

  const render = () => {
    setHTML(
      dlg,
      html`<header class="sheet-head">
          <span class="sheet-grip" aria-hidden="true"></span>
          <div class="sheet-title-row">
            <div>
              <p class="eyebrow">${periodLabel(plan)}</p>
              <h2 id="sheet-title">${plan.title}</h2>
            </div>
            <button class="icon-btn" data-close aria-label="닫기">✕</button>
          </div>
          <div class="segmented sheet-tabs" role="tablist" aria-label="진행 상황">
            ${TABS.map(
              ([id, label]) => html`<button role="tab" data-tab="${id}" aria-selected="${id === active}"
                aria-checked="${id === active}">${label}</button>`,
            )}
          </div>
        </header>
        <div class="sheet-body" role="tabpanel" aria-label="${TABS.find(([id]) => id === active)[1]}">
          ${active === 'days' ? daysTab(plan, now) : active === 'streak' ? streakTab(now) : progressTab(plan, now)}
        </div>`,
    );
    // 원형 진행률은 0에서 채워지며 올라간다.
    const ring = dlg.querySelector('.ring-fill');
    if (ring) {
      ring.getBoundingClientRect();
      requestAnimationFrame(() => ring.setAttribute('stroke-dashoffset', ring.dataset.offset));
    }
  };

  const close = () => {
    if (!dlg.open || dlg.classList.contains('is-closing')) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return dlg.close();
    dlg.classList.add('is-closing');
    dlg.addEventListener('animationend', () => dlg.close(), { once: true });
    setTimeout(() => dlg.close(), 400); // 애니메이션 이벤트가 오지 않을 때를 위해
  };
  // 날짜·링크를 눌러 화면이 바뀌거나 계정을 바꾸면 닫는다.
  const closeNow = () => dlg.close();
  window.addEventListener('hashchange', closeNow);
  window.addEventListener('account-changed', closeNow);

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) return close(); // 바깥(어두운 곳)이나 닫기 버튼
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn && tabBtn.dataset.tab !== active) {
      active = tabBtn.dataset.tab;
      render();
      dlg.querySelector(`[data-tab="${active}"]`).focus();
      return;
    }
    if (e.target.closest('[data-goto="missed"]')) {
      close();
      document.getElementById('missed')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault(); // Esc: 애니메이션과 함께 닫는다
    close();
  });
  dlg.addEventListener('close', () => {
    window.removeEventListener('hashchange', closeNow);
    window.removeEventListener('account-changed', closeNow);
    dlg.remove();
  });

  // 머리 부분을 아래로 끌어내리면 닫는다.
  let startY = null;
  dlg.addEventListener(
    'touchstart',
    (e) => {
      startY = e.target.closest('.sheet-head') && !e.target.closest('button') ? e.touches[0].clientY : null;
    },
    { passive: true },
  );
  dlg.addEventListener(
    'touchmove',
    (e) => {
      if (startY != null) dlg.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - startY)}px)`;
    },
    { passive: true },
  );
  dlg.addEventListener('touchend', (e) => {
    if (startY == null) return;
    const dy = e.changedTouches[0].clientY - startY;
    startY = null;
    if (dy > 90) return dlg.close();
    dlg.style.transform = '';
  });

  render();
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector(`[data-tab="${active}"]`).focus();
}

// ── 읽은 날 ────────────────────────────────────────────────

function dayState(entry, now) {
  if (!entry.segments.length) return entry.moved ? 'moved' : 'rest';
  if (entry.readAt) return 'read';
  const cmp = compareDate(entry.date, now);
  return cmp < 0 ? 'missed' : cmp === 0 ? 'today' : 'upcoming';
}

/** 날짜 칸 달력: 요일 머리줄 + 첫날 요일만큼 빈칸 + 날짜 칸들 */
function miniCal(first, cells, cls = '') {
  return html`<div class="mini-cal ${cls}">
    <div class="mc-week">${WEEKDAYS.map((w) => html`<span>${w}</span>`)}</div>
    <div class="mc-grid">
      ${Array.from({ length: weekday(first.y, first.m, first.d) }, () => html`<span class="mc-cell is-blank"></span>`)}
      ${cells}
    </div>
  </div>`;
}

function daysTab(plan, now) {
  const entry = entryOn(plan, now);
  const progress = progressOf(plan);
  const days = plan.days.map((d) => ({ d, state: dayState(d, now), partial: !d.readAt && d.readParts > 0 }));
  const count = (...states) => days.filter((x) => states.includes(x.state)).length;
  const missed = count('missed');
  const left = count('today', 'upcoming');
  const rest = count('rest', 'moved');
  const hasPartial = days.some((x) => x.partial);
  // 여러 달에 걸친 계획은 달이 바뀌는 칸에 달을 적는다.
  const multiMonth = ymKey(plan.start.y, plan.start.m) !== ymKey(plan.end.y, plan.end.m);

  const cells = days.map(({ d, state, partial }) => {
    const cls = `mc-cell is-${state} ${partial ? 'is-partial' : ''}`;
    const label = `${formatDate(d.date)} ${DAY_LABEL[state]}${partial ? `, ${d.readParts}/${d.parts.length} 읽음` : ''}`;
    const inner = html`${multiMonth && (d.day === 1 || d.date.d === 1) ? html`<span class="mc-month">${d.date.m}월</span>` : ''}<b>${d.date.d}</b>`;
    return d.segments.length
      ? html`<a class="${cls}" href="${readHref(d.date)}" aria-label="${label}">${inner}</a>`
      : html`<span class="${cls}" aria-label="${label}">${inner}</span>`;
  });

  return html`<div class="sheet-hero">
      <p class="hero-num">${progress.done}<small>/${progress.total}일</small></p>
      <p class="hero-label">다 읽은 날</p>
      <p class="hero-sub">오늘은 ${dayLabel(plan, entry)}입니다</p>
    </div>
    <ul class="legend">
      <li><i class="swatch is-read"></i>다 읽음 <b>${progress.done}</b></li>
      ${missed ? html`<li><i class="swatch is-missed"></i>밀림 <b>${missed}</b></li>` : ''}
      ${hasPartial ? html`<li><i class="swatch is-partial"></i>일부 읽음 <b>${days.filter((x) => x.partial).length}</b></li>` : ''}
      <li><i class="swatch is-upcoming"></i>남음 <b>${left}</b></li>
      ${rest ? html`<li><i class="swatch is-rest"></i>쉬는 날 <b>${rest}</b></li>` : ''}
    </ul>
    ${miniCal(plan.start, cells)}
    <p class="sheet-note">
      그날 분량을 모두 읽은 날만 셉니다.
      ${hasPartial ? '여러 권을 함께 읽는 날 일부만 읽었으면 반만 칠해집니다. ' : ''}날짜를 누르면 그날 본문으로 갑니다.
    </p>
    <div class="button-row is-center">
      ${missed ? html`<button class="btn btn-primary btn-sm" data-goto="missed">밀린 읽기 ${missed}일 보기</button>` : ''}
      <a class="btn btn-ghost btn-sm" href="#/month/${ymKey(now.y, now.m)}">달력에서 보기</a>
    </div>`;
}

// ── 연속 읽기 ──────────────────────────────────────────────

function streakTab(now) {
  const s = streakStats(now);
  const next = STREAK_MILESTONES.find((m) => m > s.current);
  const message = !s.dueToday
    ? '오늘은 읽을 분량이 없는 날이라 기록이 그대로 이어집니다.'
    : s.readToday
      ? '오늘도 읽었습니다. 내일도 이어 가요!'
      : s.current
        ? `오늘 분량을 읽으면 ${s.current + 1}일이 됩니다.`
        : '오늘 분량을 읽으면 연속 읽기가 다시 시작됩니다.';
  const cells = s.recent.map(
    ({ date, state }) => html`<span class="mc-cell is-${state}" aria-label="${formatDate(date)} ${STREAK_LABEL[state]}"
      ><b>${date.d}</b></span>`,
  );
  return html`<div class="sheet-hero streak-hero ${s.current ? 'is-on' : ''}">
      <span class="flame">${flameIcon}</span>
      <p class="hero-num">${s.current}<small>일</small></p>
      <p class="hero-label">연속 읽기</p>
      <p class="hero-sub">${message}</p>
    </div>
    <div class="sheet-cards">
      <div class="sheet-card"><b>${s.best}<small>일</small></b><span>최고 기록</span></div>
      <div class="sheet-card"><b>${s.total}<small>일</small></b><span>다 읽은 날 모두</span></div>
      <div class="sheet-card"><b>${next ?? '–'}<small>${next ? '일' : ''}</small></b><span>다음 목표</span></div>
    </div>
    ${next
      ? html`<div class="milestone">
          <div class="milestone-top"><span>${next}일 연속까지</span><b>${next - s.current}일 남음</b></div>
          <div class="milestone-bar"><span style="width:${Math.round((s.current / next) * 100)}%"></span></div>
        </div>`
      : ''}
    <h3 class="sheet-sub">최근 5주</h3>
    ${miniCal(s.recent[0].date, cells, 'is-streak')}
    <ul class="legend">
      <li><i class="swatch is-read"></i>다 읽음</li>
      <li><i class="swatch is-missed"></i>못 읽음</li>
      <li><i class="swatch is-rest"></i>쉬는 날</li>
    </ul>
    <p class="sheet-note">
      그날 분량을 모두 읽은 날이 이어지면 늘어납니다. 쉬는 날은 건너뛰고, 못 읽은 날·계획이 없는 날·분량을 뒤로 옮긴 날에서 끊깁니다.
    </p>`;
}

// ── 진행 ───────────────────────────────────────────────────

function progressTab(plan, now) {
  const p = progressOf(plan);
  const idx = entryOn(plan, now).day - 1; // 오늘이 몇 번째 날인지 (0부터)
  const sumChars = (days) => days.reduce((s, d) => s + d.chars, 0);
  const pct = (chars) => (plan.totalChars ? Math.round((chars / plan.totalChars) * 100) : 0);
  const dueBefore = sumChars(plan.days.slice(0, idx)); // 어제까지 읽을 분량
  const dueToday = sumChars(plan.days.slice(0, idx + 1)); // 오늘까지 읽을 분량
  const unread = plan.totalChars - p.readChars;
  const daysLeft = plan.length - idx; // 오늘을 포함해 남은 날
  const missed = plan.days.slice(0, idx).filter((d) => d.segments.length && !d.readAt).length;

  let pace;
  if (unread <= 0) pace = { cls: 'is-done', text: '계획한 분량을 모두 읽었습니다!' };
  else if (p.readChars >= dueToday) {
    const ahead = pct(p.readChars - dueToday);
    pace = { cls: 'is-ahead', text: ahead ? `예정보다 ${ahead}%p 앞서 있습니다` : '오늘 분량까지 모두 읽었습니다' };
  } else if (p.readChars >= dueBefore) {
    pace = { cls: 'is-on', text: `예정대로 읽고 있습니다. 오늘 분량을 읽으면 ${pct(dueToday)}%가 됩니다` };
  } else {
    const gap = pct(dueBefore - p.readChars);
    pace = { cls: 'is-behind', text: `예정보다 ${gap ? `${gap}%p` : '조금'} 늦습니다${missed ? ` · 밀린 날 ${missed}일` : ''}` };
  }

  const { title, items } = progressItems(plan);
  const chDone = items.reduce((s, x) => s + x.done, 0);
  const chTotal = items.reduce((s, x) => s + x.total, 0);
  const R = 52;
  const C = 2 * Math.PI * R;

  return html`<div class="sheet-hero">
      <div class="ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="ring-track" cx="60" cy="60" r="${R}" />
          <circle class="ring-fill" cx="60" cy="60" r="${R}" stroke-dasharray="${C.toFixed(1)}"
            stroke-dashoffset="${C.toFixed(1)}" data-offset="${(C * (1 - p.percent / 100)).toFixed(1)}" />
        </svg>
        <div class="ring-text"><b>${p.percent}<small>%</small></b><span>${isMonthPlan(plan) ? `${plan.start.m}월 진행` : '계획 진행'}</span></div>
      </div>
    </div>
    <div class="pace ${pace.cls}">
      <p class="pace-text">${pace.text}</p>
      <div class="pace-bar">
        <span style="width:${p.percent}%"></span>
        ${unread > 0 ? html`<i style="left:${pct(dueToday)}%" aria-hidden="true"></i>` : ''}
      </div>
      <div class="pace-legend"><span>읽음 ${p.percent}%</span>${unread > 0 ? html`<span>오늘까지 예정 ${pct(dueToday)}%</span>` : ''}</div>
    </div>
    <dl class="facts">
      <div><dt>읽은 분량</dt><dd>${formatNumber(p.readChars)}<small> / ${formatNumber(plan.totalChars)}자</small></dd></div>
      <div><dt>다 읽은 장</dt><dd>${chDone}<small> / ${chTotal}장</small></dd></div>
      ${unread > 0
        ? html`<div><dt>남은 날</dt><dd>${daysLeft}<small>일 · 하루 약 ${readingMinutes(unread / daysLeft)}분</small></dd></div>`
        : ''}
    </dl>
    <h3 class="sheet-sub">${title}</h3>
    ${progressList(items)}
    <p class="sheet-note">진행률은 읽은 글자 수로 셉니다. 여러 권을 함께 읽으면 책마다 읽은 만큼 올라갑니다.</p>`;
}
