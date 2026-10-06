// 읽기 화면 설정(글자 크기, 글꼴)을 CSS 변수로 반영한다.
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
