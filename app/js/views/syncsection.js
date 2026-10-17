// 설정 화면의 "기기 간 동기화": 동기화 시작하기, 코드로 연결하기, 코드·QR 보여 주기, 끄기

import { formatTimestamp } from '../dates.js';
import { localSummary } from '../db.js';
import {
  joinSync,
  leaveSync,
  lookupSync,
  startNewSync,
  syncLink,
  syncNow,
  syncState,
} from '../sync.js';
import { choiceDialog, copyText, formatNumber, html, setHTML, toast } from '../ui.js';
import { track } from '../analytics.js';

const syncIcon = html`<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.7-4.4L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.4L20 16M20 20v-4h-4" /></svg>`;

const STATUS_TEXT = {
  syncing: () => '동기화하는 중…',
  ok: (s) => (s.syncedAt ? `동기화됨 · ${formatTimestamp(s.syncedAt)}` : '처음 동기화를 기다리는 중'),
  offline: (s) => `인터넷에 연결되면 동기화합니다${s.pending ? ` · 보내지 않은 변경 ${formatNumber(s.pending)}개` : ''}`,
  error: (s) => s.error ?? '동기화하지 못했습니다',
};

function statusLine(s) {
  return html`<span class="sync-dot is-${s.status}" aria-hidden="true"></span>
    <span>${STATUS_TEXT[s.status]?.(s) ?? ''}</span>`;
}

/** 설정 화면에 넣을 "기기 간 동기화" 칸 */
export function syncSection() {
  const s = syncState();
  if (s.status === 'off') {
    return html`<section class="block" id="sync-block">
      <h2 class="block-title">기기 간 동기화</h2>
      <div class="card sync-card">
        <p>로그인 없이 <b>동기화 코드</b> 하나로 휴대폰·태블릿·컴퓨터의 기록을 똑같이 맞춥니다.</p>
        <p class="muted small">
          이 기기의 모든 계정(읽기 계획, 읽음 기록, 저장한 구절, 묵상 메모, 올해의 말씀)이 함께 맞춰집니다.
          글자 크기와 목소리 같은 화면 설정은 기기마다 따로 둡니다.
        </p>
        <div class="button-row">
          <button class="btn btn-primary" data-sync-action="create">${syncIcon}<span>동기화 시작하기</span></button>
          <button class="btn btn-ghost" data-sync-action="join">코드로 연결하기</button>
        </div>
      </div>
    </section>`;
  }
  return html`<section class="block" id="sync-block">
    <h2 class="block-title">기기 간 동기화</h2>
    <div class="card sync-card">
      <p class="sync-status" id="sync-status" role="status">${statusLine(s)}</p>
      <div class="sync-code-box">
        <small class="muted">동기화 코드</small>
        <code class="sync-code">${s.code}</code>
      </div>
      <p class="muted small">
        다른 기기의 설정에서 "코드로 연결하기"를 누르고 이 코드를 넣거나, QR 코드를 휴대폰 카메라로 찍으세요.
        코드를 아는 사람은 이 기록을 보고 고칠 수 있으니 함께 쓰는 사람에게만 알려 주세요.
      </p>
      <div class="button-row">
        <button class="btn btn-ghost btn-sm" data-sync-action="share">QR 코드·링크</button>
        <button class="btn btn-ghost btn-sm" data-sync-action="now">${syncIcon}<span>지금 동기화</span></button>
      </div>
      <button class="link danger" data-sync-action="leave">동기화 끄기</button>
    </div>
  </section>`;
}

// 설정 화면이 열려 있으면 상태 줄만 바꾼다 (입력하던 계정 이름 등을 건드리지 않도록 칸 전체는 다시 그리지 않는다)
if (typeof window !== 'undefined') {
  window.addEventListener('sync-status', () => {
    const el = document.getElementById('sync-status');
    const s = syncState();
    if (el && s.status !== 'off') setHTML(el, statusLine(s));
  });
}

/**
 * "기기 간 동기화" 칸의 버튼을 처리한다.
 * @param {string} action data-sync-action
 * @param {() => void} rerender 설정 화면을 다시 그린다
 */
export async function handleSyncAction(action, btn, rerender) {
  if (action === 'create') {
    btn.disabled = true;
    try {
      const code = await startNewSync();
      track('sync_started', { how: 'create' });
      rerender();
      showShareDialog(code, { fresh: true });
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  } else if (action === 'join') {
    openJoinDialog('', rerender);
  } else if (action === 'share') {
    showShareDialog(syncState().code);
  } else if (action === 'now') {
    btn.disabled = true;
    await syncNow();
    btn.disabled = false;
    const s = syncState();
    if (s.status === 'ok') toast('동기화했습니다');
    else if (s.error) toast(s.error);
  } else if (action === 'leave') {
    const choice = await choiceDialog({
      title: '동기화를 끌까요?',
      message: '이 기기의 기록은 그대로 남습니다.',
      choices: [
        { value: 'device', label: '이 기기만 끄기', detail: '다른 기기들은 서로 계속 동기화합니다.' },
        {
          value: 'everywhere',
          label: '모든 기기에서 끄기',
          detail: '서버에 있는 동기화 기록을 지웁니다. 이 코드를 쓰던 다른 기기들도 동기화를 멈춥니다.',
          danger: true,
        },
      ],
    });
    if (!choice) return;
    try {
      await leaveSync({ everywhere: choice === 'everywhere' });
      track('sync_stopped', { everywhere: choice === 'everywhere' });
      toast(choice === 'everywhere' ? '모든 기기에서 동기화를 껐습니다' : '이 기기의 동기화를 껐습니다');
      rerender();
    } catch (err) {
      toast(err.message);
    }
  }
}

/** "계정 나, 엄마 · 계획 3개 · 읽음 기록 120개 …" (항목 안에서는 줄을 바꾸지 않는다) */
function summaryText({ accounts, counts }) {
  const n = (t) => counts[t] ?? 0;
  const item = (label, count) => count && `${label} ${formatNumber(count)}개`.replace(/ /g, '\u00a0');
  const parts = [
    accounts.length ? `계정 ${accounts.join(', ')}` : '계정 없음',
    item('계획', n('plans')),
    item('읽음 기록', n('readings')),
    item('저장한 구절', n('saved_verses')),
    item('메모', n('day_notes') + n('verse_notes')),
  ];
  return parts.filter(Boolean).join(' · ');
}

/** 계획·읽음·구절·메모·올해의 말씀이 하나도 없고 계정이 하나뿐인지 */
const isBlank = ({ accounts, counts }) =>
  accounts.length <= 1 && Object.entries(counts).every(([t, n]) => t === 'accounts' || !n);

/**
 * 코드로 연결하는 창. 동기화 링크로 앱을 열었을 때도 부른다(prefill에 링크의 코드).
 * @param {() => void} [done] 연결한 뒤 부른다
 */
export function openJoinDialog(prefill = '', done = () => {}) {
  const current = syncState();
  if (current.status !== 'off') {
    toast(
      prefill && prefill === current.code
        ? '이미 이 코드로 동기화하고 있습니다'
        : '다른 코드로 동기화하고 있습니다. 먼저 설정에서 동기화를 끄세요',
    );
    return;
  }
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog';
  setHTML(
    dlg,
    html`<form class="sync-join">
      <h2>코드로 연결하기</h2>
      <p>먼저 쓰던 기기의 <b>설정 › 기기 간 동기화</b>에 있는 12자리 코드를 넣으세요.</p>
      <input name="code" class="sync-code-input" value="${prefill}" placeholder="ABCD-EFGH-JKLM" maxlength="20"
        autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" aria-label="동기화 코드" required />
      <p class="form-error" role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-close>취소</button>
        <button class="btn btn-primary">연결</button>
      </div>
    </form>`,
  );
  const form = dlg.querySelector('form');
  const error = dlg.querySelector('.form-error');
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) dlg.close();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('.btn-primary');
    submit.disabled = true;
    error.hidden = true;
    let remote;
    try {
      remote = await lookupSync(form.code.value);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
      return;
    }
    dlg.close();
    await connect(remote, done);
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

async function connect(remote, done) {
  const local = localSummary();
  let keep = 'server';
  if (!isBlank(local)) {
    keep = await choiceDialog({
      title: '어느 기록을 남길까요?',
      message: '이 기기에도 기록이 있습니다. 한쪽 기록만 남고 다른 쪽은 지워집니다. 필요하면 먼저 "기록 백업"에서 내보내기를 하세요.',
      choices: [
        {
          value: 'server',
          label: '동기화된 기록 받기',
          detail: `${summaryText(remote)}\n이 기기의 기록이 이것으로 바뀝니다.`,
        },
        {
          value: 'device',
          label: '이 기기 기록 남기기',
          detail: `${summaryText(local)}\n이 코드를 쓰는 다른 기기들의 기록이 이것으로 바뀝니다.`,
        },
      ],
    });
    if (!keep) return;
  }
  try {
    await joinSync(remote.code, keep);
    track('sync_started', { how: keep === 'server' ? 'join' : 'join_keep_device' });
    toast(keep === 'server' ? '동기화된 기록을 받았습니다' : '이 기기 기록으로 동기화를 시작했습니다');
    done();
  } catch (err) {
    toast(err.message);
  }
}

/** 동기화 코드와 QR 코드, 링크 복사·보내기 창 */
export function showShareDialog(code, { fresh = false } = {}) {
  const link = syncLink(code);
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog sync-share';
  setHTML(
    dlg,
    html`<h2>${fresh ? '동기화를 시작했습니다' : '다른 기기 연결하기'}</h2>
      <p>다른 기기에서 QR 코드를 카메라로 찍거나, 설정 › 기기 간 동기화 › "코드로 연결하기"에 이 코드를 넣으세요.</p>
      <div class="sync-qr" aria-hidden="true"></div>
      <code class="sync-code">${code}</code>
      <div class="button-row is-center">
        ${typeof navigator.share === 'function'
          ? html`<button class="btn btn-ghost btn-sm" data-share>링크 보내기</button>`
          : ''}
        <button class="btn btn-ghost btn-sm" data-copy>링크 복사</button>
      </div>
      <div class="dialog-actions"><button class="btn btn-primary" data-close>닫기</button></div>`,
  );
  dlg.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) dlg.close();
    else if (e.target.closest('[data-copy]')) {
      toast((await copyText(link)) ? '링크를 복사했습니다' : '복사하지 못했습니다');
    } else if (e.target.closest('[data-share]')) {
      // 나에게 보내기(카카오톡 등)로 다른 기기에서 열 수 있게
      navigator.share({ title: '맛있는만나 동기화', url: link }).catch(() => {});
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  renderQr(dlg.querySelector('.sync-qr'), link);
}

async function renderQr(el, text) {
  try {
    const { default: qrcode } = await import('../../vendor/qrcode.js');
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4; // QR 둘레의 빈 칸 (이게 있어야 잘 읽힌다)
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
    const size = n + quiet * 2;
    el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img">
      <rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  } catch (err) {
    console.warn('QR 코드를 그리지 못했습니다', err);
    el.remove();
  }
}
