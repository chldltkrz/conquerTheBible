// 새 계획 화면: 읽을 범위 고르기 → 날짜별 분량 미리보기 → 저장

import {
  allBooks,
  book,
  chapterChars,
  describeSelection,
  formatSegments,
  getIndex,
  loadBook,
  PRESETS,
  presetBooks,
  readingMinutes,
  selectionToChapters,
} from '../bible.js';
import { addMonths, daysInMonth, formatMonth, today, weekday, WEEKDAYS, ymKey } from '../dates.js';
import { getPlan, savePlan } from '../db.js';
import { buildPlan } from '../planner.js';
import { confirmDialog, formatNumber, html, setHTML, toast } from '../ui.js';

export async function newPlanView(root, [y, m]) {
  const now = today();
  const state = {
    y: y ?? now.y,
    m: m ?? now.m,
    sel: new Map(), // code → Set(장)
    split: true,
    open: null, // 장 목록을 펼친 책
    step: 'select',
    days: null,
    title: '',
    titleEdited: false, // 사용자가 계획 이름을 직접 고쳤는지
  };

  // 이미 계획이 있는 달이면 그 범위를 불러와 고칠 수 있게 한다.
  const loadExisting = () => {
    const existing = getPlan(state.y, state.m);
    state.sel = new Map(
      Object.entries(existing?.selection ?? {}).map(([code, chs]) => [code, new Set(chs)]),
    );
    if (existing) state.split = existing.splitChapters;
    return existing;
  };
  loadExisting();

  const selectionObject = () =>
    Object.fromEntries(
      allBooks()
        .filter((b) => state.sel.get(b.code)?.size)
        .map((b) => [b.code, [...state.sel.get(b.code)].sort((a, c) => a - c)]),
    );
  const count = (code) => state.sel.get(code)?.size ?? 0;
  const isFull = (b) => count(b.code) === b.chapters.length;
  const setBook = (b, on) => {
    if (on) state.sel.set(b.code, new Set(b.chapters.map((_, i) => i + 1)));
    else state.sel.delete(b.code);
  };

  // ── 1단계: 범위 고르기 ────────────────────────────────────
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
          <small>${n ? `${n}/${total}${unit}` : `${total}${unit}`}</small>
          <span class="chev" aria-hidden="true">▾</span>
        </button>
      </div>
      ${open
        ? html`<div class="chapter-panel">
            <div class="chapter-grid">
              ${b.chapters.map(
                (_, i) => html`<button class="ch ${state.sel.get(b.code)?.has(i + 1) ? 'on' : ''}"
                  data-ch="${b.code}:${i + 1}" aria-pressed="${!!state.sel.get(b.code)?.has(i + 1)}">${i + 1}</button>`,
              )}
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

  const renderSelect = () => {
    const days = daysInMonth(state.y, state.m);
    const chapters = selectionToChapters(selectionObject());
    const chars = chapters.reduce((s, x) => s + chapterChars(x.b, x.c), 0);
    const existing = getPlan(state.y, state.m);
    const books = allBooks();
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

    setHTML(
      root,
      html`<header class="page-head month-head">
          <button class="icon-btn" data-month="-1" aria-label="이전 달">‹</button>
          <div>
            <p class="eyebrow">새 읽기 계획</p>
            <h1>${formatMonth(state.y, state.m)}</h1>
          </div>
          <button class="icon-btn" data-month="1" aria-label="다음 달">›</button>
        </header>
        <p class="lead">읽을 범위를 고르면 ${state.m}월 1일부터 ${days}일까지 날마다 비슷한 분량으로 나눕니다.</p>
        ${existing
          ? html`<p class="notice">이 달에는 이미 <b>${existing.title}</b> 계획이 있습니다. 새로 저장하면 기존 계획과 읽음 기록이 지워집니다.</p>`
          : ''}
        <section class="block">
          <h2 class="block-title">빠른 선택</h2>
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
        </label>
        <div class="summary-bar">
          <div class="summary-text">
            ${chapters.length
              ? html`<b>${formatNumber(chapters.length)}장</b> 선택 · 하루 평균 약 ${readingMinutes(chars / days)}분`
              : html`<span class="muted">읽을 범위를 골라 주세요</span>`}
          </div>
          ${chapters.length ? html`<button class="btn btn-ghost btn-sm" data-action="clear">초기화</button>` : ''}
          <button class="btn btn-primary" data-action="preview" ${chapters.length ? '' : 'disabled'}>다음</button>
        </div>`,
    );
  };

  // ── 2단계: 미리보기 ──────────────────────────────────────
  const renderPreview = () => {
    const minutes = state.days.filter((d) => d.segments.length).map((d) => readingMinutes(d.chars));
    const [lo, hi] = [Math.min(...minutes), Math.max(...minutes)];
    const total = state.days.reduce((s, d) => s + d.chars, 0);
    const chapters = selectionToChapters(selectionObject()).length;
    setHTML(
      root,
      html`<header class="page-head month-head">
          <button class="icon-btn" data-action="back" aria-label="범위 다시 고르기">‹</button>
          <div>
            <p class="eyebrow">${formatMonth(state.y, state.m)} 계획 미리보기</p>
            <h1>${state.title}</h1>
          </div>
          <span></span>
        </header>
        <div class="plan-summary">
          <b>${formatNumber(chapters)}장 · ${formatNumber(total)}자</b>
          <span>${lo === hi
            ? `하루 약 ${lo}분`
            : `하루 약 ${lo}–${hi}분 (평균 ${readingMinutes(total / minutes.length)}분)`}</span>
        </div>
        <label class="field">
          <span>계획 이름</span>
          <input id="plan-title" value="${state.title}" maxlength="40" autocomplete="off" />
        </label>
        <ul class="day-list is-preview">
          ${state.days.map((d, i) => {
            const wd = weekday(state.y, state.m, i + 1);
            return html`<li class="day-row ${d.segments.length ? '' : 'is-rest'}">
              <span class="day-link">
                <span class="day-date ${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}"><b>${i + 1}</b><small>${WEEKDAYS[wd]}</small></span>
                <span class="day-ref">${d.segments.length ? formatSegments(d.segments) : '쉬는 날'}</span>
                ${d.segments.length ? html`<span class="day-min">${readingMinutes(d.chars)}분</span>` : ''}
              </span>
            </li>`;
          })}
        </ul>
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
    history.replaceState(null, '', `#/new/${ymKey(state.y, state.m)}`);
    // 새 달에 계획이 있으면 그 범위를, 없으면 지금까지 고른 범위를 그대로 쓴다.
    if (getPlan(state.y, state.m)) loadExisting();
    render();
  };

  const save = async () => {
    const existing = getPlan(state.y, state.m);
    if (existing) {
      const ok = await confirmDialog({
        title: `${state.m}월 계획을 바꿀까요?`,
        message: `기존 "${existing.title}" 계획과 읽음 기록이 지워집니다.`,
        confirmText: '바꾸기',
        danger: true,
      });
      if (!ok) return;
    }
    const sel = selectionObject();
    try {
      await savePlan({
        year: state.y,
        month: state.m,
        title: state.title.trim() || describeSelection(sel),
        selection: sel,
        splitChapters: state.split,
        days: state.days,
      });
    } catch (err) {
      toast(`저장하지 못했습니다: ${err.message}`);
      return;
    }
    // 이번 계획에 필요한 책을 미리 받아 두면 오프라인에서도 읽을 수 있다.
    Promise.all(Object.keys(sel).map(loadBook)).catch(() => {});
    toast(`${state.m}월 계획을 만들었습니다`);
    location.hash = state.y === now.y && state.m === now.m ? '#/' : `#/month/${ymKey(state.y, state.m)}`;
  };

  root.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.month) return changeMonth(Number(d.month));
    if (d.preset) {
      const books = presetBooks(PRESETS[d.preset]);
      const on = !books.every(isFull);
      books.forEach((b) => setBook(b, on));
    } else if (d.testament) {
      const books = allBooks().filter((b) => b.testament === d.testament);
      const on = !books.every(isFull);
      books.forEach((b) => setBook(b, on));
    } else if (d.toggleBook) {
      const b = book(d.toggleBook);
      setBook(b, !isFull(b));
    } else if (d.clearBook) {
      state.sel.delete(d.clearBook);
    } else if (d.open) {
      state.open = state.open === d.open ? null : d.open;
    } else if (d.ch) {
      const [code, c] = d.ch.split(':');
      const set = state.sel.get(code) ?? new Set();
      if (set.has(Number(c))) set.delete(Number(c));
      else set.add(Number(c));
      if (set.size) state.sel.set(code, set);
      else state.sel.delete(code);
    } else if (d.action === 'clear') {
      state.sel.clear();
    } else if (d.action === 'preview') {
      const sel = selectionObject();
      state.days = buildPlan(getIndex(), selectionToChapters(sel), daysInMonth(state.y, state.m), {
        splitChapters: state.split,
      });
      if (!state.titleEdited) state.title = describeSelection(sel);
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
    const set = state.sel.get(b.code) ?? new Set();
    for (let c = from; c <= to; c++) set.add(c);
    state.sel.set(b.code, set);
    render();
  };

  root.onchange = (e) => {
    if (e.target.id === 'split') state.split = e.target.checked;
  };
  root.oninput = (e) => {
    if (e.target.id !== 'plan-title') return;
    state.title = e.target.value;
    state.titleEdited = true;
  };

  render();
}

/** 다시 그린 뒤 같은 버튼을 찾기 위한 선택자 */
function focusSelector(el) {
  if (!el || el === document.body) return null;
  for (const attr of ['data-ch', 'data-toggle-book', 'data-open', 'data-preset', 'data-testament', 'data-month']) {
    const v = el.getAttribute?.(attr);
    if (v != null) return `[${attr}="${CSS.escape(v)}"]`;
  }
  return null;
}
