// 말씀 카드: 고른 절을 배경 위에 얹은 이미지(PNG)로 그린다. 공유 창은 views/cardsheet.js.
// 줄 나누기와 글자 크기 맞추기는 글자 폭을 재는 함수(measure)만 받는 순수 함수라 Node 테스트에서도 쓴다.
// 이 모듈은 Node 테스트에서도 import되므로 최상위에서 window/document를 직접 쓰지 않는다.

export const RATIOS = {
  square: { w: 1080, h: 1080, label: '정사각형' },
  story: { w: 1080, h: 1920, label: '세로' },
};

/** 배경. ink는 그 위에 쓸 글자 색 */
export const BACKGROUNDS = [
  { id: 'dawn', label: '새벽', stops: ['#f4dcc6', '#d9bcd2'], ink: '#2b2230' },
  { id: 'meadow', label: '초원', stops: ['#3f7d64', '#1d4536'], ink: '#fdfaf2' },
  { id: 'sea', label: '바다', stops: ['#4b76c2', '#1d3263'], ink: '#fdfaf2' },
  { id: 'sunset', label: '노을', stops: ['#d27a41', '#6a2a4b'], ink: '#fff8f0' },
  { id: 'night', label: '밤', stops: ['#2d3b5c', '#111419'], ink: '#f1eee7' },
  { id: 'paper', label: '종이', stops: ['#fbf8f1', '#ece4d4'], ink: '#2a2620' },
];

export const FONTS = {
  serif: { label: '명조', family: "'Noto Serif KR', 'Nanum Myeongjo', 'AppleMyungjo', 'Batang', serif", weight: 500 },
  sans: { label: '고딕', family: "'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif", weight: 500 },
};

// 비율마다 글자를 놓는 자리. 말씀과 출처를 한 덩어리로 top~(h-bottom) 사이 가운데에 놓는다.
const LAYOUT = {
  square: { pad: 110, top: 130, bottom: 150, max: 76, min: 32 },
  story: { pad: 110, top: 340, bottom: 360, max: 84, min: 34 },
};
const LINE_HEIGHT = 1.6;
const REF = { size: 34, lineHeight: 1.4, gap: 52, maxLines: 2 };
const FOOTER = { size: 26, bottom: 70, text: '맛있는만나' };

/**
 * 글을 폭에 맞게 줄로 나눈다. 띄어쓰기에서 나누고, 한 낱말이 줄보다 길면 글자 단위로 자른다.
 * measure(s): 그 글의 폭
 */
export function wrapText(text, maxWidth, measure) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= maxWidth) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const ch of word) {
        if (line && measure(line + ch) > maxWidth) {
          lines.push(line);
          line = ch;
        } else line += ch;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * 같은 줄 수로 줄 길이가 고르게 다시 나눈다. 마지막 줄만 짧게 남지 않게 한다.
 * ("주님은 나의 목자시니, 내게 / 부족함 없어라." → "주님은 나의 목자시니, / 내게 부족함 없어라.")
 * 같은 줄 수가 되는 가장 좁은 폭을 찾고, 그 폭 안에서 줄마다 남는 폭의 제곱 합이 가장 작게 나눈다.
 */
function balance(text, width, measure, count) {
  const words = text.split(/\s+/).filter(Boolean);
  if (count < 2 || text.includes('\n') || words.some((w) => measure(w) > width)) return wrapText(text, width, measure);
  let lo = Math.max(...words.map(measure));
  let hi = width;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (wrapText(text, mid, measure).length <= count) hi = mid;
    else lo = mid;
  }
  // best[k][i]: 앞의 낱말 i개를 k줄로 나눌 때의 가장 작은 값, from[k][i]: 그때 마지막 줄이 시작하는 낱말
  const n = words.length;
  const best = [Array.from({ length: n + 1 }, (_, i) => (i ? Infinity : 0))];
  const from = [[]];
  for (let k = 1; k <= count; k++) {
    best[k] = new Array(n + 1).fill(Infinity);
    from[k] = [];
    for (let i = 1; i <= n; i++) {
      for (let j = i - 1; j >= 0; j--) {
        const w = measure(words.slice(j, i).join(' '));
        if (w > hi) break;
        const cost = best[k - 1][j] + (hi - w) ** 2;
        if (cost < best[k][i]) {
          best[k][i] = cost;
          from[k][i] = j;
        }
      }
    }
  }
  if (!Number.isFinite(best[count][n])) return wrapText(text, hi, measure);
  const lines = [];
  for (let k = count, i = n; k > 0; k--) {
    const j = from[k][i];
    lines.unshift(words.slice(j, i).join(' '));
    i = j;
  }
  return lines;
}

/**
 * 상자에 들어가는 가장 큰 글자 크기와 그 크기의 줄들 → {size, lines, truncated}
 * 가장 작은 크기로도 넘치면 들어가는 데까지 쓰고 끝에 …를 붙인다.
 * measureAt(size): 그 크기의 measure 함수
 */
export function fitText(text, { width, height, max, min, lineHeight = LINE_HEIGHT }, measureAt) {
  for (let size = max; size >= min; size -= 2) {
    const measure = measureAt(size);
    const lines = wrapText(text, width, measure);
    if (lines.length * size * lineHeight <= height) return { size, lines: balance(text, width, measure, lines.length), truncated: false };
  }
  const measure = measureAt(min);
  const lines = wrapText(text, width, measure);
  const fit = Math.max(1, Math.floor(height / (min * lineHeight)));
  lines.length = Math.min(lines.length, fit);
  let last = lines[fit - 1] ?? '';
  while (last && measure(`${last}…`) > width) last = last.slice(0, -1);
  lines[lines.length - 1] = `${last.trimEnd()}…`;
  return { size: min, lines, truncated: true };
}

/**
 * 카드의 글자 배치 → {text: {size, lines, y}, ref: {lines, y}}. y는 첫 줄 가운데의 높이.
 * measureAt(font, size): 그 글꼴·크기의 measure 함수 (font: 'text' | 'ref')
 */
export function layoutCard({ text, ref, ratio = 'square' }, measureAt) {
  const { w, h } = RATIOS[ratio];
  const L = LAYOUT[ratio];
  const width = w - L.pad * 2;
  const refLines = wrapText(ref, width, measureAt('ref', REF.size)).slice(0, REF.maxLines);
  const refHeight = refLines.length * REF.size * REF.lineHeight;
  const room = h - L.top - L.bottom - refHeight - REF.gap;
  const fitted = fitText(text, { width, height: room, max: L.max, min: L.min }, (size) => measureAt('text', size));
  const lineH = fitted.size * LINE_HEIGHT;
  const textHeight = fitted.lines.length * lineH;
  const top = L.top + (h - L.top - L.bottom - (textHeight + REF.gap + refHeight)) / 2;
  return {
    text: { ...fitted, lineHeight: lineH, y: top + lineH / 2 },
    ref: { lines: refLines, lineHeight: REF.size * REF.lineHeight, y: top + textHeight + REF.gap + (REF.size * REF.lineHeight) / 2 },
  };
}

const fontCss = (font, size, weight = font.weight) => `${weight} ${size}px ${font.family}`;

/** 그림을 잘리더라도 꽉 차게 (CSS background-size: cover) */
function drawCover(ctx, image, w, h) {
  const scale = Math.max(w / image.width, h / image.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, 0, 0, w, h);
}

/**
 * 캔버스에 카드를 그린다.
 * card: {text, ref, version, ratio, background, font, image?}
 *   version: 역본 이름 ("새번역"), background: BACKGROUNDS의 하나, font: 'serif' | 'sans'
 *   image: 다 불러온 배경 그림 (있으면 background 대신 그리고, 글자가 잘 보이도록 어둡게 덮는다)
 */
export function drawCard(canvas, { text, ref, version, ratio = 'square', background = BACKGROUNDS[0], font = 'serif', image = null }) {
  const { w, h } = RATIOS[ratio];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const textFont = FONTS[font] ?? FONTS.serif;
  const ink = image ? '#fffdf8' : background.ink;

  if (image) {
    drawCover(ctx, image, w, h);
    ctx.fillStyle = 'rgb(0 0 0 / 34%)';
    ctx.fillRect(0, 0, w, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, w, h);
    background.stops.forEach((c, i) => g.addColorStop(i / (background.stops.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  const refText = `${ref} · ${version}`;
  const layout = layoutCard({ text, ref: refText, ratio }, (which, size) => {
    ctx.font = which === 'text' ? fontCss(textFont, size) : fontCss(FONTS.sans, size, 600);
    return (s) => ctx.measureText(s).width;
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  if (image) {
    ctx.shadowColor = 'rgb(0 0 0 / 45%)';
    ctx.shadowBlur = 18;
  }
  ctx.font = fontCss(textFont, layout.text.size);
  layout.text.lines.forEach((line, i) => ctx.fillText(line, w / 2, layout.text.y + i * layout.text.lineHeight));

  ctx.globalAlpha = 0.85;
  ctx.font = fontCss(FONTS.sans, REF.size, 600);
  layout.ref.lines.forEach((line, i) => ctx.fillText(line, w / 2, layout.ref.y + i * layout.ref.lineHeight));

  ctx.globalAlpha = 0.6;
  ctx.font = fontCss(FONTS.sans, FOOTER.size, 700);
  ctx.fillText(FOOTER.text, w / 2, h - FOOTER.bottom);
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'transparent';
  return layout;
}

/** 카드에 쓰는 글꼴을 미리 불러 둔다 (기기에 있는 글꼴이면 바로 끝난다) */
export async function loadCardFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  await Promise.all(
    [fontCss(FONTS.serif, 40), fontCss(FONTS.sans, 40), fontCss(FONTS.sans, 40, 600), fontCss(FONTS.sans, 40, 700)].map((f) =>
      document.fonts.load(f, '말씀').catch(() => {}),
    ),
  );
}

// ── 그림 배경 (app/img/cards/, scripts/backgrounds.mjs가 만든다) ──

/**
 * 말씀에 어울리는 주제 id. 주제마다 낱말이 몇 번 보이는지 세어 가장 많은 것 (같으면 앞의 주제). 없으면 null.
 * 낱말은 어절의 첫머리에서만 찾고("양을"은 "찬양을"에 맞지 않는다), 띄어쓰기가 든 낱말은 그대로 찾는다. 영어는 대소문자를 가리지 않는다.
 * themes: index.json의 themes [{id, keywords}]
 */
export function pickTheme(text, themes) {
  const lower = text.toLowerCase();
  const words = lower.split(/[\s"'“”‘’()[\],.·…!?;:]+/).filter(Boolean);
  let best = null;
  let bestScore = 0;
  for (const theme of themes) {
    let score = 0;
    for (const k of theme.keywords) {
      const key = k.toLowerCase();
      score += key.includes(' ') ? lower.split(key).length - 1 : words.filter((w) => w.startsWith(key)).length;
    }
    if (score > bestScore) {
      best = theme.id;
      bestScore = score;
    }
  }
  return best;
}

/** 말씀마다 늘 같은 것을 고르도록 출처로 정하는 순번 (같은 주제라도 말씀마다 다른 그림이 나오게) */
export function pickIndex(key, length) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return length ? h % length : 0;
}

/** 저장할 파일 이름: 맛있는만나-시편-23-1.png */
export const cardFileName = (ref) => `맛있는만나-${ref.replace(/[\s:;,]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '')}.png`;
