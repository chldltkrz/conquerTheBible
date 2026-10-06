// 대한성서공회 사이트에서 새번역 본문을 받아 app/data/ 아래 JSON으로 만든다.
//
//   node scripts/crawl.mjs            받지 않은 장만 내려받고 JSON 생성
//   node scripts/crawl.mjs --no-build 내려받기만
//   node scripts/crawl.mjs --build    내려받지 않고 캐시된 HTML로 JSON만 다시 생성
//
// 내려받은 HTML은 .cache/saenew/ 에 남겨 두므로 다시 실행해도 사이트에 요청하지 않는다.
// 새번역 본문의 저작권은 대한성서공회에 있다. 개인 용도로만 사용할 것.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOKS } from './lib/books.mjs';
import { parseChapter, verseWeight } from './lib/parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'saenew');
const OUT_DIR = path.join(ROOT, 'app', 'data');
const BASE = 'https://www.bskorea.or.kr/bible/korbibReadpage.php?version=SAENEW';

const CONCURRENCY = 2;
const DELAY_MS = 300;
const START_MARK = 'id="tdBible1"';
const END_MARK = '<div style="width:100%;text-align: center">';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cachePath = (code, chap) => path.join(CACHE_DIR, code, `${chap}.html`);

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchChapter(code, chap) {
  const url = `${BASE}&book=${code}&chap=${chap}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'conquer-the-bible personal crawler' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const start = html.indexOf(START_MARK);
      const end = html.indexOf(END_MARK, start);
      if (start < 0 || end < 0 || !html.includes('class="number"', start)) {
        throw new Error('본문 영역을 찾지 못함');
      }
      return html.slice(start, end);
    } catch (err) {
      if (attempt >= 4) throw new Error(`${code} ${chap}장: ${err.message}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

async function download() {
  const jobs = [];
  for (const b of BOOKS) {
    for (let c = 1; c <= b.chapters; c++) {
      if (!(await exists(cachePath(b.code, c)))) jobs.push([b.code, c]);
    }
  }
  if (jobs.length === 0) {
    console.log('모든 장이 이미 캐시되어 있습니다.');
    return;
  }
  console.log(`${jobs.length}개 장을 내려받습니다...`);
  let done = 0;
  const worker = async () => {
    while (jobs.length) {
      const [code, chap] = jobs.shift();
      const html = await fetchChapter(code, chap);
      await fs.mkdir(path.dirname(cachePath(code, chap)), { recursive: true });
      await fs.writeFile(cachePath(code, chap), html);
      done++;
      if (done % 50 === 0) console.log(`  ${done}장 완료 (${code} ${chap})`);
      await sleep(DELAY_MS);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`내려받기 완료: ${done}장`);
}

async function build() {
  await fs.mkdir(path.join(OUT_DIR, 'books'), { recursive: true });
  const index = { translation: '새번역', books: [] };
  const problems = [];
  let totalVerses = 0;

  for (const b of BOOKS) {
    const book = { code: b.code, name: b.name, chapters: [] };
    // index.json에는 본문 없이 분량 정보만 담는다. 계획을 세울 때 쓴다.
    //   w: 절마다 글자 수, h: 단락 제목이 시작되는 절 번호
    //   v: 절 번호 (1..n이 아닐 때만. 빠진 절이나 묶인 절이 있는 장)
    //   e: 묶인 절의 {시작 번호: 끝 번호} (있을 때만)
    const meta = [];
    for (let c = 1; c <= b.chapters; c++) {
      const html = await fs.readFile(cachePath(b.code, c), 'utf8');
      const ch = parseChapter(html);
      const nums = ch.verses.map((v) => v.v);
      if (nums.length === 0) problems.push(`${b.code} ${c}: 절이 없음`);
      let last = 0;
      for (const v of ch.verses) {
        if (v.v <= last) problems.push(`${b.code} ${c}: 절 번호 순서 이상 ${last} → ${v.v}`);
        if (v.e != null && v.e <= v.v) problems.push(`${b.code} ${c}:${v.v}-${v.e} 묶인 절 번호 이상`);
        if (!v.t) problems.push(`${b.code} ${c}:${v.v} 본문이 비어 있음`);
        last = v.e ?? v.v;
      }
      totalVerses += nums.length;
      book.chapters.push({ c, ...ch });
      const m = {
        w: ch.verses.map((v) => verseWeight(v.t)),
        h: [...new Set(ch.heads.filter((h) => h.kind === 'section' && h.v !== nums[0]).map((h) => h.v))],
      };
      if (nums.some((n, i) => n !== i + 1)) m.v = nums;
      const joined = ch.verses.filter((v) => v.e != null);
      if (joined.length) m.e = Object.fromEntries(joined.map((v) => [v.v, v.e]));
      meta.push(m);
    }
    await fs.writeFile(path.join(OUT_DIR, 'books', `${b.code}.json`), JSON.stringify(book));
    index.books.push({ code: b.code, name: b.name, short: b.short, testament: b.testament, chapters: meta });
  }

  await fs.writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(index));
  console.log(`JSON 생성 완료: 66권, 절 ${totalVerses}개 → ${path.relative(ROOT, OUT_DIR)}`);
  if (problems.length) {
    console.warn(`확인이 필요한 항목 ${problems.length}개:`);
    for (const p of problems) console.warn('  ' + p);
    process.exitCode = 1;
  }
}

const args = new Set(process.argv.slice(2));
if (!args.has('--build')) await download();
if (!args.has('--no-build')) await build();
