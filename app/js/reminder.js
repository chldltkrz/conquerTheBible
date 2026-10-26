// 읽기 알림: 정한 시각에 오늘 분량을 아직 다 읽지 않았으면 이 기기로 알림(웹 푸시)을 보낸다.
// 서버(server/push.mjs)는 기록을 모르므로, 이 기기가 오늘부터 1년 동안 날마다 읽을 분량과 다 읽었는지를
// 계산해 올려 둔다(reminderDays). 기록이 바뀌면 잠시 뒤에, 앱을 열 때와 떠날 때 다시 올린다.
// 켜고 끈 것과 시각은 기기마다 따로 둔다(settings 'reminder'는 동기화하지 않는다). 알림을 띄우는 것은 sw.js.
// 이 모듈은 Node 테스트에서도 import되므로 최상위에서 window/document를 직접 쓰지 않는다.

import { formatSegments, readingMinutes } from './bible.js';
import { addDays, compareDate, daysBetween, toISO, today } from './dates.js';
import { getSetting, listAccounts, onWrite, planOn, setSetting, syncInfo } from './db.js';
import { fetchLeaving, leaving } from './net.js';

export const DEFAULT_TIME = '21:00';
const DAYS_AHEAD = 365;
const MAX_TEXT = 120; // 서버 한도(200)보다 짧게
const UPLOAD_DELAY = 3000; // 기록을 바꾸고 올리기까지 (이어서 누르는 것을 한 번에)

const hasWindow = typeof window !== 'undefined';

// ── 날마다 알릴 내용 ───────────────────────────────────────

/**
 * 알림 내용: 다 읽지 않은 계정이 하나면 남은 분량 "창세기 1–3장 · 약 12분", 여럿이면 몇 계정인지만.
 * (계정 이름은 서버로 보내지 않는다) left: 계정마다 남은 묶음들 [[{segments, chars}]]
 */
export function reminderText(left) {
  if (!left.length) return '';
  if (left.length > 1) return `계정 ${left.length}개의 오늘 분량이 남아 있습니다`;
  const parts = left[0];
  const passage = formatSegments(parts.flatMap((p) => p.segments));
  const text = `${passage} · 약 ${readingMinutes(parts.reduce((s, p) => s + p.chars, 0))}분`;
  return text.length > MAX_TEXT ? `${passage.slice(0, MAX_TEXT - 1)}…` : text;
}

/**
 * from부터 count일 동안 읽을 분량이 있는 날마다 {"2026-10-17": {text, done}}. 이 기기의 모든 계정을 본다:
 * 분량이 있는 계정이 모두 다 읽었으면 done. 어느 계정에도 분량이 없는 날(계획 없음, 쉬는 날)은 뺀다.
 */
export function reminderDays(from = today(), count = DAYS_AHEAD + 1) {
  const accounts = listAccounts();
  const plans = new Map(); // 계정마다 마지막으로 불러온 계획 (날마다 다시 불러오지 않도록)
  const days = {};
  for (let i = 0; i < count; i++) {
    const date = addDays(from, i);
    const left = [];
    let any = false;
    for (const acc of accounts) {
      let plan = plans.get(acc.id);
      if (!plan || compareDate(plan.end, date) < 0) {
        plan = planOn(date, acc.id);
        plans.set(acc.id, plan);
      }
      const entry = plan && compareDate(plan.start, date) <= 0 ? plan.days[daysBetween(plan.start, date)] : null;
      if (!entry?.segments.length) continue;
      any = true;
      if (!entry.readAt) left.push(entry.parts.filter((p) => !p.readAt));
    }
    if (any) days[toISO(date)] = { text: reminderText(left), done: !left.length };
  }
  return days;
}

/** "21:30" → "오후 9시 30분" */
export function timeLabel(time) {
  const [h, m] = time.split(':').map(Number);
  const h12 = h % 12 || 12;
  return `${h < 12 ? '오전' : '오후'} ${h12}시${m ? ` ${m}분` : ''}`;
}

// ── 서버 요청 ──────────────────────────────────────────────

const MESSAGES = {
  offline: '인터넷에 연결되어 있지 않습니다.',
  denied: '알림이 차단되어 있습니다. 브라우저(또는 기기) 설정에서 이 사이트의 알림을 허용해 주세요.',
  dismissed: '알림을 허용해야 켤 수 있습니다.',
  push_off: '알림 서버가 아직 준비되지 않았습니다. 잠시 뒤에 다시 해 주세요.',
  busy: '잠시 뒤에 다시 해 주세요.',
  gone: '이 기기의 알림 구독이 없어졌습니다. 알림을 껐다가 다시 켜 주세요.',
  server_full: '서버의 저장 공간이 부족해 지금은 알림을 켤 수 없습니다.',
};

export class ReminderError extends Error {
  constructor(code) {
    super(MESSAGES[code] ?? '알림 서버에 문제가 생겼습니다. 잠시 뒤에 다시 해 주세요.');
    this.code = code;
  }
}

let baseUrl = 'api/push';
let fetchImpl = (...args) => fetch(...args);

/** 테스트용: 서버 주소와 fetch를 바꾼다 */
export function configureReminder({ url, fetch: f } = {}) {
  if (url) baseUrl = url;
  if (f) fetchImpl = f;
}

async function request(method, path, body, code = null) {
  const text = body ? JSON.stringify(body) : undefined;
  let res;
  try {
    // 앱을 떠나는 중이면 페이지가 닫혀도 끝까지 보낸다 (net.js)
    res = await fetchLeaving(fetchImpl, `${baseUrl}${path}`, {
      method,
      headers: {
        ...(text ? { 'Content-Type': 'application/json' } : {}),
        ...(code ? { Authorization: `Bearer ${code}` } : {}),
      },
      body: text,
      cache: 'no-store',
    });
  } catch {
    throw new ReminderError('offline');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ReminderError(data.error ?? (res.status === 429 ? 'busy' : 'server_error'));
  return data;
}

// ── 구독 ───────────────────────────────────────────────────

/** 이 기기의 알림 설정 {on, time} */
export const reminderSetting = () => ({ on: false, time: DEFAULT_TIME, ...getSetting('reminder', {}) });

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/**
 * 이 기기에서 알림을 켤 수 있는지
 *   'ok' | 'install'(아이폰·아이패드는 홈 화면에 추가한 앱에서만) | 'denied'(알림을 차단함) | 'unsupported'
 */
export function reminderSupport() {
  if (!hasWindow || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return hasWindow && isIOS() && !isStandalone() ? 'install' : 'unsupported';
  }
  return Notification.permission === 'denied' ? 'denied' : 'ok';
}

function base64urlBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

let serverKey = null; // 서버의 VAPID 공개 키 (앱을 연 동안 한 번만 받는다)
let serverMerges = false; // 서버가 days를 합치는 올리기(merge)를 아는지 (예전 서버는 모른다)

/** 이 기기의 푸시 구독. 없으면 만든다 (서버의 VAPID 키가 바뀌었으면 새로 만든다) */
async function subscription() {
  const reg = await navigator.serviceWorker.ready;
  if (!serverKey) {
    const res = await request('GET', '/key');
    serverKey = base64urlBytes(res.key);
    serverMerges = res.merge === true;
  }
  const applicationServerKey = serverKey;
  let sub = await reg.pushManager.getSubscription();
  const sameKey = (s) => {
    const k = s.options?.applicationServerKey;
    return !k || (k.byteLength === applicationServerKey.length && new Uint8Array(k).every((b, i) => b === applicationServerKey[i]));
  };
  if (sub && !sameKey(sub)) {
    await sub.unsubscribe();
    sub = null;
  }
  return sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
}

let lastSent = null; // 마지막으로 올린 내용 (같으면 다시 올리지 않는다)
const SOON_DAYS = 2; // 앱을 떠날 때는 오늘·내일만 올린다

async function upload(sub, time, { force = false } = {}) {
  const body = {
    subscription: sub.toJSON(),
    time,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    days: reminderDays(),
  };
  const code = syncInfo()?.code ?? null;
  const signature = JSON.stringify([body, code]);
  if (!force && signature === lastSent) return;
  if (leaving() && serverMerges) {
    // 1년치는 앱을 떠날 때 보낼 수 있는 크기(net.js)를 넘을 수 있다. 방금 읽음 표시한 것이 오늘 알림에 들도록
    // 오늘·내일만 서버에 있던 것과 합쳐 올리고, 나머지는 다음에 앱을 열 때 모두 올린다.
    await request('PUT', '/subscription', { ...body, days: reminderDays(today(), SOON_DAYS), merge: true }, code);
    return;
  }
  await request('PUT', '/subscription', body, code);
  lastSent = signature;
}

/** 알림을 켠다. 버튼을 누른 바로 그 자리에서 불러야 한다(알림 허용을 묻는 창은 사용자가 누를 때만 뜬다) */
export async function enableReminder(time = reminderSetting().time) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new ReminderError(permission === 'denied' ? 'denied' : 'dismissed');
  const sub = await subscription();
  await upload(sub, time, { force: true });
  await setSetting('reminder', { on: true, time });
}

/** 알림을 끈다. 서버에 알리지 못해도 구독을 지우면 푸시 서비스가 거절해 서버도 지운다 */
export async function disableReminder() {
  await setSetting('reminder', { ...reminderSetting(), on: false });
  lastSent = null;
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (!sub) return;
  await request('DELETE', '/subscription', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** 알림 시각을 바꾼다 ("HH:MM") */
export async function setReminderTime(time) {
  const { on } = reminderSetting();
  if (on) {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) await upload(sub, time);
  }
  await setSetting('reminder', { on, time });
}

/** 지금 시험 알림을 보낸다 */
export async function testReminder() {
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  if (!sub) throw new ReminderError('gone');
  await request('POST', '/test', { endpoint: sub.endpoint });
}

/**
 * 켜 둔 알림의 구독을 확인하고 내용을 올린다. 그사이 알림 허용을 거둬들였으면 끈다.
 * 구독이 없어졌으면(브라우저가 지움) 묻지 않고 다시 만든다.
 */
async function refresh() {
  const { on, time } = reminderSetting();
  if (!on) return;
  try {
    if (reminderSupport() !== 'ok' || Notification.permission !== 'granted') {
      await setSetting('reminder', { on: false, time });
      return;
    }
    await upload(await subscription(), time);
  } catch (err) {
    if (!(err instanceof ReminderError)) console.warn('[reminder]', err);
  }
}

let uploadTimer = null;

/** main.js의 boot()에서 데이터베이스를 연 뒤 한 번 부른다 */
export function initReminder() {
  if (!hasWindow) return;
  onWrite(() => {
    if (!reminderSetting().on) return;
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(refresh, UPLOAD_DELAY);
  });
  document.addEventListener('visibilitychange', () => {
    // 떠날 때는 기다리던 것을 바로 올리고, 돌아오면 날짜가 바뀌었을 수 있어 다시 올린다
    clearTimeout(uploadTimer);
    refresh();
  });
  refresh();
}
