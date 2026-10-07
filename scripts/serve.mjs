// app/ 폴더를 정적 파일로 내보내는 개발용 서버. 같은 Wi-Fi의 휴대폰에서도 접속할 수 있다.
//   node scripts/serve.mjs [포트]
// 휴대폰에서 PWA로 설치하거나 서비스 워커를 쓰려면 HTTPS(또는 localhost)가 필요하다. README 참고.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = path.join(ROOT, pathname);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  if (pathname.endsWith('/')) file = path.join(file, 'index.html');

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('찾을 수 없습니다');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      // 개발 중에는 고친 파일이 바로 보이도록 캐시하지 않는다. (오프라인 캐시는 서비스 워커 담당)
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets ?? []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`http://${n.address}:${PORT}  (같은 네트워크의 다른 기기)`);
    }
  }
});
