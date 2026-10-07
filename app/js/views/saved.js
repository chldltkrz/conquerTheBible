// 저장한 구절 화면: 묵상하며 저장한 절을 저장한 횟수, 구절 메모와 함께 모아 본다.

import { book } from '../bible.js';
import { formatTimestamp } from '../dates.js';
import { deleteSavedVerse, listSavedVerses, saveVerseNote, verseKey, verseNotes } from '../db.js';
import { confirmDialog, html, setHTML, toast } from '../ui.js';
import { accountChip, shareIcon, shareVerses, verseTabs } from './common.js';

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

/** 구절 탭 화면들의 머리말 + 하위 탭 */
export function verseHead(active, eyebrow, title) {
  return html`<header class="page-head head-row">
      <div>
        <p class="eyebrow">${eyebrow}</p>
        <h1>${title}</h1>
      </div>
      ${accountChip()}
    </header>
    ${verseTabs(active)}`;
}

export async function savedView(root) {
  let editing = null; // 메모를 고치고 있는 절의 키

  const render = () => {
    const list = listSavedVerses();
    const notes = verseNotes();
    const times = list.reduce((s, x) => s + x.times, 0);
    const head = verseHead('saved', '묵상하며 마음에 남은 말씀', '저장한 구절');

    if (!list.length) {
      setHTML(
        root,
        html`${head}
          <section class="empty">
            <h2>아직 저장한 구절이 없습니다</h2>
            <p>본문을 읽다가 마음에 남는 절을 누르고 <b>저장</b>을 누르세요. 다른 날 같은 절을 또 저장하면 횟수가 늘어납니다.
              <b>검색</b>에서 찾은 절도 저장할 수 있습니다.</p>
            <a class="btn btn-primary" href="#/">오늘의 읽기로</a>
          </section>`,
      );
      return;
    }

    const memo = (x) => {
      const key = verseKey(x.b, x.c, x.v);
      const note = notes.get(key);
      if (editing === key) {
        return html`<form class="verse-memo-form" data-memo-form="${key}">
          <textarea name="text" rows="3" maxlength="1000" aria-label="${verseRef(x)} 메모"
            placeholder="이 말씀이 왜 마음에 남았는지 적어 보세요">${note?.text ?? ''}</textarea>
          <div class="button-row">
            <button class="btn btn-primary btn-sm">메모 저장</button>
            <button type="button" class="btn btn-ghost btn-sm" data-memo-cancel>취소</button>
          </div>
        </form>`;
      }
      return note ? html`<p class="verse-memo">${note.text}</p>` : '';
    };

    setHTML(
      root,
      html`${head}
        <div class="plan-summary">
          <b>${list.length}구절</b>
          <span>모두 ${times}번 저장 · 메모 ${notes.size}개</span>
        </div>
        <div class="segmented sort-tabs" role="radiogroup" aria-label="정렬">
          ${SORTS.map((s) => html`<button role="radio" data-sort="${s.id}" aria-checked="${sort === s.id}">${s.label}</button>`)}
        </div>
        <ul class="saved-list">
          ${sorted(list).map((x) => {
            const key = verseKey(x.b, x.c, x.v);
            return html`<li class="saved-item" id="v-${key.replace(/:/g, '-')}">
              <div class="saved-head">
                <b class="saved-ref">${verseRef(x)}</b>
                <span class="times ${x.times > 1 ? 'is-many' : ''}" aria-label="${x.times}번 저장">${x.times}회</span>
              </div>
              <p class="saved-text">${x.t}</p>
              ${memo(x)}
              <div class="saved-foot">
                <details>
                  <summary>${x.times > 1 ? `저장한 날 ${x.times}번 · 최근 ` : ''}${formatTimestamp(x.lastAt)}</summary>
                  <ol>${x.dates.map((t) => html`<li>${formatTimestamp(t)}</li>`)}</ol>
                </details>
                <span class="saved-actions">
                  ${editing === key ? '' : html`<button class="link" data-memo="${key}">${notes.has(key) ? '메모 고치기' : '메모'}</button>`}
                  <button class="link" data-share="${key}">${shareIcon}<span>공유</span></button>
                  <button class="link danger" data-delete="${key}" data-label="${verseRef(x)}">삭제</button>
                </span>
              </div>
            </li>`;
          })}
        </ul>`,
    );
    if (editing) root.querySelector(`[data-memo-form="${editing}"] textarea`)?.focus();
  };

  root.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const d = btn.dataset;
    if (d.share) {
      const [b, c, v] = d.share.split(':');
      const x = listSavedVerses().find((s) => s.b === b && s.c === Number(c) && s.v === Number(v));
      if (x) shareVerses([x]);
    } else if (d.memo) {
      editing = d.memo;
      render();
    } else if (d.memoCancel != null) {
      editing = null;
      render();
    } else if (d.sort) {
      sort = d.sort;
      render();
    } else if (d.delete) {
      const ok = await confirmDialog({
        title: '구절을 지울까요?',
        message: `${d.label}의 저장 기록과 메모가 모두 지워집니다.`,
        confirmText: '지우기',
        danger: true,
      });
      if (!ok) return;
      const [b, c, v] = d.delete.split(':');
      await deleteSavedVerse(b, Number(c), Number(v));
      toast('구절을 지웠습니다');
      render();
    }
  };

  root.onsubmit = async (e) => {
    const form = e.target.closest('[data-memo-form]');
    if (!form) return;
    e.preventDefault();
    const [b, c, v] = form.dataset.memoForm.split(':');
    try {
      const at = await saveVerseNote(b, Number(c), Number(v), form.text.value);
      toast(at ? '메모를 저장했습니다' : '메모를 지웠습니다');
    } catch (err) {
      toast(`저장하지 못했습니다: ${err.message}`);
      return;
    }
    editing = null;
    render();
  };

  render();
}
