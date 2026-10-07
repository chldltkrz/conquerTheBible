// 사용 통계: PostHog로 익명 이벤트를 보낸다.
// 원칙: 분석 코드는 절대 앱 동작을 막거나 깨뜨리지 않는다. track()은 throw하지 않고, await할 필요도 없다.
//       사용자가 입력한 글(계정 이름, 계획 이름, 메모, 검색어)과 본문 텍스트는 보내지 않는다.
// 이 모듈은 Node 테스트에서도 import될 수 있으므로 최상위에서 window/location을 직접 쓰지 않는다.

import { currentAccount, listAccounts, planOn } from './db.js';
import { today } from './dates.js';

const POSTHOG_KEY = 'phc_sUgN9up8ToFEa9ThSWQ3LgHRw9Z7e3bAw6KJiGeVksqk'; // PostHog 프로젝트 API 키 (공개돼도 되는 키)
const POSTHOG_HOST = 'https://us.i.posthog.com'; // EU 프로젝트면 https://eu.i.posthog.com
export const APP_VERSION = '0.2.0'; // 배포할 때 올린다
const OPT_OUT_KEY = 'ctb-analytics-optout';
const ONCE_KEY = 'ctb-analytics-once';
const MAX_QUEUE = 200;

const hasWindow = typeof window !== 'undefined';

/** 개발·테스트용 주소인지: localhost, 사설 IP, 그리고 .test·.local 같은 실제로 쓰이지 않는 도메인(ctb.test 등) */
export const isDevHostname = (hostname) =>
  /^(localhost|127\.|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) ||
  /\.(test|local|localhost|example|invalid|internal)$/i.test(hostname);
const isLocalHost = () => hasWindow && isDevHostname(location.hostname);

let ph = null; // 불러온 posthog 인스턴스
let started = false;
let queue = []; // posthog를 불러오기 전에 생긴 이벤트 [name, props, Date]

function safe(fn, fallback) {
  try {
    return fn();
  } catch (err) {
    console.warn('[analytics]', err);
    return fallback;
  }
}

/** 홈 화면에 설치한 앱으로 열었는지 */
export const displayMode = () =>
  safe(() => (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true ? 'standalone' : 'browser'), 'unknown');

export const isOptedOut = () => safe(() => localStorage.getItem(OPT_OUT_KEY) === '1', false);

/** 설정 화면의 "익명 사용 통계 보내기" 스위치 */
export function setOptOut(optOut) {
  safe(() => (optOut ? localStorage.setItem(OPT_OUT_KEY, '1') : localStorage.removeItem(OPT_OUT_KEY)));
  if (optOut) {
    queue = [];
    safe(() => ph?.opt_out_capturing());
  } else if (ph) {
    safe(() => ph.opt_in_capturing());
  } else {
    initAnalytics();
  }
}

/** 모든 이벤트에 붙는 공통 속성. 보낼 때마다 새로 계산한다(계정·계획이 바뀌어도 맞도록). */
function context() {
  return safe(() => {
    const plan = planOn(today());
    return {
      display_mode: displayMode(),
      app_version: APP_VERSION,
      account_id: currentAccount().id, // 기기 안의 계정 번호(1, 2, …). 이름은 보내지 않는다
      account_count: listAccounts().length,
      has_active_plan: !!plan,
      active_plan_mode: plan?.mode ?? null,
    };
  }, { display_mode: displayMode(), app_version: APP_VERSION });
}

/** main.js의 boot()에서 한 번 부른다. 기다릴 필요 없다. */
export function initAnalytics() {
  if (started || !hasWindow || isOptedOut()) return;
  started = true;
  if (isLocalHost()) {
    console.info('[analytics] 로컬 개발 환경이라 이벤트를 콘솔에만 출력합니다');
    return;
  }
  import('../vendor/posthog.js')
    .then(({ default: posthog }) => {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        defaults: '2026-05-30',
        person_profiles: 'always', // 로그인이 없어도 Lifecycle·코호트를 쓰기 위해
        persistence: 'localStorage', // 쿠키를 쓰지 않는다
        autocapture: false, // 절 본문(span[role=button]) 클릭이 본문 텍스트와 함께 잡히지 않도록
        capture_pageview: false, // 해시 라우팅이라 route()에서 직접 보낸다
        capture_pageleave: false,
        disable_session_recording: true,
        disable_surveys: true,
        advanced_disable_flags: true, // 기능 플래그(A/B 테스트)를 쓰게 되면 지운다
      });
      ph = posthog;
      for (const [name, props, timestamp] of queue) ph.capture(name, props, { timestamp });
      queue = [];
    })
    .catch((err) => {
      console.warn('[analytics] PostHog를 불러오지 못했습니다', err);
      queue = [];
    });
}

/**
 * 이벤트 보내기. 어디서 불러도 안전하다.
 * 속성을 계산하는 코드가 있으면 props를 함수로 넘긴다: track('x', () => ({ ...helper() }))
 * 그래야 계산 중 오류가 나도 safe() 안에서 잡혀 앱 흐름이 끊기지 않는다.
 */
export function track(name, props = {}) {
  safe(() => {
    if (!hasWindow || isOptedOut()) return;
    const payload = { ...context(), ...(typeof props === 'function' ? props() : props) };
    if (isLocalHost()) {
      console.debug('[analytics]', name, payload);
      return;
    }
    if (ph) ph.capture(name, payload);
    else if (queue.length < MAX_QUEUE) queue.push([name, payload, new Date()]);
  });
}

/** 같은 key로는 이 기기에서 한 번만 보낸다 (읽음 취소 후 다시 표시해도 완독·연속 기록 이벤트가 겹치지 않도록) */
export function trackOnce(key, name, props = {}) {
  safe(() => {
    const sent = new Set(JSON.parse(localStorage.getItem(ONCE_KEY) ?? '[]'));
    if (sent.has(key)) return;
    sent.add(key);
    localStorage.setItem(ONCE_KEY, JSON.stringify([...sent].slice(-500)));
    track(name, props);
  });
}
