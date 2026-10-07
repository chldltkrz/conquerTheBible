// 새 계획 화면: 기간(기본은 한 달)과 읽을 범위 고르기 → 날짜별 분량 미리보기 → 저장

import {
  allBooks,
  book,
  chapterChars,
  chapterUnit,
  describeSelection,
  formatSegments,
  getIndex,
  loadBook,
  PRESETS,
  presetBooks,
  readingMinutes,
  selectionToChapters,
} from '../bible.js';
import {
  addDays,
  addMonths,
  compareDate,
  daysBetween,
  formatDate,
  formatMonth,
  formatPeriod,
  fromISO,
  isWholeMonth,
  monthEnd,
  monthStart,
  toISO,
  today,
  ymKey,
} from '../dates.js';
import { MAX_PLAN_DAYS, plansOverlapping, savePlan } from '../db.js';
import { buildGroupPlan, buildParallelPlan, buildPlan } from '../planner.js';
import { confirmDialog, formatNumber, html, setHTML, toast } from '../ui.js';
import { accountPrefix, dayDate, dayList, newPlanHref, periodLabel } from './common.js';

// 기간을 직접 정할 때 시작일부터 바로 고르는 길이
const LENGTHS = [
  { label: '2주', end: (s) => addDays(s, 13) },
  { label: '40일', end: (s) => addDays(s, 39) },
  { label: '50일', end: (s) => addDays(s, 49) },
  { label: '100일', end: (s) => addDays(s, 99) },
  { label: '1년', end: (s) => addDays({ ...s, y: s.y + 1 }, -1) },
];

const sameDate = (a, b) => compareDate(a, b) === 0;

/** 주소: #/new (이번 달), #/new/2026-10 (그 달), #/new/2026-10-15/2026-11-23 (기간을 정해서) */
export async function newPlanView(root, [y, m, d, y2, m2, d2]) {
  const now = today();
  const customRoute = d != null;
  // 2월 30일처럼 없는 날짜는 실제 날짜로 맞춘다.
  const routeStart = customRoute ? addDays({ y, m, d }, 0) : null;
  const state = {
    period: customRoute ? 'custom' : 'month', // 'month' 한 달 | 'custom' 기간 직접 정하기
    y: routeStart?.y ?? y ?? now.y, // 한 달 계획의 달
    m: routeStart?.m ?? m ?? now.m,
    start: routeStart, // 기간을 직접 정할 때의 시작일과 마지막 날
    end: customRoute ? clampEnd(routeStart, addDays({ y: y2, m: m2, d: d2 }, 0)) : null,
    sel: new Map(), // 지금 고르는 범위: code → Set(장). 그룹으로 읽기에서는 지금 고르는 그룹(groups[active])
    split: true,
    open: null, // 장 목록을 펼친 책
    // 'sequential' 이어서 읽기 | 'parallel' 책마다 따로(병렬) 읽기 | 'group' 그룹마다 따로 읽기
    mode: 'sequential',
    groups: null, // 그룹으로 읽기: 그룹마다 고른 장 [Map(code → Set(장))]. 한 장은 한 그룹에만 든다.
    active: 0, // 지금 고르는 그룹
    step: 'select',
    tracks: null, // 미리보기: [{title, days}]
    title: '',
    titleEdited: false, // 사용자가 계획 이름을 직접 고쳤는지
  };

  const period = () =>
    state.period === 'month'
      ? { start: monthStart(state.y, state.m), end: monthEnd(state.y, state.m) }
      : { start: state.start, end: state.end };
  const periodDays = () => {
    const { start, end } = period();
    return daysBetween(start, end) + 1;
  };

  // 기간이 똑같은 계획이 이미 있으면 그 범위를 불러와 고칠 수 있게 한다.
  const samePeriodPlan = () => {
    const { start, end } = period();
    return plansOverlapping(start, end).find((p) => sameDate(p.start, start) && sameDate(p.end, end)) ?? null;
  };
  const loadExisting = () => {
    const existing = samePeriodPlan();
    if (existing) {
      state.split = existing.splitChapters;
      state.mode = existing.mode;
    }
    if (existing?.mode === 'group') {
      state.groups = groupsOfPlan(existing);
      selectGroup(0);
    } else {
      state.sel = new Map(Object.entries(existing?.selection ?? {}).map(([code, chs]) => [code, new Set(chs)]));
      state.groups = null;
    }
    return existing;
  };

  // 기간이 바뀐 뒤: 새 기간에 계획이 있으면 그 범위를, 없으면 지금까지 고른 범위를 그대로 쓴다.
  const periodChanged = () => {
    if (samePeriodPlan()) loadExisting();
    const { start, end } = period();
    history.replaceState(null, '', newPlanHref(start, end));
  };

  const isGroup = () => state.mode === 'group';
  /** 계획 전체에서 고른 장 {code: [장...]} (그룹으로 읽기면 모든 그룹을 합친 것) */
  const planSelection = () => selectionOf(isGroup() ? unionOf(state.groups) : state.sel);
  /** 내용이 있는 그룹들 {code: [장...]} */
  const filledGroups = () => state.groups.map(selectionOf).filter((g) => Object.keys(g).length);
  const count = (code) => state.sel.get(code)?.size ?? 0;
  const isFull = (b) => count(b.code) === b.chapters.length;

  function selectGroup(i) {
    state.active = i;
    state.sel = state.groups[i];
  }

  /**
   * 지금 고르는 범위에 장을 넣는다. 그룹으로 읽기에서는 다른 그룹에 있던 장을 이 그룹으로 옮기고,
   * 옮긴 장 수를 돌려준다.
   */
  const addChapters = (code, chs) => {
    const set = state.sel.get(code) ?? new Set();
    chs.forEach((c) => set.add(c));
    state.sel.set(code, set);
    if (!isGroup()) return 0;
    let moved = 0;
    for (const g of state.groups) {
      const other = g === state.sel ? null : g.get(code);
      if (!other) continue;
      for (const c of chs) if (other.delete(c)) moved++;
      if (!other.size) g.delete(code);
    }
    return moved;
  };
  const movedNotice = (moved) => {
    if (moved) toast(`다른 그룹에 있던 ${moved}장을 ${state.active + 1}번 그룹으로 옮겼습니다`);
  };
  const setBook = (b, on) => {
    if (on) return addChapters(b.code, b.chapters.map((_, i) => i + 1));
    state.sel.delete(b.code);
    return 0;
  };

  /** 읽는 방식 바꾸기. 그룹으로 바꾸면 지금 고른 범위가 첫 그룹이 된다. */
  const setMode = (mode) => {
    if (mode === state.mode) return;
    if (mode === 'group') {
      // 그룹을 나눠 두고 다른 방식을 잠깐 골랐다가, 범위를 바꾸지 않고 돌아왔으면 그 그룹들을 되살린다.
      const restore = state.groups && selKey(unionOf(state.groups)) === selKey(state.sel);
      if (!restore) state.groups = [state.sel];
      state.mode = mode;
      selectGroup(0);
      return;
    }
    if (isGroup()) state.sel = unionOf(state.groups);
    state.mode = mode;
  };

  loadExisting();

  // ── 1단계: 기간과 범위 고르기 ─────────────────────────────
  // 날짜 입력칸은 입력하는 동안 다시 그리면 커서를 잃으므로, 기간이 바뀌면 입력칸 밖의 부분만 다시 그린다.

  /** 머리말, 안내, 겹치는 계획 알림 */
  const topPart = () => {
    const { start, end } = period();
    const days = periodDays();
    const overlaps = plansOverlapping(start, end);
    const same = overlaps.length === 1 && sameDate(overlaps[0].start, start) && sameDate(overlaps[0].end, end);
    const head =
      state.period === 'month'
        ? html`<header class="page-head month-head">
            <button class="icon-btn" data-month="-1" aria-label="이전 달">‹</button>
            <div>
              <p class="eyebrow">${accountPrefix()}새 읽기 계획</p>
              <h1>${formatMonth(state.y, state.m)}</h1>
            </div>
            <button class="icon-btn" data-month="1" aria-label="다음 달">›</button>
          </header>`
        : html`<header class="page-head month-head">
            <span></span>
            <div>
              <p class="eyebrow">${accountPrefix()}새 읽기 계획 · ${days}일</p>
              <h1>${formatPeriod(start, end, { year: start.y !== now.y })}</h1>
            </div>
            <span></span>
          </header>`;
    return html`${head}
      <p class="lead">읽을 범위를 고르면 ${state.period === 'month'
        ? `${state.m}월 1일부터 ${end.d}일까지`
        : `${formatDate(start)}부터 ${formatDate(end)}까지 ${days}일 동안`} 날마다 비슷한 분량으로 나눕니다.</p>
      ${same
        ? html`<p class="notice">${state.period === 'month' ? '이 달에는' : '이 기간에는'} 이미 <b>${overlaps[0].title}</b> 계획이 있습니다. 새로 저장하면 기존 계획과 읽음 기록이 지워집니다.</p>`
        : overlaps.length
          ? html`<p class="notice">기간이 겹치는 계획이 있습니다:
              ${overlaps.map((p, i) => html`${i ? ', ' : ''}<b>${p.title}</b> (${periodLabel(p)})`)}.
              새로 저장하면 겹치는 계획과 그 읽음 기록이 지워집니다.</p>`
          : ''}`;
  };

  /** 기간을 직접 정할 때 빠른 길이 선택 */
  const lengthsPart = () => {
    const { start, end } = period();
    return html`<div class="chips">
        ${LENGTHS.map((l, i) => {
          const on = sameDate(l.end(start), end);
          return html`<button class="chip ${on ? 'on' : ''}" data-length="${i}" aria-pressed="${on}">${l.label}</button>`;
        })}
      </div>
      <p class="mode-help">길이를 고르거나 마지막 날을 직접 정하세요. 최대 ${MAX_PLAN_DAYS}일까지 정할 수 있습니다.</p>`;
  };

  const periodBlock = () => {
    const custom = state.period === 'custom';
    const { start, end } = period();
    return html`<section class="block">
      <h2 class="block-title">기간</h2>
      <div class="segmented mode-tabs" role="radiogroup" aria-label="기간">
        <button role="radio" data-period="month" aria-checked="${!custom}">한 달</button>
        <button role="radio" data-period="custom" aria-checked="${custom}">기간 직접 정하기</button>
      </div>
      ${custom
        ? html`<div class="period-fields">
              <label class="field">
                <span>시작일</span>
                <input type="date" id="period-start" value="${toISO(start)}" required />
              </label>
              <label class="field">
                <span>마지막 날</span>
                <input type="date" id="period-end" value="${toISO(end)}" min="${toISO(start)}"
                  max="${toISO(addDays(start, MAX_PLAN_DAYS - 1))}" required />
              </label>
            </div>
            <div id="period-lengths">${lengthsPart()}</div>`
        : ''}
    </section>`;
  };

  /** 그룹으로 읽기에서 그 장(c를 주지 않으면 그 책의 어느 장이든)이 든 다른 그룹 번호들 (1부터) */
  const otherGroups = (code, c) =>
    isGroup()
      ? state.groups
          .map((g, i) => (g !== state.sel && (c == null ? g.get(code)?.size : g.get(code)?.has(c)) ? i + 1 : null))
          .filter(Boolean)
      : [];

  const bookRow = (b) => {
    const n = count(b.code);
    const total = b.chapters.length;
    const open = state.open === b.code;
    const unit = b.code === 'psa' ? '편' : '장';
    return html`<li class="book ${open ? 'is-open' : ''} ${n ? 'has-sel' : ''}">
      <div class="book-row">
        <button class="book-check ${n === total ? 'all' : n ? 'some' : ''}" data-toggle-book="${b.code}"
          aria-label="${b.name} 전체 ${n === total ? '해제' : '선택'}" aria-pressed="${n === total}"></button>
        <button class="book-name" data-open="${b.code}" aria-expanded="${open}">
          <span>${b.name}</span>
          ${otherGroups(b.code).map((g) => html`<span class="group-tag" title="그룹 ${g}에 든 장이 있습니다">그룹 ${g}</span>`)}
          <small>${n ? `${n}/${total}${unit}` : `${total}${unit}`}</small>
          <span class="chev" aria-hidden="true">▾</span>
        </button>
      </div>
      ${open
        ? html`<div class="chapter-panel">
            <div class="chapter-grid">
              ${b.chapters.map((_, i) => {
                const on = !!state.sel.get(b.code)?.has(i + 1);
                const other = on ? null : otherGroups(b.code, i + 1)[0];
                return html`<button class="ch ${on ? 'on' : other ? 'in-other' : ''}" data-ch="${b.code}:${i + 1}"
                  aria-pressed="${on}" ${other ? html`title="그룹 ${other}에 있음"` : ''}>${i + 1}</button>`;
              })}
            </div>
            <form class="range-row" data-range="${b.code}">
              <input type="number" name="from" min="1" max="${total}" value="1" inputmode="numeric" aria-label="시작 ${unit}" />
              <span>–</span>
              <input type="number" name="to" min="1" max="${total}" value="${total}" inputmode="numeric" aria-label="끝 ${unit}" />
              <button class="btn btn-sm btn-ghost">${unit} 범위 선택</button>
              <button type="button" class="btn btn-sm btn-ghost" data-clear-book="${b.code}">해제</button>
            </form>
          </div>`
        : ''}
    </li>`;
  };

  /** 그룹으로 읽기: 그룹 목록과 지금 고르는 그룹 */
  const groupBlock = () => {
    const days = periodDays();
    return html`<section class="block">
      <h2 class="block-title">그룹
        <button class="link" data-action="add-group">+ 그룹 추가</button>
      </h2>
      <ul class="group-list">
        ${state.groups.map((g, i) => {
          const sel = selectionOf(g);
          const chapters = selectionToChapters(sel);
          const chars = chapters.reduce((s, x) => s + chapterChars(x.b, x.c), 0);
          const active = i === state.active;
          return html`<li class="${active ? 'is-active' : ''}">
            <button class="group-item" data-group="${i}" aria-pressed="${active}">
              <span class="group-num">${i + 1}</span>
              <span class="group-text">
                <b>${chapters.length ? describeSelection(sel) : '비어 있음'}</b>
                <small>${chapters.length
                  ? `${chapters.length}${unitOf(chapters)} · 하루 약 ${readingMinutes(chars / days)}분`
                  : active ? '아래에서 이 그룹에 넣을 책을 고르세요' : '눌러서 책을 담으세요'}</small>
              </span>
              ${active ? html`<span class="tag">고르는 중</span>` : ''}
            </button>
            ${state.groups.length > 1
              ? html`<button class="icon-btn danger" data-remove-group="${i}" aria-label="그룹 ${i + 1} 지우기">✕</button>`
              : ''}
          </li>`;
        })}
      </ul>
      <p class="mode-help">아래에서 고르는 책은 <b>그룹 ${state.active + 1}</b>에 들어갑니다. 다른 그룹에 있는 장을 고르면 이 그룹으로 옮겨집니다.</p>
    </section>`;
  };

  /** 읽는 방식, (그룹), 빠른 선택, 책 목록, 장 나누기 옵션 */
  const bodyPart = () => {
    const chapters = selectionToChapters(planSelection());
    const books = allBooks();
    const bookCount = new Set(chapters.map((x) => x.b)).size;
    const groupCount = isGroup() ? filledGroups().length : 0;
    const testament = (t, label) => {
      const list = books.filter((b) => b.testament === t);
      const allOn = list.every(isFull);
      return html`<section class="block">
        <h2 class="block-title">${label}
          <button class="link" data-testament="${t}">${allOn ? '모두 해제' : '모두 선택'}</button>
        </h2>
        <ul class="book-list">${list.map(bookRow)}</ul>
      </section>`;
    };
    const help = {
      sequential: '고른 책을 성경 순서대로 이어 붙여 기간 전체에 나눕니다.',
      parallel: '고른 책마다 따로 기간 전체에 나눕니다. 날마다 책마다 조금씩 함께 읽고, 진도도 책마다 따로 봅니다.',
      group: '책을 여러 그룹으로 묶고, 그룹마다 따로 기간 전체에 나눕니다. 그룹 안에서는 성경 순서대로 이어 읽고, 날마다 그룹마다 조금씩 함께 읽습니다.',
    };
    return html`<section class="block">
        <h2 class="block-title">읽는 방식</h2>
        <div class="segmented mode-tabs" role="radiogroup" aria-label="읽는 방식">
          <button role="radio" data-mode="sequential" aria-checked="${state.mode === 'sequential'}">이어서 읽기</button>
          <button role="radio" data-mode="parallel" aria-checked="${state.mode === 'parallel'}">병렬로 읽기</button>
          <button role="radio" data-mode="group" aria-checked="${state.mode === 'group'}">그룹으로 읽기</button>
        </div>
        <p class="mode-help">${help[state.mode]}</p>
        ${state.mode === 'parallel' && bookCount > 6
          ? html`<p class="notice">${bookCount}권을 병렬로 읽으면 날마다 ${bookCount}군데를 읽게 됩니다.</p>`
          : ''}
        ${groupCount > 6 ? html`<p class="notice">${groupCount}그룹이면 날마다 ${groupCount}군데를 읽게 됩니다.</p>` : ''}
      </section>
      ${isGroup() ? groupBlock() : ''}
      <section class="block">
        <h2 class="block-title">빠른 선택${isGroup() ? ` · 그룹 ${state.active + 1}` : ''}</h2>
        <div class="chips">
          ${PRESETS.map(
            (p, i) => html`<button class="chip ${presetBooks(p).every(isFull) ? 'on' : ''}" data-preset="${i}"
              aria-pressed="${presetBooks(p).every(isFull)}">${p.name}</button>`,
          )}
        </div>
      </section>
      ${testament('OT', '구약')} ${testament('NT', '신약')}
      <label class="option">
        <input type="checkbox" id="split" ${state.split ? 'checked' : ''} />
        <span><b>장 중간에서도 나누기</b>
          <small>하루 분량을 더 고르게 맞춥니다. 가능하면 장 끝이나 단락 제목에서 끊습니다.</small></span>
      </label>`;
  };

  const summaryBar = () => {
    const chapters = selectionToChapters(planSelection());
    const chars = chapters.reduce((s, x) => s + chapterChars(x.b, x.c), 0);
    let how = ' 선택';
    if (state.mode === 'parallel') how = ` · ${new Set(chapters.map((x) => x.b)).size}권 병렬`;
    if (isGroup()) how = ` · ${filledGroups().length}그룹`;
    return html`<div class="summary-bar">
      <div class="summary-text">
        ${chapters.length
          ? html`<b>${formatNumber(chapters.length)}장</b>${how} · 하루 평균 약 ${readingMinutes(chars / periodDays())}분`
          : html`<span class="muted">읽을 범위를 골라 주세요</span>`}
      </div>
      ${chapters.length ? html`<button class="btn btn-ghost btn-sm" data-action="clear">초기화</button>` : ''}
      <button class="btn btn-primary" data-action="preview" ${chapters.length ? '' : 'disabled'}>다음</button>
    </div>`;
  };

  // 요약 막대는 화면 아래에 붙어 있도록(sticky) root의 바로 아래 자식이어야 한다.
  const renderSelect = () => {
    setHTML(
      root,
      html`<div id="np-top">${topPart()}</div>
        ${periodBlock()}
        <div id="np-body">${bodyPart()}</div>
        ${summaryBar()}`,
    );
    // 범위를 벗어난 마지막 날을 입력하는 중에는 고쳐 쓰지 않았다가, 칸을 떠날 때 맞춘 날짜로 되돌린다.
    root.querySelector('#period-end')?.addEventListener('blur', (e) => {
      if (state.end) e.target.value = toISO(state.end);
    });
  };

  /** 날짜 입력으로 기간이 바뀌었을 때: 입력칸은 그대로 두고 나머지만 다시 그린다. */
  const refreshAfterDateInput = () => {
    const { start, end } = period();
    const endInput = root.querySelector('#period-end');
    endInput.min = toISO(start);
    endInput.max = toISO(addDays(start, MAX_PLAN_DAYS - 1));
    if (endInput.value !== toISO(end) && document.activeElement !== endInput) endInput.value = toISO(end);
    setHTML(root.querySelector('#np-top'), topPart());
    setHTML(root.querySelector('#period-lengths'), lengthsPart());
    setHTML(root.querySelector('#np-body'), bodyPart());
    root.querySelector('.summary-bar').outerHTML = String(summaryBar());
  };

  // ── 2단계: 미리보기 ──────────────────────────────────────
  const renderPreview = () => {
    const { start, end } = period();
    const total = periodDays();
    // 날마다 모든 묶음을 합친 분량
    const days = Array.from({ length: total }, (_, i) => {
      const parts = state.tracks.map((t) => t.days[i]).filter((x) => x.segments.length);
      return { date: addDays(start, i), parts, chars: parts.reduce((a, p) => a + p.chars, 0) };
    });
    const minutes = days.filter((d) => d.parts.length).map((d) => readingMinutes(d.chars));
    const [lo, hi] = [Math.min(...minutes), Math.max(...minutes)];
    const totalChars = days.reduce((s, d) => s + d.chars, 0);
    const chapters = selectionToChapters(planSelection()).length;
    const parallel = state.mode !== 'sequential';
    setHTML(
      root,
      html`<header class="page-head month-head">
          <button class="icon-btn" data-action="back" aria-label="범위 다시 고르기">‹</button>
          <div>
            <p class="eyebrow">${formatPeriod(start, end, { year: true })}${state.period === 'month' ? '' : ` · ${total}일`} 계획 미리보기</p>
            <h1>${state.title}</h1>
          </div>
          <span></span>
        </header>
        <div class="plan-summary">
          <b>${formatNumber(chapters)}장 · ${formatNumber(totalChars)}자</b>
          <span>${lo === hi
            ? `하루 약 ${lo}분`
            : `하루 약 ${lo}–${hi}분 (평균 ${readingMinutes(totalChars / minutes.length)}분)`}</span>
        </div>
        ${parallel
          ? html`<ul class="track-summary">
              ${state.tracks.map((t) => {
                const sum = t.days.reduce((a, d) => a + d.chars, 0);
                const chs = new Map(t.days.flatMap((d) => d.segments.map((x) => [`${x.b}:${x.c}`, x])));
                return html`<li><b>${t.title}</b><span>${chs.size}${unitOf([...chs.values()])} · 하루 약 ${readingMinutes(sum / total)}분</span></li>`;
              })}
            </ul>`
          : ''}
        <label class="field">
          <span>계획 이름</span>
          <input id="plan-title" value="${state.title}" maxlength="40" autocomplete="off" />
        </label>
        ${dayList(
          days,
          (d) => html`<li class="day-row ${d.parts.length ? '' : 'is-rest'}">
            <span class="day-link">
              ${dayDate(d.date)}
              <span class="day-ref">${d.parts.length
                ? d.parts.map((p) => html`<span class="ref-line">${formatSegments(p.segments)}</span>`)
                : '쉬는 날'}</span>
              ${d.parts.length ? html`<span class="day-min">${readingMinutes(d.chars)}분</span>` : ''}
            </span>
          </li>`,
          'is-preview',
        )}
        <div class="summary-bar">
          <button class="btn btn-ghost" data-action="back">범위 다시 고르기</button>
          <button class="btn btn-primary" data-action="save">이 계획으로 시작</button>
        </div>`,
    );
  };

  const render = () => {
    // 다시 그려도 스크롤 위치와 키보드 포커스를 유지한다.
    const scroll = window.scrollY;
    const focusKey = focusSelector(document.activeElement);
    if (state.step === 'select') renderSelect();
    else renderPreview();
    window.scrollTo(0, scroll);
    if (focusKey) root.querySelector(focusKey)?.focus({ preventScroll: true });
  };

  const changeMonth = (delta) => {
    const next = addMonths(state.y, state.m, delta);
    state.y = next.y;
    state.m = next.m;
    periodChanged();
    render();
  };

  const setPeriodKind = (kind) => {
    if (kind === state.period) return;
    state.period = kind;
    if (kind === 'custom' && !state.start) {
      // 처음 기간을 정할 때: 보고 있던 달이 이번 달이면 오늘부터, 아니면 그 달 1일부터 30일
      state.start = state.y === now.y && state.m === now.m ? now : monthStart(state.y, state.m);
      state.end = addDays(state.start, 29);
    }
    periodChanged();
    render();
  };

  /** 날짜 입력칸이 바뀌었을 때. 시작일을 옮기면 기간 길이는 그대로 두고 마지막 날도 함께 옮긴다. */
  const changeDate = (input) => {
    // 키보드로 연도를 입력하는 도중(0002년 등)에는 바꾸지 않는다.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.value)) return;
    const date = fromISO(input.value);
    if (date.y < 2000 || date.y > 2200) return;
    if (input.id === 'period-start') {
      const length = periodDays();
      state.start = date;
      state.end = addDays(date, length - 1);
    } else {
      const end = clampEnd(state.start, date);
      if (!sameDate(end, date)) {
        toast(compareDate(date, state.start) < 0
          ? '마지막 날은 시작일보다 앞설 수 없습니다'
          : `기간은 최대 ${MAX_PLAN_DAYS}일까지 정할 수 있습니다`);
      }
      state.end = end;
    }
    periodChanged();
    refreshAfterDateInput();
  };

  const save = async () => {
    const { start, end } = period();
    const overlaps = plansOverlapping(start, end);
    if (overlaps.length) {
      const same = overlaps.length === 1 && sameDate(overlaps[0].start, start) && sameDate(overlaps[0].end, end);
      const ok = await confirmDialog({
        title: same && state.period === 'month' ? `${state.m}월 계획을 바꿀까요?` : '계획을 바꿀까요?',
        message: `기존 ${overlaps
          .map((p) => `"${p.title}"${same ? '' : `(${periodLabel(p)})`}`)
          .join(', ')} 계획과 읽음 기록이 지워집니다.`,
        confirmText: '바꾸기',
        danger: true,
      });
      if (!ok) return;
    }
    const sel = planSelection();
    const title = state.title.trim() || describeSelection(sel);
    try {
      await savePlan({
        start,
        end,
        title,
        selection: sel,
        splitChapters: state.split,
        mode: state.mode,
        // 이어서 읽기는 묶음 하나, 그 이름은 계획 이름. 병렬은 책 이름, 그룹은 그룹 이름.
        tracks: state.tracks.map((t) => ({ title: state.mode === 'sequential' ? title : t.title, days: t.days })),
      });
    } catch (err) {
      toast(`저장하지 못했습니다: ${err.message}`);
      return;
    }
    // 이번 계획에 필요한 책을 미리 받아 두면 오프라인에서도 읽을 수 있다.
    Promise.all(Object.keys(sel).map(loadBook)).catch(() => {});
    toast(`${isWholeMonth(start, end) ? `${start.m}월` : formatPeriod(start, end)} 계획을 만들었습니다`);
    const running = compareDate(start, now) <= 0 && compareDate(now, end) <= 0;
    location.hash = running ? '#/' : `#/month/${ymKey(start.y, start.m)}`;
  };

  root.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.month) return changeMonth(Number(d.month));
    if (d.period) return setPeriodKind(d.period);
    if (d.length) {
      state.end = LENGTHS[d.length].end(state.start);
      periodChanged();
    } else if (d.mode) {
      setMode(d.mode);
    } else if (d.group) {
      selectGroup(Number(d.group));
    } else if (d.action === 'add-group') {
      state.groups.push(new Map());
      selectGroup(state.groups.length - 1);
    } else if (d.removeGroup) {
      const i = Number(d.removeGroup);
      state.groups.splice(i, 1);
      selectGroup(Math.min(state.active > i ? state.active - 1 : state.active, state.groups.length - 1));
      toast(`${i + 1}번 그룹을 지웠습니다`);
    } else if (d.preset || d.testament) {
      const books = d.preset ? presetBooks(PRESETS[d.preset]) : allBooks().filter((b) => b.testament === d.testament);
      const on = !books.every(isFull);
      movedNotice(books.reduce((n, b) => n + setBook(b, on), 0));
    } else if (d.toggleBook) {
      const b = book(d.toggleBook);
      movedNotice(setBook(b, !isFull(b)));
    } else if (d.clearBook) {
      state.sel.delete(d.clearBook);
    } else if (d.open) {
      state.open = state.open === d.open ? null : d.open;
    } else if (d.ch) {
      const [code, c] = d.ch.split(':');
      const set = state.sel.get(code);
      if (set?.has(Number(c))) {
        set.delete(Number(c));
        if (!set.size) state.sel.delete(code);
      } else {
        movedNotice(addChapters(code, [Number(c)]));
      }
    } else if (d.action === 'clear') {
      if (isGroup()) {
        state.groups = [new Map()];
        selectGroup(0);
      } else {
        state.sel.clear();
      }
    } else if (d.action === 'preview') {
      const sel = planSelection();
      const chapters = selectionToChapters(sel);
      const days = periodDays();
      const opts = { splitChapters: state.split };
      if (state.mode === 'parallel') {
        state.tracks = buildParallelPlan(getIndex(), chapters, days, opts).map((t) => ({ title: book(t.b).name, days: t.days }));
      } else if (isGroup()) {
        // 빈 그룹은 빼고, 그룹 이름은 그룹에 든 범위로 짓는다 ("시편", "복음서", "이사야–예레미야")
        const groups = filledGroups();
        state.tracks = buildGroupPlan(getIndex(), groups.map(selectionToChapters), days, opts).map((days, i) => ({
          title: describeSelection(groups[i]),
          days,
        }));
      } else {
        state.tracks = [{ title: '', days: buildPlan(getIndex(), chapters, days, opts) }];
      }
      if (!state.titleEdited) {
        const names = state.tracks.map((t) => t.title);
        state.title =
          !isGroup() ? describeSelection(sel) : names.length <= 3 ? names.join(' · ') : `${names[0]} 외 ${names.length - 1}그룹`;
      }
      state.step = 'preview';
      window.scrollTo(0, 0);
      render();
      return;
    } else if (d.action === 'back') {
      state.step = 'select';
    } else if (d.action === 'save') {
      return save();
    } else {
      return;
    }
    render();
  };

  root.onsubmit = (e) => {
    const form = e.target.closest('[data-range]');
    if (!form) return;
    e.preventDefault();
    const b = book(form.dataset.range);
    const max = b.chapters.length;
    const clamp = (v) => Math.min(max, Math.max(1, Math.round(Number(v)) || 1));
    let from = clamp(form.from.value);
    let to = clamp(form.to.value);
    if (from > to) [from, to] = [to, from];
    movedNotice(addChapters(b.code, Array.from({ length: to - from + 1 }, (_, i) => from + i)));
    render();
  };

  root.onchange = (e) => {
    if (e.target.id === 'split') state.split = e.target.checked;
    if (e.target.id === 'period-start' || e.target.id === 'period-end') changeDate(e.target);
  };
  root.oninput = (e) => {
    if (e.target.id !== 'plan-title') return;
    state.title = e.target.value;
    state.titleEdited = true;
  };

  if (customRoute) periodChanged(); // 주소의 날짜를 맞췄으면 주소도 고친다
  render();
}

/** 마지막 날을 시작일부터 최대 기간 안으로 맞춘다. */
function clampEnd(start, end) {
  if (compareDate(end, start) < 0) return start;
  const last = addDays(start, MAX_PLAN_DAYS - 1);
  return compareDate(end, last) > 0 ? last : end;
}

// ── 고른 범위 ──────────────────────────────────────────────
// 화면에서는 범위를 Map(code → Set(장))으로 들고, 저장·계산할 때는 {code: [장...]}으로 바꾼다.

/** Map(code → Set(장)) → {code: [장...]} (성경 순서, 빈 책은 뺀다) */
function selectionOf(map) {
  return Object.fromEntries(
    allBooks()
      .filter((b) => map.get(b.code)?.size)
      .map((b) => [b.code, [...map.get(b.code)].sort((a, c) => a - c)]),
  );
}

const selKey = (map) => JSON.stringify(selectionOf(map));

function unionOf(maps) {
  const all = new Map();
  for (const map of maps) {
    for (const [code, set] of map) all.set(code, new Set([...(all.get(code) ?? []), ...set]));
  }
  return all;
}

/** 저장된 그룹 계획의 그룹마다 고른 장: 그 묶음(track)의 날짜별 분량에 든 장 */
function groupsOfPlan(plan) {
  return plan.tracks.map((t) => {
    const map = new Map();
    for (const d of plan.days) {
      for (const p of d.parts) {
        if (p.track !== t.track) continue;
        for (const s of p.segments) {
          if (!map.has(s.b)) map.set(s.b, new Set());
          map.get(s.b).add(s.c);
        }
      }
    }
    return map;
  });
}

/** 장 목록을 세는 단위: 한 책뿐이면 그 책의 단위(시편은 편), 아니면 장 */
function unitOf(chapters) {
  const books = new Set(chapters.map((x) => x.b));
  return books.size === 1 ? chapterUnit([...books][0]) : '장';
}

/** 다시 그린 뒤 같은 버튼을 찾기 위한 선택자 */
function focusSelector(el) {
  if (!el || el === document.body) return null;
  for (const attr of ['data-ch', 'data-toggle-book', 'data-open', 'data-preset', 'data-testament', 'data-month', 'data-mode', 'data-period', 'data-length', 'data-group']) {
    const v = el.getAttribute?.(attr);
    if (v != null) return `[${attr}="${CSS.escape(v)}"]`;
  }
  return null;
}
