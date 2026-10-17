// 사용설명서 PDF 만들기: 예시 기록을 넣은 앱을 휴대폰 크기의 헤드리스 크롬으로 열어 화면을 찍고(빨간 번호 표시),
// docs/manual/manual.html에 넣어 A4 PDF(app/docs/user-manual.pdf)로 만든다.
//
//   npx playwright install chromium        (처음 한 번: 크롬 받기)
//   npm run manual                         화면 찍기 + PDF
//   npm run manual -- --only reader,today  그 화면만 다시 찍고 PDF
//   npm run manual -- --pdf                찍어 둔 화면으로 PDF만
//
// 화면 사진은 .cache/manual/shots/에 둔다(저장소에는 넣지 않는다). 설명서 글은 docs/manual/manual.html,
// 꾸밈은 docs/manual/manual.css. 화면 사진의 번호는 사진마다 아래 marks의 순서이고, 글의 번호 목록과 짝을 이룬다.
// 예시 기록은 scripts/lib/manual-demo.mjs, 브라우저와 임시 서버는 scripts/lib/manual-env.mjs.

process.env.TZ = 'Asia/Seoul';

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildDemo, NOW_ISO } from './lib/manual-demo.mjs';
import { launchBrowser, openDemo, phonePage, settle, shoot, startAppServer, SYNC_CODE } from './lib/manual-env.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const WORK = path.join(ROOT, '.cache/manual');
const SHOTS = path.join(WORK, 'shots');
const DOC = path.join(ROOT, 'docs/manual');
const OUT = path.join(ROOT, 'app/docs/user-manual.pdf');

// ── 화면에서 하는 일 ──────────────────────────────────────

async function click(page, sel, text) {
  const loc = text ? page.locator(sel, { hasText: text }).first() : page.locator(sel).first();
  await loc.click();
  await settle(page, 450);
}

/** sel이 화면 위에서 offset(px) 아래에 오도록 스크롤한다. 열린 창이 있으면 창 안을 스크롤한다 */
async function scrollTo(page, sel, offset = 90) {
  await page.evaluate(
    ([sel, offset]) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`없는 곳: ${sel}`);
      const box = el.closest('.sheet-body, dialog[open]');
      if (box && box.scrollHeight > box.clientHeight) box.scrollTop += el.getBoundingClientRect().top - offset;
      else window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - offset);
    },
    [sel, offset],
  );
  await page.waitForTimeout(250);
}

async function switchAccount(page, name, hash) {
  await page.evaluate(async (name) => {
    const db = await import('/js/db.js');
    await db.switchAccount(db.listAccounts().find((a) => a.name === name).id);
  }, name);
  await page.goto(page.url().replace(/#.*$/, hash));
  await page.reload();
  await page.waitForSelector('body:not(.booting)');
  await settle(page);
}

async function setSetting(page, key, value) {
  await page.evaluate(
    async ([key, value]) => {
      const db = await import('/js/db.js');
      await db.setSetting(key, value);
    },
    [key, value],
  );
}

// ── 화면 사진 ─────────────────────────────────────────────
// demo: 'fresh'(아무 기록 없음) | 'main'. account: 그 계정으로 바꾼 뒤. prep: 찍기 전에 할 일. marks: 번호 붙일 곳(순서대로 1, 2, …)

const m = (sel, opts = {}) => ({ sel, ...opts });

const SHOT_LIST = [
  // 1 시작하기
  {
    name: 'start',
    demo: 'fresh',
    marks: [m('section.year-verse'), m('.daily-verse'), m('.plan-cta'), m('nav.tabbar', { pad: 0 })],
  },
  // 2 읽기 계획 만들기
  {
    name: 'new-top',
    demo: 'fresh',
    hash: '#/new',
    marks: [m('header.month-head'), m('.mode-tabs'), m('.mode-cards')],
  },
  {
    name: 'new-period',
    demo: 'fresh',
    hash: '#/new',
    prep: (p) => click(p, '.mode-tabs button', '기간 직접 정하기'),
    marks: [m('.period-fields'), m('[data-length]', { nth: 0, box: false })],
  },
  {
    name: 'new-presets',
    demo: 'fresh',
    hash: '#/new',
    prep: async (p) => {
      await click(p, '[data-preset]', '복음서');
      await scrollTo(p, '.chips', 120);
    },
    marks: [m('.chips'), m('.summary-bar', { pad: 2 })],
  },
  {
    name: 'new-books',
    demo: 'fresh',
    hash: '#/new',
    prep: async (p) => {
      await click(p, '[data-toggle-book="mat"]');
      await click(p, '[data-open="pro"]');
      for (const c of [1, 2, 3, 4, 5]) await click(p, `[data-ch="pro:${c}"]`);
      await scrollTo(p, '[data-toggle-book="pro"]', 150);
    },
    marks: [m('[data-toggle-book="pro"]'), m('[data-open="pro"]'), m('.chapter-grid'), m('.range-row')],
  },
  {
    name: 'new-split',
    demo: 'fresh',
    hash: '#/new',
    prep: async (p) => {
      await click(p, '[data-preset]', '복음서');
      await scrollTo(p, 'label.option', 420);
    },
    marks: [m('label.option'), m('[data-action="preview"]')],
  },
  {
    name: 'new-preview',
    demo: 'fresh',
    hash: '#/new',
    prep: async (p) => {
      await click(p, '[data-preset]', '복음서');
      await click(p, '[data-action="preview"]');
      await scrollTo(p, '.plan-summary', 20);
    },
    marks: [m('.plan-summary'), m('.carry-notice'), m('label.field'), m('.day-list'), m('[data-action="save"]')],
  },
  // 3 오늘 화면
  {
    name: 'today',
    marks: [
      m('section.year-verse'),
      m('article.today-card'),
      m('.today-actions a.btn-primary'),
      m('.today-actions [data-action="toggle-read"]'),
      m('section.stats'),
      m('.account-chip'),
    ],
  },
  {
    name: 'yearverse',
    prep: (p) => click(p, '[data-action="edit-year-verse"]'),
    marks: [m('.yv-suggest'), m('.yv-pick'), m('dialog[open] textarea'), m('dialog[open] input[name="ref"]'), m('dialog[open] .dialog-actions')],
  },
  {
    name: 'missed',
    prep: (p) => scrollTo(p, '#missed', 20),
    marks: [m('#missed li.day-row'), m('#missed button.check'), m('[data-action="rebalance"]')],
  },
  {
    name: 'stats-days',
    prep: (p) => click(p, 'button.stat', '읽은 날'),
    marks: [m('.sheet-tabs'), m('.sheet-hero'), m('.legend'), m('.mc-grid'), m('[data-goto="missed"]')],
  },
  {
    name: 'stats-streak',
    prep: (p) => click(p, 'button.stat', '연속 읽기'),
    marks: [m('.sheet-hero'), m('.hero-sub'), m('.sheet-cards'), m('.milestone')],
  },
  {
    name: 'stats-progress',
    prep: (p) => click(p, 'button.stat', '진행'),
    marks: [m('.ring'), m('.pace-text'), m('.facts'), m('.book-progress')],
  },
  // 4 본문 읽기
  {
    name: 'reader',
    hash: '#/read/2026-10/16',
    marks: [m('.reader-title'), m('.listen-btn'), m('.font-ctl'), m('.tr-switch'), m('h3.section'), m('.verse .vn', { nth: 2, pad: 3 })],
  },
  {
    name: 'reader-both',
    hash: '#/read/2026-10/16',
    prep: (p) => click(p, '.tr-switch button', '함께 보기'),
    marks: [m('.tr-switch'), m('.verse .en', { nth: 1 })],
  },
  {
    name: 'reader-select',
    hash: '#/read/2026-10/16',
    prep: async (p) => {
      await scrollTo(p, '.verse[data-ref="luk:5:4"]', 180);
      await click(p, '.verse[data-ref="luk:5:4"]');
      await click(p, '.verse[data-ref="luk:5:5"]');
    },
    marks: [
      m('.verse[data-ref="luk:5:4"]'),
      m('[data-action="listen-from"]'),
      m('#select-bar [data-action="share"]'),
      m('#select-bar [data-action="save"]'),
      m('[data-action="clear-selection"]'),
    ],
  },
  {
    name: 'card',
    hash: '#/read/2026-10/16',
    prep: async (p) => {
      await scrollTo(p, '.verse[data-ref="luk:5:4"]', 180);
      await click(p, '.verse[data-ref="luk:5:4"]');
      await click(p, '.verse[data-ref="luk:5:5"]');
      await click(p, '#select-bar [data-action="share"]');
      await p.waitForSelector('.card-preview:not(.is-loading)');
      await settle(p, 600);
    },
    marks: [m('.card-preview canvas'), m('.card-bg-strip', { pad: 2 }), m('.card-options .segmented', { nth: 0 }), m('.card-options .segmented', { nth: 1 })],
  },
  {
    name: 'card-actions',
    hash: '#/read/2026-10/16',
    prep: async (p) => {
      await scrollTo(p, '.verse[data-ref="luk:5:4"]', 180);
      await click(p, '.verse[data-ref="luk:5:4"]');
      await click(p, '.verse[data-ref="luk:5:5"]');
      await click(p, '#select-bar [data-action="share"]');
      await p.waitForSelector('.card-preview:not(.is-loading)');
      await scrollTo(p, '.card-actions', 420);
      await settle(p, 400);
    },
    marks: [m('[data-card="share"]'), m('[data-card="save"]'), m('[data-card="copy"]')],
  },
  {
    name: 'card-story',
    hash: '#/read/2026-10/1',
    prep: async (p) => {
      await scrollTo(p, '.verse[data-ref="mat:5:3"]', 180);
      await click(p, '.verse[data-ref="mat:5:3"]');
      await click(p, '#select-bar [data-action="share"]');
      await click(p, '[data-ratio="story"]');
      await p.waitForSelector('.card-preview:not(.is-loading)');
      await settle(p, 600);
    },
    marks: [m('#card-bg-hint', { pad: 3 }), m('.card-thumb[aria-checked="true"]', { pad: 3 })],
  },
  {
    name: 'reader-saved',
    hash: '#/read/2026-10/1',
    prep: (p) => scrollTo(p, '.verse[data-ref="mat:5:3"]', 260),
    marks: [m('.verse[data-ref="mat:5:3"]'), m('.verse[data-ref="mat:5:3"] .vcount', { pad: 3 })],
  },
  {
    name: 'reader-memo',
    hash: '#/read/2026-10/17',
    prep: (p) => scrollTo(p, '.memo-box', 300),
    marks: [m('.memo-box'), m('.reader-foot button.btn-primary'), m('.day-nav')],
  },
  {
    name: 'reader-done',
    hash: '#/read/2026-10/16',
    prep: (p) => scrollTo(p, '.memo-box', 300),
    marks: [m('.done-box')],
  },
  // 5 소리로 듣기
  {
    name: 'listen',
    hash: '#/read/2026-10/17',
    prep: async (p) => {
      await click(p, '.listen-btn');
      // 장 제목부터 읽으니 첫 절까지 넘긴다
      for (let i = 0; i < 4 && !(await p.$('.verse.is-speaking')); i++) await click(p, '[data-tts="next"]');
      await settle(p, 500);
    },
    marks: [m('.verse.is-speaking'), m('[data-tts="toggle"]'), m('[data-tts="next"]'), m('.tts-now'), m('[data-tts="rate"]'), m('[data-tts="close"]')],
  },
  // 6 달력
  {
    name: 'calendar',
    hash: '#/month/2026-10',
    marks: [m('header.month-head'), m('.plan-summary'), m('a.cal-cell.is-read'), m('a.cal-cell.is-missed'), m('.cal-cell.is-today')],
  },
  {
    name: 'calendar-days',
    hash: '#/month/2026-10',
    prep: (p) => scrollTo(p, '.day-list', 160),
    marks: [m('.day-list button.check', { nth: 0 }), m('.day-list li.is-missed')],
  },
  // 7 구절 탭
  {
    name: 'saved',
    hash: '#/saved',
    marks: [m('nav.subtabs'), m('.summary-action'), m('.sort-tabs'), m('.times.is-many'), m('.verse-memo'), m('.saved-actions')],
  },
  {
    name: 'notes',
    hash: '#/notes',
    marks: [m('.note-item', { text: '구절에서 고치기' }), m('.note-item', { text: '읽은 날' }), m('.summary-action')],
  },
  {
    name: 'export',
    hash: '#/notes',
    prep: (p) => click(p, '.summary-action'),
    marks: [m('dialog[open] .card'), m('[data-export="file"]'), m('[data-export="share"]'), m('[data-export="print"]')],
  },
  {
    name: 'search',
    hash: '#/search',
    prep: async (p) => {
      await p.fill('.search-box input[name="q"]', '이웃 사랑');
      await p.press('.search-box input[name="q"]', 'Enter');
      await p.waitForSelector('.search-results .saved-item', { timeout: 30000 });
      await settle(p, 600);
    },
    marks: [
      m('.search-box input[name="q"]'),
      m('.search-box select[name="scope"]'),
      m('.search-status'),
      m('.search-results mark'),
      m('[data-context]'),
      m('.search-results .saved-actions'),
    ],
  },
  {
    name: 'search-context',
    hash: '#/search',
    prep: async (p) => {
      await p.fill('.search-box input[name="q"]', '이웃 사랑');
      await p.press('.search-box input[name="q"]', 'Enter');
      await p.waitForSelector('.search-results .saved-item', { timeout: 30000 });
      await click(p, '[data-context]');
      await scrollTo(p, '.search-context', 200);
    },
    marks: [m('.search-context'), m('.search-context strong, .search-context .is-hit', { pad: 2 })],
  },
  // 8 계정
  {
    name: 'accounts',
    prep: (p) => click(p, '.account-chip'),
    marks: [m('dialog[open] .account-list'), m('dialog[open] .account-new')],
  },
  {
    name: 'others',
    prep: (p) => scrollTo(p, '.account-list.is-inline', 200),
    marks: [m('.account-list.is-inline')],
  },
  {
    name: 'settings-accounts',
    hash: '#/settings',
    prep: (p) => scrollTo(p, '.account-manage', 160),
    marks: [m('input.account-name'), m('.account-manage [data-switch-to]'), m('[data-delete-account]'), m('.account-manage ~ [data-action="switch-account"]')],
  },
  // 9 여러 권 동시에 · 그룹별로 동시에
  {
    name: 'parallel-new',
    account: '엄마',
    hash: '#/new/2026-11',
    prep: async (p) => {
      await click(p, '[data-mode="parallel"]');
      for (const b of ['gen', 'exo', 'lev']) await click(p, `[data-toggle-book="${b}"]`);
      await p.evaluate(() => window.scrollTo(0, 0));
    },
    marks: [m('header .eyebrow'), m('[data-mode="parallel"]'), m('.summary-bar', { pad: 2 })],
  },
  {
    name: 'group-new',
    account: '엄마',
    hash: '#/new/2026-11',
    prep: async (p) => {
      await click(p, '[data-preset]', '신약');
      await click(p, '[data-mode="group"]');
      await click(p, '[data-action="add-group"]');
      await click(p, '[data-preset]', '시편');
      await scrollTo(p, '[data-mode="group"]', 120);
    },
    marks: [m('[data-mode="group"]'), m('.group-list'), m('[data-action="add-group"]')],
  },
  {
    name: 'parallel-today',
    account: '엄마',
    prep: (p) => scrollTo(p, 'article.today-card', 120),
    marks: [m('.part-list'), m('.today-actions [data-action="toggle-read"]'), m('.book-progress')],
  },
  {
    name: 'parallel-reader',
    account: '엄마',
    hash: '#/read/2026-10/17',
    prep: (p) => scrollTo(p, '.track-foot', 420),
    marks: [m('.track-foot'), m('.track-head', { nth: 1 })],
  },
  {
    name: 'addbooks',
    account: '엄마',
    hash: '#/new',
    prep: async (p) => {
      await click(p, '[data-toggle-book="num"]');
      await p.evaluate(() => window.scrollTo(0, 0));
    },
    marks: [m('p.notice'), m('[data-mode="parallel"]'), m('.summary-bar', { pad: 2 })],
  },
  {
    name: 'addbooks-preview',
    account: '엄마',
    hash: '#/new',
    prep: async (p) => {
      await click(p, '[data-toggle-book="num"]');
      await click(p, '[data-action="preview"]');
      await scrollTo(p, '.carry-notice', 30);
    },
    marks: [m('.carry-notice'), m('.carry', { nth: 0, pad: 3 })],
  },
  // 10 밀린 분량 다시 나누기
  {
    name: 'rebalance-dialog',
    prep: async (p) => {
      await scrollTo(p, '#missed', 20);
      await click(p, '[data-action="rebalance"]');
    },
    marks: [m('dialog[open] p')],
  },
  {
    name: 'rebalance-calendar',
    prep: async (p) => {
      await scrollTo(p, '#missed', 20);
      await click(p, '[data-action="rebalance"]');
      await click(p, 'dialog[open] .dialog-actions .btn-primary');
      await p.goto(p.url().replace(/#.*$/, '#/month/2026-10'));
      await settle(p, 2800); // "다시 나눴습니다" 알림이 사라질 때까지
    },
    marks: [m('.cal-cell.is-moved'), m('.cal-cell.is-today')],
  },
  // 11 설정
  {
    name: 'settings-reading',
    hash: '#/settings',
    prep: (p) => scrollTo(p, '#font-size', 160),
    marks: [m('#font-size'), m('[data-family]', { box: true }), m('.segmented [data-reading-mode]'), m('#tts-voice'), m('[data-rate]'), m('[data-action="tts-test"]')],
  },
  {
    name: 'settings-reminder',
    hash: '#/settings',
    prep: async (p) => {
      await setSetting(p, 'reminder', { on: true, time: '21:00' });
      await p.reload();
      await p.waitForSelector('#reminder-block');
      await settle(p);
      await scrollTo(p, '#reminder-block', 120);
    },
    marks: [m('#reminder-on'), m('#reminder-time'), m('[data-reminder-action="test"]')],
  },
  {
    name: 'settings-offline',
    hash: '#/settings',
    prep: (p) => scrollTo(p, '[data-action="download"]', 300),
    marks: [m('[data-action="download"]'), m('.plan-list')],
  },
  {
    name: 'settings-backup',
    hash: '#/settings',
    prep: (p) => scrollTo(p, '[data-action="export"]', 200),
    marks: [m('[data-action="export"]'), m('label.btn', { text: '가져오기' }), m('[data-action="export-notes"]'), m('[data-action="reset"]'), m('#analytics-opt-in')],
  },
  {
    name: 'settings-coffee',
    hash: '#/settings',
    prep: (p) => scrollTo(p, '.coffee-card', 300),
    marks: [m('.coffee-text'), m('.coffee-links')],
  },
  // 12 기기 간 동기화
  {
    name: 'sync-start',
    hash: '#/settings',
    prep: (p) => scrollTo(p, '#sync-block', 200),
    marks: [m('[data-sync-action="create"]'), m('[data-sync-action="join"]')],
  },
  {
    name: 'sync-share',
    hash: '#/settings',
    prep: async (p) => {
      await scrollTo(p, '#sync-block', 200);
      await click(p, '[data-sync-action="create"]');
      await p.waitForSelector('dialog[open] .sync-qr');
      await settle(p, 500);
    },
    marks: [m('.sync-qr'), m('dialog[open] .sync-code'), m('dialog[open] .button-row')],
  },
  {
    name: 'sync-join',
    demo: 'fresh',
    hash: '#/settings',
    prep: async (p) => {
      await scrollTo(p, '#sync-block', 200);
      await click(p, '[data-sync-action="join"]');
      await p.fill('dialog[open] .sync-code-input', SYNC_CODE);
    },
    marks: [m('dialog[open] .sync-code-input'), m('dialog[open] .dialog-actions .btn-primary')],
  },
  {
    name: 'sync-choice',
    hash: '#/settings',
    prep: async (p) => {
      await scrollTo(p, '#sync-block', 200);
      await click(p, '[data-sync-action="join"]');
      await p.fill('dialog[open] .sync-code-input', SYNC_CODE);
      await click(p, 'dialog[open] .dialog-actions .btn-primary');
      await p.waitForSelector('dialog[open] .choice-list');
    },
    marks: [m('dialog[open] .choice', { nth: 0 }), m('dialog[open] .choice', { nth: 1 })],
  },
  {
    name: 'sync-status',
    hash: '#/settings',
    prep: async (p) => {
      await scrollTo(p, '#sync-block', 200);
      await click(p, '[data-sync-action="create"]');
      await p.waitForSelector('dialog[open] .sync-qr');
      await p.keyboard.press('Escape');
      await settle(p, 900);
      await scrollTo(p, '#sync-block', 120);
    },
    marks: [m('#sync-status'), m('.sync-code-box'), m('[data-sync-action="share"]'), m('[data-sync-action="now"]'), m('[data-sync-action="leave"]')],
  },
  {
    name: 'sync-leave',
    hash: '#/settings',
    prep: async (p) => {
      await scrollTo(p, '#sync-block', 200);
      await click(p, '[data-sync-action="create"]');
      await p.waitForSelector('dialog[open] .sync-qr');
      await p.keyboard.press('Escape');
      await settle(p, 900);
      await click(p, '[data-sync-action="leave"]');
      await p.waitForSelector('dialog[open] .choice-list');
    },
    marks: [m('dialog[open] .choice', { nth: 0 }), m('dialog[open] .choice', { nth: 1 })],
  },
];

// ── 실행 ──────────────────────────────────────────────────

const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const pdfOnly = args.includes('--pdf');

// 헤드리스 크롬에는 휴대폰의 공유 창, 알림 허용, 한국어 음성이 없어서 흉내 낸다(화면이 휴대폰과 같게 보이도록)
function deviceStubs() {
  Object.defineProperty(navigator, 'share', { value: async () => {}, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  if (window.Notification) {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
    Notification.requestPermission = async () => 'granted';
  }
  const voices = [
    { name: '유나', lang: 'ko-KR', localService: true, voiceURI: 'ko-yuna', default: true },
    { name: 'Google 한국의', lang: 'ko-KR', localService: false, voiceURI: 'ko-google', default: false },
  ];
  if (window.speechSynthesis) {
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
    const synth = window.speechSynthesis;
    synth.getVoices = () => voices;
    synth.speak = (u) => setTimeout(() => u.onstart?.(), 0); // 끝나지 않는다: 읽는 중인 화면
    synth.cancel = () => {};
    synth.pause = () => {};
    synth.resume = () => {};
  }
}

async function takeShots() {
  const SQL = await createRequire(import.meta.url)('sql.js')();
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data/index.json'), 'utf8'));
  const demos = { fresh: await buildDemo(SQL, index, 'fresh'), main: await buildDemo(SQL, index, 'main') };
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startAppServer(demos);
  const browser = await launchBrowser(WORK);
  const failed = [];
  try {
    for (const shot of SHOT_LIST) {
      if (only && !only.has(shot.name)) continue;
      const page = await phonePage(browser, NOW_ISO);
      await page.context().addInitScript(deviceStubs);
      try {
        await openDemo(page, server.url, shot.demo ?? 'main', shot.account ? '#/' : (shot.hash ?? '#/'));
        if (shot.account) await switchAccount(page, shot.account, shot.hash ?? '#/');
        await shot.prep?.(page);
        await shoot(page, path.join(SHOTS, `${shot.name}.jpg`), shot.marks);
        console.log(`  ${shot.name}`);
      } catch (err) {
        failed.push(shot.name);
        console.error(`  실패 ${shot.name}: ${err.message.split('\n')[0]}`);
        await page.screenshot({ path: path.join(SHOTS, `${shot.name}.failed.jpg`), type: 'jpeg', quality: 60 }).catch(() => {});
      } finally {
        await page.context().close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return failed;
}

async function renderPdf() {
  // 글과 꾸밈을 화면 사진 옆에 두고 file://로 연다
  for (const f of fs.readdirSync(DOC)) fs.copyFileSync(path.join(DOC, f), path.join(WORK, f));
  fs.copyFileSync(path.join(ROOT, 'app/icons/icon.svg'), path.join(WORK, 'icon.svg'));
  const html = path.join(WORK, 'manual.html');
  const missing = [...fs.readFileSync(html, 'utf8').matchAll(/src="shots\/([\w-]+)\.jpg"/g)]
    .map((x) => x[1])
    .filter((n) => !fs.existsSync(path.join(SHOTS, `${n}.jpg`)));
  if (missing.length) throw new Error(`찍지 않은 화면: ${missing.join(', ')}`);

  const browser = await launchBrowser(WORK);
  try {
    const page = await browser.newPage();
    await page.goto(`file://${html}`);
    await page.evaluate(() => document.fonts.ready);
    const footer = `<div style="width:100%;padding:0 16mm;display:flex;justify-content:space-between;
      font:7.5px 'Noto Sans KR',sans-serif;color:#8a8f88;"><span>맛있는만나 사용설명서</span>
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
    await page.pdf({
      path: OUT,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: footer,
      margin: { top: '16mm', bottom: '16mm', left: '0', right: '0' },
    });
  } finally {
    await browser.close();
  }
}

if (!pdfOnly) {
  console.log('화면 찍기');
  const failed = await takeShots();
  if (failed.length) {
    console.error(`찍지 못한 화면 ${failed.length}개: ${failed.join(', ')} (.cache/manual/shots/*.failed.jpg)`);
    process.exit(1);
  }
}
console.log('PDF 만들기');
await renderPdf();
console.log(`→ ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)}MB)`);
