// 함께 읽기 방: 가족·구역·목장이 함께 읽으며 서로 오늘 읽었는지 본다 ("오늘 5명 중 3명 읽음").
// 서버는 server/rooms.mjs, 이 기기에 둔 방 목록은 db.js의 room_memberships(동기화된다).
//
// 방은 두 가지다 (멤버십의 kind, 서버에 둔 방의 plan으로 안다).
//   'same': 같은 계획을 함께 읽는 방. 방에 계획 정의를 두고, 들어오는 사람에게 같은 계획을 만든다. 기간이 그 계획의 기간이다.
//   'own':  각자 계획으로 읽는 방. 방의 plan은 {kind: 'own'}뿐이고, 들어와도 계획을 만들거나 바꾸지 않는다.
//           멤버마다 자기 계획으로 그날 분량을 몇 퍼센트 읽었는지, 지금 읽는 계획의 진도와 그 계획(이름·범위·기간)을 나눈다.
//           기간이 없다.
//
// 방에는 초대 코드로 들어간다. 동기화 코드와 꼴은 같지만 따로 만든 코드라서, 방 사람들에게는 방 이름과
// 멤버 이름, 날짜별로 그날 분량을 몇 퍼센트 읽었는지, 계획 전체 진도(각자 계획 방은 읽는 계획도)만 보인다.
// (메모·저장한 구절은 보내지 않는다)
// 날짜별 읽음은 이 기기가 계산해 올린다: 방의 기간 동안 그 계정의 계획을 날마다 본다(계획을 고쳐 저장해도 이어진다).
//
// 언제: 기록을 바꾸고 잠시 뒤 올리고, 앱을 열 때·돌아올 때·켜 둔 동안 1분마다 방 소식을 받는다.
// window에 알리는 것: 'rooms-updated'(방 소식을 새로 받음), 'room-gone'(방이 없어졌거나 내보내져 목록에서 뺌, detail {name})
// 이 모듈은 Node 테스트에서도 import되므로 최상위에서 window/document를 직접 쓰지 않는다.

import { book, describeSelection, getIndex, selectionToChapters } from './bible.js';
import { addDays, compareDate, daysBetween, formatDate, fromISO, toISO, today } from './dates.js';
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
import { OLD_DEFAULT_NAME } from './names.js';
import { progressOf, readPercent } from './views/common.js';

export const MAX_MEMBERS = 30; // server/rooms.mjs와 같다
export const ROOM_NAME_MAX = 30;
export const MEMBER_NAME_MAX = 20;
const UPLOAD_DELAY = 2000; // 기록을 바꾸고 올리기까지 (이어서 누르는 것을 한 번에)
const POLL_INTERVAL = 60 * 1000;
const UPLOAD_AFTER_END = 30; // 계획이 끝난 뒤에도 이만큼(일)은 늦게 읽은 것을 올린다
const OWN_DAYS = 14; // 각자 계획 방에 올리는 날 수 (오늘까지. 방 창에는 최근 7일이 보인다)
const OWN_PLAN = { kind: 'own' }; // 각자 계획 방의 plan (서버는 해석하지 않고 그대로 돌려준다)

/** 각자 계획으로 읽는 방인지 (멤버십이나 방의 계획) */
export const isOwnRoom = (x) => x?.kind === 'own';

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
  name_taken: '방에 이미 같은 이름이 있습니다. 다른 이름을 써 주세요.',
  bad_plan: '이 방의 계획을 읽지 못했습니다. 앱을 새로 고친 뒤 다시 해 주세요.',
  offline: '인터넷에 연결되어 있지 않습니다.',
  busy: '요청이 너무 많습니다. 잠시 뒤에 다시 해 주세요.',
  server_full: '서버의 저장 공간이 부족해 지금은 방을 만들거나 들어갈 수 없습니다.',
};

export class RoomError extends Error {
  /** message: MESSAGES에 없는 그때그때의 문구 (들어가지 못하는 까닭 등) */
  constructor(code, status = 0, message = null) {
    super(message ?? MESSAGES[code] ?? '서버에 문제가 생겼습니다. 잠시 뒤에 다시 해 주세요.');
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

/**
 * 서버에서 받은 계획 정의를 확인한다 → {kind: 'same', title, start, end, length, mode, splitChapters, selection, tracks},
 * 각자 계획 방이면 {kind: 'own'}, 틀렸으면 null
 */
export function checkRoomPlan(def) {
  if (isOwnRoom(def)) return { ...OWN_PLAN };
  if (!def || typeof def.title !== 'string' || !validDate(def.start) || !validDate(def.end) || !MODES.has(def.mode)) return null;
  if (!validSelection(def.selection) || !Array.isArray(def.tracks) || !def.tracks.length || def.tracks.length > 66) return null;
  if (!def.tracks.every((t) => typeof t?.title === 'string' && validSelection(t.selection))) return null;
  const start = fromISO(def.start);
  const end = fromISO(def.end);
  const length = daysBetween(start, end) + 1;
  if (!(length >= 1 && length <= MAX_PLAN_DAYS)) return null;
  return {
    kind: 'same',
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
 * 지금 계정에서 방의 계획과 겹치는 계획들. same: 기간·읽는 방식·장 중간에서도 나누는지·묶음마다 읽는 장이 같은 계획
 * (그 계획을 그대로 쓰면 된다. 밀린 분량을 다시 나눈 계획도 같은 계획으로 본다)
 */
export function plansForRoom(plan) {
  const overlaps = plansOverlapping(plan.start, plan.end);
  const same = overlaps.find((p) => {
    if (compareDate(p.start, plan.start) || compareDate(p.end, plan.end) || p.mode !== plan.mode) return false;
    if (p.splitChapters !== plan.splitChapters) return false; // 하루 분량이 방 사람들과 달라진다
    const tracks = planTrackDays(p.id);
    return tracks.length === plan.tracks.length && tracks.every((t, i) => sameChapters(chaptersOf(t.days), plan.tracks[i].selection));
  });
  return { same: same ?? null, overlaps };
}

/** 기간 [a.start, a.end]와 [b.start, b.end]가 하루라도 겹치는지 */
export const periodsOverlap = (a, b) => compareDate(a.start, b.end) <= 0 && compareDate(b.start, a.end) <= 0;

/**
 * 지금 계정이 찾은 방(lookupRoom)에 들어갈 수 없는 까닭. 들어갈 수 있으면 null.
 * 한 계정은 한 날짜에 계획이 하나뿐이라, 같은 기간에 같은 계획 방 여럿에 들어가려면 방들의 계획이 같아야 한다.
 * 각자 계획 방은 계획을 바꾸지 않으므로 다른 방과 부딪히지 않는다.
 */
export function joinProblem(found, now = today()) {
  if (found.members.length >= MAX_MEMBERS) return MESSAGES.room_full;
  if (isOwnRoom(found.plan)) return null;
  if (compareDate(found.plan.end, now) < 0) return `이 방의 계획은 ${formatDate(found.plan.end)}에 끝났습니다.`;
  if (!plansForRoom(found.plan).same) {
    // 들어가면 겹치는 계획이 방의 계획으로 바뀌어, 그 계획으로 함께 읽던 다른 방에 올라가는 읽음이 달라진다
    const other = roomMemberships(currentAccount().id).find((x) => !isOwnRoom(x) && periodsOverlap(x, found.plan));
    if (other) return `같은 기간에 ${other.name} 방에서 다른 계획을 읽고 있습니다. 그 방에서 나온 뒤 들어올 수 있습니다.`;
  }
  return null;
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

/** 각자 계획 방에서 멤버를 누르면 보일 지금 읽는 계획 {title, range, start, end, mode}. 계획이 없으면 null */
export const readingOf = (plan) =>
  plan && {
    title: plan.title.slice(0, 100),
    range: describeSelection(plan.selection).slice(0, 200),
    start: toISO(plan.start),
    end: toISO(plan.end),
    mode: plan.mode,
  };

/** 서버에서 받은 멤버의 reading을 확인한다 → {title, range, start, end, mode} (날짜는 {y, m, d}) 또는 null */
export function checkReading(r) {
  if (!r || typeof r.title !== 'string' || typeof r.range !== 'string' || !validDate(r.start) || !validDate(r.end)) return null;
  if (!MODES.has(r.mode)) return null;
  return { title: r.title, range: r.range, start: fromISO(r.start), end: fromISO(r.end), mode: r.mode };
}

/**
 * 그 방에 올릴 내 읽음. 각자 계획 방은 오늘까지 최근 OWN_DAYS일, 진도는 오늘 읽는 계획의 것이고,
 * 그 계획(reading)도 올린다. 같은 계획 방은 모두 방의 계획을 읽으므로 올리지 않는다.
 */
export const statusFor = (m, now = today()) =>
  isOwnRoom(m)
    ? { ...memberStatus(m.accountId, addDays(now, 1 - OWN_DAYS), now, now), reading: readingOf(planOn(now, m.accountId)) }
    : memberStatus(m.accountId, m.start, m.end, now);

// ── 방 소식 ────────────────────────────────────────────────

/** code → {room, error}. room: 서버에서 받은 방 {name, plan(확인한 정의), members}. 받지 못했으면 error */
const cache = new Map();

/** 마지막으로 받은 방 소식 {room, error} 또는 null(아직 받지 않음) */
export const roomData = (code) => cache.get(code) ?? null;

function notify(name, detail = null) {
  if (hasWindow) window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** 계획이 시작하기 전이거나 끝난 지 오래되지 않은 방, 그리고 각자 계획 방 (오늘 화면에 보인다) */
export const isRoomActive = (m, now = today()) => isOwnRoom(m) || compareDate(now, addDays(m.end, 3)) <= 0;

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
  const body = { name: m.memberName, color: colors.get(m.accountId), ...statusFor(m) };
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
        const list = roomMemberships().filter((m) => isOwnRoom(m) || compareDate(now, addDays(m.end, UPLOAD_AFTER_END)) <= 0);
        for (const m of list) await uploadOne(m, colors);
      } while (again);
    } finally {
      uploading = null;
    }
  })();
  return uploading;
}

// ── 방에서 보일 내 이름 ────────────────────────────────────
// 방 이름(memberName)은 들어갈 때 정하고 계정 이름과 따로 둔다. 예전에는 기본 계정이 모두 '나'라서 '나'로 들어간 사람이 많다.

/** 방에서 그 이름을 쓸 수 있는지: 같은 방의 다른 사람이 쓰고 있지 않으면 true (방 소식을 아직 못 받았으면 true) */
const nameFree = (m, name) => !(roomData(m.code)?.room?.members ?? []).some((x) => x.id !== m.memberId && x.name === name);

/** 방에서 보일 내 이름을 바꾼다 (방 창의 "내 이름 바꾸기"). 같은 방에 그 이름이 있으면 RoomError */
export async function renameInRoom(m, name) {
  if (!nameFree(m, name)) throw new RoomError('name_taken');
  await saveRoomMembership({ ...m, memberName: name });
  await uploadRooms();
}

/**
 * 계정 이름을 바꿨을 때: 방에서 계정 이름(oldName)이나 예전 기본 이름 '나'를 그대로 쓰던 방은 새 이름으로 바꾼다.
 * 방에서 따로 지은 이름은 그대로 두고, 같은 방에 새 이름을 쓰는 사람이 있으면 그 방도 그대로 둔다. 바꾼 방 수를 돌려준다.
 */
export async function followAccountRename(accountId, oldName, newName) {
  let changed = 0;
  for (const m of roomMemberships(accountId)) {
    if (m.memberName === newName || (m.memberName !== oldName && m.memberName !== OLD_DEFAULT_NAME) || !nameFree(m, newName)) continue;
    await saveRoomMembership({ ...m, memberName: newName });
    changed++;
  }
  if (changed) uploadRooms();
  return changed;
}

/** 방에서 예전 기본 이름 '나'를 쓰는데 계정 이름은 이미 바꿨으면 방 이름도 계정 이름으로 (기기를 열 때. 테스트에서도 쓴다) */
export async function adoptAccountNames() {
  if (isPaused()) return;
  for (const acc of listAccounts()) {
    if (acc.name !== OLD_DEFAULT_NAME) await followAccountRename(acc.id, OLD_DEFAULT_NAME, acc.name);
  }
}

let uploadTimer = null;

/** main.js의 boot()에서 데이터베이스를 연 뒤 한 번 부른다 */
export function initRooms() {
  adoptAccountNames().catch((err) => console.warn('[rooms]', err));
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

/** 이 계획으로 방을 만든다. plan이 null이면 지금 계정으로 각자 계획 방을 만든다. 초대 코드를 돌려준다 */
export async function createRoom(plan, { name, memberName }) {
  const accountId = plan?.accountId ?? currentAccount().id;
  const color = listAccounts().find((a) => a.id === accountId)?.color;
  const def = plan ? roomPlanOf(plan) : OWN_PLAN;
  const res = await request('POST', '', { body: { name, plan: def, member: { name: memberName, color } } });
  await saveRoomMembership({
    accountId,
    code: res.code,
    memberId: res.member.id,
    memberKey: res.member.key,
    name,
    memberName,
    kind: plan ? 'same' : 'own',
    start: plan?.start ?? today(),
    end: plan?.end,
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
 * 지금 계정으로 찾은 방에 들어간다. 같은 계획 방이면 같은 계획이 없을 때 방의 계획을 저장한다(겹치는 계획은
 * savePlan처럼 바뀐다). 각자 계획 방이면 계획은 그대로 둔다.
 * @returns {Promise<'same'|'saved'|'own'>} 있던 계획을 그대로 쓰는지, 방의 계획을 새로 저장했는지, 각자 계획 방인지
 */
export async function joinRoom(found, memberName) {
  const problem = joinProblem(found);
  if (problem) throw new RoomError('blocked', 0, problem);
  const acc = currentAccount();
  const plan = found.plan;
  const own = isOwnRoom(plan);
  const member = await request('POST', '/members', { code: found.code, body: { name: memberName, color: acc.color } });
  const membership = { memberId: member.id, memberKey: member.key };
  let result = own ? 'own' : 'same';
  try {
    if (!own && !plansForRoom(plan).same) {
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
      kind: own ? 'own' : 'same',
      start: own ? today() : plan.start,
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
 * 아직 한 번도 올리지 않은 멤버(waiting)는 같은 계획 방이면 방의 계획에 그날 분량이 있을 때 0으로 센다.
 * 각자 계획 방은 그 사람의 계획을 모르므로 세지 않는다.
 * @returns {Array<{id, name, color, owner, me, waiting, days, progress, pct}>} pct: 그날 분량을 몇 퍼센트 읽었는지(분량이 없으면 null)
 */
export function roomMembers(m, room, date = today()) {
  const iso = toISO(date);
  const mine = { ...statusFor(m), name: m.memberName, me: true };
  const color = listAccounts().find((a) => a.id === m.accountId)?.color;
  const members = room.members.map((x) => (x.id === m.memberId ? { ...x, ...mine, color } : { ...x, me: false }));
  if (!members.some((x) => x.me)) members.push({ id: m.memberId, owner: false, color, ...mine });
  return members.map((x) => {
    const waiting = !x.me && !Object.keys(x.days ?? {}).length;
    const pct = x.days?.[iso] ?? (waiting && !isOwnRoom(room.plan) && readingDates(room).has(iso) ? 0 : null);
    return { ...x, waiting, pct };
  });
}

/** 그날 분량이 있는 멤버 수와 그중 다 읽은 멤버 수 */
export function roomTally(members) {
  const reading = members.filter((x) => x.pct != null);
  return { reading: reading.length, read: reading.filter((x) => x.pct === 100).length };
}
