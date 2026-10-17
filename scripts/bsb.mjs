// BSB(Berean Standard Bible) 본문을 받아 app/data/bsb/books/*.json으로 만든다.
//
//   node scripts/bsb.mjs           (npm run bsb) 받지 않았으면 내려받고 JSON 생성
//   node scripts/bsb.mjs --download 다시 내려받고 JSON 생성
//
// 원본은 BSB를 펴내는 곳(bereanbible.com)의 USFM 묶음이다. 받은 파일은 .cache/bsb/에 남겨 두므로
// 다시 실행해도 사이트에 요청하지 않는다. BSB 본문은 퍼블릭 도메인이다(2023년 4월 30일부터).

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { BOOKS } from './lib/books.mjs';
import { parseUsfm } from './lib/usfm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'bsb', 'bsb_usfm.zip');
const OUT_DIR = path.join(ROOT, 'app', 'data', 'bsb', 'books');
const SOURCE = 'https://bereanbible.com/bsb_usfm.zip';

// USFM 책 ID와 다른 앱의 책 코드
const CODE_OF = { JON: 'jnh' };

/** zip 파일의 파일들 Map(이름 → 내용). (저장·deflate만 지원하면 충분하다) */
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('zip 파일이 아닙니다');
  const files = new Map();
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = buf.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const data = buf.subarray(start, start + size);
    if (!name.endsWith('/')) files.set(name, method === 8 ? zlib.inflateRawSync(data) : data);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
}

async function download() {
  console.log(`내려받는 중: ${SOURCE}`);
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`내려받지 못했습니다 (HTTP ${res.status})`);
  await fs.mkdir(path.dirname(CACHE), { recursive: true });
  await fs.writeFile(CACHE, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const cached = await fs.access(CACHE).then(
    () => true,
    () => false,
  );
  if (!cached || process.argv.includes('--download')) await download();

  const files = unzip(await fs.readFile(CACHE));
  const known = new Set(BOOKS.map((b) => b.code));
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  let count = 0;
  let verses = 0;
  for (const [name, data] of files) {
    const id = /([1-3A-Z]{3})\.usfm$/i.exec(name)?.[1].toUpperCase();
    if (!id) continue;
    const code = CODE_OF[id] ?? id.toLowerCase();
    if (!known.has(code)) throw new Error(`앱에 없는 책: ${name}`);
    const book = parseUsfm(data.toString('utf8'), code);
    await fs.writeFile(path.join(OUT_DIR, `${code}.json`), JSON.stringify(book));
    count++;
    verses += book.chapters.reduce((s, c) => s + c.verses.length, 0);
  }
  if (count !== BOOKS.length) throw new Error(`책이 ${count}권뿐입니다 (${BOOKS.length}권이어야 함)`);
  console.log(`BSB ${count}권, ${verses.toLocaleString()}절 → ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
