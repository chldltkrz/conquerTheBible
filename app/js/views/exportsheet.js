// 메모·구절 내보내기 창: 묵상 메모와 저장한 구절을 텍스트 파일로 저장하거나, 다른 앱으로 보내거나, PDF로 저장(인쇄)한다.
// 내용 만들기는 notesexport.js.

import { currentAccount, listAccounts } from '../db.js';
import { exportCounts, exportFileName, exportHtml, exportText } from '../notesexport.js';
import { createSheet, html, setHTML, toast } from '../ui.js';
import { track } from '../analytics.js';

const fileIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M5 19h14" /></svg>`;
const shareIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>`;
const printIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z" /></svg>`;

/** 인쇄용 화면을 띄우고 인쇄 창을 연다. 인쇄가 끝나면 지운다 (afterprint가 오지 않는 브라우저는 다음에 열 때 지운다) */
function printExport(opts) {
  document.getElementById('print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  setHTML(root, exportHtml(opts));
  document.body.append(root);
  window.addEventListener('afterprint', () => root.remove(), { once: true });
  window.print();
}

function downloadText(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** 내보내기 창을 연다. surface: 사용 통계에 남길 화면 이름 */
export function openExportSheet(surface) {
  const counts = exportCounts();
  const state = { notes: counts.notes > 0, saved: counts.saved > 0 };
  const sharable = typeof navigator.share === 'function';
  const many = listAccounts().length > 1;

  const { dlg, close } = createSheet({ labelledBy: 'export-title' });
  setHTML(
    dlg,
    html`<header class="sheet-head">
        <span class="sheet-grip" aria-hidden="true"></span>
        <div class="sheet-title-row">
          <div>
            ${many ? html`<p class="eyebrow">${currentAccount().name}</p>` : ''}
            <h2 id="export-title">메모·구절 내보내기</h2>
          </div>
          <button class="icon-btn" data-close aria-label="닫기">✕</button>
        </div>
      </header>
      <div class="sheet-body">
        <div class="card">
          <label class="field-row">
            <span>묵상 메모 <small class="muted">${counts.notes}개</small></span>
            <input type="checkbox" data-include="notes" ${state.notes ? 'checked' : ''} ${counts.notes ? '' : 'disabled'} />
          </label>
          <label class="field-row">
            <span>저장한 구절 <small class="muted">${counts.saved}구절 · 구절 메모 포함</small></span>
            <input type="checkbox" data-include="saved" ${state.saved ? 'checked' : ''} ${counts.saved ? '' : 'disabled'} />
          </label>
        </div>
        <p class="sheet-note">
          묵상 메모는 쓴 날 순서로, 저장한 구절은 성경 순서로 적습니다.${many ? ' 지금 계정의 기록만 내보냅니다.' : ''}
          메모 내용이 그대로 들어 있으니 보관과 공유에 주의하세요.
        </p>
        <div class="export-actions">
          <button class="btn btn-primary" data-export="file">${fileIcon}<span>텍스트 파일로 저장</span></button>
          ${sharable ? html`<button class="btn btn-ghost" data-export="share">${shareIcon}<span>다른 앱으로 보내기</span></button>` : ''}
          <button class="btn btn-ghost" data-export="print">${printIcon}<span>PDF로 저장 (인쇄)</span></button>
        </div>
      </div>`,
  );

  const buttons = dlg.querySelectorAll('[data-export]');
  const sync = () => buttons.forEach((b) => (b.disabled = !state.notes && !state.saved));
  sync();

  const done = (method) => {
    track('notes_exported', {
      surface,
      method,
      include: state.notes && state.saved ? 'both' : state.notes ? 'notes' : 'saved',
      notes: state.notes ? counts.notes : 0,
      saved: state.saved ? counts.saved : 0,
    });
  };

  dlg.addEventListener('change', (e) => {
    const key = e.target.dataset.include;
    if (!key) return;
    state[key] = e.target.checked;
    sync();
  });

  dlg.addEventListener('click', (e) => {
    const method = e.target.closest('[data-export]')?.dataset.export;
    if (!method || (!state.notes && !state.saved)) return;
    const opts = { ...state };
    if (method === 'file') {
      downloadText(exportText(opts), exportFileName(opts));
      done('file');
      toast('텍스트 파일로 저장했습니다');
      close();
    } else if (method === 'share') {
      // 누른 그 자리에서 불러야 한다(사파리). 카카오톡 "나와의 채팅"이나 메모 앱으로 보낼 수 있다.
      navigator.share({ title: exportFileName(opts).replace(/\.txt$/, ''), text: exportText(opts) }).then(
        () => {
          done('share');
          close();
        },
        (err) => {
          if (err?.name !== 'AbortError') toast('보내지 못했습니다. 텍스트 파일로 저장해 보세요');
        },
      );
    } else if (method === 'print') {
      done('print');
      printExport(opts);
      close();
    }
  });

  document.body.append(dlg);
  dlg.showModal();
}
