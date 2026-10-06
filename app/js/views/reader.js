// 본문 화면: 그날 분량의 새번역 본문, 마음에 남는 절 저장, 읽음 완료 버튼

import { book, chapterUnit, formatSegments, loadBook, readingMinutes } from '../bible.js';
import { formatDay, formatTimestamp, ymKey } from '../dates.js';
import {
  getPlan,
  getSetting,
  saveVerses,
  savedInReading,
  setRead,
  setSetting,
  unsaveVerses,
  verseCounts,
  verseKey,
} from '../db.js';
import { FONT_SIZE, applyReadingSettings } from '../prefs.js';
import { html, setHTML, toast } from '../ui.js';
import { accountPrefix, bookmarkIcon, checkIcon, readHref } from './common.js';

// 시가서는 한 절씩 줄을 나누어 보여 준다.
const POETRY = new Set(['job', 'psa', 'pro', 'sng', 'lam']);

export async function readerView(root, [y, m, d], { isCurrent }) {
  const plan = getPlan(y, m);
  const entry = plan?.days[d - 1];
  if (!entry || !entry.segments.length) {
    setHTML(
      root,
      html`<section class="empty">
        <h2>${entry ? '이날은 쉬는 날입니다' : '읽기 계획을 찾을 수 없습니다'}</h2>
        <a class="btn btn-primary" href="#/month/${ymKey(y, m)}">달력으로</a>
      </section>`,
    );
    return;
  }

  const readingDays = plan.days.filter((x) => x.segments.length);
  const idx = readingDays.findIndex((x) => x.day === d);
  const prevDay = readingDays[idx - 1];
  const nextDay = readingDays[idx + 1];
  const title = formatSegments(entry.segments);

  setHTML(
    root,
    html`<header class="reader-head">
        <a class="icon-btn" href="#/month/${ymKey(y, m)}" aria-label="달력으로">‹</a>
        <div class="reader-title">
          <small>${accountPrefix()}${formatDay(y, m, d)} · ${idx + 1}/${readingDays.length}</small>
          <b>${title}</b>
        </div>
        <div class="font-ctl" role="group" aria-label="글자 크기">
          <button class="icon-btn" data-font="-1" aria-label="글자 작게">가<sup>−</sup></button>
          <button class="icon-btn" data-font="1" aria-label="글자 크게">가<sup>+</sup></button>
        </div>
      </header>
      <article class="scripture" aria-busy="true">
        <p class="muted loading">본문을 불러오는 중…</p>
      </article>
      <p class="reader-hint">마음에 남는 절을 눌러 저장해 보세요. 저장한 구절은 <a href="#/saved">구절</a> 탭에 모입니다.</p>
      <footer class="reader-foot" id="reader-foot"></footer>
      <div class="select-bar" id="select-bar" hidden></div>`,
  );

  // ── 읽음 완료 ────────────────────────────────────────────
  const renderFoot = (readAt) => {
    setHTML(
      root.querySelector('#reader-foot'),
      html`${readAt
          ? html`<div class="done-box">
              <span class="done-mark">${checkIcon}</span>
              <span><b>읽음</b><small>${formatTimestamp(readAt)}에 기록</small></span>
              <button class="btn btn-ghost btn-sm" data-action="toggle" data-read="1">취소</button>
            </div>`
          : html`<button class="btn btn-primary btn-block btn-lg" data-action="toggle" data-read="0">
              ${checkIcon}<span>읽음 완료 · 약 ${readingMinutes(entry.chars)}분 분량</span>
            </button>`}
        <nav class="day-nav">
          ${prevDay ? html`<a href="${readHref(y, m, prevDay.day)}">‹ ${prevDay.day}일</a>` : html`<span></span>`}
          <a href="#/month/${ymKey(y, m)}">달력</a>
          ${nextDay ? html`<a href="${readHref(y, m, nextDay.day)}">${nextDay.day}일 ›</a>` : html`<span></span>`}
        </nav>`,
    );
  };
  renderFoot(entry.readAt);

  // ── 절 선택과 저장 ───────────────────────────────────────
  const verses = new Map(); // 키 → {b, c, v, e, t}
  const selected = new Set();
  let savedHere = savedInReading(plan.id, d);
  const counts = new Map(); // 키 → 지금까지 저장한 횟수

  const loadCounts = () => {
    counts.clear();
    for (const { b, c } of entry.segments) {
      for (const [v, n] of verseCounts(b, c)) counts.set(verseKey(b, c, v), n);
    }
  };
  loadCounts();

  const paintVerse = (el) => {
    const key = el.dataset.ref;
    el.classList.toggle('is-selected', selected.has(key));
    el.classList.toggle('is-saved', savedHere.has(key));
    el.setAttribute('aria-pressed', selected.has(key));
    const n = counts.get(key) ?? 0;
    setHTML(el.querySelector('.vcount'), n ? html`${bookmarkIcon}${n}` : '');
    el.querySelector('.vcount').title = n ? `${n}번 저장한 절` : '';
  };

  const bar = root.querySelector('#select-bar');
  const renderBar = () => {
    bar.hidden = selected.size === 0;
    if (!selected.size) return;
    const allSaved = [...selected].every((k) => savedHere.has(k));
    setHTML(
      bar,
      html`<span class="select-count"><b>${selected.size}절</b> 선택</span>
        <button class="btn btn-ghost btn-sm" data-action="clear-selection">선택 해제</button>
        ${allSaved
          ? html`<button class="btn btn-ghost btn-sm" data-action="unsave">저장 취소</button>`
          : html`<button class="btn btn-primary btn-sm" data-action="save">${bookmarkIcon}<span>저장</span></button>`}`,
    );
  };

  const repaint = () => {
    root.querySelectorAll('.verse[data-ref]').forEach(paintVerse);
    renderBar();
  };

  const toggleVerse = (el) => {
    const key = el.dataset.ref;
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    paintVerse(el);
    renderBar();
  };

  const saveSelection = async (save) => {
    const list = [...selected].map((k) => verses.get(k));
    try {
      if (save) await saveVerses(plan.id, d, list.filter((x) => !savedHere.has(verseKey(x.b, x.c, x.v))));
      else await unsaveVerses(plan.id, d, list);
    } catch (err) {
      toast(`저장하지 못했습니다: ${err.message}`);
      return;
    }
    savedHere = savedInReading(plan.id, d);
    loadCounts();
    selected.clear();
    repaint();
    toast(save ? `${list.length}절을 저장했습니다` : '저장을 취소했습니다');
  };

  root.onclick = async (e) => {
    const font = e.target.closest('[data-font]');
    if (font) {
      const size = getSetting('fontSize', FONT_SIZE.default) + Number(font.dataset.font);
      if (size < FONT_SIZE.min || size > FONT_SIZE.max) return;
      await setSetting('fontSize', size);
      applyReadingSettings();
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'save' || action === 'unsave') return saveSelection(action === 'save');
    if (action === 'clear-selection') {
      selected.clear();
      repaint();
      return;
    }
    if (action === 'toggle') return toggleRead(e.target.closest('[data-action]'));

    // 글자를 드래그해서 복사하려는 중이면 절 선택으로 보지 않는다.
    const verse = e.target.closest('.verse[data-ref]');
    if (verse && !window.getSelection()?.toString()) toggleVerse(verse);
  };
  root.onkeydown = (e) => {
    const verse = e.target.closest?.('.verse[data-ref]');
    if (verse && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggleVerse(verse);
    }
  };

  const toggleRead = async (btn) => {
    btn.disabled = true;
    const read = btn.dataset.read !== '1';
    try {
      const readAt = await setRead(plan.id, d, read);
      renderFoot(readAt);
      toast(read ? `${m}월 ${d}일 분량을 읽었습니다. 수고하셨어요!` : '읽음 표시를 지웠습니다');
    } catch (err) {
      btn.disabled = false;
      toast(`저장하지 못했습니다: ${err.message}`);
    }
  };

  // ── 본문 ─────────────────────────────────────────────────
  const article = root.querySelector('.scripture');
  try {
    const books = await Promise.all([...new Set(entry.segments.map((s) => s.b))].map(loadBook));
    if (!isCurrent()) return;
    const byCode = new Map(books.map((b) => [b.code, b]));
    setHTML(article, entry.segments.map((s) => renderSegment(s, byCode.get(s.b), verses)));
    article.removeAttribute('aria-busy');
    repaint();
  } catch (err) {
    if (!isCurrent()) return;
    setHTML(
      article,
      html`<p class="error">${err.message}</p>
        <p class="muted">인터넷에 연결되어 있지 않다면, 설정에서 성경 전체를 미리 저장해 두면 오프라인에서도 읽을 수 있습니다.</p>`,
    );
  }
}

/** 한 구간의 본문. 각 절을 verses(키 → 절 정보)에도 담는다. */
function renderSegment(seg, bookData, verses) {
  const ch = bookData.chapters[seg.c - 1];
  const inRange = (v) => seg.from == null || (v >= seg.from && v <= seg.to);
  const list = ch.verses.filter((v) => inRange(v.v));
  const whole = seg.from == null;
  const unit = chapterUnit(seg.b);
  const last = list.at(-1);
  const heading = whole
    ? `${book(seg.b).name} ${seg.c}${unit}`
    : `${book(seg.b).name} ${seg.c}${unit} ${list[0].v}–${last.e ?? last.v}절`;

  // 단락 제목·시편 표제는 해당 절 앞에서 문단을 새로 시작한다.
  const headsAt = new Map();
  for (const h of ch.heads) {
    if (!inRange(h.v)) continue;
    if (!headsAt.has(h.v)) headsAt.set(h.v, []);
    headsAt.get(h.v).push(h);
  }
  const poetry = POETRY.has(seg.b);
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length) blocks.push(html`<p class="${poetry ? 'poetry' : 'prose'}">${current}</p>`);
    current = [];
  };
  for (const v of list) {
    const heads = headsAt.get(v.v);
    if (heads) {
      flush();
      for (const h of heads) {
        blocks.push(h.kind === 'title' ? html`<p class="psalm-title">${h.t}</p>` : html`<h3 class="section">${h.t}</h3>`);
      }
    }
    const key = verseKey(seg.b, seg.c, v.v);
    verses.set(key, { b: seg.b, c: seg.c, v: v.v, e: v.e, t: v.t });
    current.push(
      html`<span class="verse" data-ref="${key}" tabindex="0" role="button" aria-pressed="false"><sup class="vn">${v.e ? `${v.v}-${v.e}` : v.v}</sup>${v.t}<span class="vcount"></span></span> `,
    );
  }
  flush();

  const notes = ch.notes.filter((n) => (n.v === 0 ? whole || seg.from === ch.verses[0].v : inRange(n.v)));
  return html`<section class="chapter">
    <h2 class="chapter-title">${heading}</h2>
    ${blocks}
    ${notes.length
      ? html`<details class="notes">
          <summary>각주 ${notes.length}개</summary>
          <ol>${notes.map((n) => html`<li><b>${n.v === 0 ? '제목' : `${n.v}절`}</b> ${n.t}</li>`)}</ol>
        </details>`
      : ''}
  </section>`;
}
