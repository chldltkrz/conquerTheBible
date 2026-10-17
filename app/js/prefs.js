// 읽기 화면 설정(글자 크기, 글꼴)을 CSS 변수로 반영한다. 읽을 역본도 여기서 정한다.
import { getSetting } from './db.js';

export const FONT_SIZE = { min: 15, max: 26, default: 19 };

export function applyReadingSettings() {
  const style = document.documentElement.style;
  style.setProperty('--read-size', `${getSetting('fontSize', FONT_SIZE.default)}px`);
  style.setProperty(
    '--read-font',
    getSetting('fontFamily', 'serif') === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)',
  );
}

/** 본문을 어느 역본으로 볼지: 새번역, BSB(영어), 함께 보기(새번역 아래에 BSB를 한 절씩) */
export const READING_MODES = [
  { id: 'saenew', label: '새번역', detail: '대한성서공회 새번역' },
  { id: 'bsb', label: 'BSB', detail: 'Berean Standard Bible · 현대 영어' },
  { id: 'both', label: '함께 보기', detail: '새번역 아래에 BSB를 한 절씩' },
];

/** 지금 고른 보기 'saenew' | 'bsb' | 'both' (기기마다 따로 둔다) */
export function readingMode() {
  const mode = getSetting('translation', 'saenew');
  return READING_MODES.some((m) => m.id === mode) ? mode : 'saenew';
}

/** 그 보기로 본문을 보여 줄 때 불러올 역본들 */
export const translationsFor = (mode = readingMode()) => (mode === 'both' ? ['saenew', 'bsb'] : [mode]);
