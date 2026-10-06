// 여러 화면에서 함께 쓰는 조각들

import { book, chapterUnit, formatSegments, readingMinutes } from '../bible.js';
import { compareDate, today, weekday, WEEKDAYS, ymKey } from '../dates.js';
import {
  createAccount,
  currentAccount,
  getPlan,
  listAccounts,
  readDates,
  scheduledDates,
  setRead,
  switchAccount,
} from '../db.js';
import { html, josa, setHTML, toast } from '../ui.js';

/** 본문 화면 주소. track을 주면 그 책 부분으로 바로 내려간다. */
export const readHref = (y, m, d, track) => `#/read/${ymKey(y, m)}/${d}${track == null ? '' : `/${track}`}`;

export const checkIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>`;
export const bookmarkIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" /></svg>`;

// ── 계정 ───────────────────────────────────────────────────

/** 이름 첫 글자를 담은 색 동그라미 */
export function avatar(acc, cls = '') {
  return html`<span class="avatar ${cls}" style="background:${acc.color}" aria-hidden="true">${[...acc.name][0] ?? '?'}</span>`;
}

/** 머리말 오른쪽의 지금 계정 표시. 누르면 계정 바꾸기 창이 열린다. (main.js가 처리) */
export function accountChip() {
  const acc = currentAccount();
  return html`<button class="account-chip" data-action="switch-account" aria-label="계정 바꾸기, 지금 계정: ${acc.name}">
    ${avatar(acc)}<span>${acc.name}</span><span class="chev" aria-hidden="true">▾</span>
  </button>`;
}

/** 계정이 둘 이상일 때만 "이름 · " 접두어 */
export function accountPrefix() {
  return listAccounts().length > 1 ? `${currentAccount().name} · ` : '';
}

/** 그 계정의 이번 달 계획과 오늘 읽었는지 한 줄 요약 */
export function accountStatus(accountId, now = today()) {
  const plan = getPlan(now.y, now.m, accountId);
  if (!plan) return { text: `${now.m}월 계획 없음`, state: 'none' };
  const entry = plan.days[now.d - 1];
  if (!entry.segments.length) return { text: `${plan.title} · 오늘은 쉬는 날`, state: 'rest' };
  if (entry.readAt) return { text: `${plan.title} · 오늘 읽음`, state: 'read' };
  if (entry.readParts) {
    return { text: `${plan.title} · 오늘 ${entry.readParts}/${entry.parts.length}권 읽음`, state: 'todo' };
  }
  return { text: `${plan.title} · 오늘 ${formatSegments(entry.segments, { short: true })}`, state: 'todo' };
}

export const isParallel = (plan) => plan.mode === 'parallel';
export const modeLabel = (plan) => (isParallel(plan) ? `${plan.tracks.length}권 병렬` : '');

/** 계정을 바꾼 뒤 지금 화면을 다시 그리도록 알린다. */
export async function changeAccount(id) {
  await switchAccount(id);
  window.dispatchEvent(new Event('account-changed'));
  toast(`${currentAccount().name} 계정으로 바꿨습니다`);
}

/** 계정 바꾸기·추가 창 */
export function openAccountSwitcher() {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog account-dialog';
  const now = today();
  const cur = currentAccount().id;
  setHTML(
    dlg,
    html`<h2>계정</h2>
      <p>계정마다 읽기 계획, 읽음 기록, 저장한 구절이 따로 있습니다.</p>
      <ul class="account-list">
        ${listAccounts().map((acc) => {
          const status = accountStatus(acc.id, now);
          return html`<li>
            <button class="account-item ${acc.id === cur ? 'is-current' : ''}" data-account="${acc.id}"
              aria-current="${acc.id === cur}">
              ${avatar(acc)}
              <span class="account-text"><b>${acc.name}</b><small class="is-${status.state}">${status.text}</small></span>
              ${acc.id === cur ? html`<span class="account-check">${checkIcon}</span>` : ''}
            </button>
          </li>`;
        })}
      </ul>
      <form class="account-new">
        <input name="name" placeholder="새 계정 이름" maxlength="20" required autocomplete="off" aria-label="새 계정 이름" />
        <button class="btn btn-primary btn-sm">추가</button>
      </form>
      <div class="dialog-actions"><button class="btn btn-ghost" data-close>닫기</button></div>`,
  );
  dlg.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return dlg.close();
    const item = e.target.closest('[data-account]');
    if (!item) return;
    dlg.close();
    const id = Number(item.dataset.account);
    if (id !== cur) await changeAccount(id);
  });
  dlg.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    dlg.close();
    const id = await createAccount(name);
    await switchAccount(id);
    toast(`${name} 계정을 만들었습니다. 읽을 범위를 골라 주세요`);
    // 새 계정은 계획이 없으니 바로 이번 달 계획 만들기로 간다.
    const target = `#/new/${ymKey(now.y, now.m)}`;
    if (location.hash === target) window.dispatchEvent(new Event('account-changed'));
    else location.hash = target;
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/** 날짜별 분량 한 줄: 날짜 · 범위 · 분 · 읽음 버튼 */
export function dayRow(plan, entry, now) {
  const { year: y, month: m } = plan;
  const date = { y, m, d: entry.day };
  const rest = entry.segments.length === 0;
  const cmp = compareDate(date, now);
  const state = entry.readAt ? 'read' : rest ? 'rest' : cmp < 0 ? 'missed' : cmp === 0 ? 'today' : 'upcoming';
  const partial = !entry.readAt && entry.readParts > 0;
  const wd = weekday(y, m, entry.day);
  return html`<li class="day-row is-${state}">
    <a class="day-link" href="${rest ? '#' : readHref(y, m, entry.day)}" ${rest ? html`aria-disabled="true"` : ''}>
      <span class="day-date ${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}">
        <b>${entry.day}</b><small>${WEEKDAYS[wd]}</small>
      </span>
      <span class="day-ref">
        ${rest ? '쉬는 날' : formatSegments(entry.segments)}
        ${partial ? html`<small class="partial-note">${entry.readParts}/${entry.parts.length}권 읽음</small>` : ''}
      </span>
      ${rest ? '' : html`<span class="day-min">${readingMinutes(entry.chars)}분</span>`}
    </a>
    ${rest
      ? ''
      : html`<button class="check ${entry.readAt ? 'on' : partial ? 'partial' : ''}" data-action="toggle-read"
          data-plan="${plan.id}" data-day="${entry.day}" data-read="${entry.readAt ? 1 : 0}"
          aria-pressed="${entry.readAt ? 'true' : partial ? 'mixed' : 'false'}"
          aria-label="${entry.day}일 ${partial ? '나머지도 ' : ''}읽음 표시">${checkIcon}</button>`}
  </li>`;
}

/**
 * 화면 안의 읽음 버튼(data-action="toggle-read") 처리. 기록을 바꾼 뒤 onChange를 부른다.
 * data-track이 있으면 그 책(묶음)만, 없으면 그날 전체를 표시한다. 루트 요소에 한 번만 연결된다.
 */
export function bindReadToggles(root, onChange) {
  root.onclick = async (e) => {
    const btn = e.target.closest('[data-action="toggle-read"]');
    if (!btn) return;
    e.preventDefault();
    btn.disabled = true;
    const day = Number(btn.dataset.day);
    const track = btn.dataset.track == null ? null : Number(btn.dataset.track);
    const read = btn.dataset.read !== '1';
    const what = btn.dataset.label ? `${day}일 ${btn.dataset.label}` : `${day}일 분량`;
    try {
      await setRead(Number(btn.dataset.plan), day, read, track);
      toast(read ? `${what}${josa(what, '을', '를')} 읽음으로 기록했습니다` : `${what} 읽음 표시를 지웠습니다`);
      await onChange();
    } catch (err) {
      btn.disabled = false;
      toast(`저장하지 못했습니다: ${err.message}`);
    }
  };
}

/**
 * 연속으로 읽은 날 수. 오늘(아직 안 읽었으면 어제)부터 거슬러 올라가며
 * 분량이 있는 날을 모두 읽었으면 이어진다. 쉬는 날은 건너뛰고, 계획이 없는 날에서 끊긴다.
 */
export function readingStreak(now) {
  const key = (y, m, d) => `${y}-${m}-${d}`;
  const read = new Set(readDates().map((r) => key(r.y, r.m, r.d)));
  const scheduled = scheduledDates();
  const planned = new Set(scheduled.map((r) => `${r.y}-${r.m}`));
  const due = new Set(scheduled.map((r) => key(r.y, r.m, r.d)));

  let streak = 0;
  const date = new Date(now.y, now.m - 1, now.d);
  if (due.has(key(now.y, now.m, now.d)) && !read.has(key(now.y, now.m, now.d))) date.setDate(date.getDate() - 1);
  for (let i = 0; i < 4000; i++) {
    const [y, m, d] = [date.getFullYear(), date.getMonth() + 1, date.getDate()];
    if (!planned.has(`${y}-${m}`)) break;
    const k = key(y, m, d);
    if (due.has(k)) {
      if (!read.has(k)) break;
      streak++;
    }
    date.setDate(date.getDate() - 1);
  }
  return streak;
}

/** 진행 상황: 다 읽은 날 수와, 읽은 분량(병렬이면 책마다 읽은 것까지)의 비율 */
export function progressOf(plan) {
  const reading = plan.days.filter((d) => d.segments.length);
  const readChars = plan.days.reduce(
    (s, d) => s + d.parts.filter((p) => p.readAt).reduce((a, p) => a + p.chars, 0),
    0,
  );
  return {
    total: reading.length,
    done: reading.filter((d) => d.readAt).length,
    percent: plan.totalChars ? Math.round((readChars / plan.totalChars) * 100) : 0,
  };
}

/**
 * 책별 진도: 그 장이 들어 있는 날(여러 날로 나뉘었으면 모두)을 읽었으면 다 읽은 장으로 센다.
 * @returns {Array<{b, done, total}>} 성경 순서
 */
export function bookProgress(plan) {
  const chapters = new Map(); // "b:c" → {b, done}
  for (const d of plan.days) {
    for (const p of d.parts) {
      for (const s of p.segments) {
        const key = `${s.b}:${s.c}`;
        const cur = chapters.get(key) ?? { b: s.b, done: true };
        cur.done &&= !!p.readAt;
        chapters.set(key, cur);
      }
    }
  }
  const books = new Map();
  for (const { b, done } of chapters.values()) {
    const cur = books.get(b) ?? { b, done: 0, total: 0 };
    cur.total++;
    if (done) cur.done++;
    books.set(b, cur);
  }
  return [...books.values()].sort((x, y) => book(x.b).order - book(y.b).order);
}

/** 책별 진도 막대 목록 */
export function bookProgressList(plan) {
  return html`<ul class="book-progress">
    ${bookProgress(plan).map((p) => {
      const pct = Math.round((p.done / p.total) * 100);
      return html`<li class="${p.done === p.total ? 'is-done' : ''}">
        <span class="bp-name">${book(p.b).name}</span>
        <span class="bp-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
          aria-label="${book(p.b).name} ${p.done}/${p.total}${chapterUnit(p.b)}"><span style="width:${pct}%"></span></span>
        <span class="bp-count">${p.done}/${p.total}${chapterUnit(p.b)}</span>
      </li>`;
    })}
  </ul>`;
}
