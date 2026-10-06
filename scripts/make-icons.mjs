// 앱 아이콘(펼친 책 + 책갈피)을 PNG와 SVG로 만든다. 외부 도구 없이 Node만으로 그린다.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'icons');

const COLORS = { bg: '#2f6a55', page: '#fffdf8', line: '#c6d9cf', ribbon: '#e0ad4f' };

// 0~1 좌표계의 도형 (뒤에 있는 것부터)
const leftPage = [[0.19, 0.33], [0.47, 0.37], [0.47, 0.71], [0.19, 0.67]];
const rightPage = [[0.53, 0.37], [0.81, 0.33], [0.81, 0.67], [0.53, 0.71]];
const ribbon = [[0.476, 0.4], [0.524, 0.4], [0.524, 0.83], [0.5, 0.79], [0.476, 0.83]];
const textLines = [0.12, 0.3, 0.48, 0.66].flatMap((t) => [
  pageLine(leftPage, 0.14, 0.86, t),
  pageLine(rightPage, 0.14, 0.86, t),
]);

/** 페이지 윗변과 나란한 얇은 줄 (t: 페이지 높이 안의 위치) */
function pageLine(page, a, b, t) {
  const [tl, tr, br, bl] = page;
  const at = (u, v) => {
    const top = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u];
    const bot = [bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u];
    return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
  };
  const h = 0.045;
  return [at(a, t + 0.1), at(b, t + 0.1), at(b, t + 0.1 + h), at(a, t + 0.1 + h)];
}

function inPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundRect([x, y], r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/** 한 점의 색 [r,g,b,a] */
function sample(p) {
  for (const line of textLines) if (inPolygon(p, line)) return [...hex(COLORS.line), 255];
  if (inPolygon(p, leftPage) || inPolygon(p, rightPage)) return [...hex(COLORS.page), 255];
  if (inPolygon(p, ribbon)) return [...hex(COLORS.ribbon), 255];
  return [...hex(COLORS.bg), 255];
}

/** scale: 도형을 가운데 기준으로 줄이는 비율 (maskable 아이콘의 안전 영역용) */
function render(size, { rounded, scale = 1 }) {
  const SS = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const shapeP = [0.5 + (x - 0.5) / scale, 0.5 + (y - 0.5) / scale];
          let c = sample(shapeP);
          if (rounded && !inRoundRect([x, y], 0.22)) c = [0, 0, 0, 0];
          // 미리 곱한 알파로 더해 가장자리 색이 번지지 않게 한다.
          acc[0] += c[0] * c[3];
          acc[1] += c[1] * c[3];
          acc[2] += c[2] * c[3];
          acc[3] += c[3];
        }
      }
      const i = (py * size + px) * 4;
      const a = acc[3] / (SS * SS);
      rgba[i] = a ? Math.round(acc[0] / acc[3]) : 0;
      rgba[i + 1] = a ? Math.round(acc[1] / acc[3]) : 0;
      rgba[i + 2] = a ? Math.round(acc[2] / acc[3]) : 0;
      rgba[i + 3] = Math.round(a);
    }
  }
  return encodePng(size, size, rgba);
}

// ── PNG ─────────────────────────────────────────────────
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── SVG ─────────────────────────────────────────────────
function svg() {
  const pts = (poly) => poly.map(([x, y]) => `${(x * 512).toFixed(1)},${(y * 512).toFixed(1)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${0.22 * 512}" fill="${COLORS.bg}"/>
  <polygon points="${pts(ribbon)}" fill="${COLORS.ribbon}"/>
  <polygon points="${pts(leftPage)}" fill="${COLORS.page}"/>
  <polygon points="${pts(rightPage)}" fill="${COLORS.page}"/>
${textLines.map((l) => `  <polygon points="${pts(l)}" fill="${COLORS.line}"/>`).join('\n')}
</svg>
`;
}

await fs.mkdir(OUT, { recursive: true });
const files = {
  'icon-192.png': render(192, { rounded: true }),
  'icon-512.png': render(512, { rounded: true }),
  'maskable-512.png': render(512, { rounded: false, scale: 0.8 }),
  'apple-touch-icon.png': render(180, { rounded: false, scale: 0.9 }),
  'icon.svg': svg(),
};
for (const [name, data] of Object.entries(files)) await fs.writeFile(path.join(OUT, name), data);
console.log(`아이콘 ${Object.keys(files).length}개 → app/icons/`);
