// 여러 화면에서 함께 쓰는 조각들

import { formatSegments, readingMinutes } from '../bible.js';
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
import { html, setHTML, toast } from '../ui.js';

export const readHref = (y, m, d) => `#/read/${ymKey(y, m)}/${d}`;

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
  return entry.readAt
    ? { text: `${plan.title} · 오늘 읽음`, state: 'read' }
    : { text: `${plan.title} · 오늘 ${formatSegments(entry.segments, { short: true })}`, state: 'todo' };
}

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
  const wd = weekday(y, m, entry.day);
  return html`<li class="day-row is-${state}">
    <a class="day-link" href="${rest ? '#' : readHref(y, m, entry.day)}" ${rest ? html`aria-disabled="true"` : ''}>
      <span class="day-date ${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}">
        <b>${entry.day}</b><small>${WEEKDAYS[wd]}</small>
      </span>
      <span class="day-ref">${rest ? '쉬는 날' : formatSegments(entry.segments)}</span>
      ${rest ? '' : html`<span class="day-min">${readingMinutes(entry.chars)}분</span>`}
    </a>
    ${rest
      ? ''
      : html`<button class="check ${entry.readAt ? 'on' : ''}" data-action="toggle-read"
          data-plan="${plan.id}" data-day="${entry.day}" data-read="${entry.readAt ? 1 : 0}"
          aria-pressed="${entry.readAt ? 'true' : 'false'}" aria-label="${entry.day}일 읽음 표시">${checkIcon}</button>`}
  </li>`;
}

/**
 * 화면 안의 읽음 버튼(data-action="toggle-read") 처리. 기록을 바꾼 뒤 onChange를 부른다.
 * 루트 요소에 한 번만 연결된다.
 */
export function bindReadToggles(root, onChange) {
  root.onclick = async (e) => {
    const btn = e.target.closest('[data-action="toggle-read"]');
    if (!btn) return;
    e.preventDefault();
    btn.disabled = true;
    const day = Number(btn.dataset.day);
    const read = btn.dataset.read !== '1';
    try {
      await setRead(Number(btn.dataset.plan), day, read);
      toast(read ? `${day}일 분량을 읽음으로 기록했습니다` : `${day}일 읽음 표시를 지웠습니다`);
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

export function progressOf(plan) {
  const reading = plan.days.filter((d) => d.segments.length);
  const done = reading.filter((d) => d.readAt);
  const readChars = done.reduce((s, d) => s + d.chars, 0);
  return {
    total: reading.length,
    done: done.length,
    percent: plan.totalChars ? Math.round((readChars / plan.totalChars) * 100) : 0,
  };
}
