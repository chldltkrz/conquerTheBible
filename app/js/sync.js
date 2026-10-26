// 기기 간 동기화: 동기화 코드 하나로 이 기기의 모든 계정 기록을 다른 기기와 맞춘다. 로그인은 없다.
// 무엇을 어떻게 주고받는지는 db.js의 '동기화', 서버는 server/sync-server.mjs.
//
// 언제: 앱을 열 때, 기록을 바꾸고 잠시 뒤, 앱으로 돌아올 때와 떠날 때, 인터넷이 다시 될 때, 켜 둔 동안 1분마다.
// window에 알리는 것: 'sync-status'(상태가 바뀜), 'sync-applied'(다른 기기의 기록을 받음),
//                    'sync-ended'(다른 기기에서 동기화를 지웠거나 오래 쓰지 않아 서버가 지워 이 기기도 멈춤)
// 이 모듈은 Node 테스트에서도 import되므로 최상위에서 window/document를 직접 쓰지 않는다.

import {
  flushPendingSaves,
  isPaused,
  onWrite,
  syncAdopt,
  syncApply,
  syncCollect,
  syncInfo,
  syncResetCursor,
  syncStart,
  syncStop,
} from './db.js';

const PROTOCOL = 1;
const PUSH_DELAY = 1500; // 기록을 바꾸고 보내기까지 (이어서 누르는 것을 한 번에 보낸다)
const POLL_INTERVAL = 60 * 1000;
const MAX_CHARS = 500000; // 요청 하나에 담는 변경의 대략적인 글자 수 (서버 한도 4MB 안)
const KEEPALIVE_LIMIT = 60000; // 앱을 떠날 때 보내는 요청의 최대 크기 (브라우저 한도 64KB)

const hasWindow = typeof window !== 'undefined';

// ── 동기화 코드 ────────────────────────────────────────────
// 헷갈리는 글자(0·O, 1·I)를 뺀 32글자로 12자리. 서버의 normalizeCode와 같다.

const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;

/** 사람이 넣은 코드를 "ABCD-EFGH-JKLM" 꼴로. 맞지 않으면 null */
export function normalizeCode(input) {
  const s = String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
  return CODE_RE.test(s) ? s.match(/.{4}/g).join('-') : null;
}

/** 다른 기기에서 열면 그 코드로 연결하는 링크. 코드는 #뒤에 두어 서버로 가지 않게 한다 */
export const syncLink = (code, base = location.origin + location.pathname) => `${base}#sync=${code}`;

/** 주소에 동기화 링크(#sync=코드)가 있으면 코드를 꺼내고 주소에서 지운다 (사용 통계에 주소가 남지 않도록) */
export function takeSyncLinkCode() {
  const m = /^#sync=([^&]+)/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', `${location.pathname}${location.search}#/settings`);
  let raw = m[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // 잘린 링크
  }
  // 맞지 않는 코드도 그대로 창에 넣어 보여 준다 (연결을 누르면 무엇이 틀렸는지 알린다)
  return normalizeCode(raw) ?? raw.slice(0, 20);
}

// ── 서버 요청 ──────────────────────────────────────────────

const MESSAGES = {
  bad_code: '동기화 코드는 12자리입니다. 다시 확인해 주세요.',
  no_space: '이 코드로 시작한 동기화가 없습니다. 코드를 다시 확인해 주세요.',
  offline: '인터넷에 연결되어 있지 않습니다.',
  busy: '요청이 너무 많습니다. 잠시 뒤에 다시 해 주세요.',
  space_full: '동기화할 기록이 너무 많습니다.',
  too_large: '한 번에 보낼 수 있는 기록보다 큽니다.',
  row_too_large: '한 번에 보낼 수 있는 기록보다 큽니다.',
  server_full: '동기화 서버의 저장 공간이 부족합니다. 기록은 이 기기에 그대로 있습니다.',
};

export class SyncError extends Error {
  constructor(code, status = 0) {
    super(MESSAGES[code] ?? '동기화 서버에 문제가 생겼습니다. 잠시 뒤에 다시 해 주세요.');
    this.code = code;
    this.status = status;
  }
}

let baseUrl = 'api/sync';
let fetchImpl = (...args) => fetch(...args);

/** 테스트용: 서버 주소와 fetch를 바꾼다 */
export function configureSync({ url, fetch: f } = {}) {
  if (url) baseUrl = url;
  if (f) fetchImpl = f;
}

async function request(method, path, code, body) {
  const text = body ? JSON.stringify(body) : undefined;
  let res;
  try {
    res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(text ? { 'Content-Type': 'application/json' } : {}),
        ...(code ? { Authorization: `Bearer ${code}` } : {}),
      },
      body: text,
      cache: 'no-store',
      // 앱을 떠나는 중이면 페이지가 닫혀도 요청을 끝까지 보낸다
      keepalive: hasWindow && document.visibilityState === 'hidden' && (text?.length ?? 0) < KEEPALIVE_LIMIT,
    });
  } catch {
    throw new SyncError('offline');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallback = { 413: 'too_large', 429: 'busy' }[res.status] ?? 'server_error';
    throw new SyncError(data.error ?? fallback, res.status);
  }
  return data;
}

// ── 상태 ───────────────────────────────────────────────────

/** 'off' | 'syncing' | 'ok' | 'offline' | 'error' */
let status = 'off';
let lastError = null;

function notify(name) {
  if (hasWindow) window.dispatchEvent(new Event(name));
}

function setStatus(next, error = null) {
  lastError = error;
  if (status === next && !error) return;
  status = next;
  notify('sync-status');
}

/** 화면에 보여 줄 동기화 상태. 동기화 중이 아니면 {status: 'off'} */
export function syncState() {
  const info = syncInfo();
  if (!info) return { status: 'off' };
  return { ...info, status: status === 'off' ? 'ok' : status, error: lastError?.message ?? null };
}

// ── 주고받기 ───────────────────────────────────────────────

let running = null;
let again = false;

/**
 * 지금 동기화한다. 이미 하는 중이면 끝난 뒤 한 번 더 한다. 실패해도 throw하지 않고 상태로 알린다.
 * 다른 창에서 쓰고 있으면(이 창은 쉬는 중) 하지 않는다. 쓰는 창이 한다.
 */
export function syncNow() {
  if (!syncInfo() || isPaused()) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    setStatus('syncing');
    try {
      do {
        again = false;
        await exchange();
      } while (again);
      setStatus(syncInfo() ? 'ok' : 'off');
    } catch (err) {
      await handleError(err);
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * 보낼 것과 받을 것이 없어질 때까지 주고받는다. 보내는 사이 이 기기에서 또 바꾼 것(받은 기록과 어긋나 고친 것 포함)도
 * 이어서 보낸다. 쉬지 않고 바뀌어도 끝나도록 횟수를 정해 둔다(남은 것은 다음 동기화에).
 */
async function exchange() {
  for (let round = 0; round < 50; round++) {
    const info = syncInfo();
    if (!info) return;
    const { upTo, changes, more } = syncCollect(MAX_CHARS);
    // 기다리는 사이 동기화를 끄거나 새로 시작했으면(백업 가져오기, 다른 코드로 연결 등) 이 요청의 결과는 버린다.
    // 다른 창에 쓰기를 넘겼을 때도 버린다 (그 창이 같은 것을 다시 보내고 받는다).
    const stale = () => isPaused() || syncInfo()?.epoch !== info.epoch;
    let res;
    try {
      res = await request('POST', '', info.code, {
        v: PROTOCOL,
        cursor: info.cursor,
        ...(info.replace ? { replace: true } : {}),
        changes,
      });
    } catch (err) {
      if (stale()) return;
      if (err.code !== 'cursor_ahead') throw err;
      await syncResetCursor();
      continue;
    }
    if (stale()) return;
    if (await syncApply({ upTo, rows: res.rows, cursor: res.cursor, replaced: info.replace, tables: res.tables })) {
      notify('sync-applied');
    }
    if (!more && !res.more && !syncInfo()?.pending) return;
  }
}

async function handleError(err) {
  if (err.code === 'no_space') {
    // 다른 기기에서 "모든 기기에서 끄기"를 했거나, 400일 동안 아무 기기도 오지 않아 서버가 지웠다. 이 기기도 멈추되 기록은 남긴다.
    await syncStop();
    setStatus('off');
    notify('sync-ended');
    return;
  }
  if (!(err instanceof SyncError)) console.error('[sync]', err);
  setStatus(err.code === 'offline' ? 'offline' : 'error', err);
}

let pushTimer = null;

function schedulePush() {
  if (!syncInfo()?.pending) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, PUSH_DELAY);
}

/** main.js의 boot()에서 데이터베이스를 연 뒤 한 번 부른다 */
export function initSync() {
  onWrite(schedulePush);
  if (!hasWindow) return;
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
    else {
      // 다른 앱으로 가거나 닫기 전에 입력 중이던 메모 등을 저장하고 남은 것을 보낸다
      flushPendingSaves().then(() => {
        if (!syncInfo()?.pending) return;
        clearTimeout(pushTimer);
        syncNow();
      });
    }
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, POLL_INTERVAL);
  syncNow();
}

// ── 시작·연결·끄기 (설정 화면) ─────────────────────────────

/** 새 동기화 코드를 만들고 이 기기 기록을 올린다. 코드를 돌려준다 */
export async function startNewSync() {
  const { code } = await request('POST', '/spaces');
  await syncStart(code);
  await syncNow();
  return code;
}

/** 다른 기기의 코드가 맞는지 확인하고 그 동기화 기록 요약을 받는다 {code, accounts, counts, updatedAt} */
export async function lookupSync(input) {
  const code = normalizeCode(input);
  if (!code) throw new SyncError('bad_code');
  return { code, ...(await request('GET', '/space', code)) };
}

/**
 * 코드로 연결한다.
 *   keep 'server': 이 기기 기록을 동기화된 기록으로 바꾼다
 *   keep 'device': 동기화된 기록(과 다른 기기들의 기록)을 이 기기 기록으로 바꾼다
 */
export async function joinSync(code, keep) {
  if (keep === 'device') {
    await syncStart(code);
    await syncNow();
    return;
  }
  // 모두 받은 뒤에 한 번에 바꾼다 (받는 중에 끊겨도 이 기기 기록은 그대로)
  const rows = [];
  let cursor = 0;
  for (;;) {
    const res = await request('POST', '', code, { v: PROTOCOL, cursor, changes: [] });
    for (const r of res.rows) rows.push(r);
    cursor = res.cursor;
    if (!res.more) break;
  }
  await syncAdopt({ code, rows, cursor });
  setStatus('ok');
  notify('sync-applied');
}

/** 동기화를 끈다. everywhere면 서버 기록도 지워 다른 기기들도 멈춘다. 이 기기 기록은 남는다 */
export async function leaveSync({ everywhere = false } = {}) {
  const info = syncInfo();
  if (!info) return;
  if (everywhere) {
    await request('DELETE', '/space', info.code).catch((err) => {
      if (err.code !== 'no_space') throw err;
    });
  }
  await syncStop();
  setStatus('off');
}
