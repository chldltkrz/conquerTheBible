// 사용설명서 화면 사진을 찍는 환경: 앱을 띄우는 임시 서버, 휴대폰 크기의 헤드리스 크롬, 화면 위의 빨간 번호 표시.
// scripts/manual.mjs가 쓴다.
//
// - 서버는 app/를 그대로 내보내고, /api/는 가짜로 답한다(운영 동기화 서버에 닿지 않도록). 예시 기록은 /__demo/<이름>.sqlite.
// - 브라우저의 시각은 예시 기록과 같은 2026-10-17로 고정한다(page.clock.setFixedTime). 시간대는 Asia/Seoul.
// - 명조·고딕이 기기에 있는 Noto CJK 글꼴로 보이도록 fontconfig 별칭을 준다.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const APP = path.join(ROOT, 'app');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
};

export const SYNC_CODE = 'MANA-READ-7K4P'; // 화면에 보일 예시 동기화 코드 (헷갈리는 0·O·1·I는 쓰지 않는다)

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

/** 가짜 /api: 동기화는 늘 성공하고 받을 것이 없다. 읽기 알림은 서버가 꺼져 있는 것처럼 */
async function fakeApi(req, res) {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body == null ? '' : JSON.stringify(body));
  };
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && pathname === '/api/sync') {
    const body = JSON.parse((await readBody(req)) || '{}');
    return send(200, { cursor: (body.cursor ?? 0) + (body.changes?.length ?? 0), more: false, rows: [] });
  }
  if (req.method === 'POST' && pathname === '/api/sync/spaces') return send(201, { code: SYNC_CODE });
  if (req.method === 'GET' && pathname === '/api/sync/space') {
    return send(200, { accounts: ['나', '엄마'], counts: { plans: 2, readings: 41, saved_verses: 6 }, updatedAt: '2026-10-16T22:10:00Z' });
  }
  if (req.method === 'DELETE' && pathname === '/api/sync/space') return send(204);
  if (pathname.startsWith('/api/push/')) return send(503, { error: 'push_off' });
  return send(404, { error: 'not_found' });
}

/** 앱 서버를 띄운다. demos: {이름: Uint8Array} → {url, close} */
export async function startAppServer(demos) {
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) return fakeApi(req, res);
    const { pathname } = new URL(req.url, 'http://localhost');
    const demo = /^\/__demo\/([\w-]+)\.sqlite$/.exec(pathname);
    if (demo) {
      if (!demos[demo[1]]) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
      return res.end(Buffer.from(demos[demo[1]]));
    }
    let file = path.join(APP, decodeURIComponent(pathname));
    if (!file.startsWith(APP)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) };
}

const FONTS_CONF = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <alias binding="same"><family>Noto Serif KR</family><prefer><family>Noto Serif CJK KR</family></prefer></alias>
  <alias binding="same"><family>Noto Sans KR</family><prefer><family>Noto Sans CJK KR</family></prefer></alias>
  <alias><family>serif</family><prefer><family>Noto Serif CJK KR</family></prefer></alias>
  <alias><family>sans-serif</family><prefer><family>Noto Sans CJK KR</family></prefer></alias>
</fontconfig>
`;

/** 헤드리스 크롬. workDir에 fontconfig 설정을 둔다 */
export async function launchBrowser(workDir) {
  const { chromium } = await import('playwright');
  fs.mkdirSync(workDir, { recursive: true });
  const conf = path.join(workDir, 'fonts.conf');
  fs.writeFileSync(conf, FONTS_CONF);
  return chromium.launch({ env: { ...process.env, FONTCONFIG_FILE: conf } });
}

export const PHONE = { width: 390, height: 844 };

/** 휴대폰 크기의 새 창. 시각은 nowIso로 고정한다 */
export async function phonePage(browser, nowIso) {
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    permissions: ['notifications', 'clipboard-read', 'clipboard-write'],
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(nowIso));
  page.on('pageerror', (err) => console.warn('  [앱 오류]', err.message));
  return page;
}

/** 예시 기록 demo를 넣고 hash 화면을 연다 */
export async function openDemo(page, baseUrl, demo, hash = '#/') {
  await page.goto(`${baseUrl}#/`);
  await page.waitForSelector('body:not(.booting)');
  await page.evaluate(async (name) => {
    const db = await import('/js/db.js');
    const bytes = new Uint8Array(await (await fetch(`/__demo/${name}.sqlite`)).arrayBuffer());
    await db.importFile(bytes);
  }, demo);
  await page.goto(`${baseUrl}${hash}`);
  await page.reload();
  await page.waitForSelector('body:not(.booting)');
  await settle(page);
}

/** 화면이 다 그려지기를 잠깐 기다린다 */
export async function settle(page, ms = 500) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

/**
 * 화면 위에 빨간 테두리와 번호를 얹는다. 열린 창(dialog)이 있으면 그 안에 얹는다(맨 위 층이라 밖에 두면 가려진다).
 * marks: [{sel, text?, nth?, pad?, box?}] — 순서대로 1, 2, 3… sel에 맞는 것 중 text가 들어 있는 nth번째(0부터).
 * box:false면 번호만 붙인다.
 */
export async function addMarks(page, marks) {
  const missing = await page.evaluate((marks) => {
    document.getElementById('__marks')?.remove();
    const host = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
    const layer = document.createElement('div');
    layer.id = '__marks';
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    host.append(layer);
    const missing = [];
    marks.forEach((m, i) => {
      const all = [...document.querySelectorAll(m.sel)].filter((el) => !m.text || el.textContent.includes(m.text));
      const el = all[m.nth ?? 0];
      if (!el) return missing.push(`${i + 1}: ${m.sel}${m.text ? ` "${m.text}"` : ''}`);
      const r = el.getBoundingClientRect();
      const pad = m.pad ?? 4;
      const box = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
      if (m.box !== false) {
        const b = document.createElement('div');
        b.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;
          border:2.5px solid #e0402f;border-radius:10px;box-sizing:border-box;box-shadow:0 0 0 2px rgb(255 255 255 / 70%);`;
        layer.append(b);
      }
      const n = document.createElement('div');
      const cx = Math.min(Math.max(box.x, 12), innerWidth - 12);
      const cy = Math.min(Math.max(box.y, 12), innerHeight - 12);
      n.textContent = String(i + 1);
      n.style.cssText = `position:fixed;left:${cx - 12}px;top:${cy - 12}px;width:24px;height:24px;border-radius:50%;
        background:#e0402f;color:#fff;font:700 14px/24px 'Noto Sans KR',sans-serif;text-align:center;
        box-shadow:0 0 0 2px #fff, 0 2px 6px rgb(0 0 0 / 30%);`;
      layer.append(n);
    });
    return missing;
  }, marks);
  if (missing.length) throw new Error(`표시할 곳을 찾지 못함: ${missing.join(', ')}`);
}

/** 번호를 얹어 지금 화면을 JPEG로 찍는다 */
export async function shoot(page, file, marks = []) {
  await addMarks(page, marks);
  await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
  await page.evaluate(() => document.getElementById('__marks')?.remove());
}
