// 본문 화면: 그날 분량의 새번역 본문과 읽음 완료 버튼

import { book, chapterUnit, formatSegments, loadBook, readingMinutes } from '../bible.js';
import { formatDay, formatTimestamp, ymKey } from '../dates.js';
import { getPlan, getSetting, setRead, setSetting } from '../db.js';
import { FONT_SIZE, applyReadingSettings } from '../prefs.js';
import { html, setHTML, toast } from '../ui.js';
import { checkIcon, readHref } from './common.js';

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
          <small>${formatDay(y, m, d)} · ${idx + 1}/${readingDays.length}</small>
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
      <footer class="reader-foot" id="reader-foot"></footer>`,
  );

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

  root.onclick = async (e) => {
    const font = e.target.closest('[data-font]');
    if (font) {
      const size = getSetting('fontSize', FONT_SIZE.default) + Number(font.dataset.font);
      if (size < FONT_SIZE.min || size > FONT_SIZE.max) return;
      await setSetting('fontSize', size);
      applyReadingSettings();
      return;
    }
    const btn = e.target.closest('[data-action="toggle"]');
    if (!btn) return;
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

  const article = root.querySelector('.scripture');
  try {
    const books = await Promise.all([...new Set(entry.segments.map((s) => s.b))].map(loadBook));
    if (!isCurrent()) return;
    const byCode = new Map(books.map((b) => [b.code, b]));
    setHTML(article, entry.segments.map((s) => renderSegment(s, byCode.get(s.b))));
    article.removeAttribute('aria-busy');
  } catch (err) {
    if (!isCurrent()) return;
    setHTML(
      article,
      html`<p class="error">${err.message}</p>
        <p class="muted">인터넷에 연결되어 있지 않다면, 설정에서 성경 전체를 미리 저장해 두면 오프라인에서도 읽을 수 있습니다.</p>`,
    );
  }
}

function renderSegment(seg, bookData) {
  const ch = bookData.chapters[seg.c - 1];
  const inRange = (v) => seg.from == null || (v >= seg.from && v <= seg.to);
  const verses = ch.verses.filter((v) => inRange(v.v));
  const whole = seg.from == null;
  const unit = chapterUnit(seg.b);
  const last = verses.at(-1);
  const heading = whole
    ? `${book(seg.b).name} ${seg.c}${unit}`
    : `${book(seg.b).name} ${seg.c}${unit} ${verses[0].v}–${last.e ?? last.v}절`;

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
  for (const v of verses) {
    const heads = headsAt.get(v.v);
    if (heads) {
      flush();
      for (const h of heads) {
        blocks.push(h.kind === 'title' ? html`<p class="psalm-title">${h.t}</p>` : html`<h3 class="section">${h.t}</h3>`);
      }
    }
    current.push(html`<span class="verse"><sup class="vn">${v.e ? `${v.v}-${v.e}` : v.v}</sup>${v.t}</span> `);
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
