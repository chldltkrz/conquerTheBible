// 오늘 화면 맨 위의 "올해의 말씀": 가운데 상자에 보여 주고, 오른쪽 연필 버튼으로 바꾼다.
// 계정마다 따로 정하고, 해가 바뀌면 새로 정하도록 빈 상자로 돌아간다.

import { allBooks, book } from '../bible.js';
import { today } from '../dates.js';
import { saveYearVerse, yearVerse } from '../db.js';
import { verseNumbers } from '../planner.js';
import { html, setHTML, toast } from '../ui.js';
import { loadPassage, passageRef, passageText, YEAR_SUGGESTIONS } from '../verses.js';

const pencilIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>`;

/** 올해 정한 말씀. 지난해에 정한 것이면 null */
function thisYears(now) {
  const saved = yearVerse();
  return saved?.year === now.y && saved.text ? saved : null;
}

/** 올해의 말씀을 정했는지 (정했으면 오늘 화면 맨 위, 아직이면 맨 아래에 정하기 상자를 둔다) */
export const hasYearVerse = (now = today()) => !!thisYears(now);

/** 오늘 화면의 올해의 말씀 상자 */
export function yearVerseBox(now = today()) {
  const mine = thisYears(now);
  return html`<section class="year-verse ${mine ? '' : 'is-empty'}" aria-label="${now.y}년 올해의 말씀">
    <p class="yv-label">${now.y}년 올해의 말씀</p>
    ${mine
      ? html`<p class="yv-text">${mine.text}</p>${mine.ref ? html`<p class="yv-ref">${mine.ref}</p>` : ''}`
      : html`<p class="yv-empty">한 해 동안 마음에 품을 말씀을 정해 보세요</p>
          <button class="btn btn-ghost btn-sm" data-action="edit-year-verse">말씀 정하기</button>`}
    <button class="icon-btn yv-edit" data-action="edit-year-verse" aria-label="올해의 말씀 ${mine ? '바꾸기' : '정하기'}">
      ${pencilIcon}
    </button>
  </section>`;
}

/**
 * 올해의 말씀 고치기 창. 성경 구절을 골라 불러오거나, 교회 표어처럼 원하는 문구를 직접 적는다.
 * 저장하거나 지우면 onSaved()를 부른다.
 */
export function openYearVerseEditor(onSaved) {
  const now = today();
  const mine = thisYears(now);
  const books = allBooks();
  const pick = { b: mine?.b ?? 'isa', c: mine?.c ?? 43, v: mine?.v ?? 19, to: mine?.to ?? mine?.v ?? 19 };

  const dlg = document.createElement('dialog');
  dlg.className = 'dialog yv-dialog';
  dlg.setAttribute('aria-labelledby', 'yv-title');
  setHTML(
    dlg,
    html`<form class="yv-form">
      <h2 id="yv-title">${now.y}년 올해의 말씀</h2>
      <p>성경 구절을 골라 불러오거나, 교회 표어처럼 원하는 문구를 직접 적을 수 있습니다.</p>
      <div class="yv-suggest" aria-label="추천 구절">
        ${YEAR_SUGGESTIONS.map((s, i) => html`<button type="button" class="chip" data-suggest="${i}">${passageRef(s)}</button>`)}
      </div>
      <fieldset class="yv-pick">
        <legend>구절 찾기</legend>
        <select name="b" aria-label="책">
          ${books.map((x) => html`<option value="${x.code}" ${x.code === pick.b ? 'selected' : ''}>${x.name}</option>`)}
        </select>
        <div class="yv-nums">
          <input name="c" type="number" min="1" value="${pick.c}" inputmode="numeric" aria-label="장" /><span>장</span>
          <input name="v" type="number" min="1" value="${pick.v}" inputmode="numeric" aria-label="시작 절" /><span>–</span>
          <input name="to" type="number" min="1" value="${pick.to}" inputmode="numeric" aria-label="끝 절" /><span>절</span>
          <button type="button" class="btn btn-ghost btn-sm" data-action="load">불러오기</button>
        </div>
      </fieldset>
      <label class="field">
        <span>말씀</span>
        <textarea name="text" rows="4" maxlength="300" placeholder="구절을 불러오거나 직접 적어 주세요">${mine?.text ?? ''}</textarea>
      </label>
      <label class="field">
        <span>출처 <small>(비워 두어도 됩니다)</small></span>
        <input name="ref" maxlength="40" value="${mine?.ref ?? ''}" placeholder="예: 이사야서 43:19" autocomplete="off" />
      </label>
      <div class="dialog-actions">
        ${mine ? html`<button type="button" class="btn btn-ghost yv-clear" data-action="clear">지우기</button>` : ''}
        <button type="button" class="btn btn-ghost" data-close>취소</button>
        <button class="btn btn-primary">저장</button>
      </div>
    </form>`,
  );
  const form = dlg.querySelector('form');

  /** 장·절 칸을 그 책·장에 있는 번호로 맞춘다 */
  const clampFields = () => {
    const b = book(form.b.value);
    const c = Math.min(b.chapters.length, Math.max(1, Math.round(Number(form.c.value)) || 1));
    const nums = verseNumbers(b.chapters[c - 1]);
    const fit = (n) => Math.min(nums.at(-1), Math.max(nums[0], Math.round(Number(n)) || nums[0]));
    let v = fit(form.v.value);
    let to = fit(form.to.value || v);
    if (to < v) [v, to] = [to, v];
    form.c.value = c;
    form.c.max = b.chapters.length;
    form.v.value = v;
    form.to.value = to;
    form.v.max = form.to.max = nums.at(-1);
    return { b: b.code, c, v, to };
  };

  /** 고른 구절의 본문을 말씀 칸에, 구절 이름을 출처 칸에 넣는다 */
  const loadPick = async () => {
    const ref = clampFields();
    try {
      const verses = await loadPassage(ref);
      if (!verses.length) throw new Error('구절을 찾지 못했습니다');
      form.text.value = passageText(verses);
      form.ref.value = passageRef(ref);
      Object.assign(pick, ref);
    } catch (err) {
      toast(`불러오지 못했습니다: ${err.message}`);
    }
  };

  dlg.addEventListener('click', async (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
    const s = e.target.closest('[data-suggest]');
    if (s) {
      const ref = YEAR_SUGGESTIONS[Number(s.dataset.suggest)];
      form.b.value = ref.b;
      form.c.value = ref.c;
      form.v.value = ref.v;
      form.to.value = ref.to;
      return loadPick();
    }
    if (e.target.closest('[data-action="load"]')) return loadPick();
    if (e.target.closest('[data-action="clear"]')) {
      await saveYearVerse(null);
      dlg.close();
      toast('올해의 말씀을 지웠습니다');
      onSaved();
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = form.text.value.trim();
    if (!text) {
      toast('말씀을 적거나 구절을 불러와 주세요');
      form.text.focus();
      return;
    }
    const ref = form.ref.value.trim();
    // 불러온 구절 그대로면 구절 위치도 기억해 둔다 (다음에 창을 열 때 그 구절이 골라져 있도록)
    const fromPick = ref === passageRef(pick);
    await saveYearVerse({ year: now.y, text, ref, ...(fromPick ? pick : {}) });
    dlg.close();
    toast('올해의 말씀을 정했습니다');
    onSaved();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
