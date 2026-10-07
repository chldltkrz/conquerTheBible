// node_modules에 있는 브라우저용 라이브러리를 app/vendor/로 복사한다. (npm install 후 자동 실행)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQLJS = path.join(ROOT, 'node_modules', 'sql.js');
const OUT = path.join(ROOT, 'app', 'vendor');

await fs.mkdir(OUT, { recursive: true });
for (const file of ['sql-wasm-browser.js', 'sql-wasm-browser.wasm']) {
  await fs.copyFile(path.join(SQLJS, 'dist', file), path.join(OUT, file));
}
await fs.copyFile(path.join(SQLJS, 'LICENSE'), path.join(OUT, 'sql.js-LICENSE.txt'));
const { version } = JSON.parse(await fs.readFile(path.join(SQLJS, 'package.json'), 'utf8'));
console.log(`sql.js ${version} → app/vendor/`);

// PostHog(사용 통계). no-external 빌드라 실행 중에 PostHog 서버에서 추가 스크립트를 받아오지 않는다.
const POSTHOG = path.join(ROOT, 'node_modules', 'posthog-js');
const posthogSrc = await fs.readFile(path.join(POSTHOG, 'dist', 'module.no-external.js'), 'utf8');
// 소스맵은 복사하지 않으므로, 배포 사이트에서 404가 나지 않게 sourceMappingURL 줄을 지운다.
await fs.writeFile(path.join(OUT, 'posthog.js'), posthogSrc.replace(/\n?\/\/# sourceMappingURL=.*\s*$/, '\n'));
try {
  await fs.copyFile(path.join(POSTHOG, 'LICENSE'), path.join(OUT, 'posthog-js-LICENSE.txt'));
} catch {
  // LICENSE가 없는 버전이면 건너뛴다
}
const { version: posthogVersion } = JSON.parse(await fs.readFile(path.join(POSTHOG, 'package.json'), 'utf8'));
console.log(`posthog-js ${posthogVersion} → app/vendor/`);
