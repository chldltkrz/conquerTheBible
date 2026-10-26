// 함께 읽기 방 화면: 오늘 화면의 방 소식("오늘 5명 중 3명 읽음"), 방 창(멤버마다 이번 주 읽음과 진도),
// 방 만들기·초대 코드로 들어가기·초대하기 창, 설정 화면의 "함께 읽기" 칸. 서버와 주고받는 것은 ../rooms.js.

import {
  addDays,
  compareDate,
  daysBetween,
  formatDate,
  formatDay,
  monthEnd,
  monthStart,
  today,
  toISO,
  weekday,
  WEEKDAYS,
} from '../dates.js';
import { createAccount, currentAccount, deleteAccount, listAccounts, listPlans, planOn, roomMemberships, switchAccount, syncInfo } from '../db.js';
import {
  createRoom,
  deleteRoom,
  checkReading,
  isOwnRoom,
  isRoomActive,
  joinImpact,
  joinProblem,
  joinRoom,
  leaveRoom,
  lookupRoom,
  MAX_MEMBERS,
  MEMBER_NAME_MAX,
  periodsOverlap,
  plansForRoom,
  refreshRoom,
  refreshRooms,
  removeRoomMember,
  renameInRoom,
  ROOM_NAME_MAX,
  roomData,
  roomLink,
  roomMembers,
  roomTally,
} from '../rooms.js';
import { normalizeCode } from '../sync.js';
import { OLD_DEFAULT_NAME, randomName } from '../names.js';
import { choiceDialog, confirmDialog, copyText, createSheet, html, josa, setHTML, toast } from '../ui.js';
import { track } from '../analytics.js';
import { avatar, checkIcon, isMonthPlan, newPlanHref, outsideText, periodLabel } from './common.js';
import { renderQr } from './syncsection.js';

export const roomIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14.2a6.5 6.5 0 0 1 3 5.8" /></svg>`;

const CHIP_MAX = 12; // 오늘 화면에 이름으로 보여 줄 멤버 수 (넘으면 "외 N명")

/** 그날 읽음 → 'read' 다 읽음 | 'part' 읽는 중 | 'todo' 아직 | 'off' 그날 분량 없음 */
function dayState(pct) {
  if (pct == null) return 'off';
  return pct === 100 ? 'read' : pct > 0 ? 'part' : 'todo';
}

/**
 * 방에서 보일 내 이름으로 권할 것: 계정 이름. 예전 기본 이름('나')이거나 방에 같은 이름이 있으면
 * 방 사람들과 겹치지 않는 "기쁜 수달" 같은 이름
 */
const memberNameFor = (name, taken = []) => (name === OLD_DEFAULT_NAME || taken.includes(name) ? randomName(taken) : name);

/** 나를 맨 앞에, 나머지는 들어온 순서대로 */
const sortMembers = (members) => [...members.filter((x) => x.me), ...members.filter((x) => !x.me)];

/** 방 소식을 아직 받지 않았거나 받지 못했을 때 보여 줄 말 */
const waitingText = (data) => (data?.error ? data.error.message : '방 소식을 받는 중…');

/** 방 이름 아래 한 줄: 같은 계획 방은 계획 이름과 기간, 각자 계획 방은 그렇다고만 */
const roomSubtitle = (m, room) => (isOwnRoom(m) ? '각자 계획으로 읽기' : `${room ? `${room.plan.title} · ` : ''}${periodLabel(m)}`);

// ── 오늘 화면 ──────────────────────────────────────────────

const asked = new Set(); // 이 기기에서 소식을 받아 보려 한 방 (다른 기기에서 들어간 방이 동기화로 왔을 때 한 번 받는다)

function chipMark(state, pct) {
  if (state === 'read') return html`<span class="room-mark">${checkIcon}</span>`;
  if (state === 'part') return html`<span class="room-mark">${pct}%</span>`;
  return html`<span class="room-mark" aria-hidden="true"></span>`;
}

const CHIP_LABEL = { read: '오늘 다 읽음', part: '오늘 읽는 중', todo: '오늘 아직', off: '오늘 분량 없음' };

function memberChips(members) {
  const more = members.length - CHIP_MAX;
  return html`<span class="room-chips">
    ${members.slice(0, CHIP_MAX).map((x) => {
      const state = dayState(x.pct);
      return html`<span class="room-chip is-${state} ${x.me ? 'is-me' : ''}" title="${x.name}${x.me ? '(나)' : ''} · ${CHIP_LABEL[state]}">
        ${chipMark(state, x.pct)}<span>${x.name}</span>
      </span>`;
    })}
    ${more > 0 ? html`<span class="room-chip is-more">외 ${more}명</span>` : ''}
  </span>`;
}

/** 오늘 화면의 방 하나 */
function roomCard(m, now) {
  const data = roomData(m.code);
  const room = data?.room;
  let body;
  if (!room) {
    body = html`<span class="room-line">${waitingText(data)}</span>`;
  } else {
    const members = sortMembers(roomMembers(m, room, now));
    if (!isOwnRoom(m) && compareDate(now, m.start) < 0) {
      body = html`<b class="room-tally">${formatDate(m.start)}에 시작합니다</b>
        <span class="room-line">${members.length}명이 함께 읽습니다</span>`;
    } else if (!isOwnRoom(m) && compareDate(now, m.end) > 0) {
      const done = members.filter((x) => x.progress === 100).length;
      body = html`<b class="room-tally">계획이 끝났습니다</b>
        <span class="room-line">${members.length}명 중 ${done}명이 끝까지 읽었습니다</span>`;
    } else {
      const { reading, read } = roomTally(members);
      body = reading
        ? html`<b class="room-tally">오늘 ${reading}명 중 ${read}명 읽음</b>
            <span class="room-bar" aria-hidden="true"><span style="width:${Math.round((read / reading) * 100)}%"></span></span>
            ${memberChips(members)}`
        : html`<b class="room-tally">오늘은 읽을 분량이 없습니다</b>`;
    }
  }
  return html`<button class="card room-card" data-room-open="${m.code}" aria-label="${m.name} 방 자세히 보기">
    <span class="room-card-head">
      <span class="room-icon">${roomIcon}</span>
      <span class="room-card-title"><b>${m.name}</b><small>${roomSubtitle(m, room)}</small></span>
      <span class="chev" aria-hidden="true">›</span>
    </span>
    ${body}
  </button>`;
}

function roomAreaInner(now) {
  const list = roomMemberships(currentAccount().id).filter((m) => isRoomActive(m, now));
  if (!list.length) return '';
  const missing = list.filter((m) => !roomData(m.code) && !asked.has(m.code));
  if (missing.length) {
    missing.forEach((m) => asked.add(m.code));
    setTimeout(refreshRooms, 0);
  }
  return html`<section class="block">
    <h2 class="block-title">함께 읽기</h2>
    <div class="room-cards">${list.map((m) => roomCard(m, now))}</div>
  </section>`;
}

/** 오늘 화면의 "함께 읽기" 자리. 방 소식을 새로 받으면 이 자리만 다시 그린다 */
export const roomArea = (now = today()) => html`<div id="room-area">${roomAreaInner(now)}</div>`;

/** 오늘 화면 아래쪽의 "함께 읽기 방 만들기" (그 계획의 기간에 들어간 방도, 각자 계획 방도 없을 때만) */
export function roomCreateCard(plan) {
  if (roomMemberships(plan.accountId).some((m) => isOwnRoom(m) || periodsOverlap(m, plan))) return '';
  return html`<button class="card card-link room-create" data-action="room-create">
    <span class="room-icon">${roomIcon}</span>
    <span><b>함께 읽기 방 만들기</b><small>가족·구역 사람들과 이 계획을 같이 읽고, 오늘 누가 읽었는지 봅니다</small></span>
    <span class="chev" aria-hidden="true">›</span>
  </button>`;
}

if (typeof window !== 'undefined') {
  window.addEventListener('rooms-updated', () => {
    const el = document.getElementById('room-area');
    if (el) setHTML(el, roomAreaInner(today()));
  });
}

// ── 방 창 ──────────────────────────────────────────────────

/** 방 창에 보여 줄 날들: 오늘까지 최근 7일 (같은 계획 방은 계획 기간 안에서). 시작 전이면 [] */
function weekOf(m, now) {
  const last = !isOwnRoom(m) && compareDate(now, m.end) > 0 ? m.end : now;
  if (!isOwnRoom(m) && compareDate(last, m.start) < 0) return [];
  let first = addDays(last, -6);
  if (!isOwnRoom(m) && compareDate(first, m.start) < 0) first = m.start;
  const days = [];
  for (let d = first; compareDate(d, last) <= 0; d = addDays(d, 1)) days.push(d);
  return days;
}

const DAY_TEXT = { read: '다 읽음', part: '읽는 중', todo: '안 읽음', off: '분량 없음' };

function weekStrip(x, week, now) {
  const read = week.filter((d) => x.days?.[toISO(d)] === 100).length;
  return html`<span class="room-week" role="img" aria-label="최근 ${week.length}일 중 ${read}일 다 읽음">
    ${week.map((d) => {
      const pct = x.days?.[toISO(d)] ?? null;
      const state = dayState(pct);
      const isToday = !compareDate(d, now);
      return html`<span class="rd is-${state} ${isToday ? 'is-today' : ''}" ${state === 'part' ? html`style="--p:${pct}%"` : ''}
        title="${formatDay(d.y, d.m, d.d)} · ${state === 'part' ? `${pct}% 읽음` : DAY_TEXT[state]}" aria-hidden="true">${WEEKDAYS[weekday(d.y, d.m, d.d)]}</span>`;
    })}
  </span>`;
}

function memberSub(x) {
  if (x.waiting) return '아직 소식이 없습니다';
  const state = dayState(x.pct);
  const todayText = state === 'part' ? `오늘 ${x.pct}% 읽음` : CHIP_LABEL[state];
  return x.progress == null ? todayText : `${todayText} · 전체 ${x.progress}%`;
}

// 각자 계획 방에서 멤버를 누르면 보이는 그 사람이 읽는 계획 (읽는 방식 이름은 새 계획 화면과 같다)
const MODE_NAMES = { sequential: '한 권씩 차례로', parallel: '여러 권 동시에', group: '그룹별로 동시에' };

function readingDetail(x, now) {
  const r = checkReading(x.reading);
  if (!r) {
    return html`<div class="room-member-plan">
      <span>${x.me ? '오늘 읽는 계획이 없습니다' : '읽는 계획을 알 수 없습니다 (오늘 계획이 없거나 앱을 아직 업데이트하지 않았습니다)'}</span>
    </div>`;
  }
  const length = daysBetween(r.start, r.end) + 1;
  const when =
    compareDate(now, r.start) < 0
      ? `${length}일 계획 · ${formatDate(r.start)}에 시작`
      : compareDate(now, r.end) > 0
        ? `${length}일 계획 · 끝남`
        : `${length}일 중 ${daysBetween(r.start, now) + 1}일째`;
  return html`<div class="room-member-plan">
    <b>${r.title}</b>
    <span>${[r.range !== r.title && r.range, MODE_NAMES[r.mode]].filter(Boolean).join(' · ')}</span>
    <span>${periodLabel(r)} · ${when}</span>
  </div>`;
}

/** open: 각자 계획 방에서 읽는 계획을 펼친 멤버 번호들 (같은 계획 방이면 null) */
function memberList(members, week, now, owner, open = null) {
  return html`<ul class="room-members">
    ${members.map(
      (x) => html`<li class="room-member ${x.me ? 'is-me' : ''} ${open ? 'is-expandable' : ''}" data-member="${open ? x.id : ''}">
        ${avatar(x)}
        <span class="room-member-name"><b>${x.name}</b>${x.me ? html`<span class="tag">나</span>` : ''}${x.owner
          ? html`<span class="tag is-owner">방장</span>`
          : ''}</span>
        ${owner && !x.me
          ? html`<button class="icon-btn danger" data-room-kick="${x.id}" data-label="${x.name}" aria-label="${x.name} 내보내기">✕</button>`
          : ''}
        <small class="room-member-sub">${memberSub(x)}</small>
        ${week.length ? weekStrip(x, week, now) : ''}
        ${open
          ? html`<button class="room-member-toggle" aria-expanded="${open.has(x.id)}">
                ${open.has(x.id) ? '읽는 계획 접기' : '읽는 계획 보기'}<span aria-hidden="true">${open.has(x.id) ? '▴' : '▾'}</span>
              </button>
              ${open.has(x.id) ? readingDetail(x, now) : ''}`
          : ''}
      </li>`,
    )}
  </ul>`;
}

function roomHero(m, room, members, now) {
  const own = isOwnRoom(m);
  if (!own && compareDate(now, m.start) < 0) {
    return html`<div class="sheet-hero">
      <p class="hero-label">${formatDate(m.start)}에 시작합니다</p>
      <p class="hero-sub">${room.plan.title} · ${members.length}명이 함께 읽습니다</p>
    </div>`;
  }
  if (!own && compareDate(now, m.end) > 0) {
    const done = members.filter((x) => x.progress === 100).length;
    return html`<div class="sheet-hero">
      <p class="hero-num">${done}<small>/${members.length}명</small></p>
      <p class="hero-label">끝까지 읽음</p>
      <p class="hero-sub">${room.plan.title} 계획이 ${formatDate(m.end)}에 끝났습니다</p>
    </div>`;
  }
  const { reading, read } = roomTally(members);
  return html`<div class="sheet-hero">
    <p class="hero-num">${read}<small>/${reading}명</small></p>
    <p class="hero-label">오늘 읽음</p>
    <p class="hero-sub">${own ? '각자 계획으로 읽기' : room.plan.title}${reading < members.length ? ` · 오늘 분량이 있는 ${reading}명 중` : ''}</p>
  </div>`;
}

const legend = html`<ul class="legend room-legend" aria-hidden="true">
  <li><span class="rd is-read"></span>다 읽음</li>
  <li><span class="rd is-part" style="--p:50%"></span>읽는 중</li>
  <li><span class="rd is-todo"></span>안 읽음</li>
  <li><span class="rd is-off"></span>분량 없음</li>
</ul>`;

/**
 * 방 창: 멤버마다 오늘 읽음, 최근 7일, 전체 진도. 초대하기, 나가기, 방장은 내보내기·방 없애기.
 * @param {() => void} [changed] 방에서 나오거나 방을 없앤 뒤 부른다 (화면을 다시 그린다)
 */
export function openRoomSheet(code, changed = () => {}) {
  const account = currentAccount().id;
  const find = () => roomMemberships(account).find((x) => x.code === code);
  const first = find();
  if (!first) return;
  const { dlg, close } = createSheet({ labelledBy: 'room-title' });
  const open = new Set(); // 각자 계획 방: 읽는 계획을 펼친 멤버

  const render = () => {
    const m = find();
    if (!m) return close();
    const now = today();
    const data = roomData(m.code);
    const room = data?.room;
    const members = room ? sortMembers(roomMembers(m, room, now)) : [];
    const owner = !!members.find((x) => x.me)?.owner;
    const week = weekOf(m, now);
    const scrollTop = dlg.querySelector('.sheet-body')?.scrollTop ?? 0;
    setHTML(
      dlg,
      html`<header class="sheet-head">
          <span class="sheet-grip" aria-hidden="true"></span>
          <div class="sheet-title-row">
            <div>
              <p class="eyebrow">함께 읽기 · ${roomSubtitle(m, null)}</p>
              <h2 id="room-title">${m.name}</h2>
            </div>
            <button class="icon-btn" data-close aria-label="닫기">✕</button>
          </div>
        </header>
        <div class="sheet-body">
          ${room
            ? html`${roomHero(m, room, members, now)}
                ${week.length ? legend : ''}
                ${memberList(members, week, now, owner, isOwnRoom(m) ? open : null)}`
            : html`<p class="muted">${waitingText(data)}</p>`}
          <div class="button-row">
            <button class="btn btn-primary" data-room-invite>${roomIcon}<span>함께 읽을 사람 초대하기</span></button>
          </div>
          <p class="sheet-note">${isOwnRoom(m)
            ? `각자 자기 계획으로 읽는 방입니다. 방 사람들에게는 이 방에서 쓰는 이름과 날짜별로 그날 분량을 몇 퍼센트 읽었는지,
              지금 읽는 계획의 진도, 그리고 사람을 누르면 그 계획의 이름·범위·기간이 보입니다.`
            : '방 사람들에게는 이 방에서 쓰는 이름과 날짜별 읽음, 계획 진도만 보입니다.'}
            묵상 메모와 저장한 구절, 다른 계획은 보이지 않습니다. 한 방에는 ${MAX_MEMBERS}명까지 들어올 수 있습니다.</p>
          <div class="room-leave">
            <button class="link" data-room-rename>내 이름 바꾸기</button>
            <button class="link danger" data-room-leave>방에서 나가기</button>
            ${owner ? html`<button class="link danger" data-room-delete>방 없애기</button>` : ''}
          </div>
        </div>`,
    );
    dlg.querySelector('.sheet-body').scrollTop = scrollTop;
  };

  const leave = async (m) => {
    const others = (roomData(m.code)?.room?.members.length ?? 1) - 1;
    const me = roomData(m.code)?.room?.members.find((x) => x.id === m.memberId);
    const ok = await confirmDialog({
      title: `${m.name} 방에서 나갈까요?`,
      message:
        '이 계정의 계획과 읽음 기록은 그대로 남습니다. 다시 들어오려면 초대 코드가 필요합니다.' +
        (others <= 0 ? ' 방에 남는 사람이 없어 방이 없어집니다.' : me?.owner ? ' 방장은 다음으로 들어온 사람이 맡습니다.' : ''),
      confirmText: '나가기',
      danger: true,
    });
    if (!ok) return;
    try {
      await leaveRoom(m);
    } catch (err) {
      toast(err.message);
      return;
    }
    track('room_left', { owner: !!me?.owner, members: others + 1 });
    toast(`${m.name} 방에서 나왔습니다`);
    close();
    changed();
  };

  const remove = async (m) => {
    const ok = await confirmDialog({
      title: `${m.name} 방을 없앨까요?`,
      message: '모든 사람이 이 방에서 빠집니다. 각자의 계획과 읽음 기록은 남습니다.',
      confirmText: '방 없애기',
      danger: true,
    });
    if (!ok) return;
    const members = roomData(m.code)?.room?.members.length ?? 1;
    try {
      await deleteRoom(m);
    } catch (err) {
      toast(err.message);
      return;
    }
    track('room_deleted', { members });
    toast(`${m.name} 방을 없앴습니다`);
    close();
    changed();
  };

  const kick = async (m, id, label) => {
    const ok = await confirmDialog({
      title: `${label} 님을 내보낼까요?`,
      message: '그 사람의 기기에서도 이 방이 빠집니다. 그 사람의 계획과 읽음 기록은 남고, 초대 코드를 알면 다시 들어올 수 있습니다.',
      confirmText: '내보내기',
      danger: true,
    });
    if (!ok) return;
    try {
      await removeRoomMember(m, id);
    } catch (err) {
      toast(err.message);
      return;
    }
    track('room_member_removed');
    toast(`${label} 님을 내보냈습니다`);
  };

  dlg.addEventListener('click', (e) => {
    const m = find();
    if (!m) return;
    if (e.target.closest('[data-room-invite]')) return openInviteDialog(m);
    if (e.target.closest('[data-room-rename]')) return openRenameDialog(m, render);
    if (e.target.closest('[data-room-leave]')) return leave(m);
    if (e.target.closest('[data-room-delete]')) return remove(m);
    const k = e.target.closest('[data-room-kick]');
    if (k) return kick(m, k.dataset.roomKick, k.dataset.label);
    // 각자 계획 방: 멤버를 누르면 그 사람이 읽는 계획을 펼치거나 접는다
    const row = e.target.closest('.room-member[data-member]');
    if (row?.dataset.member) {
      const id = row.dataset.member;
      if (!open.delete(id)) {
        open.add(id);
        track('room_member_reading_opened', { me: row.classList.contains('is-me') });
      }
      render();
    }
  });
  window.addEventListener('rooms-updated', render);
  dlg.addEventListener('close', () => window.removeEventListener('rooms-updated', render));

  render();
  document.body.append(dlg);
  dlg.showModal();
  refreshRoom(first);
  track('room_opened', { members: roomData(code)?.room?.members.length ?? null });
}

/** 방에서 보일 내 이름을 바꾸는 창 (이 방에서만. 계정 이름은 그대로) */
function openRenameDialog(m, done) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog room-form';
  setHTML(
    dlg,
    html`<form>
      <h2>${m.name} 방에서 보일 내 이름</h2>
      <p class="muted small">이 방 사람들에게 보이는 이름입니다. 계정 이름은 그대로 둡니다.</p>
      <label class="field">
        <span>내 이름</span>
        <input name="member" value="${m.memberName}" maxlength="${MEMBER_NAME_MAX}" required autocomplete="off" />
      </label>
      <p class="form-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-close>취소</button>
        <button class="btn btn-primary">바꾸기</button>
      </div>
    </form>`,
  );
  const form = dlg.querySelector('form');
  const error = dlg.querySelector('.form-error');
  dlg.addEventListener('click', (e) => e.target.closest('[data-close]') && dlg.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.member.value.trim();
    if (!name) return;
    if (name === m.memberName) return dlg.close();
    try {
      await renameInRoom(m, name);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      return;
    }
    track('room_member_renamed');
    toast(`이 방에서 ${name}${josa(name, '으로', '로')} 보입니다`);
    dlg.close();
    done();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  form.member.select();
}

// ── 초대하기 ───────────────────────────────────────────────

/** 초대 코드와 QR 코드, 링크 복사·보내기 창 */
export function openInviteDialog(m, { fresh = false } = {}) {
  const link = roomLink(m.code);
  const plan = roomData(m.code)?.room?.plan;
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog sync-share';
  setHTML(
    dlg,
    html`<h2>${fresh ? `${m.name} 방을 만들었습니다` : '함께 읽을 사람 초대하기'}</h2>
      <p>이 링크를 카카오톡이나 문자로 보내거나 QR 코드를 보여 주세요. 받은 사람이 열면 이 방에 들어오는 창이 뜹니다.</p>
      <div class="sync-qr" aria-hidden="true"></div>
      <code class="sync-code">${m.code}</code>
      <div class="button-row is-center">
        ${typeof navigator.share === 'function' ? html`<button class="btn btn-ghost btn-sm" data-share>링크 보내기</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-copy>링크 복사</button>
      </div>
      <p class="muted small">앱의 설정 › 함께 읽기 › "초대 코드로 들어가기"에 이 코드를 넣어도 됩니다.
        코드를 아는 사람은 누구나 들어와 멤버의 이름과 읽음을 볼 수 있으니, 함께 읽을 사람에게만 보내 주세요.</p>
      <div class="dialog-actions"><button class="btn btn-primary" data-close>닫기</button></div>`,
  );
  dlg.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) dlg.close();
    else if (e.target.closest('[data-copy]')) {
      const ok = await copyText(link);
      toast(ok ? '링크를 복사했습니다' : '복사하지 못했습니다');
      if (ok) track('room_invite_shared', { how: 'copy' });
    } else if (e.target.closest('[data-share]')) {
      const what = isOwnRoom(m) ? ' 각자 계획으로' : plan ? ` ${plan.title}(${periodLabel(m)})` : '';
      navigator
        .share({ title: `맛있는만나 함께 읽기 · ${m.name}`, text: `맛있는만나에서${what} 함께 읽어요. ${m.name} 방 초대 링크입니다.`, url: link })
        .then(() => track('room_invite_shared', { how: 'share' }))
        .catch(() => {});
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  renderQr(dlg.querySelector('.sync-qr'), link);
}

// ── 방 만들기 ──────────────────────────────────────────────

/** 방을 만들 수 있는 계획: 오늘 읽는 계획과 앞으로 시작할 계획들 (일찍 시작하는 것부터) */
export function roomPlanChoices(now = today()) {
  return listPlans()
    .filter((p) => compareDate(p.end, now) >= 0)
    .sort((a, b) => compareDate(a.start, b.start));
}

/** 그 계획들 다음에 이어 만들 계획: 마지막 계획 다음 날부터 같은 길이(한 달 계획이면 다음 달). 계획이 없으면 이번 달 */
function nextPlanPeriod(plans, now) {
  const last = plans.at(-1);
  if (!last) return { start: monthStart(now.y, now.m), end: monthEnd(now.y, now.m), label: `${now.m}월 계획` };
  const start = addDays(last.end, 1);
  if (isMonthPlan(last)) return { start, end: monthEnd(start.y, start.m), label: `${start.m}월 계획` };
  return { start, end: addDays(start, last.length - 1), label: `${formatDate(start)}부터 ${last.length}일 계획` };
}

// 방 만들기 창에서 "새로 만들기"로 새 계획 화면에 가면, 그 계획을 저장한 뒤 방 만들기 창을 다시 띄운다.
let pendingCreate = null; // 창에 적던 {name, memberName}

/** 새 계획 화면: 저장하면 방 만들기 창이 이어서 뜨는지 */
export const roomCreatePending = () => pendingCreate != null;

/** 새 계획 화면에서 계획을 저장한 뒤 부른다. 방 만들기 창에서 왔으면 그 계획을 고른 창을 다시 띄운다 */
export function resumeRoomCreate(plan) {
  if (!pendingCreate || !plan) return;
  const typed = pendingCreate;
  pendingCreate = null;
  openRoomCreate(plan, typed);
}

if (typeof window !== 'undefined') {
  // 계획을 저장하지 않고 다른 화면으로 가면 잊는다
  window.addEventListener('hashchange', () => {
    if (!location.hash.startsWith('#/new')) pendingCreate = null;
  });
}

function planStatus(p, now, rooms) {
  const when = compareDate(p.start, now) > 0 ? `${formatDate(p.start)}에 시작` : '읽는 중';
  return rooms.length ? `${when} · ${rooms.map((m) => m.name).join(', ')} 방` : when;
}

/**
 * 방을 만드는 창. 같은 계획을 함께 읽을지, 각자 계획으로 읽을지 고른다. 같은 계획이면 지금 계정의 오늘 계획과
 * 앞으로 시작할 계획 중에서 고르고, 다음 계획이 아직 없으면 새 계획 화면에서 만든 뒤 돌아온다. 만들면 초대 창을 띄운다.
 * @param {object|null} plan 먼저 골라 둘 계획 (없으면 아직 방이 없는 가장 이른 계획)
 * @param {{done?: () => void, name?: string, memberName?: string}} [opts] done: 만든 뒤 부른다 (화면을 다시 그린다)
 */
export function openRoomCreate(plan = null, { done = () => {}, name = '', memberName = null } = {}) {
  const now = today();
  const acc = currentAccount();
  const plans = roomPlanChoices(now);
  const rooms = roomMemberships(acc.id).filter((m) => !isOwnRoom(m));
  const roomsOf = (p) => rooms.filter((m) => periodsOverlap(m, p));
  const chosen = plans.find((p) => p.id === plan?.id) ?? plans.find((p) => !roomsOf(p).length) ?? plans[0];
  const next = nextPlanPeriod(plans, now);
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog room-form';
  setHTML(
    dlg,
    html`<form>
      <h2>함께 읽기 방 만들기</h2>
      <div class="room-plans room-kinds" role="radiogroup" aria-label="어떻게 함께 읽을까요?">
        <label class="room-plan">
          <input type="radio" name="kind" value="same" checked />
          <span><b>같은 계획을 함께</b><small>모두 같은 본문을 같은 날 읽습니다</small></span>
        </label>
        <label class="room-plan">
          <input type="radio" name="kind" value="own" />
          <span><b>각자 계획으로</b><small>각자 자기 계획으로 읽고, 읽은 퍼센트와 진도를 나눕니다</small></span>
        </label>
      </div>
      <div data-kind="same">
        <p>함께 읽을 계획을 고르세요. 초대받은 사람에게는 같은 계획이 만들어지고, 서로 오늘 읽었는지 볼 수 있습니다.</p>
        ${plans.length
          ? html`<div class="room-plans" role="radiogroup" aria-label="함께 읽을 계획">
              ${plans.map(
                (p) => html`<label class="room-plan">
                  <input type="radio" name="plan" value="${p.id}" ${p === chosen ? 'checked' : ''} />
                  <span><b>${p.title}</b><small>${periodLabel(p, { year: p.start.y !== now.y })} · ${planStatus(p, now, roomsOf(p))}</small></span>
                </label>`,
              )}
            </div>`
          : html`<p class="muted small">함께 읽을 계획이 아직 없습니다. 먼저 계획을 만들어 주세요.</p>`}
        <button type="button" class="room-plan is-new" data-new-plan>
          <span><b>${next.label} 새로 만들기</b><small>계획을 저장하면 이 창으로 돌아옵니다</small></span>
          <span class="chev" aria-hidden="true">›</span>
        </button>
      </div>
      <p data-kind="own" hidden>들어온 사람의 계획은 바뀌지 않습니다. 저마다 오늘 읽을 분량을 몇 퍼센트 읽었는지와 지금 읽는
        계획의 진도가 방에 보이고, 사람을 누르면 그 사람이 읽는 계획(이름·범위·며칠 계획인지)이 보입니다.
        기간이 없어 계획을 새로 만들어도 방은 이어집니다.</p>
      <label class="field">
        <span>방 이름</span>
        <input name="name" value="${name}" maxlength="${ROOM_NAME_MAX}" placeholder="예: 사랑구역, 우리 가족" required autocomplete="off" />
      </label>
      <label class="field">
        <span>방에서 보일 내 이름</span>
        <input name="member" value="${memberName || memberNameFor(acc.name)}" maxlength="${MEMBER_NAME_MAX}" required autocomplete="off" />
      </label>
      <p class="form-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-close>취소</button>
        <button class="btn btn-primary" ${plans.length ? '' : 'disabled'}>만들기</button>
      </div>
    </form>`,
  );
  const form = dlg.querySelector('form');
  const error = dlg.querySelector('.form-error');
  const submit = form.querySelector('.btn-primary');
  const kind = () => form.kind.value;
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'kind') return;
    form.querySelectorAll('[data-kind]').forEach((el) => (el.hidden = el.dataset.kind !== kind()));
    submit.disabled = kind() === 'same' && !plans.length;
  });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return dlg.close();
    if (e.target.closest('[data-new-plan]')) {
      pendingCreate = { name: form.name.value.trim(), memberName: form.member.value.trim() };
      dlg.close();
      track('room_plan_new');
      location.hash = newPlanHref(next.start, next.end);
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const own = kind() === 'own';
    const picked = own ? null : plans.find((p) => String(p.id) === form.querySelector('input[name=plan]:checked')?.value);
    const name = form.name.value.trim();
    const memberName = form.member.value.trim();
    if ((!own && !picked) || !name || !memberName) return;
    submit.disabled = true;
    error.hidden = true;
    let code;
    try {
      code = await createRoom(picked, { name, memberName });
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
      return;
    }
    track(
      'room_created',
      own
        ? { kind: 'own' }
        : {
            kind: 'same',
            plan_mode: picked.mode,
            plan_length: picked.length,
            starts_in_days: Math.max(0, daysBetween(now, picked.start)),
          },
    );
    dlg.close();
    done();
    const m = roomMemberships(picked?.accountId ?? acc.id).find((x) => x.code === code);
    if (m) openInviteDialog(m, { fresh: true });
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  (name ? form.member : form.name).focus();
}

// ── 초대 코드로 들어가기 ───────────────────────────────────

/** 들어가면 계획이 어떻게 되는지 */
function planNote(found) {
  if (isOwnRoom(found.plan)) {
    return html`각자 계획으로 읽는 방입니다. 내 계획은 바뀌지 않고, 그날 분량을 몇 퍼센트 읽었는지와 진도, 읽는 계획(이름·범위·기간)이 방에 보입니다.
      ${planOn(today()) ? '' : html`<small class="notice-sub">오늘 읽는 계획이 없습니다. 들어간 뒤 계획을 만들면 그때부터 방에 올라갑니다.</small>`}`;
  }
  const { same, overlaps: list } = plansForRoom(found.plan);
  if (same) return html`이미 같은 계획(<b>${same.title}</b>)이 있어 그 계획을 그대로 이어 읽습니다.`;
  if (list.length) {
    const impact = found.impact;
    return html`기간이 겹치는 ${list.map((p, i) => html`${i ? ', ' : ''}<b>${p.title}</b>(${periodLabel(p)})`)} 계획은
      이 방의 계획으로 바뀝니다. ${impact?.loses
        ? html`<b>${lossText(impact)}</b> 들어갈 때 한 번 더 묻습니다.`
        : '같은 날짜에 같은 범위를 읽은 기록은 이어집니다.'}`;
  }
  return html`이 방의 계획이 새로 만들어집니다.`;
}

/** 방의 계획으로 바꾸면 사라지는 것: "읽은 기록 200일이 지워지고, 이 방 기간 밖의 … 일정도 함께 없어집니다." */
function lossText(impact) {
  const lost = impact.lostDays ? `읽은 기록 ${impact.lostDays}일이 지워` : '';
  const outside = impact.outside.length ? `이 방 기간 밖의 ${outsideText(impact.outside)} 일정도 함께 없어집니다.` : '';
  const kept = impact.keptDays ? ` 같은 날짜에 같은 범위를 읽은 ${impact.keptDays}일은 이어집니다.` : '';
  if (lost && outside) return `${lost}지고, ${outside}${kept}`;
  return `${lost ? `${lost}집니다.` : outside}${kept}`;
}

/**
 * 초대 코드로 방에 들어가는 창. 초대 링크(#room=코드)로 앱을 열었을 때도 부른다(prefill에 링크의 코드).
 * @param {{via?: 'link'|'code', done?: () => void}} [opts] done: 들어간 뒤 부른다 (화면을 다시 그린다)
 */
export function openRoomJoin(prefill = '', { via = 'code', done = () => {} } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog room-form';
  let found = null;

  const codeStep = () =>
    setHTML(
      dlg,
      html`<form data-step="code">
        <h2>초대 코드로 들어가기</h2>
        <p>함께 읽기 방의 12자리 초대 코드를 넣으세요. 초대 링크를 열면 이 창이 저절로 뜹니다.</p>
        <input name="code" class="sync-code-input" value="${prefill}" placeholder="ABCD-EFGH-JKLM" maxlength="20"
          autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" aria-label="초대 코드" required />
        <p class="form-error" role="alert" hidden></p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" data-close>취소</button>
          <button class="btn btn-primary">다음</button>
        </div>
      </form>`,
    );

  const joinStep = () => {
    const acc = currentAccount();
    const names = found.members.map((x) => x.name);
    const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ` 외 ${names.length - 5}명` : '');
    setHTML(
      dlg,
      html`<form data-step="join">
        <p class="eyebrow">함께 읽기 방</p>
        <h2>${found.name}</h2>
        <p class="room-join-plan">${isOwnRoom(found.plan)
          ? html`<b>각자 계획으로 읽기</b>`
          : html`<b>${found.plan.title}</b> · ${periodLabel(found.plan)}`}<br />
          <small>${found.members.length}명이 함께 읽는 중: ${shown}</small></p>
        <label class="field">
          <span>방에서 보일 내 이름</span>
          <input name="member" value="${memberNameFor(acc.name, names)}" maxlength="${MEMBER_NAME_MAX}" required autocomplete="off" />
        </label>
        <p class="notice">${planNote(found)}</p>
        ${listAccounts().length > 1
          ? html`<p class="muted small"><b>${acc.name}</b> 계정으로 들어갑니다. 다른 계정으로 들어가려면 계정을 바꾼 뒤 다시 여세요.</p>`
          : ''}
        <p class="form-error" role="alert" hidden></p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" data-close>취소</button>
          <button class="btn btn-primary">들어가기</button>
        </div>
      </form>`,
    );
  };

  const fail = (form, message) => {
    const error = form.querySelector('.form-error');
    error.textContent = message;
    error.hidden = false;
    form.querySelector('.btn-primary').disabled = false;
  };

  const lookup = async (form) => {
    let room;
    try {
      room = await lookupRoom(form.code.value);
    } catch (err) {
      track('room_join_failed', { reason: err.code ?? 'error', via });
      return fail(form, err.message);
    }
    const mine = roomMemberships(currentAccount().id).find((x) => x.code === room.code);
    if (mine) {
      dlg.close();
      toast(`이미 ${room.name} 방에 있습니다`);
      openRoomSheet(room.code, done);
      return;
    }
    const problem = joinProblem(room, today());
    if (problem) {
      track('room_join_failed', { reason: 'blocked', via });
      return fail(form, problem);
    }
    found = room;
    found.impact = joinImpact(room); // 들어가면 지금 계획이 어떻게 되는지 (방의 계획을 한 번만 나눈다)
    joinStep();
    dlg.querySelector('[name=member]').focus();
  };

  const join = async (form) => {
    const memberName = form.member.value.trim();
    if (!memberName) return fail(form, '방에서 보일 이름을 넣어 주세요.');
    if (found.members.some((x) => x.name === memberName)) return fail(form, `방에 이미 ${memberName}${josa(memberName, '이', '가')} 있습니다. 다른 이름을 써 주세요.`);
    // 지금 계획의 읽음 기록이나 일정이 사라지면 들어가기 전에 묻는다: 새 계정으로 들어가거나, 계획을 바꾸고 들어가거나
    const impact = found.impact;
    let fresh = null; // 새로 만든 계정 {id, prev} (들어가지 못하면 지우고 원래 계정으로 돌아간다)
    if (impact?.loses) {
      const names = impact.replaced.map((p) => `'${p.title}'(${periodLabel(p, { year: true })})`).join(', ');
      const choice = await choiceDialog({
        title: '지금 계획을 바꾸고 들어갈까요?',
        message: `${names} 계획이 이 방의 계획으로 바뀝니다. ${lossText(impact)}${syncInfo() ? ' 동기화된 다른 기기에서도 그렇게 바뀝니다.' : ''}`,
        choices: [
          { value: 'account', label: '새 계정으로 들어가기', detail: `지금 계획은 그대로 두고, "${memberName}" 계정을 새로 만들어 들어갑니다` },
          { value: 'replace', label: '계획을 바꾸고 들어가기', detail: '이 계정의 계획을 방의 계획으로 바꿉니다', danger: true },
        ],
      });
      track('room_join_replace_asked', { choice: choice ?? 'cancel', lost_days: impact.lostDays, outside: impact.outside.length > 0 });
      if (!choice) {
        form.querySelector('.btn-primary').disabled = false;
        return;
      }
      if (choice === 'account') {
        const prev = currentAccount().id;
        try {
          fresh = { id: await createAccount(memberName), prev };
          await switchAccount(fresh.id);
        } catch (err) {
          if (fresh) await deleteAccount(fresh.id).catch(() => {});
          return fail(form, `계정을 만들지 못했습니다: ${err.message}`);
        }
      }
    }
    let result;
    try {
      result = await joinRoom(found, memberName, { tracks: impact?.tracks });
    } catch (err) {
      if (fresh) {
        await switchAccount(fresh.prev).catch(() => {});
        await deleteAccount(fresh.id).catch(() => {});
      }
      track('room_join_failed', { reason: err.code ?? 'error', via });
      return fail(form, err.message);
    }
    track('room_joined', {
      result,
      via,
      new_account: !!fresh,
      members: found.members.length + 1,
      ...(isOwnRoom(found.plan) ? { kind: 'own' } : { kind: 'same', plan_mode: found.plan.mode, plan_length: found.plan.length }),
    });
    dlg.close();
    if (fresh) {
      toast(`새 계정 ${memberName}${josa(memberName, '을', '를')} 만들어 ${found.name} 방에 들어갔습니다`);
      window.dispatchEvent(new Event('account-changed')); // 새 계정으로 화면을 다시 그린다
    } else {
      toast(result === 'saved' ? `${found.name} 방에 들어가 계획을 만들었습니다` : `${found.name} 방에 들어갔습니다`);
    }
    done();
    openRoomSheet(found.code, done);
  };

  dlg.addEventListener('click', (e) => e.target.closest('[data-close]') && dlg.close());
  dlg.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    form.querySelector('.btn-primary').disabled = true;
    form.querySelector('.form-error').hidden = true;
    if (form.dataset.step === 'code') lookup(form);
    else join(form);
  });
  dlg.addEventListener('close', () => dlg.remove());
  codeStep();
  document.body.append(dlg);
  dlg.showModal();
  // 링크로 열었으면 코드를 확인할 것 없이 바로 찾는다
  if (normalizeCode(prefill)) dlg.querySelector('form').requestSubmit();
}

// ── 설정 화면 ──────────────────────────────────────────────

/** 설정 화면에 넣을 "함께 읽기" 칸 */
export function roomSection() {
  const now = today();
  const list = roomMemberships(currentAccount().id);
  return html`<section class="block" id="room-block">
    <h2 class="block-title">함께 읽기</h2>
    <div class="card">
      ${list.length
        ? html`<ul class="room-list">
            ${list.map((m) => {
              const n = roomData(m.code)?.room?.members.length;
              const own = isOwnRoom(m);
              const ended = !own && compareDate(now, m.end) > 0;
              return html`<li>
                <button class="room-item" data-room-open="${m.code}" aria-label="${m.name} 방 자세히 보기">
                  <span class="room-icon">${roomIcon}</span>
                  <span class="account-text"><b>${m.name}</b>
                    <small>${own ? '각자 계획' : periodLabel(m, { year: m.start.y !== now.y })}${n ? ` · ${n}명` : ''}${ended ? ' · 끝남' : ''}</small></span>
                  <span class="chev" aria-hidden="true">›</span>
                </button>
              </li>`;
            })}
          </ul>`
        : html`<p>가족·구역·목장 사람들과 함께 읽으며, 오늘 누가 읽었는지 봅니다 ("오늘 5명 중 3명 읽음").
            <b>같은 계획</b>을 함께 읽거나, <b>각자 계획</b>으로 읽고 읽은 퍼센트와 진도, 읽는 계획을 나눌 수 있습니다.</p>`}
      <p class="muted small">방을 만들면 초대 코드와 링크가 나옵니다. 방 사람들에게는 방에서 쓰는 이름과 날짜별 읽음, 계획 진도(각자 계획
        방은 읽는 계획의 이름·범위·기간도)만 보이고 묵상 메모와 저장한 구절은 보이지 않습니다.${listAccounts().length > 1 ? ' 계정마다 따로 들어갑니다.' : ''}</p>
      <div class="button-row">
        <button class="btn btn-primary" data-room-action="create">${roomIcon}<span>방 만들기</span></button>
        <button class="btn btn-ghost" data-room-action="join">초대 코드로 들어가기</button>
      </div>
    </div>
  </section>`;
}

/**
 * "함께 읽기" 칸의 버튼(data-room-action)을 처리한다.
 * @param {() => void} rerender 설정 화면을 다시 그린다
 */
export function handleRoomAction(action, rerender) {
  if (action === 'join') return openRoomJoin('', { done: rerender });
  if (action === 'create') openRoomCreate(null, { done: rerender });
}
