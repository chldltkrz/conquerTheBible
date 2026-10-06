// 저장한 구절 화면: 묵상하며 저장한 절을 저장한 횟수와 함께 모아 본다.

import { book } from '../bible.js';
import { formatTimestamp } from '../dates.js';
import { deleteSavedVerse, listSavedVerses } from '../db.js';
import { confirmDialog, html, setHTML, toast } from '../ui.js';
import { accountChip } from './common.js';

const SORTS = [
  { id: 'count', label: '많이 저장한 순' },
  { id: 'recent', label: '최근 저장 순' },
  { id: 'bible', label: '성경 순서' },
];
let sort = 'count'; // 화면을 떠났다 돌아와도 유지

export const verseRef = (x) => `${book(x.b).name} ${x.c}:${x.v}${x.e ? `-${x.e}` : ''}`;

function sorted(list) {
  const copy = [...list];
  if (sort === 'recent') copy.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  if (sort === 'bible') copy.sort((a, b) => book(a.b).order - book(b.b).order || a.c - b.c || a.v - b.v);
  return copy; // 'count'는 DB가 이미 그 순서로 준다
}

export async function savedView(root) {
  const render = () => {
    const list = listSavedVerses();
    const times = list.reduce((s, x) => s + x.times, 0);
    const head = html`<header class="page-head head-row">
      <div>
        <p class="eyebrow">묵상하며 마음에 남은 말씀</p>
        <h1>저장한 구절</h1>
      </div>
      ${accountChip()}
    </header>`;

    if (!list.length) {
      setHTML(
        root,
        html`${head}
          <section class="empty">
            <h2>아직 저장한 구절이 없습니다</h2>
            <p>본문을 읽다가 마음에 남는 절을 누르고 <b>저장</b>을 누르세요. 다른 날 같은 절을 또 저장하면 횟수가 늘어납니다.</p>
            <a class="btn btn-primary" href="#/">오늘의 읽기로</a>
          </section>`,
      );
      return;
    }

    setHTML(
      root,
      html`${head}
        <div class="plan-summary">
          <b>${list.length}구절</b>
          <span>모두 ${times}번 저장</span>
        </div>
        <div class="segmented sort-tabs" role="radiogroup" aria-label="정렬">
          ${SORTS.map((s) => html`<button role="radio" data-sort="${s.id}" aria-checked="${sort === s.id}">${s.label}</button>`)}
        </div>
        <ul class="saved-list">
          ${sorted(list).map(
            (x) => html`<li class="saved-item">
              <div class="saved-head">
                <b class="saved-ref">${verseRef(x)}</b>
                <span class="times ${x.times > 1 ? 'is-many' : ''}" aria-label="${x.times}번 저장">${x.times}회</span>
              </div>
              <p class="saved-text">${x.t}</p>
              <div class="saved-foot">
                <details>
                  <summary>${x.times > 1 ? `저장한 날 ${x.times}번 · 최근 ` : ''}${formatTimestamp(x.lastAt)}</summary>
                  <ol>${x.dates.map((t) => html`<li>${formatTimestamp(t)}</li>`)}</ol>
                </details>
                <button class="link danger" data-delete="${x.b}:${x.c}:${x.v}" data-label="${verseRef(x)}">삭제</button>
              </div>
            </li>`,
          )}
        </ul>`,
    );
  };

  root.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.sort) {
      sort = btn.dataset.sort;
      render();
      return;
    }
    if (btn.dataset.delete) {
      const ok = await confirmDialog({
        title: '구절을 지울까요?',
        message: `${btn.dataset.label}의 저장 기록이 모두 지워집니다.`,
        confirmText: '지우기',
        danger: true,
      });
      if (!ok) return;
      const [b, c, v] = btn.dataset.delete.split(':');
      await deleteSavedVerse(b, Number(c), Number(v));
      toast('구절을 지웠습니다');
      render();
    }
  };

  render();
}
