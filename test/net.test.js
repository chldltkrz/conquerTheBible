import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchLeaving } from '../app/js/net.js';

/** fetch 대신: 받은 keepalive를 적고, release()를 부를 때까지 끝나지 않는다 */
function fakeFetch() {
  const calls = [];
  const fn = (url, init) =>
    new Promise((resolve) => {
      calls.push({ keepalive: init.keepalive, release: () => resolve({ status: 204 }) });
    });
  return { fn, calls };
}

test('앱을 떠날 때만 keepalive로 보내고, 진행 중인 것과 합쳐 60KB(바이트)를 넘으면 보통 요청으로 보낸다', async () => {
  const f = fakeFetch();
  globalThis.document = { visibilityState: 'visible' };
  try {
    fetchLeaving(f.fn, 'x', { body: 'a' });
    assert.equal(f.calls[0].keepalive, false, '화면이 보이는 동안은 keepalive가 아니다');

    document.visibilityState = 'hidden';
    const korean = (n) => '가'.repeat(n); // 한 글자에 3바이트
    const first = fetchLeaving(f.fn, 'x', { body: korean(15000) }); // 45,000바이트
    fetchLeaving(f.fn, 'x', { body: korean(6000) }); // 18,000바이트: 합치면 넘는다
    fetchLeaving(f.fn, 'x', { body: 'b'.repeat(10000) }); // 10,000바이트: 들어간다
    fetchLeaving(f.fn, 'x', { body: korean(21000) }); // 글자 수는 2만 남짓이어도 63,000바이트라 혼자서도 넘는다
    assert.deepEqual(
      f.calls.slice(1).map((c) => c.keepalive),
      [true, false, true, false],
    );

    f.calls[1].release();
    await first; // 끝난 요청의 몫은 돌려받는다
    fetchLeaving(f.fn, 'x', { body: korean(6000) });
    assert.equal(f.calls.at(-1).keepalive, true);
  } finally {
    delete globalThis.document;
  }
});
