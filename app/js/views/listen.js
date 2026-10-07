// 본문 화면의 "소리로 듣기": 플레이어 바, 지금 읽는 절 강조, 속도·목소리 설정

import { book } from '../bible.js';
import { getSetting, setSetting } from '../db.js';
import { player, pickVoice, RATES, speechChunks, voicesReady } from '../tts.js';
import { html, setHTML, toast } from '../ui.js';
import { track } from '../analytics.js';

const icon = (d, filled = false) =>
  html`<svg viewBox="0 0 24 24" aria-hidden="true" class="${filled ? 'is-filled' : ''}"><path d="${d}" /></svg>`;
export const speakerIcon = icon('M4 9.5v5h3.5L12 19V5L7.5 9.5zM15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12');
export const playIcon = icon('M8 5.5v13l10.5-6.5z', true);
const pauseIcon = icon('M8 5h3v14H8zM13 5h3v14h-3z', true);
const prevIcon = icon('M18 6v12l-8.5-6zM6.5 6v12');
const nextIcon = icon('M6 6v12l8.5-6zM17.5 6v12');

export const rateLabel = (r) => `${r}×`;

/**
 * 본문 화면에 듣기를 붙인다. 지원하지 않는 브라우저면 null.
 * @param {HTMLElement} root 본문 화면
 * @param {Map<string, {b, c, v, e, t}>} verses 절 키 → 절
 * @returns {{open(fromKey?), handle(action)} | null}
 */
export function createListening(root, verses) {
  if (!player) return null;
  const bar = root.querySelector('#tts-bar');
  let loaded = false;
  let speaking = null; // 강조하고 있는 절 요소
  let label = '';

  /** 본문을 읽을 차례대로: 장 제목, 절(긴 절은 문장 조각) */
  const buildItems = () => {
    const out = [];
    root.querySelectorAll('.scripture .chapter-title[data-speak], .scripture .verse[data-ref]').forEach((el) => {
      if (el.dataset.speak) {
        out.push({ text: el.dataset.speak, key: null, label: el.dataset.speak });
        return;
      }
      const v = verses.get(el.dataset.ref);
      const ref = `${book(v.b).name} ${v.c}:${v.e ? `${v.v}-${v.e}` : v.v}`;
      for (const text of speechChunks(v.t)) out.push({ text, key: el.dataset.ref, label: ref });
    });
    return out;
  };

  // 바는 한 번만 그리고, 그 뒤로는 글자·아이콘만 바꾼다. 절이 넘어갈 때마다 버튼을 새로 만들면
  // 누르는 사이(손가락을 대고 떼는 사이)에 버튼이 바뀌어 누른 것이 무시될 수 있다.
  setHTML(
    bar,
    html`<button class="icon-btn" data-tts="prev" aria-label="이전 절">${prevIcon}</button>
      <button class="tts-play" data-tts="toggle" aria-label="듣기">
        <span class="when-paused">${playIcon}</span><span class="when-playing">${pauseIcon}</span>
      </button>
      <button class="icon-btn" data-tts="next" aria-label="다음 절">${nextIcon}</button>
      <span class="tts-now" aria-live="polite"></span>
      <button class="tts-rate" data-tts="rate"></button>
      <button class="icon-btn tts-close" data-tts="close" aria-label="듣기 닫기">✕</button>`,
  );
  const playBtn = bar.querySelector('.tts-play');
  const nowEl = bar.querySelector('.tts-now');
  const rateBtn = bar.querySelector('.tts-rate');

  const renderBar = () => {
    const rate = getSetting('ttsRate', 1);
    playBtn.classList.toggle('is-playing', player.playing);
    playBtn.setAttribute('aria-label', player.playing ? '잠시 멈춤' : '듣기');
    nowEl.textContent = label || '처음부터 읽습니다';
    rateBtn.textContent = rateLabel(rate);
    rateBtn.setAttribute('aria-label', `읽는 속도 ${rateLabel(rate)}`);
  };

  const highlight = (key) => {
    speaking?.classList.remove('is-speaking');
    speaking = key ? root.querySelector(`.verse[data-ref="${key}"]`) : null;
    if (!speaking) return;
    speaking.classList.add('is-speaking');
    // 위쪽 머리말과 아래쪽 바에 가리지 않는 곳에 있도록 따라 내려간다.
    const r = speaking.getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight - 170) speaking.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const load = async () => {
    if (loaded) return;
    loaded = true;
    await voicesReady();
    const voice = pickVoice(getSetting('ttsVoice'));
    if (!voice) toast('이 기기에 한국어 음성이 없어 기본 음성으로 읽습니다. 기기 설정에서 한국어 음성을 설치해 보세요');
    player.setVoice(voice);
    player.setRate(getSetting('ttsRate', 1));
    player.load(buildItems(), {
      index: (item) => {
        label = item.label;
        highlight(item.key);
        renderBar();
      },
      state: renderBar,
      end: () => {
        highlight(null);
        label = '끝까지 들었습니다';
        renderBar();
        toast('오늘 분량을 끝까지 들었습니다');
        root.querySelector('#reader-foot')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        track('tts_completed', () => ({ rate: getSetting('ttsRate', 1) }));
      },
      error: (code) => {
        toast(`읽어 주기를 할 수 없습니다 (${code})`);
        track('tts_error', { code: String(code) });
      },
    });
  };

  return {
    /** 바를 열고 읽기 시작한다. fromKey가 있으면 그 절부터 */
    async open(fromKey) {
      // await보다 먼저, 버튼을 누른 그 순간에 읽기를 허용받는다 (사파리)
      player.unlock();
      bar.hidden = false;
      renderBar();
      await load();
      const from = fromKey ? player.items.findIndex((it) => it.key === fromKey) : player.index;
      player.play(Math.max(0, from));
      // 목소리는 이름 대신 직접 골랐는지만 보낸다.
      track('tts_started', () => ({
        from_selection: !!fromKey,
        rate: getSetting('ttsRate', 1),
        voice: getSetting('ttsVoice') ? 'chosen' : 'auto',
      }));
    },
    async handle(action) {
      player.unlock();
      if (action === 'toggle') {
        await load();
        player.toggle();
      } else if (action === 'next') player.next();
      else if (action === 'prev') player.prev();
      else if (action === 'rate') {
        const cur = getSetting('ttsRate', 1);
        const rate = RATES[(RATES.indexOf(cur) + 1) % RATES.length];
        // DB에는 바로 반영되므로 저장(IndexedDB)이 끝나기 전에 화면부터 바꾼다.
        const saving = setSetting('ttsRate', rate);
        player.setRate(rate);
        renderBar();
        await saving;
        track('reading_setting_changed', { setting: 'tts_rate', value: rate, surface: 'tts_bar' });
      } else if (action === 'close') {
        player.pause();
        highlight(null);
        bar.hidden = true;
      }
    },
  };
}
