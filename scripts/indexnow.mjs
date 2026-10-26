// 새로 만들었거나 고친 페이지를 IndexNow로 검색엔진(네이버·Bing 등)에 알린다. 배포한 뒤에 돌린다.
//
//   npm run indexnow                                         sitemap.xml의 주소를 모두
//   npm run indexnow -- https://delicious-manna.com/landing/ 그 주소만
//
// 키는 app/<키>.txt에 그 키 글자만 담아 사이트 맨 위에 둔다(검색엔진이 받아 가서 사이트 주인인지 확인한다).
// api.indexnow.org에 한 번 보내면 IndexNow를 쓰는 검색엔진이 모두 나눠 받는다. 알리는 것일 뿐 색인을 보장하지는 않는다.

import fs from 'node:fs';
import path from 'node:path';

const APP = new URL('../app/', import.meta.url).pathname;
const SITE = 'https://delicious-manna.com';

const keyFile = fs.readdirSync(APP).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error('app/에 IndexNow 키 파일(<32자리 16진수>.txt)이 없습니다');
const key = fs.readFileSync(path.join(APP, keyFile), 'utf8').trim();

const urls = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [...fs.readFileSync(path.join(APP, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const outside = urls.filter((u) => !u.startsWith(`${SITE}/`));
if (outside.length) throw new Error(`${SITE}의 주소가 아닙니다: ${outside.join(', ')}`);

// 배포한 키와 이 저장소의 키가 같아야 검색엔진이 받아 준다
const live = await fetch(`${SITE}/${keyFile}`);
if (!live.ok || (await live.text()).trim() !== key) {
  throw new Error(`${SITE}/${keyFile}이 이 키를 돌려주지 않습니다. 먼저 배포하세요.`);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation: `${SITE}/${keyFile}`, urlList: urls }),
});
// 200: 받음, 202: 받았고 키는 나중에 확인
if (res.status !== 200 && res.status !== 202) {
  throw new Error(`IndexNow ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
console.log(`IndexNow ${res.status}: ${urls.length}개 주소를 알렸습니다`);
for (const u of urls) console.log(`  ${u}`);
