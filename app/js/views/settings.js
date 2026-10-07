// 설정 화면: 읽기 화면, 오프라인 저장, 계획 기록, 백업

import { allBooks } from '../bible.js';
import { today, ymKey } from '../dates.js';
import {
  currentAccount,
  deleteAccount,
  deletePlan,
  exportFile,
  getSetting,
  importFile,
  listAccounts,
  listPlans,
  renameAccount,
  resetAll,
  setSetting,
} from '../db.js';
import { FONT_SIZE, applyReadingSettings } from '../prefs.js';
import { confirmDialog, html, setHTML, toast } from '../ui.js';
import { avatar, isMonthPlan, periodLabel } from './common.js';
import { koreanVoices, pickVoice, player, RATES, voicesReady } from '../tts.js';
import { rateLabel, speakerIcon } from './listen.js';
import { isOptedOut, setOptOut, track } from '../analytics.js';

const manualIcon = html`<svg viewBox="0 0 24 24"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H10a2 2 0 0 1 2 2v14a1.5 1.5 0 0 0-1.5-1.5H4zM20 5.5c0-.8-.7-1.5-1.5-1.5H14a2 2 0 0 0-2 2v14a1.5 1.5 0 0 1 1.5-1.5H20z" /></svg>`;

// sw.js의 DATA_CACHE와 같은 이름이어야 한다.
const DATA_CACHE = 'bible-data-v1';

export async function settingsView(root) {
  let downloading = false;

  const cachedBookCount = async () => {
    if (!('caches' in window)) return null;
    const cache = await caches.open(DATA_CACHE);
    const keys = await cache.keys();
    return keys.filter((r) => /\/data\/books\/[^/]+\.json$/.test(new URL(r.url).pathname)).length;
  };

  const render = async () => {
    const plans = listPlans();
    const thisYear = today().y;
    const accounts = listAccounts();
    const me = currentAccount().id;
    const size = getSetting('fontSize', FONT_SIZE.default);
    const family = getSetting('fontFamily', 'serif');
    const cached = await cachedBookCount();
    const voices = player ? (await voicesReady(), koreanVoices()) : [];
    const voiceURI = getSetting('ttsVoice');
    const rate = getSetting('ttsRate', 1);

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
            <p class="sample">주님은 나의 목자시니, 내게 부족함 없어라.</p>
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
                : html`성경 66권 중 <b id="cached-count">${cached}</b>권이 이 기기에 저장되어 있습니다.`}
            </p>
            <p class="muted">계획을 만들면 그 계획에 필요한 책은 자동으로 저장됩니다. 전체를 받아 두면 인터넷 없이도 모든 본문을 읽을 수 있습니다(약 6MB).</p>
            ${cached != null && cached < 66
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
                      <span>${p.title}${p.mode === 'parallel' ? ' · 병렬' : p.mode === 'group' ? ' · 그룹' : ''}${isMonthPlan(p) ? '' : ` · ${p.length}일`}</span>
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
            <p class="muted">읽기 기록은 이 기기의 브라우저 안 SQLite 데이터베이스에 저장됩니다. 다른 기기로 옮기거나 보관하려면 파일로 내보내세요.</p>
            <div class="button-row">
              <button class="btn btn-ghost" data-action="export">내보내기 (.sqlite)</button>
              <label class="btn btn-ghost">
                가져오기
                <input type="file" id="import-file" accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3,application/x-sqlite3" hidden />
              </label>
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

        <section class="block about">
          <p>성경 본문: 새번역 © 대한성서공회. 개인 묵상과 읽기 용도로만 사용하세요.</p>
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
    let done = 0;
    let failed = 0;
    for (const b of books) {
      const url = new URL(`data/books/${b.code}.json`, location.href).href;
      if (!(await cache.match(url))) {
        try {
          await cache.add(url);
        } catch {
          failed++;
        }
      }
      done++;
      bar.firstElementChild.style.width = `${Math.round((done / books.length) * 100)}%`;
    }
    downloading = false;
    toast(failed ? `${failed}권을 받지 못했습니다. 인터넷 연결을 확인하세요.` : '성경 전체를 저장했습니다');
    render();
    track('offline_download_completed', { total: books.length, failed });
  };

  const exportBackup = () => {
    const blob = new Blob([exportFile()], { type: 'application/vnd.sqlite3' });
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
    if (d.family) {
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
    } else if (d.action === 'export') {
      exportBackup();
      track('backup_exported');
    } else if (d.action === 'reset') {
      const ok = await confirmDialog({
        title: '모든 기록을 지울까요?',
        message: '모든 계정과 계획, 읽음 기록, 저장한 구절, 설정이 지워집니다. 되돌릴 수 없으니 필요하면 먼저 내보내기를 하세요.',
        confirmText: '모두 지우기',
        danger: true,
      });
      if (!ok) return;
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
      const ok = await confirmDialog({
        title: `${d.label} 계정을 삭제할까요?`,
        message: '이 계정의 계획, 읽음 기록, 저장한 구절이 모두 지워집니다.',
        confirmText: '삭제',
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteAccount(Number(d.deleteAccount));
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
      message: `지금 기기의 기록이 "${file.name}"의 내용으로 바뀝니다.`,
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
