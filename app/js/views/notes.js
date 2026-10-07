// 묵상 메모 화면: 날짜별 묵상 메모와 구절 메모를 최근에 쓴 순서로 모아 본다.

import { formatDay, formatTimestamp } from '../dates.js';
import { listNotes, planOn } from '../db.js';
import { html, setHTML } from '../ui.js';
import { readHref } from './common.js';
import { verseHead, verseRef } from './saved.js';

export async function notesView(root) {
  const notes = listNotes();
  const head = verseHead('notes', '말씀 앞에서 적은 고백', '묵상 메모');

  if (!notes.length) {
    setHTML(
      root,
      html`${head}
        <section class="empty">
          <h2>아직 쓴 메모가 없습니다</h2>
          <p>본문 화면 아래 <b>오늘의 묵상 메모</b>에 적거나, 저장한 구절에서 <b>메모</b>를 눌러 남길 수 있습니다.</p>
          <a class="btn btn-primary" href="#/">오늘의 읽기로</a>
        </section>`,
    );
    return;
  }

  const dayCount = notes.filter((n) => n.kind === 'day').length;
  setHTML(
    root,
    html`${head}
      <div class="plan-summary">
        <b>메모 ${notes.length}개</b>
        <span>읽은 날 ${dayCount}개 · 구절 ${notes.length - dayCount}개</span>
      </div>
      <ul class="saved-list">
        ${notes.map((n) =>
          n.kind === 'day'
            ? html`<li class="saved-item note-item">
                <div class="saved-head">
                  <b class="saved-ref">${formatDay(n.date.y, n.date.m, n.date.d)}</b>
                  <span class="note-kind">읽은 날</span>
                </div>
                <p class="note-passage">${n.passage}</p>
                <p class="note-text">${n.text}</p>
                <div class="saved-foot">
                  <small>${formatTimestamp(n.updatedAt)} 저장</small>
                  ${planOn(n.date) ? html`<a class="link" href="${readHref(n.date)}">본문 보기 ›</a>` : ''}
                </div>
              </li>`
            : html`<li class="saved-item note-item">
                <div class="saved-head">
                  <b class="saved-ref">${verseRef(n)}</b>
                  <span class="note-kind">구절</span>
                </div>
                ${n.verseText ? html`<p class="saved-text">${n.verseText}</p>` : ''}
                <p class="note-text">${n.text}</p>
                <div class="saved-foot">
                  <small>${formatTimestamp(n.updatedAt)} 저장</small>
                  <a class="link" href="#/saved">구절에서 고치기 ›</a>
                </div>
              </li>`,
        )}
      </ul>`,
  );
}
