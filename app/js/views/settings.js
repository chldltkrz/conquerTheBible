// 설정 화면: 계정, 함께 읽기, 동기화, 읽기 알림, 테마, 읽기 화면, 오프라인 저장, 계획 기록, 백업

import { TRANSLATIONS, allBooks, bookUrl } from '../bible.js';
import { today, ymKey } from '../dates.js';
import {
  currentAccount,
  deleteAccount,
  deletePlan,
  exportBackup,
  getSetting,
  importFile,
  listAccounts,
  listPlans,
  renameAccount,
  resetAll,
  roomMemberships,
  setSetting,
  syncInfo,
} from '../db.js';
import { FONT_SIZE, READING_MODES, applyReadingSettings, readingMode, translationsFor } from '../prefs.js';
import { confirmDialog, html, setHTML, toast } from '../ui.js';
import { avatar, isMonthPlan, periodLabel } from './common.js';
import { koreanVoices, pickVoice, player, RATES, voicesReady } from '../tts.js';
import { rateLabel, speakerIcon } from './listen.js';
import { isDevHostname, isOptedOut, setOptOut, track } from '../analytics.js';
import { handleSyncAction, syncSection } from './syncsection.js';
import { handleReminderAction, handleReminderChange, reminderSection } from './remindersection.js';
import { openExportSheet } from './exportsheet.js';
import { handleRoomAction, openRoomSheet, roomSection } from './roomsection.js';
import { leaveAccountRooms } from '../rooms.js';
import { chosenTheme, currentTheme, setTheme } from '../theme.js';

const THEMES = [
  ['light', '라이트'],
  ['dark', '다크'],
];

/**
 * 개발자에게 커피 보내기: 송금 링크를 넣으면 설정 화면에 그 버튼이 생긴다. 주소가 빈 항목은 보이지 않는다.
 * 모두 비어 있으면 배포한 사이트에서는 이 칸을 숨긴다(개발 주소에서만 넣는 법을 안내한다).
 */
const COFFEE_LINKS = [
  { label: '토스로 보내기', url: '' }, // 예: https://toss.me/아이디
  { label: '카카오페이로 보내기', url: '' }, // 예: https://qr.kakaopay.com/XXXXXXXXX
  // Buy Me a Coffee 버튼 모양(노란 바탕·검은 테두리·☕)을 따르되, 외부 스크립트 없이 링크로 연다.
  { label: '☕ 쓴물사주기', url: 'https://buymeacoffee.com/issac_choi', kind: 'bmc' },
];
const coffeeLinks = COFFEE_LINKS.filter((l) => /^https:\/\//.test(l.url));

const coffeeIcon = html`<svg viewBox="0 0 24 24"><path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c0 1 1 1.3 1 2.3M11.5 3.5c0 1 1 1.3 1 2.3" /></svg>`;

const manualIcon = html`<svg viewBox="0 0 24 24"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H10a2 2 0 0 1 2 2v14a1.5 1.5 0 0 0-1.5-1.5H4zM20 5.5c0-.8-.7-1.5-1.5-1.5H14a2 2 0 0 0-2 2v14a1.5 1.5 0 0 1 1.5-1.5H20z" /></svg>`;

// sw.js의 DATA_CACHE와 같은 이름이어야 한다.
const DATA_CACHE = 'bible-data-v1';

// 설정 화면의 보기 예: 시편 23:1
const SAMPLE = {
  saenew: '주님은 나의 목자시니, 내게 부족함 없어라.',
  bsb: 'The LORD is my shepherd; I shall not want.',
};

export async function settingsView(root, _params, { isCurrent }) {
  let downloading = false;

  /** 역본마다 이 기기에 저장된 책 수 {saenew, bsb}. 지원하지 않는 브라우저면 null */
  const cachedBookCounts = async () => {
    if (!('caches' in window)) return null;
    const cache = await caches.open(DATA_CACHE);
    const paths = (await cache.keys()).map((r) => new URL(r.url).pathname);
    return {
      saenew: paths.filter((p) => /\/data\/books\/[^/]+\.json$/.test(p)).length,
      bsb: paths.filter((p) => /\/data\/bsb\/books\/[^/]+\.json$/.test(p)).length,
    };
  };

  const render = async () => {
    const plans = listPlans();
    const thisYear = today().y;
    const accounts = listAccounts();
    const me = currentAccount().id;
    const size = getSetting('fontSize', FONT_SIZE.default);
    const family = getSetting('fontFamily', 'serif');
    const mode = readingMode();
    const inUse = translationsFor(mode); // 오프라인 저장은 읽는 역본만
    const cached = await cachedBookCounts();
    const missing = cached && inUse.some((tr) => cached[tr] < 66);
    const voices = player ? (await voicesReady(), koreanVoices()) : [];
    const voiceURI = getSetting('ttsVoice');
    const rate = getSetting('ttsRate', 1);
    // 기다리는 동안(목소리 목록은 최대 1.5초, 성경 전체 저장은 몇 초) 다른 화면으로 옮겼으면 그 화면을 덮어쓰지 않는다.
    if (!isCurrent()) return;

    setHTML(
      root,
      html`<header class="page-head"><h1>설정</h1></header>

        <a class="card card-link manual-link" href="docs/user-manual.pdf" target="_blank" rel="noopener">
          <span class="manual-icon" aria-hidden="true">${manualIcon}</span>
          <span><b>사용설명서</b><small>메뉴마다 화면 사진과 함께 쓰는 법을 설명합니다 · PDF</small></span>
          <span class="chev" aria-hidden="true">›</span>
        </a>

        <section class="block">
          <h2 class="block-title">계정</h2>
          <ul class="account-manage">
            ${accounts.map(
              (acc) => html`<li>
                ${avatar(acc)}
                <input class="account-name" data-rename="${acc.id}" value="${acc.name}" maxlength="20"
                  aria-label="${acc.name} 계정 이름" autocomplete="off" />
                ${acc.id === me
                  ? html`<span class="tag">사용 중</span>`
                  : html`<button class="btn btn-ghost btn-sm" data-switch-to="${acc.id}">바꾸기</button>`}
                ${accounts.length > 1
                  ? html`<button class="icon-btn danger" data-delete-account="${acc.id}" data-label="${acc.name}"
                      aria-label="${acc.name} 계정 삭제">✕</button>`
                  : ''}
              </li>`,
            )}
          </ul>
          <p class="muted small">계정마다 읽기 계획, 읽음 기록, 저장한 구절이 따로 있습니다. 이름을 누르면 고칠 수 있습니다.</p>
          <button class="btn btn-ghost" data-action="switch-account">계정 추가</button>
        </section>

        ${roomSection()}

        ${syncSection()}

        ${reminderSection()}

        <section class="block" id="theme-block">
          <h2 class="block-title">테마</h2>
          <div class="card">
            <div class="field-row">
              <span>화면</span>
              <div class="segmented" role="radiogroup" aria-label="테마">
                ${THEMES.map(
                  ([id, label]) => html`<button role="radio" data-theme-choice="${id}" aria-checked="${id === currentTheme()}">${label}</button>`,
                )}
              </div>
            </div>
            <p class="muted small">${chosenTheme()
              ? '이 기기에서만 바뀝니다.'
              : '고르기 전에는 휴대폰의 밝기 설정(다크 모드)을 따릅니다. 고르면 이 기기에서만 바뀝니다.'}</p>
          </div>
        </section>

        <section class="block">
          <h2 class="block-title">읽기 화면</h2>
          <div class="card">
            <label class="field-row">
              <span>글자 크기 <b id="size-label">${size}px</b></span>
              <input type="range" id="font-size" min="${FONT_SIZE.min}" max="${FONT_SIZE.max}" value="${size}" />
            </label>
            <div class="field-row">
              <span>글꼴</span>
              <div class="segmented" role="radiogroup" aria-label="글꼴">
                <button role="radio" data-family="serif" aria-checked="${family === 'serif'}">명조</button>
                <button role="radio" data-family="sans" aria-checked="${family === 'sans'}">고딕</button>
              </div>
            </div>
            <div class="field-row">
              <span>역본</span>
              <div class="segmented" role="radiogroup" aria-label="역본">
                ${READING_MODES.map(
                  (x) => html`<button role="radio" data-reading-mode="${x.id}" aria-checked="${x.id === mode}">${x.label}</button>`,
                )}
              </div>
            </div>
            <p class="sample ${mode === 'both' ? 'is-both' : ''}">
              ${mode === 'bsb'
                ? html`<span lang="en">${SAMPLE.bsb}</span>`
                : html`${SAMPLE.saenew}${mode === 'both' ? html`<span class="en" lang="en">${SAMPLE.bsb}</span>` : ''}`}
            </p>
            <p class="muted small">BSB(Berean Standard Bible)는 현대 영어 번역입니다. 함께 보기는 새번역 절마다 아래에 BSB를 보여 줍니다.
              본문 화면 위에서도 바꿀 수 있고, 계획의 분량과 절 번호는 새번역을 따릅니다.</p>
          </div>
        </section>

        ${player
          ? html`<section class="block">
              <h2 class="block-title">소리로 듣기</h2>
              <div class="card">
                <label class="field-row">
                  <span>목소리</span>
                  <select id="tts-voice" class="select">
                    <option value="">자동 (기기 안의 한국어 음성)</option>
                    ${voices.map(
                      (v) => html`<option value="${v.voiceURI}" ${v.voiceURI === voiceURI ? 'selected' : ''}>
                        ${v.name}${v.localService ? '' : ' · 인터넷 필요'}</option>`,
                    )}
                  </select>
                </label>
                <div class="field-row">
                  <span>속도</span>
                  <div class="segmented" role="radiogroup" aria-label="읽는 속도">
                    ${RATES.map(
                      (r) => html`<button role="radio" data-rate="${r}" aria-checked="${r === rate}">${rateLabel(r)}</button>`,
                    )}
                  </div>
                </div>
                <button class="btn btn-ghost btn-sm" data-action="tts-test">${speakerIcon}<span>들어 보기</span></button>
                <p class="muted small tts-note">
                  ${voices.length
                    ? '브라우저에 들어 있는 음성으로 읽어 줍니다. "인터넷 필요"로 표시된 음성은 브라우저가 인터넷으로 소리를 만듭니다.'
                    : '이 기기에서 한국어 음성을 찾지 못했습니다. 기기 설정에서 한국어 음성(TTS)을 설치하면 자연스럽게 읽습니다.'}
                </p>
              </div>
            </section>`
          : ''}

        <section class="block">
          <h2 class="block-title">오프라인에서 읽기</h2>
          <div class="card">
            <p>
              ${cached == null
                ? '이 브라우저는 오프라인 저장을 지원하지 않습니다.'
                : inUse.length === 1 && inUse[0] === 'saenew'
                  ? html`성경 66권 중 <b>${cached.saenew}</b>권이 이 기기에 저장되어 있습니다.`
                  : html`${inUse.map(
                      (tr, i) => html`${i ? ', ' : ''}${TRANSLATIONS[tr].name} 66권 중 <b>${cached[tr]}</b>권`,
                    )}이 이 기기에 저장되어 있습니다.`}
            </p>
            <p class="muted">계획을 만들면 그 계획에 필요한 책은 자동으로 저장됩니다. 전체를 받아 두면 인터넷 없이도 모든 본문을 읽을 수 있습니다(새번역 약 6MB${inUse.includes('bsb') ? ', BSB 약 5MB' : ''}).</p>
            ${missing
              ? html`<button class="btn btn-ghost" data-action="download">성경 전체 저장하기</button>
                  <div class="progress is-hidden" id="dl-progress"><span style="width:0"></span></div>`
              : ''}
          </div>
        </section>

        <section class="block">
          <h2 class="block-title">${accounts.length > 1 ? `${currentAccount().name}의 계획` : '지난 계획'}</h2>
          ${plans.length
            ? html`<ul class="plan-list">
                ${plans.map((p) => {
                  const period = periodLabel(p, { year: p.start.y !== thisYear });
                  return html`<li>
                    <a href="#/month/${ymKey(p.start.y, p.start.m)}">
                      <b>${period}</b>
                      <small>${p.readDays}/${p.readingDays}일 읽음</small>
                      <span>${p.title}${p.mode === 'parallel' ? ' · 여러 권 동시에' : p.mode === 'group' ? ' · 그룹별로 동시에' : ''}${isMonthPlan(p) ? '' : ` · ${p.length}일`}</span>
                    </a>
                    <button class="icon-btn danger" data-delete="${p.id}" data-label="${period} ${p.title}"
                      aria-label="${period} 계획 삭제">✕</button>
                  </li>`;
                })}
              </ul>`
            : html`<p class="muted">아직 만든 계획이 없습니다.</p>`}
        </section>

        <section class="block">
          <h2 class="block-title">기록 백업</h2>
          <div class="card">
            <p class="muted">읽기 기록은 이 기기의 브라우저 안 SQLite 데이터베이스에 저장됩니다. 보관하거나 동기화 없이 다른 기기로 옮기려면 파일로 내보내세요.</p>
            ${syncInfo()
              ? html`<p class="muted small">동기화 중에는 백업을 가져오거나 모든 기록을 지우면 동기화된 다른 기기의 기록도 함께 바뀝니다.</p>`
              : ''}
            <div class="button-row">
              <button class="btn btn-ghost" data-action="export">내보내기 (.sqlite)</button>
              <label class="btn btn-ghost">
                가져오기
                <input type="file" id="import-file" accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3,application/x-sqlite3" hidden />
              </label>
            </div>
            <div class="button-row">
              <button class="btn btn-ghost" data-action="export-notes">메모·구절을 글로 내보내기 (텍스트·PDF)</button>
            </div>
            <button class="link danger" data-action="reset">모든 기록 지우기</button>
          </div>
        </section>

        <section class="block">
          <h2 class="block-title">사용 통계</h2>
          <div class="card">
            <label class="field-row">
              <span>익명 사용 통계 보내기</span>
              <input type="checkbox" id="analytics-opt-in" ${isOptedOut() ? '' : 'checked'} />
            </label>
            <p class="muted small">어떤 기능을 얼마나 쓰는지 익명으로 모아 앱을 고치는 데 씁니다. 계정 이름, 계획 이름, 메모, 구절, 검색어는 보내지 않습니다.</p>
          </div>
        </section>

        ${coffeeLinks.length || isDevHostname(location.hostname)
          ? html`<section class="block">
              <h2 class="block-title">개발자 응원하기</h2>
              <div class="card coffee-card">
                <span class="coffee-icon" aria-hidden="true">${coffeeIcon}</span>
                <div class="coffee-text">
                  <b>개발자에게 커피 한 잔 보내기</b>
                  <p class="muted small">이 앱이 말씀 읽기에 도움이 되었다면 커피 한 잔으로 응원해 주세요. 앱은 앞으로도 무료입니다.</p>
                </div>
                ${coffeeLinks.length
                  ? html`<div class="button-row coffee-links">
                      ${coffeeLinks.map(
                        (l) => html`<a class="btn btn-sm coffee-link ${l.kind ? `is-${l.kind}` : 'btn-ghost'}" href="${l.url}"
                          target="_blank" rel="noopener">${l.label}</a>`,
                      )}
                    </div>`
                  : html`<p class="coffee-setup">개발용 안내: <code>app/js/views/settings.js</code>의 <code>COFFEE_LINKS</code>에 송금 링크를 넣으면 이 자리에 버튼이 생깁니다. (배포한 사이트에서는 링크가 없으면 이 칸을 숨깁니다)</p>`}
              </div>
            </section>`
          : ''}

        <section class="block about">
          <p>성경 본문: 새번역 © 대한성서공회. 개인 묵상과 읽기 용도로만 사용하세요.
            BSB(Berean Standard Bible)는 퍼블릭 도메인입니다 (bereanbible.com).</p>
        </section>`,
    );
  };

  const downloadAll = async (btn) => {
    if (downloading) return;
    downloading = true;
    btn.disabled = true;
    const bar = root.querySelector('#dl-progress');
    bar.classList.remove('is-hidden');
    const cache = await caches.open(DATA_CACHE);
    const books = allBooks();
    // 읽는 역본만 받는다 (함께 보기면 새번역과 BSB 모두)
    const files = translationsFor().flatMap((tr) => books.map((b) => new URL(bookUrl(b.code, tr), location.href).href));
    let done = 0;
    let failed = 0;
    for (const url of files) {
      if (!(await cache.match(url))) {
        try {
          await cache.add(url);
        } catch {
          failed++;
        }
      }
      done++;
      bar.firstElementChild.style.width = `${Math.round((done / files.length) * 100)}%`;
    }
    downloading = false;
    toast(failed ? `${failed}권을 받지 못했습니다. 인터넷 연결을 확인하세요.` : '성경 전체를 저장했습니다');
    render();
    track('offline_download_completed', { total: files.length, failed });
  };

  const downloadBackup = () => {
    const blob = new Blob([exportBackup()], { type: 'application/vnd.sqlite3' });
    const t = today();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `conquer-the-bible-${ymKey(t.y, t.m)}-${String(t.d).padStart(2, '0')}.sqlite`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  root.onclick = async (e) => {
    // 사용설명서 링크는 그대로 열리게 두고 센다.
    if (e.target.closest('.manual-link')) {
      track('manual_opened');
      return;
    }
    const btn = e.target.closest('button');
    if (!btn) return;
    const d = btn.dataset;
    if (d.roomOpen) {
      openRoomSheet(d.roomOpen, render);
    } else if (d.roomAction) {
      handleRoomAction(d.roomAction, render);
    } else if (d.syncAction) {
      await handleSyncAction(d.syncAction, btn, render);
    } else if (d.reminderAction) {
      await handleReminderAction(d.reminderAction, btn);
    } else if (d.themeChoice) {
      setTheme(d.themeChoice);
      render();
      track('reading_setting_changed', { setting: 'theme', value: d.themeChoice, surface: 'settings' });
    } else if (d.readingMode) {
      await setSetting('translation', d.readingMode);
      render();
    } else if (d.family) {
      await setSetting('fontFamily', d.family);
      applyReadingSettings();
      render();
      track('reading_setting_changed', { setting: 'font_family', value: d.family, surface: 'settings' });
    } else if (d.rate) {
      await setSetting('ttsRate', Number(d.rate));
      render();
      track('reading_setting_changed', { setting: 'tts_rate', value: Number(d.rate), surface: 'settings' });
    } else if (d.action === 'tts-test') {
      player.unlock();
      player.load([{ text: '주님은 나의 목자시니, 내게 부족함 없어라. 시편 23편 1절', key: null, label: '' }]);
      player.setVoice(pickVoice(getSetting('ttsVoice')));
      player.setRate(getSetting('ttsRate', 1));
      player.play(0);
    } else if (d.action === 'download') {
      downloadAll(btn);
    } else if (d.action === 'export-notes') {
      openExportSheet('settings');
    } else if (d.action === 'export') {
      downloadBackup();
      track('backup_exported');
    } else if (d.action === 'reset') {
      const ok = await confirmDialog({
        title: '모든 기록을 지울까요?',
        message: `모든 계정과 계획, 읽음 기록, 저장한 구절, 설정이 지워집니다.${syncInfo() ? ' 동기화된 다른 기기에서도 모두 지워집니다.' : ''} 되돌릴 수 없으니 필요하면 먼저 내보내기를 하세요.`,
        confirmText: '모두 지우기',
        danger: true,
      });
      if (!ok) return;
      await leaveAccountRooms(null); // 들어간 함께 읽기 방에서 먼저 나온다 (안 되면 그냥 지운다)
      await resetAll();
      applyReadingSettings();
      track('data_reset');
      toast('모든 기록을 지웠습니다');
      render();
    } else if (d.delete) {
      // 지우기 전에 진도를 잡아 둔다 (사용 통계)
      const p = listPlans().find((p) => p.id === Number(d.delete));
      const ok = await confirmDialog({
        title: '계획을 삭제할까요?',
        message: `${d.label} 계획과 읽음 기록이 지워집니다.`,
        confirmText: '삭제',
        danger: true,
      });
      if (!ok) return;
      await deletePlan(Number(d.delete));
      track('plan_deleted', () => ({
        plan_mode: p.mode,
        plan_length: p.length,
        reading_days: p.readingDays,
        read_days: p.readDays,
        completion_pct: p.readingDays ? Math.round((p.readDays / p.readingDays) * 100) : 0,
      }));
      toast('계획을 삭제했습니다');
      render();
    } else if (d.deleteAccount) {
      const id = Number(d.deleteAccount);
      const ok = await confirmDialog({
        title: `${d.label} 계정을 삭제할까요?`,
        message: `이 계정의 계획, 읽음 기록, 저장한 구절이 모두 지워집니다.${roomMemberships(id).length
          ? ' 들어간 함께 읽기 방에서도 나옵니다.'
          : ''}`,
        confirmText: '삭제',
        danger: true,
      });
      if (!ok) return;
      try {
        await leaveAccountRooms(id);
        await deleteAccount(id);
        track('account_deleted');
        toast('계정을 삭제했습니다');
      } catch (err) {
        toast(err.message);
      }
      render();
    }
  };

  root.oninput = (e) => {
    if (e.target.id !== 'font-size') return;
    root.querySelector('#size-label').textContent = `${e.target.value}px`;
    document.documentElement.style.setProperty('--read-size', `${e.target.value}px`);
  };

  root.onchange = async (e) => {
    // 알림 켜기는 허용을 묻는 창을 띄우므로 무엇보다 먼저, 기다리지 않고 부른다
    if (handleReminderChange(e.target, render)) return;
    if (e.target.id === 'analytics-opt-in') {
      setOptOut(!e.target.checked);
      toast(e.target.checked ? '사용 통계를 보냅니다' : '사용 통계를 보내지 않습니다');
      return;
    }
    if (e.target.id === 'tts-voice') {
      await setSetting('ttsVoice', e.target.value || null);
      // 음성 이름(URI)은 보내지 않고 직접 골랐는지만
      track('reading_setting_changed', { setting: 'tts_voice', value: e.target.value ? 'chosen' : 'auto', surface: 'settings' });
      return;
    }
    if (e.target.id === 'font-size') {
      await setSetting('fontSize', Number(e.target.value));
      track('reading_setting_changed', { setting: 'font_size', value: Number(e.target.value), surface: 'settings' });
      return;
    }
    if (e.target.dataset.rename) {
      const id = Number(e.target.dataset.rename);
      const name = e.target.value.trim();
      if (!name) {
        e.target.value = listAccounts().find((a) => a.id === id).name;
        return;
      }
      await renameAccount(id, name);
      toast('계정 이름을 바꿨습니다');
      render();
      return;
    }
    if (e.target.id !== 'import-file') return;
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const ok = await confirmDialog({
      title: '백업을 가져올까요?',
      message: `지금 기기${syncInfo() ? '와 동기화된 다른 기기들' : ''}의 기록이 "${file.name}"의 내용으로 바뀝니다.`,
      confirmText: '가져오기',
      danger: true,
    });
    if (!ok) return;
    try {
      await importFile(new Uint8Array(await file.arrayBuffer()));
      applyReadingSettings();
      track('backup_imported');
      toast('백업을 가져왔습니다');
      render();
    } catch (err) {
      track('backup_import_failed'); // 파일 이름과 오류 문구는 보내지 않는다
      toast(err.message);
    }
  };

  await render();
}
