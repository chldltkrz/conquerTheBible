// 함께 읽기 방: 같은 계획을 가족·구역·목장이 함께 읽으며 서로 오늘 읽었는지 본다 ("오늘 5명 중 3명 읽음").
// 서버는 server/rooms.mjs, 이 기기에 둔 방 목록은 db.js의 room_memberships(동기화된다).
//
// 방에는 초대 코드로 들어간다. 동기화 코드와 꼴은 같지만 따로 만든 코드라서, 방 사람들에게는 방 이름과
// 멤버 이름, 날짜별로 그날 분량을 몇 퍼센트 읽었는지, 계획 전체 진도만 보인다. (메모·저장한 구절은 보내지 않는다)
// 날짜별 읽음은 이 기기가 계산해 올린다: 방의 기간 동안 그 계정의 계획을 날마다 본다(계획을 고쳐 저장해도 이어진다).
//
// 언제: 기록을 바꾸고 잠시 뒤 올리고, 앱을 열 때·돌아올 때·켜 둔 동안 1분마다 방 소식을 받는다.
// window에 알리는 것: 'rooms-updated'(방 소식을 새로 받음), 'room-gone'(방이 없어졌거나 내보내져 목록에서 뺌, detail {name})
// 이 모듈은 Node 테스트에서도 import되므로 최상위에서 window/document를 직접 쓰지 않는다.

import { book, getIndex, selectionToChapters } from './bible.js';
import { addDays, compareDate, daysBetween, fromISO, toISO, today } from './dates.js';
import {
  currentAccount,
  deleteRoomMembership,
  isPaused,
  listAccounts,
  MAX_PLAN_DAYS,
  onWrite,
  planOn,
  planTrackDays,
  plansOverlapping,
  roomMemberships,
  savePlan,
  saveRoomMembership,
} from './db.js';
import { buildPlan } from './planner.js';
import { normalizeCode } from './sync.js';
import { progressOf, readPercent } from './views/common.js';

export const MAX_MEMBERS = 30; // server/rooms.mjs와 같다
export const ROOM_NAME_MAX = 30;
export const MEMBER_NAME_MAX = 20;
const UPLOAD_DELAY = 2000; // 기록을 바꾸고 올리기까지 (이어서 누르는 것을 한 번에)
const POLL_INTERVAL = 60 * 1000;
const UPLOAD_AFTER_END = 30; // 계획이 끝난 뒤에도 이만큼(일)은 늦게 읽은 것을 올린다

const hasWindow = typeof window !== 'undefined';

// ── 초대 링크 ──────────────────────────────────────────────

/** 다른 사람이 열면 그 방에 들어가는 창이 뜨는 링크. 코드는 #뒤에 두어 서버로 가지 않게 한다 */
export const roomLink = (code, base = location.origin + location.pathname) => `${base}#room=${code}`;

/** 주소에 초대 링크(#room=코드)가 있으면 코드를 꺼내고 주소에서 지운다 (사용 통계에 주소가 남지 않도록) */
export function takeRoomLinkCode() {
  const m = /^#room=([^&]+)/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  let raw = m[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // 잘린 링크
  }
  return normalizeCode(raw) ?? raw.slice(0, 20);
}

// ── 서버 요청 ──────────────────────────────────────────────

const MESSAGES = {
  bad_code: '초대 코드는 12자리입니다. 다시 확인해 주세요.',
  no_room: '이 코드의 방이 없습니다. 코드를 다시 확인해 주세요.',
  room_full: `방이 가득 찼습니다. 한 방에는 ${MAX_MEMBERS}명까지 들어갈 수 있습니다.`,
  no_member: '이미 방에서 나왔습니다.',
  not_owner: '방장만 할 수 있습니다.',
  bad_name: `이름을 확인해 주세요 (${MEMBER_NAME_MAX}자까지).`,
  bad_plan: '이 방의 계획을 읽지 못했습니다. 앱을 새로 고친 뒤 다시 해 주세요.',
  offline: '인터넷에 연결되어 있지 않습니다.',
  busy: '요청이 너무 많습니다. 잠시 뒤에 다시 해 주세요.',
};

export class RoomError extends Error {
  constructor(code, status = 0) {
    super(MESSAGES[code] ?? '서버에 문제가 생겼습니다. 잠시 뒤에 다시 해 주세요.');
    this.code = code;
    this.status = status;
  }
}

let baseUrl = 'api/rooms';
let fetchImpl = (...args) => fetch(...args);

/** 테스트용: 서버 주소와 fetch를 바꾼다 */
export function configureRooms({ url, fetch: f } = {}) {
  if (url) baseUrl = url;
  if (f) fetchImpl = f;
}

/** member: {memberId, memberKey} (방 목록의 줄) */
async function request(method, path, { code = null, member = null, body } = {}) {
  const text = body ? JSON.stringify(body) : undefined;
  let res;
  try {
    res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(text ? { 'Content-Type': 'application/json' } : {}),
        ...(code ? { Authorization: `Bearer ${code}` } : {}),
        ...(member ? { 'X-Room-Member': `${member.memberId}:${member.memberKey}` } : {}),
      },
      body: text,
      cache: 'no-store',
      // 앱을 떠나는 중이면 페이지가 닫혀도 요청을 끝까지 보낸다
      keepalive: hasWindow && document.visibilityState === 'hidden' && (text?.length ?? 0) < 60000,
    });
  } catch {
    throw new RoomError('offline');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new RoomError(data.error ?? ({ 413: 'too_large', 429: 'busy' }[res.status] ?? 'server_error'), res.status);
  return data;
}

// ── 방의 계획 ──────────────────────────────────────────────
// 방에는 날짜별 분량 대신 묶음마다 고른 장을 둔다. 들어오는 사람은 같은 알고리즘(planner.buildPlan)으로
// 똑같이 나눈다. 만든 사람이 밀린 분량을 다시 나눴어도, 들어오는 사람은 처음 나눈 그대로 받는다.

const MODES = new Set(['sequential', 'parallel', 'group']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 묶음의 날짜별 분량 → 그 묶음이 읽는 장 {code: [장...]} */
function chaptersOf(days) {
  const sel = {};
  for (const d of days) for (const s of d.segments) (sel[s.b] ??= new Set()).add(s.c);
  return Object.fromEntries(Object.entries(sel).map(([b, set]) => [b, [...set].sort((x, y) => x - y)]));
}

/** 계획 → 방에 올릴 계획 정의 */
export function roomPlanOf(plan) {
  return {
    title: plan.title,
    start: toISO(plan.start),
    end: toISO(plan.end),
    mode: plan.mode,
    splitChapters: plan.splitChapters,
    selection: plan.selection,
    tracks: planTrackDays(plan.id).map((t) => ({ title: t.title, selection: chaptersOf(t.days) })),
  };
}

const validDate = (s) => typeof s === 'string' && DATE_RE.test(s) && toISO(fromISO(s)) === s;

function validSelection(sel) {
  if (!sel || typeof sel !== 'object' || Array.isArray(sel)) return false;
  return Object.entries(sel).every(([code, chapters]) => {
    const b = book(code);
    return b && Array.isArray(chapters) && chapters.every((c) => Number.isInteger(c) && c >= 1 && c <= b.chapters.length);
  });
}

/** 서버에서 받은 계획 정의를 확인한다 → {title, start, end, length, mode, splitChapters, selection, tracks} 또는 null */
export function checkRoomPlan(def) {
  if (!def || typeof def.title !== 'string' || !validDate(def.start) || !validDate(def.end) || !MODES.has(def.mode)) return null;
  if (!validSelection(def.selection) || !Array.isArray(def.tracks) || !def.tracks.length || def.tracks.length > 66) return null;
  if (!def.tracks.every((t) => typeof t?.title === 'string' && validSelection(t.selection))) return null;
  const start = fromISO(def.start);
  const end = fromISO(def.end);
  const length = daysBetween(start, end) + 1;
  if (!(length >= 1 && length <= MAX_PLAN_DAYS)) return null;
  return {
    title: def.title.slice(0, 100),
    start,
    end,
    length,
    mode: def.mode,
    splitChapters: def.splitChapters !== false,
    selection: def.selection,
    tracks: def.tracks.map((t) => ({ title: t.title.slice(0, 100), selection: t.selection })),
  };
}

/** 확인한 계획 정의 → savePlan에 넘길 묶음들 */
export function roomPlanTracks(plan) {
  return plan.tracks.map((t) => ({
    title: t.title,
    days: buildPlan(getIndex(), selectionToChapters(t.selection), plan.length, { splitChapters: plan.splitChapters }),
  }));
}

const sameChapters = (a, b) => JSON.stringify(selectionToChapters(a)) === JSON.stringify(selectionToChapters(b));

/**
 * 지금 계정에서 방의 계획과 겹치는 계획들. same: 기간·읽는 방식·묶음마다 읽는 장이 같은 계획
 * (그 계획을 그대로 쓰면 된다. 밀린 분량을 다시 나눈 계획도 같은 계획으로 본다)
 */
export function plansForRoom(plan) {
  const overlaps = plansOverlapping(plan.start, plan.end);
  const same = overlaps.find((p) => {
    if (compareDate(p.start, plan.start) || compareDate(p.end, plan.end) || p.mode !== plan.mode) return false;
    const tracks = planTrackDays(p.id);
    return tracks.length === plan.tracks.length && tracks.every((t, i) => sameChapters(chaptersOf(t.days), plan.tracks[i].selection));
  });
  return { same: same ?? null, overlaps };
}

// ── 날짜별 읽음 ────────────────────────────────────────────

/**
 * 방에 올릴 그 계정의 읽음: days {"2026-10-22": 40} 분량이 있는 날마다 몇 퍼센트 읽었는지(다 읽으면 100),
 * progress 오늘(기간 밖이면 가까운 끝날)의 계획 전체 진도. 그 기간에 계획이 없는 날은 뺀다.
 */
export function memberStatus(accountId, start, end, now = today()) {
  const days = {};
  let plan = null;
  for (let date = start; compareDate(date, end) <= 0; date = addDays(date, 1)) {
    if (!plan || compareDate(plan.end, date) < 0) plan = planOn(date, accountId);
    if (!plan) continue;
    const entry = plan.days[daysBetween(plan.start, date)];
    if (entry?.segments.length) days[toISO(date)] = entry.readAt ? 100 : readPercent(entry);
  }
  const at = compareDate(now, start) < 0 ? start : compareDate(now, end) > 0 ? end : now;
  const current = planOn(at, accountId);
  return { days, progress: current ? Math.min(100, progressOf(current).percent) : null };
}

// ── 방 소식 ────────────────────────────────────────────────

/** code → {room, error}. room: 서버에서 받은 방 {name, plan(확인한 정의), members}. 받지 못했으면 error */
const cache = new Map();

/** 마지막으로 받은 방 소식 {room, error} 또는 null(아직 받지 않음) */
export const roomData = (code) => cache.get(code) ?? null;

function notify(name, detail = null) {
  if (hasWindow) window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** 계획이 시작하기 전이거나 끝난 지 오래되지 않은 방 (오늘 화면에 보인다) */
export const isRoomActive = (m, now = today()) => compareDate(now, addDays(m.end, 3)) <= 0;

/** 방이 없어졌거나 내보내졌다: 이 기기의 방 목록에서 뺀다 (동기화하면 다른 기기에서도) */
async function dropMembership(m) {
  if (isPaused()) return;
  await deleteRoomMembership(m.accountId, m.code);
  if (!roomMemberships().some((x) => x.code === m.code)) cache.delete(m.code);
  notify('room-gone', { name: m.name });
}

/** 방 하나의 소식을 받는다 */
async function fetchRoom(m) {
  try {
    const data = await request('GET', '/room', { code: m.code });
    const plan = checkRoomPlan(data.plan);
    if (!plan) throw new RoomError('bad_plan');
    if (!data.members.some((x) => x.id === m.memberId)) {
      // 방장이 내보냈다
      await dropMembership(m);
      return;
    }
    cache.set(m.code, { room: { ...data, plan }, error: null });
  } catch (err) {
    if (err.code === 'no_room') return dropMembership(m);
    if (!(err instanceof RoomError)) console.warn('[rooms]', err);
    cache.set(m.code, { room: cache.get(m.code)?.room ?? null, error: err });
  }
}

let refreshing = null;

/** 지금 계정이 들어간 방들의 소식을 새로 받는다. 받으면 'rooms-updated' */
export function refreshRooms() {
  refreshing ??= (async () => {
    await null; // 할 일 없이 바로 끝나도 finally가 refreshing에 대입된 뒤에 비우도록 한 박자 쉰다
    try {
      const list = roomMemberships(currentAccount().id).filter((m) => isRoomActive(m));
      if (!list.length) return;
      await Promise.all(list.map(fetchRoom));
      notify('rooms-updated');
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** 방 하나의 소식을 새로 받는다 (방 창을 열 때. 끝난 지 오래된 방도 받는다). 받으면 'rooms-updated' */
export async function refreshRoom(m) {
  await fetchRoom(m);
  notify('rooms-updated');
}

// ── 내 읽음 올리기 ─────────────────────────────────────────

const lastSent = new Map(); // 멤버 번호 → 마지막으로 올린 내용 (같으면 다시 올리지 않는다)
let uploading = null;
let again = false;

async function uploadOne(m, colors) {
  const body = { name: m.memberName, color: colors.get(m.accountId), ...memberStatus(m.accountId, m.start, m.end) };
  const key = `${m.code} ${m.memberId}`;
  const text = JSON.stringify(body);
  if (lastSent.get(key) === text) return;
  try {
    await request('PUT', '/members/me', { code: m.code, member: m, body });
    lastSent.set(key, text);
  } catch (err) {
    if (err.code === 'no_member' || err.code === 'no_room') return dropMembership(m);
    if (!(err instanceof RoomError)) console.warn('[rooms]', err);
  }
}

/** 이 기기의 모든 계정이 들어간 방에 읽음을 올린다. 하는 중이면 끝난 뒤 한 번 더 한다 */
export function uploadRooms() {
  if (uploading) {
    again = true;
    return uploading;
  }
  uploading = (async () => {
    await null; // refreshRooms와 같은 까닭
    try {
      do {
        again = false;
        const now = today();
        const colors = new Map(listAccounts().map((a) => [a.id, a.color]));
        const list = roomMemberships().filter((m) => compareDate(now, addDays(m.end, UPLOAD_AFTER_END)) <= 0);
        for (const m of list) await uploadOne(m, colors);
      } while (again);
    } finally {
      uploading = null;
    }
  })();
  return uploading;
}

let uploadTimer = null;

/** main.js의 boot()에서 데이터베이스를 연 뒤 한 번 부른다 */
export function initRooms() {
  onWrite(() => {
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(uploadRooms, UPLOAD_DELAY);
  });
  if (!hasWindow) return;
  const both = () => {
    uploadRooms();
    refreshRooms();
  };
  window.addEventListener('online', both);
  window.addEventListener('account-changed', () => refreshRooms());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') return both();
    // 떠나기 전에 기다리던 것을 바로 올린다
    clearTimeout(uploadTimer);
    uploadRooms();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshRooms();
  }, POLL_INTERVAL);
  both();
}

// ── 만들기·들어가기·나가기 ─────────────────────────────────

/** 이 계획으로 방을 만든다. 초대 코드를 돌려준다 */
export async function createRoom(plan, { name, memberName }) {
  const color = listAccounts().find((a) => a.id === plan.accountId)?.color;
  const res = await request('POST', '', { body: { name, plan: roomPlanOf(plan), member: { name: memberName, color } } });
  await saveRoomMembership({
    accountId: plan.accountId,
    code: res.code,
    memberId: res.member.id,
    memberKey: res.member.key,
    name,
    memberName,
    start: plan.start,
    end: plan.end,
  });
  await uploadRooms();
  refreshRooms();
  return res.code;
}

/** 초대 코드로 방을 찾는다 → {code, name, plan(확인한 정의), members} */
export async function lookupRoom(input) {
  const code = normalizeCode(input);
  if (!code) throw new RoomError('bad_code');
  const data = await request('GET', '/room', { code });
  const plan = checkRoomPlan(data.plan);
  if (!plan) throw new RoomError('bad_plan');
  return { code, ...data, plan };
}

/**
 * 지금 계정으로 찾은 방에 들어간다. 같은 계획이 없으면 방의 계획을 저장한다(겹치는 계획은 savePlan처럼 바뀐다).
 * @returns {Promise<'same'|'saved'>} 있던 계획을 그대로 쓰는지, 방의 계획을 새로 저장했는지
 */
export async function joinRoom(found, memberName) {
  const acc = currentAccount();
  const plan = found.plan;
  const member = await request('POST', '/members', { code: found.code, body: { name: memberName, color: acc.color } });
  const membership = { memberId: member.id, memberKey: member.key };
  let result = 'same';
  try {
    if (!plansForRoom(plan).same) {
      await savePlan({
        start: plan.start,
        end: plan.end,
        title: plan.title,
        selection: plan.selection,
        splitChapters: plan.splitChapters,
        mode: plan.mode,
        tracks: roomPlanTracks(plan),
      });
      result = 'saved';
    }
    await saveRoomMembership({
      accountId: acc.id,
      code: found.code,
      ...membership,
      name: found.name,
      memberName,
      start: plan.start,
      end: plan.end,
    });
  } catch (err) {
    request('DELETE', '/members/me', { code: found.code, member: membership }).catch(() => {});
    throw err;
  }
  cache.set(found.code, { room: { name: found.name, plan, members: found.members, createdAt: found.createdAt }, error: null });
  await uploadRooms();
  refreshRooms();
  return result;
}

/** 방에서 나간다. 이 계정의 계획과 기록은 그대로 둔다 */
export async function leaveRoom(m) {
  await request('DELETE', '/members/me', { code: m.code, member: m }).catch((err) => {
    if (err.code !== 'no_member' && err.code !== 'no_room') throw err;
  });
  await deleteRoomMembership(m.accountId, m.code);
  if (!roomMemberships().some((x) => x.code === m.code)) cache.delete(m.code);
}

/**
 * 계정을 지우기 전에 그 계정이 들어간 방에서 나간다. null이면 모든 계정(모든 기록 지우기).
 * 안 되면 그냥 둔다: 방장이 내보낼 수 있다.
 */
export async function leaveAccountRooms(accountId) {
  await Promise.allSettled(
    roomMemberships(accountId).map((m) => request('DELETE', '/members/me', { code: m.code, member: m })),
  );
}

/** 방장이 멤버를 내보낸다 */
export async function removeRoomMember(m, memberId) {
  await request('DELETE', `/members/${memberId}`, { code: m.code, member: m });
  await refreshRooms();
}

/** 방장이 방을 없앤다 */
export async function deleteRoom(m) {
  await request('DELETE', '/room', { code: m.code, member: m }).catch((err) => {
    if (err.code !== 'no_room') throw err;
  });
  await deleteRoomMembership(m.accountId, m.code);
  cache.delete(m.code);
}

// ── 화면에 보여 줄 것 ──────────────────────────────────────

const schedules = new WeakMap(); // 방 소식 → 방의 계획에서 분량이 있는 날짜들 (소식을 받을 때마다 한 번 계산한다)

/** 방의 계획에서 분량이 있는 날짜들 {'2026-10-22', …} */
function readingDates(room) {
  let dates = schedules.get(room);
  if (!dates) {
    dates = new Set();
    for (const t of roomPlanTracks(room.plan)) {
      t.days.forEach((d, i) => d.segments.length && dates.add(toISO(addDays(room.plan.start, i))));
    }
    schedules.set(room, dates);
  }
  return dates;
}

/**
 * 방 멤버들과 그날 읽음. 내 줄은 서버 소식 대신 이 기기의 기록으로 바로 보여 준다(방금 읽음 표시한 것도).
 * 아직 한 번도 올리지 않은 멤버(waiting)는 방의 계획에 그날 분량이 있으면 0으로 센다.
 * @returns {Array<{id, name, color, owner, me, waiting, days, progress, pct}>} pct: 그날 분량을 몇 퍼센트 읽었는지(분량이 없으면 null)
 */
export function roomMembers(m, room, date = today()) {
  const iso = toISO(date);
  const mine = { ...memberStatus(m.accountId, m.start, m.end), name: m.memberName, me: true };
  const color = listAccounts().find((a) => a.id === m.accountId)?.color;
  const members = room.members.map((x) => (x.id === m.memberId ? { ...x, ...mine, color } : { ...x, me: false }));
  if (!members.some((x) => x.me)) members.push({ id: m.memberId, owner: false, color, ...mine });
  return members.map((x) => {
    const waiting = !x.me && !Object.keys(x.days ?? {}).length;
    const pct = x.days?.[iso] ?? (waiting && readingDates(room).has(iso) ? 0 : null);
    return { ...x, waiting, pct };
  });
}

/** 그날 분량이 있는 멤버 수와 그중 다 읽은 멤버 수 */
export function roomTally(members) {
  const reading = members.filter((x) => x.pct != null);
  return { reading: reading.length, read: reading.filter((x) => x.pct === 100).length };
}
