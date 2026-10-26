// 소개 페이지(app/landing/)에 쓰는 화면 사진과 "고르게 나누기" 그래프 자료를 만든다.
//
//   npm run landing        화면 사진(app/landing/img/*.webp)과 그래프 자료(app/landing/split.json)
//
// 화면 사진은 사용설명서(scripts/manual.mjs)와 같은 예시 기록·가짜 서버·휴대폰 크기 크롬으로 찍되 번호 표시는 넣지 않는다.
// 그래프 자료는 성경 전체를 1년(365일)에 읽을 때 날마다 몇 분인지: 맛있는만나(planner.js)와, 장 수만 똑같이 나눈 것.
// 앱 화면이나 나누는 방식(planner.js)을 바꾸면 다시 만든다.

process.env.TZ = 'Asia/Seoul';

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { buildDemo, NOW_ISO } from './lib/manual-demo.mjs';
import { click, deviceStubs, joinDemoRoom, launchBrowser, openDemo, phonePage, scrollTo, settle, startAppServer } from './lib/manual-env.mjs';
import { formatSegments, presetBooks, PRESETS, useIndex } from '../app/js/bible.js';
import { buildPlan } from '../app/js/planner.js';

const ROOT = new URL('..', import.meta.url).pathname;
const WORK = path.join(ROOT, '.cache/landing');
const OUT = path.join(ROOT, 'app/landing');
const run = promisify(execFile);

// ── 화면 사진 ─────────────────────────────────────────────
// demo: 'fresh'(아무 기록 없음) | 'main'(사용설명서의 예시 기록, 오늘은 2026년 10월 17일)

const SHOT_LIST = [
  { name: 'today' },
  {
    name: 'plan',
    demo: 'fresh',
    hash: '#/new/2026-11', // 다음 달: 지난 날짜(밀린 읽기) 안내 없이
    prep: async (p) => {
      await click(p, '[data-preset]', '복음서');
      await click(p, '[data-action="preview"]');
      await scrollTo(p, '.plan-summary', 20);
    },
  },
  { name: 'reader', hash: '#/read/2026-10/16' },
  { name: 'calendar', hash: '#/month/2026-10' },
  {
    name: 'room',
    prep: async (p) => {
      await joinDemoRoom(p);
      await click(p, '[data-room-open]');
      await p.waitForSelector('.sheet .room-members');
      await settle(p, 500);
    },
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
  },
];

async function takeShots(index) {
  const SQL = await createRequire(import.meta.url)('sql.js')();
  const demos = { fresh: await buildDemo(SQL, index, 'fresh'), main: await buildDemo(SQL, index, 'main') };
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  const server = await startAppServer(demos);
  const browser = await launchBrowser(WORK);
  try {
    for (const shot of SHOT_LIST) {
      const page = await phonePage(browser, NOW_ISO);
      await page.context().addInitScript(deviceStubs);
      try {
        await openDemo(page, server.url, shot.demo ?? 'main', shot.hash ?? '#/');
        await shot.prep?.(page);
        const png = path.join(WORK, `${shot.name}.png`);
        await page.screenshot({ path: png });
        await run('convert', [png, '-strip', '-quality', '78', path.join(OUT, 'img', `${shot.name}.webp`)]);
        console.log(`  ${shot.name}`);
      } finally {
        await page.context().close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

// ── 그래프 자료 ───────────────────────────────────────────

const CHARS_PER_MINUTE = 500; // bible.js readingMinutes와 같다
const minutes = (chars) => Math.round((chars / CHARS_PER_MINUTE) * 10) / 10;

/** 성경 전체 365일: 날마다 {m: 분, r: 범위} — 맛있는만나(plan)와 장 수만 똑같이 나눈 것(naive) */
function splitData(index) {
  const days = 365;
  const chapters = presetBooks(PRESETS[0]).flatMap((b) => b.chapters.map((_, i) => ({ b: b.code, c: i + 1 })));
  const chars = new Map(index.books.map((b) => [b.code, b.chapters.map((ch) => ch.w.reduce((s, w) => s + w, 0))]));
  const plan = buildPlan(index, chapters, days).map((d) => ({ m: minutes(d.chars), r: formatSegments(d.segments) }));
  const naive = Array.from({ length: days }, (_, i) => {
    const part = chapters.slice(Math.round((i * chapters.length) / days), Math.round(((i + 1) * chapters.length) / days));
    return { m: minutes(part.reduce((s, x) => s + chars.get(x.b)[x.c - 1], 0)), r: formatSegments(part) };
  });
  return { title: '성경 전체를 1년(365일)에 읽을 때 하루 분량', chapters: chapters.length, days, plan, naive };
}

const index = useIndex(JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data/index.json'), 'utf8')));
const data = splitData(index);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'split.json'), `${JSON.stringify(data)}\n`);
console.log('그래프 자료 → app/landing/split.json');
if (!process.argv.includes('--data')) {
  console.log('화면 찍기');
  await takeShots(index);
}
