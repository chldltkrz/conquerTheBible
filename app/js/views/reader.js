// 본문 화면: 그날 분량의 새번역 본문, 마음에 남는 절 저장, 읽음 완료 버튼

import { book, chapterUnit, formatSegments, loadBook, readingMinutes } from '../bible.js';
import { formatDay, formatTimestamp, ymKey } from '../dates.js';
import {
  currentAccount,
  getDayNote,
  getSetting,
  planOn,
  saveDayNote,
  saveVerses,
  savedInReading,
  setRead,
  setSetting,
  unsaveVerses,
  verseCounts,
  verseKey,
} from '../db.js';
import { FONT_SIZE, applyReadingSettings } from '../prefs.js';
import { html, setHTML, toast } from '../ui.js';
import {
  accountPrefix,
  bookmarkIcon,
  checkIcon,
  entryOn,
  isParallel,
  partUnit,
  readHref,
  readingEventProps,
  readSnapshot,
  shareIcon,
  shareVerses,
  trackReadChange,
} from './common.js';
import { player } from '../tts.js';
import { track, trackOnce } from '../analytics.js';
import { createListening, playIcon, speakerIcon } from './listen.js';

// 시가서는 한 절씩 줄을 나누어 보여 준다.
const POETRY = new Set(['job', 'psa', 'pro', 'sng', 'lam']);

/** 주소의 날짜(y, m, d)가 들어 있는 계획의 그날 분량. 읽음·구절 기록은 계획의 몇 번째 날(entry.day)로 남긴다. */
export async function readerView(root, [y, m, d, focusTrack], { isCurrent }) {
  const plan = planOn({ y, m, d });
  const entry = plan && entryOn(plan, { y, m, d });
  if (!entry || !entry.segments.length) {
    setHTML(
      root,
      html`<section class="empty">
        <h2>${entry ? '이날은 쉬는 날입니다' : '읽기 계획을 찾을 수 없습니다'}</h2>
        <a class="btn btn-primary" href="#/month/${ymKey(y, m)}">달력으로</a>
      </section>`,
    );
    return;
  }

  const readingDays = plan.days.filter((x) => x.segments.length);
  const idx = readingDays.indexOf(entry);
  const prevDay = readingDays[idx - 1];
  const nextDay = readingDays[idx + 1];
  // 이웃한 날이 다른 달이면 달도 붙인다: "7일" / "11월 1일"
  const navLabel = ({ date }) => (date.m === m ? `${date.d}일` : `${date.m}월 ${date.d}일`);
  const title = formatSegments(entry.segments);
  const day = entry.day;
  const note = getDayNote({ y, m, d });
  // 사용 통계: 본문을 연 뒤 읽음 표시까지 걸린 시간, 소리로 듣기를 썼는지
  const openedAt = performance.now();
  let ttsUsed = false;

  setHTML(
    root,
    html`<header class="reader-head">
        <a class="icon-btn" href="#/month/${ymKey(y, m)}" aria-label="달력으로">‹</a>
        <div class="reader-title">
          <small>${accountPrefix()}${formatDay(y, m, d)} · ${idx + 1}/${readingDays.length}</small>
          <b>${title}</b>
        </div>
        ${player ? html`<button class="icon-btn listen-btn" data-action="listen" aria-label="소리로 듣기">${speakerIcon}</button>` : ''}
        <div class="font-ctl" role="group" aria-label="글자 크기">
          <button class="icon-btn" data-font="-1" aria-label="글자 작게">가<sup>−</sup></button>
          <button class="icon-btn" data-font="1" aria-label="글자 크게">가<sup>+</sup></button>
        </div>
      </header>
      <article class="scripture" aria-busy="true">
        <p class="muted loading">본문을 불러오는 중…</p>
      </article>
      <p class="reader-hint">마음에 남는 절을 눌러 저장해 보세요. 저장한 구절은 <a href="#/saved">구절</a> 탭에 모입니다.</p>
      <section class="memo-box">
        <label for="day-memo">
          <b>오늘의 묵상 메모</b>
          <small id="memo-status">${note ? `${formatTimestamp(note.updatedAt)} 저장` : ''}</small>
        </label>
        <textarea id="day-memo" rows="3" maxlength="2000"
          placeholder="말씀을 읽으며 받은 은혜, 결단, 기도 제목을 적어 보세요">${note?.text ?? ''}</textarea>
      </section>
      <footer class="reader-foot" id="reader-foot"></footer>
      <div class="select-bar" id="select-bar" hidden></div>
      <div class="tts-bar" id="tts-bar" role="region" aria-label="소리로 듣기" hidden></div>`,
  );

  // ── 읽음 완료 ────────────────────────────────────────────
  // 병렬 읽기면 책(묶음)마다 따로 표시하고, 아래 버튼은 남은 책을 한꺼번에 표시한다.
  const parallel = isParallel(plan);
  const unit = partUnit(plan); // 권 | 그룹
  const parts = entry.parts.map((p) => ({ ...p }));
  const dayReadAt = () => (parts.every((p) => p.readAt) ? parts.map((p) => p.readAt).sort().at(-1) : null);

  const renderTrackFoot = (p) => {
    const el = root.querySelector(`[data-track-foot="${p.track}"]`);
    if (!el) return;
    setHTML(
      el,
      p.readAt
        ? html`<span class="track-done">${checkIcon}<span>${p.title} 읽음 · ${formatTimestamp(p.readAt)}</span></span>
            <button class="btn btn-ghost btn-sm" data-action="toggle-part" data-track="${p.track}" data-read="1">취소</button>`
        : html`<button class="btn btn-ghost btn-block" data-action="toggle-part" data-track="${p.track}" data-read="0">
            ${checkIcon}<span>${p.title} 읽음 표시</span>
          </button>`,
    );
  };

  const renderFoot = () => {
    const readAt = dayReadAt();
    const left = parts.filter((p) => !p.readAt);
    setHTML(
      root.querySelector('#reader-foot'),
      html`${readAt
          ? html`<div class="done-box">
              <span class="done-mark">${checkIcon}</span>
              <span><b>${parallel ? `${parts.length}${unit} 모두 읽음` : '읽음'}</b><small>${formatTimestamp(readAt)}에 기록</small></span>
              <button class="btn btn-ghost btn-sm" data-action="toggle" data-read="1">취소</button>
            </div>`
          : html`<button class="btn btn-primary btn-block btn-lg" data-action="toggle" data-read="0">
              ${checkIcon}<span>${parallel && left.length < parts.length
                ? `남은 ${left.length}${unit}도 읽음 완료`
                : `${parallel ? '모두 ' : ''}읽음 완료 · 약 ${readingMinutes(entry.chars)}분 분량`}</span>
            </button>`}
        <nav class="day-nav">
          ${prevDay ? html`<a href="${readHref(prevDay.date)}">‹ ${navLabel(prevDay)}</a>` : html`<span></span>`}
          <a href="#/month/${ymKey(y, m)}">달력</a>
          ${nextDay ? html`<a href="${readHref(nextDay.date)}">${navLabel(nextDay)} ›</a>` : html`<span></span>`}
        </nav>`,
    );
  };
  renderFoot();

  // ── 절 선택과 저장 ───────────────────────────────────────
  const verses = new Map(); // 키 → {b, c, v, e, t}
  const selected = new Set();
  let savedHere = savedInReading(plan.id, day);
  const counts = new Map(); // 키 → 지금까지 저장한 횟수

  const loadCounts = () => {
    counts.clear();
    for (const { b, c } of entry.segments) {
      for (const [v, n] of verseCounts(b, c)) counts.set(verseKey(b, c, v), n);
    }
  };
  loadCounts();

  const paintVerse = (el) => {
    const key = el.dataset.ref;
    el.classList.toggle('is-selected', selected.has(key));
    el.classList.toggle('is-saved', savedHere.has(key));
    el.setAttribute('aria-pressed', selected.has(key));
    const n = counts.get(key) ?? 0;
    setHTML(el.querySelector('.vcount'), n ? html`${bookmarkIcon}${n}` : '');
    el.querySelector('.vcount').title = n ? `${n}번 저장한 절` : '';
  };

  const listening = createListening(root, verses);
  const bar = root.querySelector('#select-bar');
  const renderBar = () => {
    bar.hidden = selected.size === 0;
    if (!selected.size) return;
    const allSaved = [...selected].every((k) => savedHere.has(k));
    setHTML(
      bar,
      html`<span class="select-count"><b>${selected.size}절</b> 선택</span>
        ${player
          ? html`<button class="icon-btn" data-action="listen-from" aria-label="선택한 절부터 듣기">${playIcon}</button>`
          : ''}
        <button class="btn btn-ghost btn-sm" data-action="share">${shareIcon}<span>공유</span></button>
        ${allSaved
          ? html`<button class="btn btn-ghost btn-sm" data-action="unsave">저장 취소</button>`
          : html`<button class="btn btn-primary btn-sm" data-action="save">${bookmarkIcon}<span>저장</span></button>`}
        <button class="icon-btn select-clear" data-action="clear-selection" aria-label="선택 해제">✕</button>`,
    );
  };

  const repaint = () => {
    root.querySelectorAll('.verse[data-ref]').forEach(paintVerse);
    renderBar();
  };

  const toggleVerse = (el) => {
    const key = el.dataset.ref;
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    paintVerse(el);
    renderBar();
  };

  const saveSelection = async (save) => {
    const list = [...selected].map((k) => verses.get(k));
    const fresh = save ? list.filter((x) => !savedHere.has(verseKey(x.b, x.c, x.v))) : []; // 새로 저장할 절
    try {
      if (save) {
        await saveVerses(plan.id, day, fresh);
        track('verses_saved', { surface: 'reader', count: fresh.length, plan_day: day });
      } else await unsaveVerses(plan.id, day, list);
    } catch (err) {
      toast(`저장하지 못했습니다: ${err.message}`);
      return;
    }
    savedHere = savedInReading(plan.id, day);
    loadCounts();
    selected.clear();
    repaint();
    toast(save ? `${list.length}절을 저장했습니다` : '저장을 취소했습니다');
  };

  root.onclick = async (e) => {
    const font = e.target.closest('[data-font]');
    if (font) {
      const size = getSetting('fontSize', FONT_SIZE.default) + Number(font.dataset.font);
      if (size < FONT_SIZE.min || size > FONT_SIZE.max) return;
      await setSetting('fontSize', size);
      track('reading_setting_changed', { setting: 'font_size', value: size, surface: 'reader' });
      applyReadingSettings();
      return;
    }
    const tts = e.target.closest('[data-tts]')?.dataset.tts;
    if (tts) return listening?.handle(tts);
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'listen' || action === 'listen-from') ttsUsed = true;
    if (action === 'listen') return listening?.open();
    if (action === 'listen-from') {
      // 선택한 절 중 본문에서 가장 앞에 있는 절부터 읽는다.
      const first = [...root.querySelectorAll('.verse.is-selected')][0]?.dataset.ref;
      selected.clear();
      repaint();
      return listening?.open(first);
    }
    if (action === 'save' || action === 'unsave') return saveSelection(action === 'save');
    // 공유한 뒤에도 선택은 그대로 두어 이어서 저장할 수 있게 한다.
    if (action === 'share') return shareVerses([...selected].map((k) => verses.get(k)), 'reader');
    if (action === 'clear-selection') {
      selected.clear();
      repaint();
      return;
    }
    if (action === 'toggle' || action === 'toggle-part') return toggleRead(e.target.closest('[data-action]'));

    // 글자를 드래그해서 복사하려는 중이면 절 선택으로 보지 않는다.
    const verse = e.target.closest('.verse[data-ref]');
    if (verse && !window.getSelection()?.toString()) toggleVerse(verse);
  };
  // ── 묵상 메모: 입력이 멈추면 잠시 뒤, 입력란을 벗어나면 바로 저장한다 ─────
  const memoStatus = root.querySelector('#memo-status');
  let memoTimer = null;
  let savedMemo = note?.text ?? '';
  const saveMemo = async (text) => {
    clearTimeout(memoTimer);
    if (text === savedMemo) return;
    savedMemo = text;
    try {
      const at = await saveDayNote({ y, m, d }, title, text);
      memoStatus.textContent = at ? `${formatTimestamp(at)} 저장` : '메모를 지웠습니다';
      // 자동 저장이 입력을 멈출 때마다 일어나므로 그날 한 번만 보낸다
      if (at) trackOnce(`day_note:${currentAccount().id}:${y}-${m}-${d}`, 'day_note_created', { length: text.trim().length });
    } catch (err) {
      savedMemo = null; // 다음 입력 때 다시 시도
      memoStatus.textContent = `저장하지 못했습니다: ${err.message}`;
    }
  };
  root.oninput = (e) => {
    if (e.target.id !== 'day-memo') return;
    memoStatus.textContent = '입력 중…';
    clearTimeout(memoTimer);
    const text = e.target.value;
    memoTimer = setTimeout(() => saveMemo(text), 800);
  };
  root.onchange = (e) => {
    if (e.target.id === 'day-memo') saveMemo(e.target.value);
  };

  root.onkeydown = (e) => {
    const verse = e.target.closest?.('.verse[data-ref]');
    if (verse && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggleVerse(verse);
    }
  };

  /** data-track이 있으면 그 책만, 없으면 그날의 남은 책 전부(이어서 읽기는 그날 분량) */
  const toggleRead = async (btn) => {
    btn.disabled = true;
    const read = btn.dataset.read !== '1';
    const track = btn.dataset.track == null ? null : Number(btn.dataset.track);
    const targets = track == null ? parts : parts.filter((p) => p.track === track);
    try {
      const snap = readSnapshot(plan.id);
      const readAt = await setRead(plan.id, day, read, track);
      trackReadChange(snap, {
        planId: plan.id,
        day,
        track,
        read,
        surface: 'reader',
        extra: { reading_seconds: Math.min(3600, Math.round((performance.now() - openedAt) / 1000)), tts_used: ttsUsed },
      });
      for (const p of targets) {
        if (!read) p.readAt = null;
        else p.readAt ??= readAt;
        renderTrackFoot(p);
      }
      renderFoot();
      const all = dayReadAt();
      if (track != null && read && !all) {
        const left = parts.filter((p) => !p.readAt).length;
        toast(`${targets[0].title} 읽음. ${unit === '권' ? `남은 책 ${left}권` : `남은 그룹 ${left}개`}`);
      } else {
        toast(read ? `${m}월 ${d}일 분량을 다 읽었습니다. 수고하셨어요!` : '읽음 표시를 지웠습니다');
      }
    } catch (err) {
      btn.disabled = false;
      toast(`저장하지 못했습니다: ${err.message}`);
    }
  };

  // ── 본문 ─────────────────────────────────────────────────
  const article = root.querySelector('.scripture');
  try {
    const books = await Promise.all([...new Set(entry.segments.map((s) => s.b))].map(loadBook));
    if (!isCurrent()) return;
    const byCode = new Map(books.map((b) => [b.code, b]));
    const chapters = (segments) => segments.map((s) => renderSegment(s, byCode.get(s.b), verses));
    setHTML(
      article,
      parallel
        ? parts.map(
            (p) => html`<section class="track" id="track-${p.track}">
              <div class="track-head">
                <b>${p.title}</b><span>${formatSegments(p.segments)} · 약 ${readingMinutes(p.chars)}분</span>
              </div>
              ${chapters(p.segments)}
              <div class="track-foot" data-track-foot="${p.track}"></div>
            </section>`,
          )
        : chapters(entry.segments),
    );
    parts.forEach(renderTrackFoot);
    article.removeAttribute('aria-busy');
    track('reading_opened', () => ({ ...readingEventProps(plan, day), already_read: !!dayReadAt() }));
    repaint();
    // 오늘 화면에서 특정 책을 눌러 들어왔으면 그 책 부분으로 내려간다.
    if (focusTrack != null) root.querySelector(`#track-${focusTrack}`)?.scrollIntoView();
  } catch (err) {
    if (!isCurrent()) return;
    track('reading_load_failed', () => ({ books: [...new Set(entry.segments.map((s) => s.b))], online: navigator.onLine }));
    setHTML(
      article,
      html`<p class="error">${err.message}</p>
        <p class="muted">인터넷에 연결되어 있지 않다면, 설정에서 성경 전체를 미리 저장해 두면 오프라인에서도 읽을 수 있습니다.</p>`,
    );
  }
}

/** 한 구간의 본문. 각 절을 verses(키 → 절 정보)에도 담는다. */
function renderSegment(seg, bookData, verses) {
  const ch = bookData.chapters[seg.c - 1];
  const inRange = (v) => seg.from == null || (v >= seg.from && v <= seg.to);
  const list = ch.verses.filter((v) => inRange(v.v));
  const whole = seg.from == null;
  const unit = chapterUnit(seg.b);
  const last = list.at(-1);
  const heading = whole
    ? `${book(seg.b).name} ${seg.c}${unit}`
    : `${book(seg.b).name} ${seg.c}${unit} ${list[0].v}–${last.e ?? last.v}절`;
  // 소리로 들을 때 읽는 장 제목 ("–"를 읽지 않도록 따로 만든다)
  const speak = whole ? heading : `${book(seg.b).name} ${seg.c}${unit} ${list[0].v}절부터`;

  // 단락 제목·시편 표제는 해당 절 앞에서 문단을 새로 시작한다.
  const headsAt = new Map();
  for (const h of ch.heads) {
    if (!inRange(h.v)) continue;
    if (!headsAt.has(h.v)) headsAt.set(h.v, []);
    headsAt.get(h.v).push(h);
  }
  const poetry = POETRY.has(seg.b);
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length) blocks.push(html`<p class="${poetry ? 'poetry' : 'prose'}">${current}</p>`);
    current = [];
  };
  for (const v of list) {
    const heads = headsAt.get(v.v);
    if (heads) {
      flush();
      for (const h of heads) {
        blocks.push(h.kind === 'title' ? html`<p class="psalm-title">${h.t}</p>` : html`<h3 class="section">${h.t}</h3>`);
      }
    }
    const key = verseKey(seg.b, seg.c, v.v);
    verses.set(key, { b: seg.b, c: seg.c, v: v.v, e: v.e, t: v.t });
    current.push(
      html`<span class="verse" data-ref="${key}" tabindex="0" role="button" aria-pressed="false"><sup class="vn">${v.e ? `${v.v}-${v.e}` : v.v}</sup>${v.t}<span class="vcount"></span></span> `,
    );
  }
  flush();

  const notes = ch.notes.filter((n) => (n.v === 0 ? whole || seg.from === ch.verses[0].v : inRange(n.v)));
  return html`<section class="chapter">
    <h2 class="chapter-title" data-speak="${speak}">${heading}</h2>
    ${blocks}
    ${notes.length
      ? html`<details class="notes">
          <summary>각주 ${notes.length}개</summary>
          <ol>${notes.map((n) => html`<li><b>${n.v === 0 ? '제목' : `${n.v}절`}</b> ${n.t}</li>`)}</ol>
        </details>`
      : ''}
  </section>`;
}
