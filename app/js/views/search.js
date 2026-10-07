// 말씀 검색 화면: 새번역 전체에서 낱말로 찾고, 결과에서 바로 저장·공유한다.

import { allBooks, book, loadBook } from '../bible.js';
import { listSavedVerses, saveVerseToday, verseKey } from '../db.js';
import { esc, html, raw, setHTML, toast } from '../ui.js';
import { bookmarkIcon, shareIcon, shareVerses } from './common.js';
import { verseHead, verseRef } from './saved.js';
import { track } from '../analytics.js';

const PAGE = 50;

// 검색할 본문: 처음 검색할 때 66권을 모두 불러 절 목록 하나로 펼쳐 둔다.
// (서비스 워커가 책을 캐시하므로 다음부터는 오프라인에서도 바로 찾는다)
let corpus = null; // [{b, c, v, e, t}]
let loading = null;

function loadCorpus(onProgress) {
  if (corpus) return Promise.resolve(corpus);
  loading ??= (async () => {
    const books = allBooks();
    let done = 0;
    const data = await Promise.all(
      books.map((b) =>
        loadBook(b.code).then((d) => {
          onProgress(++done, books.length);
          return d;
        }),
      ),
    );
    corpus = data.flatMap((bk) =>
      bk.chapters.flatMap((ch) => ch.verses.map((x) => ({ b: bk.code, c: ch.c, v: x.v, e: x.e, t: x.t }))),
    );
    return corpus;
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

// 화면을 떠났다 돌아와도 검색어와 결과를 유지한다.
const state = { q: '', scope: 'all', shown: PAGE, open: new Set() };
// 사용 통계에 마지막으로 센 검색(범위|낱말). 돌아와서 같은 검색을 다시 그려도 두 번 세지 않는다.
let lastTrackedSearch = '';

const wordsOf = (q) => q.trim().split(/\s+/).filter(Boolean);

/** 낱말이 모두 들어 있는 절의 corpus 위치 목록 */
function find(q, scope) {
  const words = wordsOf(q);
  if (!words.length) return [];
  const inScope =
    scope === 'all'
      ? () => true
      : scope === 'OT' || scope === 'NT'
        ? (x) => book(x.b).testament === scope
        : (x) => x.b === scope;
  const out = [];
  corpus.forEach((x, i) => {
    if (inScope(x) && words.every((w) => x.t.includes(w))) out.push(i);
  });
  return out;
}

/** 찾은 낱말을 <mark>로 감싼 본문 */
function highlight(text, words) {
  const pattern = words
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|');
  let out = '';
  let last = 0;
  for (const m of text.matchAll(new RegExp(pattern, 'g'))) {
    out += `${esc(text.slice(last, m.index))}<mark>${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return raw(out + esc(text.slice(last)));
}

const scopeLabel = (scope) =>
  scope === 'all' ? '성경 전체' : scope === 'OT' ? '구약' : scope === 'NT' ? '신약' : book(scope).name;

export async function searchView(root, _params, { isCurrent }) {
  const books = allBooks();
  setHTML(
    root,
    html`${verseHead('search', '새번역 전체에서 찾기', '말씀 검색')}
      <form class="search-box" role="search">
        <input type="search" name="q" value="${state.q}" placeholder="낱말로 찾기 (예: 목자, 평안)"
          enterkeyhint="search" autocomplete="off" aria-label="찾을 낱말" />
        <button class="btn btn-primary">찾기</button>
        <select name="scope" aria-label="찾을 범위">
          ${[
            ['all', '성경 전체'],
            ['OT', '구약'],
            ['NT', '신약'],
          ].map(([v, label]) => html`<option value="${v}" ${state.scope === v ? 'selected' : ''}>${label}</option>`)}
          ${['OT', 'NT'].map(
            (t) => html`<optgroup label="${t === 'OT' ? '구약' : '신약'}">
              ${books
                .filter((b) => b.testament === t)
                .map((b) => html`<option value="${b.code}" ${state.scope === b.code ? 'selected' : ''}>${b.name}</option>`)}
            </optgroup>`,
          )}
        </select>
      </form>
      <div id="search-out"></div>`,
  );
  const out = root.querySelector('#search-out');
  const form = root.querySelector('.search-box');

  let results = [];
  let counts = new Map();
  const loadCounts = () => {
    counts = new Map(listSavedVerses().map((x) => [verseKey(x.b, x.c, x.v), x.times]));
  };

  const renderResults = () => {
    const words = wordsOf(state.q);
    if (!words.length) {
      setHTML(
        out,
        html`<p class="search-status">찾을 낱말을 입력하세요. 여러 낱말을 띄어 쓰면 모두 들어 있는 절을 찾습니다.
          ${corpus ? '' : html`<br /><small>처음 찾을 때 성경 전체(약 6MB)를 불러옵니다.</small>`}</p>`,
      );
      return;
    }
    const shown = results.slice(0, state.shown);
    setHTML(
      out,
      html`<p class="search-status" role="status">
          <b>‘${state.q.trim()}’</b> ${scopeLabel(state.scope)}에서 ${results.length.toLocaleString('ko-KR')}절
        </p>
        ${results.length
          ? html`<ul class="saved-list search-results">
              ${shown.map((i) => {
                const x = corpus[i];
                const key = verseKey(x.b, x.c, x.v);
                const n = counts.get(key);
                const open = state.open.has(key);
                return html`<li class="saved-item">
                  <div class="saved-head">
                    <b class="saved-ref">${verseRef(x)}</b>
                    ${n ? html`<span class="times is-many" aria-label="${n}번 저장">${n}회</span>` : ''}
                  </div>
                  ${open ? context(i, words) : html`<p class="saved-text">${highlight(x.t, words)}</p>`}
                  <div class="saved-foot">
                    <button class="link" data-context="${key}" aria-expanded="${open}">${open ? '앞뒤 접기' : '앞뒤 보기'}</button>
                    <span class="saved-actions">
                      <button class="link" data-share="${i}">${shareIcon}<span>공유</span></button>
                      <button class="link" data-save="${i}">${bookmarkIcon}<span>저장</span></button>
                    </span>
                  </div>
                </li>`;
              })}
            </ul>
            ${results.length > shown.length
              ? html`<div class="footer-actions">
                  <button class="btn btn-ghost" data-more>더 보기 (${(results.length - shown.length).toLocaleString('ko-KR')}절 남음)</button>
                </div>`
              : ''}`
          : html`<p class="muted search-empty">찾는 낱말이 들어 있는 절이 없습니다. 띄어쓰기를 바꾸거나 더 짧은 낱말로 찾아 보세요.</p>`}`,
    );
  };

  /** 앞뒤 두 절씩 (같은 장 안에서) */
  const context = (i, words) => {
    const x = corpus[i];
    const around = [];
    for (let j = i - 2; j <= i + 2; j++) {
      const y = corpus[j];
      if (y && y.b === x.b && y.c === x.c) around.push([j, y]);
    }
    return html`<div class="search-context">
      ${around.map(
        ([j, y]) => html`<p class="${j === i ? 'is-hit' : ''}"><sup class="vn">${y.e ? `${y.v}-${y.e}` : y.v}</sup>${
          j === i ? highlight(y.t, words) : y.t
        }</p>`,
      )}
    </div>`;
  };

  // 검색 통계: 검색어는 보내지 않고 낱말 수와 결과 수만 보낸다.
  let trackTimer = null;
  const trackSearch = () => {
    clearTimeout(trackTimer);
    const words = wordsOf(state.q);
    const key = `${state.scope}|${words.join(' ')}`;
    if (!words.length || key === lastTrackedSearch) return;
    lastTrackedSearch = key;
    const count = results.length;
    track('search_performed', { scope: state.scope, word_count: words.length, result_count: count, zero_results: count === 0 });
  };

  let seq = 0;
  /** submitted: 찾기를 눌렀으면 바로 세고, 입력 중이면 1.5초 동안 검색어가 그대로일 때 센다 */
  const run = async (submitted = false) => {
    const my = ++seq;
    clearTimeout(trackTimer);
    state.shown = PAGE;
    if (!wordsOf(state.q).length) {
      results = [];
      renderResults();
      return;
    }
    if (!corpus) {
      setHTML(out, html`<p class="search-status" role="status">성경을 불러오는 중…</p>`);
      try {
        await loadCorpus((done, total) => {
          if (my === seq && isCurrent()) {
            setHTML(out, html`<p class="search-status" role="status">성경을 불러오는 중… ${done}/${total}권</p>`);
          }
        });
      } catch (err) {
        if (isCurrent()) {
          setHTML(
            out,
            html`<p class="error">${err.message}</p>
              <p class="muted">인터넷 연결을 확인하거나, 설정에서 성경 전체를 미리 저장해 두세요.</p>`,
          );
        }
        return;
      }
    }
    if (my !== seq || !isCurrent()) return;
    loadCounts();
    results = find(state.q, state.scope);
    renderResults();
    if (submitted) trackSearch();
    else trackTimer = setTimeout(trackSearch, 1500);
  };

  let timer = null;
  root.oninput = (e) => {
    if (e.target.name !== 'q') return;
    state.q = e.target.value;
    clearTimeout(timer);
    clearTimeout(trackTimer);
    timer = setTimeout(run, 300);
  };
  root.onchange = (e) => {
    if (e.target.name !== 'scope') return;
    state.scope = e.target.value;
    run();
  };
  root.onsubmit = (e) => {
    e.preventDefault();
    clearTimeout(timer);
    state.q = form.q.value;
    form.q.blur(); // 휴대폰 키보드를 닫는다
    run(true);
  };
  root.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.form) return; // 폼 안의 '찾기' 버튼은 onsubmit이 처리한다
    const d = btn.dataset;
    if (d.more != null) {
      state.shown += PAGE;
      renderResults();
    } else if (d.context) {
      if (state.open.has(d.context)) state.open.delete(d.context);
      else state.open.add(d.context);
      renderResults();
    } else if (d.share) {
      shareVerses([corpus[Number(d.share)]], 'search');
    } else if (d.save) {
      const x = corpus[Number(d.save)];
      try {
        const added = await saveVerseToday(x);
        if (added) track('verses_saved', { surface: 'search', count: 1 });
        toast(added ? `${verseRef(x)} 구절을 저장했습니다` : '오늘 이미 저장한 구절입니다');
      } catch (err) {
        toast(`저장하지 못했습니다: ${err.message}`);
        return;
      }
      loadCounts();
      renderResults();
    }
  };

  // 돌아왔을 때 이전 검색어가 있으면 다시 찾는다.
  if (wordsOf(state.q).length) run();
  else renderResults();
}
