// 말씀 공유 창: 고른 절을 말씀 카드(이미지)로 만들어 공유·저장하거나 글로 복사한다. 카드 그리기는 card.js.
// 배경은 그림(app/img/cards/, 말씀에 어울리는 주제를 맨 앞에 권한다)과 그러데이션 중에서 고른다.
// 고른 모양·글꼴과, 그러데이션을 골랐으면 그것을 기기마다 기억한다(settings 'card', 동기화하지 않는다).
// 그림을 골랐으면 다음에도 그 말씀에 어울리는 그림부터 보여 준다.

import { TRANSLATIONS, shareParts, shareText } from '../bible.js';
import { BACKGROUNDS, FONTS, RATIOS, cardFileName, drawCard, loadCardFonts, pickIndex, pickTheme } from '../card.js';
import { getSetting, setSetting } from '../db.js';
import { copyText, createSheet, html, setHTML, toast } from '../ui.js';
import { track } from '../analytics.js';

const shareIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>`;
const saveIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M5 19h14" /></svg>`;
const copyIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v11H9zM5 15V4h10" /></svg>`;

// ── 그림 배경 ──────────────────────────────────────────────

let indexPromise = null;

/** 그림 배경 목록 {themes: [{id, label, keywords, backgrounds: [id]}]}. 받지 못하면 null (그러데이션만 쓴다) */
function cardIndex() {
  indexPromise ??= fetch('img/cards/index.json')
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((index) => {
      if (!index) indexPromise = null; // 다음에 다시 받아 본다
      return index;
    });
  return indexPromise;
}

const images = new Map(); // id → Promise<HTMLImageElement> (창을 다시 열어도 다시 받지 않는다)

function loadImage(id) {
  if (!images.has(id)) {
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `img/cards/${id}.webp`;
    });
    p.catch(() => images.delete(id));
    images.set(id, p);
  }
  return images.get(id);
}

const themeOf = (id) => id.replace(/-\d+$/, '');
const isGradient = (id) => BACKGROUNDS.some((b) => b.id === id);

// ── 창 ────────────────────────────────────────────────────

/** 이 브라우저가 파일(이미지)을 다른 앱으로 공유할 수 있는지 */
function canShareFiles() {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'card.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

const radio = (attr, value, current, label) =>
  html`<button role="radio" data-${attr}="${value}" aria-checked="${value === current}">${label}</button>`;

/** 배경 줄: firstTheme(어울리는 주제, 없으면 처음 고른 그림의 주제)의 그림 → 그러데이션 → 나머지 그림 */
function backgroundStrip(index, firstTheme, current) {
  const thumb = (theme, id, n) => html`<button role="radio" class="card-thumb" data-bg="${id}" aria-checked="${id === current}"
      aria-label="${theme.label} ${n}"><img src="img/cards/thumb/${id}.webp" alt="" loading="lazy" decoding="async" /></button>`;
  const themeThumbs = (theme) => theme.backgrounds.map((id, i) => thumb(theme, id, i + 1));
  const themes = index?.themes ?? [];
  const first = themes.find((t) => t.id === firstTheme);
  return [
    first ? themeThumbs(first) : '',
    BACKGROUNDS.map(
      (b) => html`<button role="radio" class="card-thumb" data-bg="${b.id}" aria-checked="${b.id === current}" aria-label="${b.label}"
        style="background: linear-gradient(135deg, ${b.stops.join(', ')})"></button>`,
    ),
    themes.filter((t) => t !== first).map(themeThumbs),
  ];
}

/**
 * 말씀 공유 창을 연다.
 * verses: [{b, c, v, e?, t}], surface: 사용 통계에 남길 화면 이름, translation: 'saenew' | 'gae' | 'bsb'
 */
export function openShareSheet(verses, { surface, translation = 'saenew' }) {
  const { text, ref } = shareParts(verses, { translation });
  const version = TRANSLATIONS[translation]?.name ?? TRANSLATIONS.saenew.name;
  const saved = getSetting('card', {}) ?? {};
  const state = {
    ratio: RATIOS[saved.ratio] ? saved.ratio : 'square',
    font: FONTS[saved.font] ? saved.font : 'serif',
    background: isGradient(saved.background) ? saved.background : BACKGROUNDS[0].id, // 그림 목록을 받으면 바꾼다
  };
  let recommended = null; // 말씀에 어울리는 주제 id
  const sharable = canShareFiles();
  let file = null; // 지금 미리 보기의 PNG. 공유는 누른 그 자리에서 바로 불러야 해서(사파리) 미리 만들어 둔다.

  const { dlg, close } = createSheet({ labelledBy: 'card-title' });
  setHTML(
    dlg,
    html`<header class="sheet-head">
        <span class="sheet-grip" aria-hidden="true"></span>
        <div class="sheet-title-row">
          <div>
            <p class="eyebrow">${ref}</p>
            <h2 id="card-title">말씀 공유</h2>
          </div>
          <button class="icon-btn" data-close aria-label="닫기">✕</button>
        </div>
      </header>
      <div class="sheet-body card-sheet">
        <div class="card-preview is-loading" data-ratio="${state.ratio}">
          <canvas role="img" aria-label="말씀 카드 미리 보기: ${ref}"></canvas>
        </div>
        <div class="card card-options">
          <div class="card-bg">
            <div class="card-bg-head"><span>배경</span><small class="muted" id="card-bg-hint"></small></div>
            <div class="card-bg-strip" role="radiogroup" aria-label="배경"></div>
          </div>
          <div class="field-row">
            <span>모양</span>
            <div class="segmented" role="radiogroup" aria-label="카드 모양">
              ${Object.entries(RATIOS).map(([id, r]) => radio('ratio', id, state.ratio, r.label))}
            </div>
          </div>
          <div class="field-row">
            <span>글꼴</span>
            <div class="segmented" role="radiogroup" aria-label="글꼴">
              ${Object.entries(FONTS).map(([id, f]) => radio('font', id, state.font, f.label))}
            </div>
          </div>
        </div>
        <div class="card-actions">
          ${sharable
            ? html`<button class="btn btn-primary" data-card="share" disabled>${shareIcon}<span>이미지 공유</span></button>`
            : ''}
          <button class="btn ${sharable ? 'btn-ghost' : 'btn-primary'}" data-card="save" disabled>${saveIcon}<span>이미지 저장</span></button>
          <button class="btn btn-ghost" data-card="copy">${copyIcon}<span>글로 복사</span></button>
        </div>
      </div>`,
  );

  const canvas = dlg.querySelector('canvas');
  const preview = dlg.querySelector('.card-preview');
  const strip = dlg.querySelector('.card-bg-strip');
  const fileButtons = dlg.querySelectorAll('[data-card="share"], [data-card="save"]');
  let drawn = 0;

  async function draw() {
    const seq = ++drawn;
    file = null;
    fileButtons.forEach((b) => (b.disabled = true));
    preview.dataset.ratio = state.ratio;
    preview.classList.add('is-loading');
    const gradient = BACKGROUNDS.find((b) => b.id === state.background);
    let image = null;
    if (!gradient) {
      image = await loadImage(state.background).catch(() => null); // 받지 못하면(오프라인) 그러데이션으로
      if (seq !== drawn) return; // 기다리는 사이 다른 것을 골랐다
    }
    drawCard(canvas, { text, ref, version, ratio: state.ratio, background: gradient ?? BACKGROUNDS[0], font: state.font, image });
    preview.classList.remove('is-loading');
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (seq !== drawn || !blob) return;
    file = new File([blob], cardFileName(ref), { type: 'image/png' });
    fileButtons.forEach((b) => (b.disabled = false));
  }

  function remember() {
    // 그림은 말씀마다 어울리는 것이 달라 'image'로만 기억한다
    const background = isGradient(state.background) ? state.background : 'image';
    setSetting('card', { ratio: state.ratio, font: state.font, background }).catch(() => {}); // 다른 창에서 쓰는 중이면 기억하지 못해도 괜찮다
  }

  const props = (method) => {
    const image = !isGradient(state.background);
    return {
      surface,
      method,
      count: verses.length,
      translation,
      ratio: state.ratio,
      font: state.font,
      background: state.background,
      background_kind: image ? 'image' : 'gradient',
      recommended_theme: recommended,
      picked_recommended: image && themeOf(state.background) === recommended,
    };
  };

  function shareImage() {
    if (!file) return;
    const p = props('share');
    navigator.share({ files: [file] }).then(
      () => {
        track('verse_card_shared', p);
        close();
      },
      (err) => {
        if (err?.name !== 'AbortError') toast('공유하지 못했습니다. "이미지 저장"으로 저장한 뒤 보내 주세요');
      },
    );
  }

  function saveImage() {
    if (!file) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    track('verse_card_shared', props('save'));
    toast('이미지를 저장했습니다');
  }

  async function copy() {
    const ok = await copyText(shareText(verses, { translation }));
    track('verses_shared', { surface, count: verses.length, copied: ok });
    toast(ok ? '말씀을 클립보드에 복사했습니다' : '복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요');
    if (ok) close();
  }

  dlg.addEventListener('click', (e) => {
    const option = e.target.closest('[data-ratio], [data-bg], [data-font]');
    if (option) {
      const [key, attr] = option.dataset.ratio ? ['ratio', 'ratio'] : option.dataset.bg ? ['background', 'bg'] : ['font', 'font'];
      const value = option.dataset[attr];
      if (state[key] === value) return;
      state[key] = value;
      option.parentElement.querySelectorAll('[role=radio]').forEach((b) => b.setAttribute('aria-checked', b === option));
      draw();
      remember();
      return;
    }
    const action = e.target.closest('[data-card]')?.dataset.card;
    if (action === 'share') shareImage();
    else if (action === 'save') saveImage();
    else if (action === 'copy') copy();
  });

  document.body.append(dlg);
  dlg.showModal();

  // 그림 목록을 받아 배경 줄을 채우고, 그러데이션을 기억해 둔 것이 아니면 말씀에 어울리는 그림으로 시작한다
  Promise.all([cardIndex(), loadCardFonts()]).then(([index]) => {
    const themes = (index?.themes ?? []).filter((t) => t.backgrounds.length);
    let first = null; // 배경 줄 맨 앞에 둘 주제
    if (themes.length) {
      recommended = pickTheme(text, themes);
      const theme = themes.find((t) => t.id === recommended);
      // 어울리는 주제가 없는 말씀(대부분)은 모든 그림 중에서 말씀마다 다른 것으로 시작한다
      const pool = theme ? theme.backgrounds : themes.flatMap((t) => t.backgrounds);
      const pick = pool[pickIndex(ref, pool.length)];
      first = recommended ?? themeOf(pick);
      if (!isGradient(saved.background)) state.background = pick;
      if (theme) dlg.querySelector('#card-bg-hint').textContent = `말씀에 어울리는 배경: ${theme.label}`;
    }
    setHTML(strip, backgroundStrip({ themes }, first, state.background));
    strip.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    draw();
  });
}
