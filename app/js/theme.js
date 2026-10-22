// 화면 테마: 라이트·다크. 설정에서 고르면 이 기기에 기억하고, 고르지 않았으면 기기의 밝기 설정(다크 모드)을 따른다.
// 첫 화면부터 맞는 색으로 그리도록 index.html의 <head>에서도 같은 일을 한다 (KEY를 바꾸면 거기도 바꾼다).
// 데이터베이스가 열리기 전(첫 화면)에 알아야 해서 SQLite 설정 대신 localStorage에 둔다.
// 색은 app.css의 :root(라이트)와 :root[data-theme='dark'](다크).

const KEY = 'ctb-theme';
const STATUS_BAR = { light: '#f6f3ec', dark: '#191714' }; // 휴대폰 상태 표시줄 색 = app.css의 --bg
const dark = () => matchMedia('(prefers-color-scheme: dark)');

/** 설정에서 고른 테마 'light' | 'dark', 고르지 않았으면 null */
export function chosenTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

/** 지금 보이는 테마 */
export const currentTheme = () => chosenTheme() ?? (dark().matches ? 'dark' : 'light');

function applyTheme(theme = currentTheme()) {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', STATUS_BAR[theme]));
}

/** 테마를 고른다 (이 기기에 기억한다) */
export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // 저장할 수 없는 브라우저(사생활 보호 모드 등)는 이번에만 바꾼다
  }
  applyTheme(theme);
}

/** main.js의 boot()에서 한 번 부른다. 고르지 않았으면 기기 설정이 바뀔 때 따라 바꾼다 */
export function initTheme() {
  applyTheme();
  dark().addEventListener('change', () => chosenTheme() || applyTheme());
}
