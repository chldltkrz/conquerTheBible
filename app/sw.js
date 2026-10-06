// 서비스 워커: 앱 화면과 성경 본문을 캐시해 오프라인에서도 열리게 한다.
//   앱 파일·index.json  → 네트워크 우선 (온라인이면 항상 최신), 실패하면 캐시
//   성경 본문(books/*.json) → 캐시 우선 (본문은 바뀌지 않는다)

const SHELL_CACHE = 'shell-v1';
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
  'vendor/sql-wasm-browser.js',
  'vendor/sql-wasm-browser.wasm',
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

  if (/\/data\/books\/[^/]+\.json$/.test(url.pathname)) {
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
