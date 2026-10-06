// 설정 화면: 읽기 화면, 오프라인 저장, 계획 기록, 백업

import { allBooks } from '../bible.js';
import { formatMonth, today, ymKey } from '../dates.js';
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
import { avatar } from './common.js';

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
    const accounts = listAccounts();
    const me = currentAccount().id;
    const size = getSetting('fontSize', FONT_SIZE.default);
    const family = getSetting('fontFamily', 'serif');
    const cached = await cachedBookCount();

    setHTML(
      root,
      html`<header class="page-head"><h1>설정</h1></header>

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
                ${plans.map(
                  (p) => html`<li>
                    <a href="#/month/${ymKey(p.year, p.month)}">
                      <b>${formatMonth(p.year, p.month)}</b>
                      <span>${p.title}</span>
                      <small>${p.readDays}/${p.readingDays}일 읽음</small>
                    </a>
                    <button class="icon-btn danger" data-delete="${p.id}" data-label="${formatMonth(p.year, p.month)} ${p.title}"
                      aria-label="${formatMonth(p.year, p.month)} 계획 삭제">✕</button>
                  </li>`,
                )}
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
    const btn = e.target.closest('button');
    if (!btn) return;
    const d = btn.dataset;
    if (d.family) {
      await setSetting('fontFamily', d.family);
      applyReadingSettings();
      render();
    } else if (d.action === 'download') {
      downloadAll(btn);
    } else if (d.action === 'export') {
      exportBackup();
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
      toast('모든 기록을 지웠습니다');
      render();
    } else if (d.delete) {
      const ok = await confirmDialog({
        title: '계획을 삭제할까요?',
        message: `${d.label} 계획과 읽음 기록이 지워집니다.`,
        confirmText: '삭제',
        danger: true,
      });
      if (!ok) return;
      await deletePlan(Number(d.delete));
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
    if (e.target.id === 'font-size') {
      await setSetting('fontSize', Number(e.target.value));
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
      toast('백업을 가져왔습니다');
      render();
    } catch (err) {
      toast(err.message);
    }
  };

  await render();
}
