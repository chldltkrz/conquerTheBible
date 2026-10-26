// 서버 요청 도우미. 앱을 떠나는 중(화면이 가려짐)에 보내는 요청은 keepalive로 보내 페이지가 닫혀도 끝까지 가게 한다.
// 브라우저는 진행 중인 keepalive 요청의 본문을 모두 합쳐 64KB까지만 받고, 넘으면 그 요청을 아예 보내지 않는다.
// 동기화(sync.js)·함께 읽기(rooms.js)·읽기 알림(reminder.js)이 앱을 떠날 때 함께 보내므로 몫을 나눠 쓴다.
// 크기는 바이트로 센다(한글은 글자당 3바이트). 몫에 들지 않는 요청은 보통 요청으로 보낸다(닫히기 전에 끝나면 간다).
// 이 모듈은 Node 테스트에서도 import되므로 최상위에서 window/document를 직접 쓰지 않는다.

const KEEPALIVE_BUDGET = 60 * 1024;
let inFlight = 0; // 진행 중인 keepalive 요청 본문의 바이트 합

/** 앱을 떠나는 중인지 (화면이 가려졌다) */
export const leaving = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** fetchImpl(url, init)과 같되, 앱을 떠나는 중이고 남은 몫에 들면 keepalive로 보낸다 */
export async function fetchLeaving(fetchImpl, url, init = {}) {
  const size = init.body ? new TextEncoder().encode(init.body).length : 0;
  const keepalive = leaving() && inFlight + size <= KEEPALIVE_BUDGET;
  if (keepalive) inFlight += size;
  try {
    return await fetchImpl(url, { ...init, keepalive });
  } finally {
    if (keepalive) inFlight -= size;
  }
}
