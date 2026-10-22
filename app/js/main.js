import { flushPendingSaves, isPaused, openDatabase, resumeWriting } from './db.js';
import { loadIndex } from './bible.js';
import { applyReadingSettings } from './prefs.js';
import { today, ymKey } from './dates.js';
import { html, setHTML, toast } from './ui.js';
import { todayView } from './views/today.js';
import { calendarView } from './views/calendar.js';
import { newPlanView } from './views/newplan.js';
import { readerView } from './views/reader.js';
import { settingsView } from './views/settings.js';
import { savedView } from './views/saved.js';
import { notesView } from './views/notes.js';
import { searchView } from './views/search.js';
import { changeAccount, openAccountSwitcher, openedProps } from './views/common.js';
import { player } from './tts.js';
import { initAnalytics, track } from './analytics.js';
import { initSync, syncNow, takeSyncLinkCode } from './sync.js';
import { initReminder } from './reminder.js';
import { initRooms, takeRoomLinkCode } from './rooms.js';
import { initTheme } from './theme.js';
import { openJoinDialog } from './views/syncsection.js';
import { openRoomJoin } from './views/roomsection.js';
import { leaveInAppBrowser } from './inapp.js';

const main = document.getElementById('main');

// tab은 아래 메뉴 강조용(본문 화면도 'month'), screen은 사용 통계에 쓰는 화면 이름
const routes = [
  { re: /^#?\/?$/, tab: 'today', screen: 'today', view: todayView },
  { re: /^#\/month\/(\d{4})-(\d{2})$/, tab: 'month', screen: 'calendar', view: calendarView },
  // #/new, #/new/2026-10 (그 달), #/new/2026-10-15/2026-11-23 (기간을 정해서)
  {
    re: /^#\/new(?:\/(\d{4})-(\d{2})(?:-(\d{2})\/(\d{4})-(\d{2})-(\d{2}))?)?$/,
    tab: 'new',
    screen: 'new_plan',
    view: newPlanView,
  },
  { re: /^#\/read\/(\d{4})-(\d{2})\/(\d{1,2})(?:\/(\d+))?$/, tab: 'month', screen: 'reader', view: readerView },
  { re: /^#\/saved$/, tab: 'saved', screen: 'saved', view: savedView },
  { re: /^#\/notes$/, tab: 'saved', screen: 'notes', view: notesView },
  { re: /^#\/search$/, tab: 'saved', screen: 'search', view: searchView },
  { re: /^#\/settings$/, tab: 'settings', screen: 'settings', view: settingsView },
];

let renderSeq = 0;

/** refresh: 다른 기기에서 받은 기록으로 지금 화면을 다시 그린다 (사용 통계·스크롤·소리로 듣기는 그대로) */
async function route({ refresh = false } = {}) {
  const hash = location.hash || '#/';
  const match = routes.map((r) => ({ r, m: r.re.exec(hash) })).find((x) => x.m);
  if (!match) {
    location.replace('#/');
    return;
  }
  const seq = ++renderSeq;
  if (!refresh) track('$pageview', { screen: match.r.screen });
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
  const scrollY = window.scrollY;
  if (!refresh) {
    player?.stop(); // 소리로 듣던 것은 화면을 옮기면 멈춘다
    window.scrollTo(0, 0);
  }
  try {
    // 화면마다 main 영역을 통째로 다시 그린다. 이전 화면의 비동기 작업이 늦게 끝나도
    // 덮어쓰지 않도록 isCurrent()로 확인할 수 있게 한다.
    await match.r.view(main, params, { isCurrent: () => seq === renderSeq });
    if (seq !== renderSeq) return;
    if (refresh) window.scrollTo(0, scrollY);
    else main.focus({ preventScroll: true });
  } catch (err) {
    console.error(err);
    track('app_error', { where: 'route', screen: match.r.screen, message: String(err?.message ?? err).slice(0, 120) });
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

// 다른 기기에서 받은 기록은 지금 화면에 바로 반영하되, 쓰던 글·열린 창·소리로 듣기를 방해하지 않도록
// 그동안은 미뤘다가 끝나면 다시 그린다.
let staleView = false;

function refreshView() {
  const el = document.activeElement;
  const typing = el?.matches?.('textarea, input:not([type=checkbox], [type=radio], [type=range], [type=file]), select');
  const listening = player?.playing || document.querySelector('#tts-bar:not([hidden])');
  if (typing || listening || document.querySelector('dialog[open]')) {
    staleView = true;
    return;
  }
  staleView = false;
  route({ refresh: true });
}

const refreshIfStale = () => staleView && setTimeout(refreshView, 0);

// 한 번에 한 창만 기록을 쓴다 (db.js의 '여러 창'). 다른 창에 넘기고 쉬는 동안은 이 창을 막아 두고,
// 다시 앞으로 나오거나 "여기서 계속 쓰기"를 누르면 되찾는다.
let pausedDialog = null;

function showPaused() {
  if (pausedDialog) return;
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog';
  setHTML(
    dlg,
    html`<h2>다른 창에서 쓰고 있습니다</h2>
      <p>맛있는만나가 다른 창(탭)이나 설치한 앱에서도 열려 있어 이 창은 잠시 쉽니다. 두 곳에서 함께 쓰면 기록이 엇갈리기 때문입니다.</p>
      <div class="dialog-actions"><button class="btn btn-primary" data-resume>여기서 계속 쓰기</button></div>`,
  );
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // Esc로 닫고 쓰지 못하게
  dlg.addEventListener('click', (e) => e.target.closest('[data-resume]') && resume());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  pausedDialog = dlg;
}

async function resume() {
  if (!isPaused()) return;
  try {
    const reloaded = await resumeWriting();
    pausedDialog?.close();
    pausedDialog = null;
    if (reloaded) {
      // 그사이 다른 창이 바꾼 기록으로 다시 그린다
      applyReadingSettings();
      route({ refresh: true });
    }
    syncNow();
  } catch (err) {
    console.error(err);
    toast(`기록을 다시 읽지 못했습니다: ${err.message}`);
  }
}

/** 동기화 링크·함께 읽기 초대 링크의 코드가 있으면 화면을 그린 뒤 그 창을 띄운다 */
function openLinks(rendered, syncCode, roomCode) {
  const done = () => route({ refresh: true });
  if (syncCode != null) rendered.then(() => openJoinDialog(syncCode, done));
  if (roomCode != null) rendered.then(() => openRoomJoin(roomCode, { via: 'link', done }));
}

async function boot() {
  // 카카오톡 등 앱 안의 브라우저에서 열었으면 휴대폰 브라우저로 옮긴다 (주소의 동기화·초대 코드를 꺼내기 전에)
  await leaveInAppBrowser(main);
  // 동기화 링크(#sync=코드)나 함께 읽기 초대 링크(#room=코드)로 열었으면 코드를 꺼내고 주소에서 지운다.
  // 사용 통계에 주소가 남기 전에 한다.
  const linkCode = takeSyncLinkCode();
  const roomCode = takeRoomLinkCode();
  initTheme();
  initAnalytics();
  try {
    await Promise.all([openDatabase(), loadIndex()]);
  } catch (err) {
    console.error(err);
    track('app_error', { where: 'boot', message: String(err?.message ?? err).slice(0, 120) });
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
  // 앱이 열려 있을 때 링크를 열어 주소만 바뀌어도 동기화·초대 창을 띄운다
  window.addEventListener('hashchange', () => {
    // 코드를 먼저 꺼낸다 (route()는 모르는 주소를 #/로 바꾼다)
    const sync = takeSyncLinkCode();
    const room = sync == null ? takeRoomLinkCode() : null;
    openLinks(route(), sync, room);
  });
  window.addEventListener('account-changed', () => route());
  window.addEventListener('sync-applied', refreshView);
  window.addEventListener('sync-status', refreshIfStale);
  document.addEventListener('focusout', refreshIfStale);
  document.addEventListener('close', refreshIfStale, true); // 창(dialog)을 닫으면
  window.addEventListener('db-paused', showPaused);
  window.addEventListener('pagehide', () => flushPendingSaves());
  window.addEventListener('sync-ended', () => {
    toast('다른 기기에서 동기화를 꺼서 이 기기도 멈췄습니다. 기록은 그대로 있습니다');
    refreshView();
  });
  window.addEventListener('room-gone', (e) => {
    toast(`${e.detail.name} 방이 없어졌거나 방에서 내보내져 목록에서 뺐습니다`);
    refreshView();
  });
  track('app_opened', () => ({ launch: 'cold', ...openedProps() }));
  window.addEventListener('appinstalled', () => track('pwa_installed'));
  const firstRender = route();
  initSync();
  initReminder();
  initRooms();
  openLinks(firstRender, linkCode, roomCode);

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
  // 30분 넘게 숨겨졌다가 돌아오면 앱을 다시 연 것으로 센다(사용 통계).
  let shownDay = ymKey(today().y, today().m) + today().d;
  let hiddenAt = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      flushPendingSaves(); // 입력 중이던 메모 등을 떠나기 전에 저장한다
      return;
    }
    resume(); // 다른 창에 넘겼었으면 되찾는다
    if (hiddenAt != null && Date.now() - hiddenAt >= 30 * 60 * 1000) {
      track('app_opened', () => ({ launch: 'resume', ...openedProps() }));
    }
    hiddenAt = null;
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
