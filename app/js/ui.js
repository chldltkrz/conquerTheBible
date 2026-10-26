// 화면 그리기 도우미: 자동 이스케이프되는 html 템플릿, 토스트, 확인 대화상자

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

/** 이스케이프하지 않고 그대로 넣을 HTML */
export const raw = (s) => new Raw(s);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function renderValue(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(renderValue).join('');
  if (v instanceof Raw) return v.s;
  return esc(v);
}

/** html`<p>${text}</p>` — 끼워 넣는 값은 이스케이프된다. 배열과 중첩된 html``은 그대로 이어 붙인다. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += renderValue(v) + strings[i + 1];
  });
  return new Raw(out);
}

export function setHTML(el, content) {
  el.innerHTML = renderValue(content);
}

let toastTimer;
export function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/**
 * 아래에서 올라오는 창(.sheet)을 만든다 → {dlg, close}. 내용을 채운 뒤 document.body에 붙이고 showModal()한다.
 * 바깥(어두운 곳)이나 data-close 버튼, Esc로 애니메이션과 함께 닫히고, 머리(.sheet-head)를 아래로 끌어내려도 닫힌다.
 * 다른 화면으로 가거나 계정을 바꾸면 바로 닫는다. 닫히면 문서에서 지운다.
 */
export function createSheet({ labelledBy } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  if (labelledBy) dlg.setAttribute('aria-labelledby', labelledBy);

  const close = () => {
    if (!dlg.open || dlg.classList.contains('is-closing')) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return dlg.close();
    dlg.classList.add('is-closing');
    dlg.addEventListener('animationend', () => dlg.close(), { once: true });
    setTimeout(() => dlg.close(), 400); // 애니메이션 이벤트가 오지 않을 때를 위해
  };
  const closeNow = () => dlg.close();
  window.addEventListener('hashchange', closeNow);
  window.addEventListener('account-changed', closeNow);

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) close();
  });
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault(); // Esc: 애니메이션과 함께 닫는다
    close();
  });
  dlg.addEventListener('close', () => {
    window.removeEventListener('hashchange', closeNow);
    window.removeEventListener('account-changed', closeNow);
    dlg.remove();
  });

  let startY = null;
  dlg.addEventListener(
    'touchstart',
    (e) => {
      startY = e.target.closest('.sheet-head') && !e.target.closest('button') ? e.touches[0].clientY : null;
    },
    { passive: true },
  );
  dlg.addEventListener(
    'touchmove',
    (e) => {
      if (startY != null) dlg.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - startY)}px)`;
    },
    { passive: true },
  );
  dlg.addEventListener('touchend', (e) => {
    if (startY == null) return;
    const dy = e.changedTouches[0].clientY - startY;
    startY = null;
    if (dy > 90) return dlg.close();
    dlg.style.transform = '';
  });
  return { dlg, close };
}

/** 확인 대화상자. 확인을 누르면 true. */
export function confirmDialog({ title, message, confirmText = '확인', danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    setHTML(
      dlg,
      html`<form method="dialog">
        <h2>${title}</h2>
        ${message ? html`<p>${message}</p>` : ''}
        <div class="dialog-actions">
          <button value="cancel" class="btn btn-ghost">취소</button>
          <button value="ok" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${confirmText}</button>
        </div>
      </form>`,
    );
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/**
 * 여러 가지 중 하나를 고르는 대화상자. 고른 것의 value, 취소하면 null.
 * @param {{title, message?, choices: Array<{value, label, detail?, danger?}>}} options
 */
export function choiceDialog({ title, message, choices }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog choice-dialog';
    setHTML(
      dlg,
      html`<form method="dialog">
        <h2>${title}</h2>
        ${message ? html`<p>${message}</p>` : ''}
        <div class="choice-list">
          ${choices.map(
            (c) => html`<button value="${c.value}" class="choice ${c.danger ? 'is-danger' : ''}">
              <b>${c.label}</b>${c.detail ? html`<small>${c.detail}</small>` : ''}
            </button>`,
          )}
        </div>
        <div class="dialog-actions"><button value="" class="btn btn-ghost">취소</button></div>
      </form>`,
    );
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue || null);
      dlg.remove();
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export const formatNumber = (n) => n.toLocaleString('ko-KR');

/**
 * 화면에 보일 글에서 "1–5장"처럼 대시로 이은 숫자가 줄 끝에서 "1–" / "5장"으로 갈라지지 않게 대시 뒤에 단어 잇기(U+2060)를 넣는다.
 * 메모와 함께 저장하거나 알림·공유로 보내는 글에는 쓰지 않는다.
 */
export const keepRanges = (text) => text.replace(/–(?=\d)/g, '–\u2060');

/** 클립보드에 복사한다. 성공하면 true */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 권한이 없으면 아래 방식으로 다시 시도한다.
  }
  // HTTPS가 아닌 주소(같은 Wi-Fi의 http://192.168…)에서는 clipboard API를 쓸 수 없어 예전 방식으로 복사한다.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** 받침에 맞는 조사: josa('창세기', '을', '를') → '를', josa('시편', '을', '를') → '을' */
export function josa(word, withFinal, withoutFinal) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hasFinal = code >= 0 && code <= 11171 ? code % 28 !== 0 : false;
  return hasFinal ? withFinal : withoutFinal;
}
