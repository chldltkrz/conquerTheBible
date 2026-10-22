// 동기화(sync-server.mjs), 읽기 알림(push.mjs), 함께 읽기 방(rooms.mjs)이 함께 쓰는 HTTP 조각

export const MAX_BODY = 4 * 1024 * 1024; // 요청 하나 (nginx client_max_body_size와 맞춘다)

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function send(res, status, body) {
  const text = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

export function readJson(req, maxBody = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBody) {
        req.removeAllListeners('data');
        req.resume();
        reject(new HttpError(413, 'too_large'));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > maxBody) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'bad_json'));
      }
    });
    req.on('error', reject);
  });
}
