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
