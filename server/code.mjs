// 동기화 코드(sync-server.mjs)와 함께 읽기 방의 초대 코드(rooms.mjs)가 함께 쓰는 코드 꼴.
// 헷갈리는 글자(0·O, 1·I)를 뺀 32글자로 12자리 = 60비트. "ABCD-EFGH-JKLM"처럼 넷씩 끊어 보여 준다.
// 서버에는 코드 대신 SHA-256 해시만 둔다.

import crypto from 'node:crypto';

export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{12}$`);

/** CODE_ALPHABET 글자로 된 무작위 문자열 (글자 하나에 5비트) */
export function randomToken(length) {
  let s = '';
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

const formatCode = (s) => s.match(/.{4}/g).join('-');

export const newCode = () => formatCode(randomToken(12));

/** 사람이 넣은 코드를 "ABCD-EFGH-JKLM" 꼴로. 맞지 않으면 null (소문자, 띄어쓰기, 빠진 '-'는 괜찮다) */
export function normalizeCode(input) {
  const s = String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
  return CODE_RE.test(s) ? formatCode(s) : null;
}

export const hashCode = (code) => crypto.createHash('sha256').update(code.replace(/-/g, '')).digest();

/** Authorization: Bearer <코드>. 없거나 맞지 않으면 null */
export function bearerCode(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  return (m && normalizeCode(m[1])) || null;
}
