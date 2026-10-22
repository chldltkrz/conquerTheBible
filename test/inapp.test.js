// 앱 안 브라우저(카카오톡·네이버 등)에서 열었을 때 휴대폰 브라우저로 옮기는 주소
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectInApp, externalUrl, withoutEscapeParam } from '../app/js/inapp.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ROOM = 'https://delicious-manna.com/#room=ABCD-EFGH-JKLM';

test('앱마다 알아보고, 안드로이드·iOS를 가린다 (iPad는 Macintosh로 나온다)', () => {
  assert.deepEqual(detectInApp(`${ANDROID};KAKAOTALK 2410840`), { id: 'kakaotalk', name: '카카오톡', os: 'android' });
  assert.deepEqual(detectInApp(`${IPHONE} KAKAOTALK 10.8.4`), { id: 'kakaotalk', name: '카카오톡', os: 'ios' });
  assert.equal(detectInApp(`${IPAD} KAKAOTALK 10.8.4`).os, 'ios');
  assert.equal(detectInApp(`${ANDROID} NAVER(inapp; search; 2000; 12.8.4)`).id, 'naver');
  assert.equal(detectInApp(`${IPHONE} Instagram 350.0.0.21.94 (iPhone15,2; iOS 18_0; ko_KR)`).id, 'instagram');
  assert.equal(detectInApp(`${IPHONE} [FBAN/FBIOS;FBAV/480.0.0]`).id, 'facebook');
  assert.equal(detectInApp(`${ANDROID} [FB_IAB/FB4A;FBAV/480.0.0]`).id, 'facebook');
  assert.equal(detectInApp(`${ANDROID} Line/14.16.0/IAB`).id, 'line');
  assert.equal(detectInApp(`${ANDROID} BAND/16.3.0`).id, 'band');
  assert.equal(detectInApp(`${ANDROID} DaumApps/5.0`).id, 'daum');
});

test('실제 브라우저와 홈 화면에 설치한 앱은 인앱 브라우저가 아니다', () => {
  assert.equal(detectInApp(ANDROID.replace('; wv', '')), null, 'Chrome');
  assert.equal(detectInApp(`${IPHONE.replace('Mobile/', 'Version/18.0 Mobile/')} Safari/604.1`), null, 'Safari');
  assert.equal(detectInApp(IPHONE), null, 'iOS 홈 화면 앱 (Safari 토큰이 없다)');
  assert.equal(detectInApp(`${ANDROID.replace('; wv', '')} SamsungBrowser/26.0`), null, '삼성 인터넷');
  assert.equal(detectInApp(`${ANDROID.replace('; wv', '')} Whale/3.28.0.0`), null, '웨일');
});

test('카카오톡은 iOS·안드로이드 모두 openExternal로, 주소는 #까지 통째로', () => {
  const url = externalUrl(ROOM, { id: 'kakaotalk', os: 'ios' });
  assert.equal(url, `kakaotalk://web/openExternal?url=${encodeURIComponent(ROOM)}`);
  assert.equal(externalUrl(ROOM, { id: 'kakaotalk', os: 'android' }), url);
});

test('라인은 openExternalBrowser=1을 #앞에 붙이고, 넘어온 주소에서 다시 뺀다', () => {
  const url = externalUrl(ROOM, { id: 'line', os: 'ios' });
  assert.equal(url, 'https://delicious-manna.com/?openExternalBrowser=1#room=ABCD-EFGH-JKLM');
  assert.equal(withoutEscapeParam(url), 'https://delicious-manna.com/#room=ABCD-EFGH-JKLM');
  assert.equal(withoutEscapeParam('https://delicious-manna.com/?a=1&openExternalBrowser=1#/'), 'https://delicious-manna.com/?a=1#/');
  assert.equal(withoutEscapeParam(ROOM), null, '없으면 그대로');
});

test('안드로이드의 다른 앱은 Chrome intent로, #room=은 #Intent; 앞에 그대로 남는다', () => {
  assert.equal(
    externalUrl(ROOM, { id: 'naver', os: 'android' }),
    'intent://delicious-manna.com/#room=ABCD-EFGH-JKLM#Intent;scheme=https;package=com.android.chrome;end',
  );
  assert.equal(
    externalUrl('https://delicious-manna.com/?x=1', { id: 'band', os: 'android' }),
    'intent://delicious-manna.com/?x=1#Intent;scheme=https;package=com.android.chrome;end',
  );
});

test('iOS의 다른 앱은 밖으로 보낼 주소가 없다 (Safari로 여는 법을 알려 준다)', () => {
  assert.equal(externalUrl(ROOM, { id: 'instagram', os: 'ios' }), null);
  assert.equal(externalUrl(ROOM, { id: 'naver', os: 'ios' }), null);
});
