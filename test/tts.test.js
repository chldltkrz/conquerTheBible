import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, pickVoice, speechChunks } from '../app/js/tts.js';

// 브라우저의 speechSynthesis 흉내: speak하면 잠시 뒤 끝났다고 알리고(autoEnd가 false면 그대로 둔다),
// cancel하면 지금 것을 'interrupted'로 끝낸다.
function fakeSynth({ autoEnd = true } = {}) {
  const spoken = [];
  let current = null;
  return {
    spoken,
    paused: false,
    getVoices: () => [
      { voiceURI: 'net-ko', lang: 'ko-KR', localService: false },
      { voiceURI: 'local-ko', lang: 'ko_KR', localService: true },
      { voiceURI: 'en', lang: 'en-US', localService: true },
    ],
    speak(u) {
      spoken.push(u);
      current = u;
      if (!autoEnd) return;
      setTimeout(() => {
        if (current === u) {
          current = null;
          u.onend?.();
        }
      }, 2);
    },
    cancel() {
      const u = current;
      current = null;
      u?.onerror?.({ error: 'interrupted' });
    },
    resume() {},
  };
}
class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** cond()가 참이 될 때까지 (최대 2초) 기다린다 */
async function until(cond) {
  for (let i = 0; i < 200 && !cond(); i++) await wait(10);
}

const ITEMS = [
  { text: '요한복음서 1장', key: null },
  { text: '태초에 말씀이 계셨다.', key: 'jhn:1:1' },
  { text: '그 말씀은 하나님과 함께 계셨다.', key: 'jhn:1:1' },
  { text: '그는 태초에 하나님과 함께 계셨다.', key: 'jhn:1:2' },
];

test('끝까지 차례대로 읽고 끝났다고 알린다', async () => {
  const synth = fakeSynth();
  const p = createPlayer(synth, FakeUtterance);
  const seen = [];
  const states = [];
  let ended = false;
  p.load(ITEMS, { index: (item) => seen.push(item.text), state: (s) => states.push(s), end: () => (ended = true) });
  p.setRate(1.2);
  p.play();
  await until(() => ended);
  assert.deepEqual(seen, ITEMS.map((x) => x.text));
  assert.ok(ended);
  assert.deepEqual(states, [true, false]);
  assert.ok(synth.spoken.every((u) => u.lang === 'ko-KR' && u.rate === 1.2));
});

test('멈췄다가 다시 누르면 그 절 처음부터 이어서 읽는다', async () => {
  const synth = fakeSynth({ autoEnd: false });
  const p = createPlayer(synth, FakeUtterance);
  const seen = [];
  p.load(ITEMS, { index: (item, i) => seen.push(i) });
  p.play(2); // 1절의 둘째 조각을 읽는 중에
  await until(() => synth.spoken.length === 1);
  assert.equal(synth.spoken[0].text, ITEMS[2].text);
  p.pause();
  assert.equal(p.playing, false);
  seen.length = 0;
  p.toggle();
  await until(() => seen.length > 0);
  assert.equal(seen[0], 1, '1절 첫 조각부터 다시');
});

test('다음·이전 절은 절 단위로 움직인다 (장 제목도 한 칸)', () => {
  const p = createPlayer(fakeSynth(), FakeUtterance);
  p.load(ITEMS);
  p.next();
  assert.equal(p.index, 1, '장 제목 다음은 1절');
  p.next();
  assert.equal(p.index, 3, '1절의 조각을 건너 2절로');
  p.next();
  assert.equal(p.index, 3, '끝에서는 그대로');
  p.prev();
  assert.equal(p.index, 1);
  p.prev();
  assert.equal(p.index, 0);
});

test('unlock은 소리 없는 빈 발화를 딱 한 번만 읽는다 (사파리의 첫 읽기 허용용)', () => {
  const synth = fakeSynth({ autoEnd: false });
  const p = createPlayer(synth, FakeUtterance);
  p.unlock();
  p.unlock();
  assert.equal(synth.spoken.length, 1);
  assert.equal(synth.spoken[0].volume, 0);
  assert.equal(synth.spoken[0].text.trim(), '');
});

test('목소리는 고른 것, 없으면 기기 안의 한국어 목소리', () => {
  const synth = fakeSynth();
  assert.equal(pickVoice('net-ko', synth).voiceURI, 'net-ko');
  assert.equal(pickVoice(null, synth).voiceURI, 'local-ko');
  assert.equal(pickVoice('없는 목소리', synth).voiceURI, 'local-ko');
});

test('긴 절은 문장(필요하면 쉼표) 단위로 나누고, 짧은 절은 그대로', () => {
  assert.deepEqual(speechChunks('태초에 말씀이 계셨다.'), ['태초에 말씀이 계셨다.']);
  const long =
    '그 때에 왕의 서기관들이 소집되었다. 셋째 달인 시완월 이십삼일에, 서기관들은 모르드개가 불러 주는 대로 받아썼다. ' +
    '인도에서부터 에티오피아에 이르기까지, 백스물일곱 지방에 있는 유다 사람들과 대신들과 총독들과 각 지방 고관들에게 보내는 조서였다.';
  const chunks = speechChunks(long, 60);
  assert.ok(chunks.length >= 3, `나뉘어야 한다: ${chunks.length}`);
  assert.ok(chunks.every((c) => c.length <= 80), `너무 긴 조각: ${chunks.map((c) => c.length)}`);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), long.trim().replace(/\s+/g, ' '), '글자가 빠지지 않는다');
});
