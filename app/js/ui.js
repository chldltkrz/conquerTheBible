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

export const formatNumber = (n) => n.toLocaleString('ko-KR');

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
