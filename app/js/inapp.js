// 앱 안 브라우저(인앱 브라우저): 카카오톡·네이버·인스타그램 등에서 링크를 누르면 그 앱 안의 브라우저로 열린다.
// 거기서는 기록이 그 앱 안에만 따로 저장되고(휴대폰 브라우저와 나뉜다) 홈 화면에 추가·읽기 알림을 쓸 수 없으며,
// 동기화·함께 읽기 링크를 열면 그 앱 안의 기록에 연결된다. 그래서 앱을 띄우기 전에 휴대폰 브라우저로 옮긴다.
//   카카오톡: kakaotalk://web/openExternal (iOS·안드로이드 모두 기본 브라우저로)
//   라인: 주소에 openExternalBrowser=1
//   그 밖의 앱(안드로이드): intent://로 Chrome을 연다
//   그 밖의 앱(iOS): 앱 밖으로 보낼 방법이 없어 "Safari로 열기" 메뉴를 알려 준다
// 그 앱 안에 쌓아 온 기록이 있어도 옮긴다. 옮기지 못했거나 그 기록을 보려면 "여기서 계속 보기"로 그 앱 안에서 쓴다
// (그 창에서만. 링크를 다시 누르면 또 옮긴다).
// 이 모듈은 Node 테스트에서도 import되므로 최상위에서 window/document를 직접 쓰지 않는다.

import { copyText, html, setHTML, toast } from './ui.js';

// 앞에 있는 것부터 맞춰 본다. 실제 브라우저(Chrome·Safari·삼성 인터넷·웨일)는 넣지 않는다.
const APPS = [
  { id: 'kakaotalk', name: '카카오톡', re: /KAKAOTALK/i },
  { id: 'line', name: '라인', re: /\bLine\//i },
  { id: 'kakaostory', name: '카카오스토리', re: /KAKAOSTORY/i },
  { id: 'naver', name: '네이버 앱', re: /NAVER\(inapp/i },
  { id: 'daum', name: '다음 앱', re: /DaumApps/i },
  { id: 'band', name: '밴드', re: /\bBAND\//i },
  { id: 'instagram', name: '인스타그램', re: /Instagram/i },
  { id: 'facebook', name: '페이스북', re: /FBAN|FBAV|FB_IAB|FB4A/i },
  { id: 'everytime', name: '에브리타임', re: /everytimeApp/i },
];

const LINE_PARAM = 'openExternalBrowser';
const STAY_KEY = 'ctb-inapp-stay'; // sessionStorage. '1'이면 이 창에서는 "여기서 계속 보기"를 골랐다

/** 사용자 에이전트로 본 인앱 브라우저 {id, name, os: 'android' | 'ios'}. 아니면 null */
export function detectInApp(ua) {
  const app = APPS.find((a) => a.re.test(ua));
  if (!app) return null;
  // iPad의 인앱 브라우저는 Macintosh로 나온다
  const os = /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod|Macintosh/i.test(ua) ? 'ios' : null;
  return os && { id: app.id, name: app.name, os };
}

/** 그 앱에서 휴대폰 브라우저로 href를 여는 주소. 보낼 방법이 없으면(iOS의 다른 앱) null */
export function externalUrl(href, { id, os }) {
  if (id === 'kakaotalk') return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
  const url = new URL(href);
  if (id === 'line') {
    url.searchParams.set(LINE_PARAM, '1');
    return url.href;
  }
  // 주소의 #(#room=코드 등)는 그대로 둔다. 안드로이드는 마지막 #부터를 #Intent;…로 읽는다.
  if (os === 'android') {
    const scheme = url.protocol.slice(0, -1);
    return `intent://${url.host}${url.pathname}${url.search}${url.hash}#Intent;scheme=${scheme};package=com.android.chrome;end`;
  }
  return null;
}

/** 라인이 외부 브라우저로 넘겨준 주소에서 openExternalBrowser를 뺀 주소. 없으면 null */
export function withoutEscapeParam(href) {
  const url = new URL(href);
  if (!url.searchParams.has(LINE_PARAM)) return null;
  url.searchParams.delete(LINE_PARAM);
  return url.href;
}

const stayed = () => {
  try {
    return sessionStorage.getItem(STAY_KEY) === '1';
  } catch {
    return false;
  }
};

const stay = () => {
  try {
    sessionStorage.setItem(STAY_KEY, '1');
  } catch {
    // 저장할 수 없으면 새로 고칠 때 또 묻는다
  }
};

/**
 * main.js의 boot()에서 앱을 띄우기 전에 부른다. 인앱 브라우저에서 열었으면 휴대폰 브라우저로 옮기고
 * 안내 화면을 그린 채 기다린다 (그 앱 안에서는 앱을 띄우지 않는다). "여기서 계속 보기"를 누르면 끝난다.
 */
export async function leaveInAppBrowser(main) {
  const cleaned = withoutEscapeParam(location.href);
  if (cleaned) history.replaceState(null, '', cleaned);
  const app = detectInApp(navigator.userAgent);
  if (!app || stayed()) return;
  const target = externalUrl(location.href, app);
  const before = main.innerHTML;
  const choice = showLeaveScreen(main, app, target);
  // 라인이 받아 주지 않아 같은 앱 안에서 다시 열렸으면 또 보내지 않는다 (계속 다시 열리지 않도록)
  if (target && !cleaned) location.href = target;
  await choice;
  stay();
  main.innerHTML = before;
}

/** 안내 화면을 그린다. "여기서 계속 보기"를 누르면 끝나는 Promise */
function showLeaveScreen(main, app, target) {
  const button = app.os === 'android' && app.id !== 'kakaotalk' && app.id !== 'line' ? 'Chrome에서 열기' : '브라우저에서 열기';
  const why = `${app.name} 안에서는 기록이 따로 저장되고 홈 화면에 추가와 읽기 알림을 쓸 수 없습니다.`;
  setHTML(
    main,
    html`<section class="boot inapp">
      <img class="boot-mark" src="icons/icon.svg" alt="" width="64" height="64" />
      ${target
        ? html`<h1>브라우저에서 여는 중입니다</h1>
            <p class="boot-lead">${why} 휴대폰 브라우저에서 열어 주세요. 열리지 않으면 아래 버튼을 눌러 주세요.</p>
            <div class="inapp-actions">
              <a class="btn btn-primary btn-lg" href="${target}">${button}</a>
              <button class="btn btn-ghost" data-stay>여기서 계속 보기</button>
            </div>`
        : html`<h1>Safari에서 열어 주세요</h1>
            <p class="boot-lead">${why}</p>
            <p class="inapp-how">화면 위나 아래의 <b>···</b> 메뉴에서 <b>Safari로 열기</b>(또는 <b>외부 브라우저로 열기</b>)를 누르세요.
              메뉴가 없으면 링크를 복사해 Safari 주소창에 붙여 넣으세요.</p>
            <div class="inapp-actions">
              <button class="btn btn-primary btn-lg" data-copy>링크 복사</button>
              <button class="btn btn-ghost" data-stay>여기서 계속 보기</button>
            </div>`}
    </section>`,
  );
  return new Promise((resolve) => {
    main.onclick = async (e) => {
      if (e.target.closest('[data-stay]')) {
        main.onclick = null;
        resolve();
      } else if (e.target.closest('[data-copy]')) {
        toast((await copyText(location.href)) ? '링크를 복사했습니다. Safari 주소창에 붙여 넣으세요' : '복사하지 못했습니다');
      }
    };
  });
}
