// 읽기 화면 설정(글자 크기, 글꼴)을 CSS 변수로 반영한다. 읽을 역본도 여기서 정한다.
import { getSetting, setSetting } from './db.js';

export const FONT_SIZE = { min: 15, max: 26, default: 19 };

export function applyReadingSettings() {
  const style = document.documentElement.style;
  style.setProperty('--read-size', `${getSetting('fontSize', FONT_SIZE.default)}px`);
  style.setProperty(
    '--read-font',
    getSetting('fontFamily', 'serif') === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)',
  );
}

/**
 * 본문을 어느 역본으로 볼지(기기마다 따로 둔다).
 *   translation: 본문 역본 'saenew' | 'gae' | 'bsb'
 *   companion: 절마다 아래에 함께 볼 역본 (없으면 ''). 본문 역본과 같으면 없는 것으로 본다.
 * 예전에는 translation 하나로 'both'(새번역 아래에 BSB)를 골랐다. 그 기기는 새번역 + BSB로 읽는다.
 */
export const READING_TRANSLATIONS = [
  { id: 'saenew', label: '새번역', detail: '대한성서공회 새번역' },
  { id: 'gae', label: '개역개정', detail: '대한성서공회 개역개정' },
  { id: 'bsb', label: 'BSB', detail: 'Berean Standard Bible · 현대 영어' },
];

const known = (id) => READING_TRANSLATIONS.some((x) => x.id === id);

/** 저장된 그대로의 보기 (companion이 본문 역본과 같을 수도 있다) */
function storedMode() {
  const main = getSetting('translation', 'saenew');
  return { main: known(main) ? main : 'saenew', companion: getSetting('companion', main === 'both' ? 'bsb' : '') || null };
}

/** 지금 고른 보기 {main, companion} (companion이 없으면 null) */
export function readingMode() {
  const { main, companion } = storedMode();
  return { main, companion: known(companion) && companion !== main ? companion : null };
}

/**
 * 보기를 바꾼다. 바꾸지 않을 쪽은 저장된 것을 그대로 둔다 ({companion: null}이면 함께 보기를 끈다).
 * 함께 보던 역본을 본문으로 고르면 그동안은 함께 보기가 없고, 본문을 다시 바꾸면 되살아난다.
 */
export async function setReadingMode(change) {
  const next = { ...storedMode(), ...change };
  await setSetting('translation', next.main);
  await setSetting('companion', next.companion ?? '');
}

/** 그 보기로 본문을 보여 줄 때 불러올 역본들 (본문 역본이 먼저) */
export const translationsFor = ({ main, companion } = readingMode()) => (companion ? [main, companion] : [main]);
