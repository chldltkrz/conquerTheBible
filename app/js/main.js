import { openDatabase } from './db.js';
import { loadIndex } from './bible.js';
import { applyReadingSettings } from './prefs.js';
import { today, ymKey } from './dates.js';
import { html, setHTML } from './ui.js';
import { todayView } from './views/today.js';
import { calendarView } from './views/calendar.js';
import { newPlanView } from './views/newplan.js';
import { readerView } from './views/reader.js';
import { settingsView } from './views/settings.js';
import { savedView } from './views/saved.js';
import { notesView } from './views/notes.js';
import { searchView } from './views/search.js';
import { changeAccount, openAccountSwitcher } from './views/common.js';
import { player } from './tts.js';

const main = document.getElementById('main');

const routes = [
  { re: /^#?\/?$/, tab: 'today', view: todayView },
  { re: /^#\/month\/(\d{4})-(\d{2})$/, tab: 'month', view: calendarView },
  // #/new, #/new/2026-10 (그 달), #/new/2026-10-15/2026-11-23 (기간을 정해서)
  { re: /^#\/new(?:\/(\d{4})-(\d{2})(?:-(\d{2})\/(\d{4})-(\d{2})-(\d{2}))?)?$/, tab: 'new', view: newPlanView },
  { re: /^#\/read\/(\d{4})-(\d{2})\/(\d{1,2})(?:\/(\d+))?$/, tab: 'month', view: readerView },
  { re: /^#\/saved$/, tab: 'saved', view: savedView },
  { re: /^#\/notes$/, tab: 'saved', view: notesView },
  { re: /^#\/search$/, tab: 'saved', view: searchView },
  { re: /^#\/settings$/, tab: 'settings', view: settingsView },
];

let renderSeq = 0;

async function route() {
  const hash = location.hash || '#/';
  const match = routes.map((r) => ({ r, m: r.re.exec(hash) })).find((x) => x.m);
  if (!match) {
    location.replace('#/');
    return;
  }
  const seq = ++renderSeq;
  document.querySelectorAll('.tabbar a').forEach((a) => {
    a.toggleAttribute('aria-current', a.dataset.tab === match.r.tab);
    if (a.dataset.tab === 'month') {
      const t = today();
      a.href = `#/month/${ymKey(t.y, t.m)}`;
    }
  });
  const params = match.m.slice(1).map((x) => (x == null ? undefined : Number(x)));
  // 화면들은 main에 이벤트 핸들러 속성(onclick 등)을 직접 단다. 이전 화면 것을 지운다.
  main.onclick = main.oninput = main.onchange = main.onsubmit = main.onkeydown = null;
  player?.stop(); // 소리로 듣던 것은 화면을 옮기면 멈춘다

  window.scrollTo(0, 0);
  try {
    // 화면마다 main 영역을 통째로 다시 그린다. 이전 화면의 비동기 작업이 늦게 끝나도
    // 덮어쓰지 않도록 isCurrent()로 확인할 수 있게 한다.
    await match.r.view(main, params, { isCurrent: () => seq === renderSeq });
    if (seq === renderSeq) main.focus({ preventScroll: true });
  } catch (err) {
    console.error(err);
    if (seq === renderSeq) showError(err);
  }
}

function showError(err) {
  setHTML(
    main,
    html`<section class="empty">
      <h1>문제가 생겼습니다</h1>
      <p>${err.message}</p>
      <a class="btn btn-primary" href="#/">처음으로</a>
    </section>`,
  );
}

async function boot() {
  try {
    await Promise.all([openDatabase(), loadIndex()]);
  } catch (err) {
    console.error(err);
    setHTML(
      main,
      html`<section class="empty">
        <h1>앱을 시작하지 못했습니다</h1>
        <p>${err.message}</p>
        <p class="muted">성경 데이터가 없다면 프로젝트 폴더에서 <code>npm run crawl</code>을 먼저 실행하세요.</p>
      </section>`,
    );
    return;
  }
  applyReadingSettings();
  document.body.classList.remove('booting');
  window.addEventListener('hashchange', route);
  window.addEventListener('account-changed', route);
  route();

  // 어느 화면에서든: 계정 칩을 누르면 계정 창, data-switch-to 버튼은 그 계정으로 바로 바꾼다.
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="switch-account"]')) {
      openAccountSwitcher();
      return;
    }
    const to = e.target.closest('[data-switch-to]');
    if (to) changeAccount(Number(to.dataset.switchTo));
  });

  // 자정을 넘겨 다시 앱으로 돌아오면 '오늘'을 새로 그린다.
  let shownDay = ymKey(today().y, today().m) + today().d;
  document.addEventListener('visibilitychange', () => {
    const t = today();
    const key = ymKey(t.y, t.m) + t.d;
    if (document.visibilityState === 'visible' && key !== shownDay) {
      shownDay = key;
      route();
    }
  });

  // 브라우저가 저장 공간이 부족할 때 기록을 지우지 않도록 요청한다.
  navigator.storage?.persist?.().catch(() => {});
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('서비스 워커 등록 실패', err));
  });
}

boot();
