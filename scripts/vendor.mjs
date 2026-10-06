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
