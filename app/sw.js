// 서비스 워커: 앱 화면과 성경 본문을 캐시해 오프라인에서도 열리게 한다.
//   앱 파일·index.json  → 네트워크 우선 (온라인이면 항상 최신), 실패하면 캐시
//   성경 본문(books/*.json, bsb/books/*.json) → 캐시 우선 (본문은 바뀌지 않는다)
//   동기화 서버(api/) → 손대지 않는다 (늘 서버로)
// 읽기 알림(js/reminder.js, server/push.mjs)이 보낸 푸시를 알림으로 띄우는 것도 여기서 한다.

const SHELL_CACHE = 'shell-v7';
const DATA_CACHE = 'bible-data-v1'; // js/views/settings.js와 같은 이름

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/bible.js',
  'js/dates.js',
  'js/db.js',
  'js/planner.js',
  'js/prefs.js',
  'js/ui.js',
  'js/views/common.js',
  'js/views/today.js',
  'js/views/calendar.js',
  'js/views/newplan.js',
  'js/views/reader.js',
  'js/views/settings.js',
  'js/views/saved.js',
  'js/views/notes.js',
  'js/views/search.js',
  'js/views/listen.js',
  'js/views/stats.js',
  'js/views/yearverse.js',
  'js/views/syncsection.js',
  'js/sync.js',
  'js/reminder.js',
  'js/views/remindersection.js',
  'js/verses.js',
  'js/tts.js',
  'js/analytics.js',
  'vendor/sql-wasm-browser.js',
  'vendor/sql-wasm-browser.wasm',
  'vendor/posthog.js',
  'vendor/qrcode.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'data/index.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(new URL('api/', self.registration.scope).pathname)) return;

  if (/\/data\/(?:bsb\/)?books\/[^/]+\.json$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

// ── 읽기 알림 ──────────────────────────────────────────────
// 서버가 보내는 내용: {title, body, tag, url}

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data?.json() ?? {};
  } catch {
    msg = { body: event.data?.text() }; // JSON이 아닌 글자만 온 경우
  }
  event.waitUntil(
    self.registration.showNotification(msg.title ?? '맛있는만나', {
      body: msg.body ?? '',
      icon: 'icons/icon-192.png',
      tag: msg.tag ?? 'reminder', // 같은 tag의 알림은 새 것으로 바뀐다 (쌓이지 않게)
      data: { url: new URL(msg.url ?? './', self.registration.scope).href },
    }),
  );
});

// 알림을 누르면 열려 있는 앱 창을 앞으로 가져오고, 없으면 새로 연다
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      if (open) return open.focus();
      return self.clients.openWindow(event.notification.data?.url ?? self.registration.scope);
    })(),
  );
});

// 브라우저가 구독을 바꾸면 서버의 구독도 새 것으로 바꾼다 (옛 구독을 알려 주지 않는 브라우저는 앱을 열 때 다시 올린다)
self.addEventListener('pushsubscriptionchange', (event) => {
  const old = event.oldSubscription;
  if (!old) return;
  event.waitUntil(
    (async () => {
      const sub = event.newSubscription ?? (await self.registration.pushManager.subscribe(old.options));
      await fetch(new URL('api/push/renew', self.registration.scope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old: old.endpoint, subscription: sub.toJSON() }),
      });
    })().catch(() => {}),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    throw err;
  }
}
