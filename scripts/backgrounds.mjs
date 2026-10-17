// 말씀 카드 배경: 주제별 풍경 사진을 이미지 AI(Nano Banana 2.1, Vertex AI의 gemini-nano-banana-2.1)로 만든다.
// Vertex AI 익스프레스 모드 API 키(AQ.…)와 그 키의 Google Cloud 프로젝트 번호가 필요하다.
//
//   GEMINI_API_KEY=… GOOGLE_CLOUD_PROJECT=… npm run backgrounds   만들지 않은 것만 만든다 (원본은 .cache/backgrounds/)
//   npm run backgrounds -- --build                원본으로 앱용 파일만 다시 만든다
//   npm run backgrounds -- --redo pasture-2       그 배경만 다시 만든다
//
// 원본(2K, 9:16 PNG)에서 앱용 파일을 만든다 (ImageMagick 필요):
//   app/img/cards/<id>.webp        1080×1920 (인스타 스토리는 그대로, 정사각형 카드는 가운데를 잘라 쓴다)
//   app/img/cards/thumb/<id>.webp  고르는 화면의 작은 그림
//   app/img/cards/index.json       주제(이름·말씀에서 찾을 낱말)와 주제마다의 배경
// 글자는 이미지 AI가 쓰지 않는다 (한글을 자주 틀린다). 카드를 만들 때 앱이 얹는다.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = path.join(ROOT, '.cache/backgrounds');
const OUT = path.join(ROOT, 'app/img/cards');

const MODEL = 'gemini-nano-banana-2.1';
// 2.1은 global 위치에만 있다 (프로젝트를 빼면 지역 위치로 가서 404)
const endpoint = (project) =>
  `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${MODEL}:generateContent`;
const PARALLEL = 2; // 더 많이 보내면 요청 한도(429)에 자주 걸린다
const ATTEMPTS = 8;

const STYLE = [
  'Vertical fine-art landscape photograph, shot on a full-frame camera with natural light.',
  'Gentle, rich but calm colors, high dynamic range, sharp detail, peaceful and contemplative mood.',
  'Keep a large calm, uncluttered area in the middle of the frame (sky, mist, water or soft field) so text can be placed over it.',
  'Absolutely no people, no human figures, no faces, no hands, no text, no letters, no signatures, no watermark,',
  'no logos, no buildings, no religious symbols.',
].join(' ');

/**
 * 주제: 말씀에서 이 낱말들이 보이면 이 주제의 배경을 먼저 권한다 (app/js/card.js의 pickTheme).
 * 낱말은 어절의 첫머리에서만 찾는다("양을"은 "찬양을"에 맞지 않는다). 띄어쓰기가 든 낱말은 그대로 찾는다.
 * "해", "강", "가지"처럼 다른 뜻으로 흔히 쓰는 낱말은 넣지 않는다(해서, 강하다, 가지고). 영어는 BSB용.
 */
export const THEMES = [
  {
    id: 'pasture',
    label: '초장',
    keywords: ['목자', '양을', '양이', '양의', '양들', '양 떼', '양떼', '초장', '풀밭', '푸른 풀', '쉴 만한', 'shepherd', 'sheep', 'flock', 'pasture', 'lamb'],
    scenes: [
      'Lush green rolling pasture at early morning with a gentle stream winding through it, a few white sheep grazing far in the distance, soft golden mist.',
      'Quiet meadow beside still, glassy water reflecting the pale dawn sky, soft green grass in the foreground.',
      'Green hillside pasture under a soft bright overcast sky, sheep resting in the distance, light breeze moving the grass.',
      'Small flock of sheep on a grassy slope at golden hour, warm backlight, mountains faint in the hazy background.',
      'Wide green valley with a calm brook and scattered wildflowers, morning dew sparkling in gentle sunlight.',
    ],
  },
  {
    id: 'light',
    label: '빛',
    keywords: ['빛', '등불', '비추', '비치', '밝', '아침', '새벽', '햇빛', '해가', 'light', 'lamp', 'shine', 'morning', 'dawn', 'sun'],
    scenes: [
      'Rays of sunlight breaking through clouds over a quiet valley at sunrise.',
      'Soft golden light streaming through a misty forest, visible light beams between tall trees.',
      'Sunrise over a calm open horizon, warm glow spreading across the sky, gentle scattered clouds.',
      'A single small clay oil lamp glowing warmly on a rough wooden table in darkness, soft bokeh, close-up still life.',
      'Dawn light glowing behind a mountain ridge, sky shifting from deep blue to soft gold.',
    ],
  },
  {
    id: 'water',
    label: '물가',
    keywords: ['물가', '물이', '물을', '물로', '물에', '강물', '강가', '샘', '시내', '시냇', '생수', '목마르', '목말라', 'water', 'river', 'spring', 'stream', 'thirst'],
    scenes: [
      'Clear mountain stream flowing over smooth stones through a green forest, soft light.',
      'Natural spring of crystal clear water welling up among mossy rocks, sunlight on the surface.',
      'Wide calm river winding through a valley at sunrise, mist rising from the water.',
      'Small waterfall cascading into a clear pool surrounded by ferns, soft diffused light.',
    ],
  },
  {
    id: 'mountain',
    label: '산과 반석',
    keywords: ['산이', '산에', '산을', '산들', '산과', '산으로', '반석', '바위', '요새', '산성', '피난처', '방패', 'mountain', 'hill', 'rock', 'fortress', 'refuge', 'shield', 'stronghold'],
    scenes: [
      'Majestic mountain range at dawn, layers of peaks fading into soft blue haze.',
      'Massive solid rock cliff rising above a quiet valley, warm evening light on the stone.',
      'Snow-capped mountain peak reflected in a perfectly still alpine lake.',
      'Rugged mountain summit above a sea of clouds at sunrise.',
    ],
  },
  {
    id: 'path',
    label: '길',
    keywords: ['길', '걸음', '발걸음', '발길', '인도', '따르', 'path', 'way', 'walk', 'step', 'lead', 'guide', 'follow'],
    scenes: [
      'Narrow dirt path winding through a golden wheat field toward the horizon.',
      'Forest trail with soft sunlight filtering through the trees, the path leading forward into light.',
      'Old stone footpath through a green hillside meadow on a fresh morning.',
      'Mountain trail at sunrise leading over a ridge, gentle mist in the valley below.',
    ],
  },
  {
    id: 'sea',
    label: '바다',
    keywords: ['바다', '바닷', '물결', '풍랑', '파도', '배를', '배가', '배에', '호수', 'sea', 'wave', 'storm', 'boat', 'lake'],
    scenes: [
      'Calm sea at dawn with gentle waves and a soft pastel sky.',
      'Dark storm clouds over the sea with a break in the clouds sending sunlight onto the water.',
      'Gentle waves washing onto a quiet sandy shore at sunrise.',
      'A small empty wooden fishing boat resting on a calm lake at dawn, hills on the far shore.',
    ],
  },
  {
    id: 'night',
    label: '밤하늘',
    keywords: ['별', '밤', '달이', '달과', 'star', 'night', 'moon'],
    scenes: [
      'Starry night sky with the Milky Way arching over a quiet desert landscape.',
      'Full moon rising over calm hills in a soft blue night.',
      'Countless stars above the silhouette of a mountain ridge.',
      'Night sky full of stars reflected in a calm lake.',
    ],
  },
  {
    id: 'wilderness',
    label: '광야',
    keywords: ['광야', '사막', '메마른', '마른 땅', 'wilderness', 'desert'],
    scenes: [
      'Vast desert wilderness with soft sand dunes at sunrise, long gentle shadows.',
      'Rocky wilderness valley with sparse shrubs under a wide open sky.',
      'A small oasis with palm trees and a pool of water in the middle of the desert.',
      'A single blooming flower growing from dry cracked desert ground, soft morning light.',
    ],
  },
  {
    id: 'harvest',
    label: '열매와 추수',
    keywords: ['열매', '포도', '씨를', '씨앗', '씨가', '추수', '거두', '곡식', '밀알', '밭', 'fruit', 'vine', 'seed', 'harvest', 'grain', 'field'],
    scenes: [
      'Golden wheat field ready for harvest under warm evening sun.',
      'Rows of grapevines heavy with ripe purple grapes in a vineyard, soft sunlight.',
      'Close-up of a grapevine branch with grape clusters and leaves, shallow depth of field.',
      'Freshly plowed field with young green sprouts emerging in morning light.',
    ],
  },
  {
    id: 'flowers',
    label: '들꽃',
    keywords: ['꽃', '백합', '들풀', '풀이', '풀과', '풀은', 'flower', 'lily', 'lilies', 'grass', 'bloom'],
    scenes: [
      'Field of wild lilies and wildflowers swaying in the breeze, soft focus background.',
      'Close-up of delicate white flowers with morning dew drops, soft light.',
      'Hillside covered with colorful wildflowers in spring, gentle sunlight.',
      'Soft purple and white wildflowers in a meadow at golden hour, dreamy bokeh.',
    ],
  },
  {
    id: 'tree',
    label: '나무',
    keywords: ['나무', '뿌리', '감람', '백향목', '심은', '심긴', 'tree', 'root', 'branch', 'olive', 'cedar'],
    scenes: [
      'A single strong tree planted by a flowing stream, green leaves, soft morning light.',
      'Ancient olive tree in a quiet grove, warm sunlight through silver leaves.',
      'Tall cedar trees on a mountainside under a clear sky.',
      'A tree in full white blossom against a soft blue sky.',
    ],
  },
  {
    id: 'sky',
    label: '하늘',
    keywords: ['독수리', '날개', '구름', '비가', '비를', '단비', '무지개', '하늘', 'eagle', 'wing', 'cloud', 'rain', 'rainbow', 'heaven', 'sky'],
    scenes: [
      'A golden eagle soaring high above mountain peaks in a wide open sky.',
      'Soft white clouds drifting in a bright blue sky, peaceful.',
      'Rainbow over green hills after rain, soft light.',
      'Gentle rain falling over a green valley, soft silver light breaking through.',
    ],
  },
];

const jobs = THEMES.flatMap((t) => t.scenes.map((scene, i) => ({ id: `${t.id}-${i + 1}`, theme: t.id, prompt: `${scene} ${STYLE}` })));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(job, { key, project }) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const res = await fetch(endpoint(project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: job.prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16', imageSize: '2K' } },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const image = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
      if (image) return Buffer.from(image.data, 'base64');
      console.warn(`  ${job.id}: 그림 없음 (${data.candidates?.[0]?.finishReason ?? '?'}), 다시`);
    } else if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(15 * attempt, 90);
      console.warn(`  ${job.id}: ${res.status}, ${wait}초 뒤 다시`);
      await sleep(wait * 1000);
    } else {
      throw new Error(`${job.id}: ${res.status} ${data.error?.message ?? ''}`);
    }
  }
  throw new Error(`${job.id}: ${ATTEMPTS}번 해도 만들지 못함`);
}

const exists = (p) => fs.access(p).then(() => true, () => false);

async function generateAll(auth, redo) {
  await fs.mkdir(CACHE, { recursive: true });
  const todo = [];
  for (const job of jobs) if (redo.has(job.id) || !(await exists(path.join(CACHE, `${job.id}.png`)))) todo.push(job);
  console.log(`만들 배경 ${todo.length}개 (전체 ${jobs.length}개)`);
  let next = 0;
  const failed = [];
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (next < todo.length) {
        const job = todo[next++];
        try {
          await fs.writeFile(path.join(CACHE, `${job.id}.png`), await generate(job, auth));
          console.log(`  ${job.id}`);
        } catch (err) {
          failed.push(job.id);
          console.error(`  실패 ${err.message}`);
        }
      }
    }),
  );
  if (failed.length) console.error(`만들지 못한 배경: ${failed.join(' ')} (다시 실행하면 이어서 만든다)`);
}

async function build() {
  await fs.mkdir(path.join(OUT, 'thumb'), { recursive: true });
  const made = [];
  for (const job of jobs) {
    const src = path.join(CACHE, `${job.id}.png`);
    if (!(await exists(src))) continue;
    await run('convert', [src, '-resize', '1080x1920^', '-gravity', 'center', '-extent', '1080x1920', '-strip', '-quality', '80', path.join(OUT, `${job.id}.webp`)]);
    await run('convert', [src, '-resize', '270x480^', '-gravity', 'center', '-extent', '270x480', '-strip', '-quality', '70', path.join(OUT, 'thumb', `${job.id}.webp`)]);
    made.push(job);
  }
  const index = {
    themes: THEMES.map(({ id, label, keywords }) => ({
      id,
      label,
      keywords,
      backgrounds: made.filter((j) => j.theme === id).map((j) => j.id),
    })),
  };
  await fs.writeFile(path.join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`앱용 배경 ${made.length}개 → app/img/cards/`);
}

const args = process.argv.slice(2);
if (!args.includes('--build')) {
  const { GEMINI_API_KEY: key, GOOGLE_CLOUD_PROJECT: project } = process.env;
  if (!key || !project) {
    console.error('GEMINI_API_KEY(Vertex AI 익스프레스 모드 API 키)와 GOOGLE_CLOUD_PROJECT(프로젝트 번호)가 필요합니다');
    process.exit(1);
  }
  const redo = new Set(args.filter((a, i) => args[i - 1] === '--redo'));
  await generateAll({ key, project }, redo);
}
await build();
