// 묵상 메모·저장한 구절 내보내기: 지금 계정의 메모와 구절을 글(텍스트 파일, 다른 앱으로 보내기)이나
// 인쇄용 화면(브라우저의 "PDF로 저장")으로 만든다. 창은 views/exportsheet.js.
// 묵상 메모는 쓴 날 순서(오래된 것부터, 일기처럼), 저장한 구절은 성경 순서로 적는다.
// 이 모듈은 Node 테스트에서도 import되므로 최상위에서 window/document를 직접 쓰지 않는다.

import { book } from './bible.js';
import { formatDate, formatDay, toISO, today } from './dates.js';
import { currentAccount, listAccounts, listNotes, listSavedVerses, verseKey, verseNotes } from './db.js';
import { html } from './ui.js';

const verseRef = (x) => `${book(x.b).name} ${x.c}:${x.v}${x.e ? `-${x.e}` : ''}`;

/** 지금 계정에서 내보낼 수 있는 것의 개수 {notes, saved} */
export function exportCounts() {
  return { notes: listNotes().length, saved: listSavedVerses().length };
}

/**
 * 내보낼 내용 → {title, account, sections: [{title, entries: [{head, verse?, note?, noteLabel?}]}], hasVerses}
 * account는 계정이 둘 이상일 때만 지금 계정 이름 (파일은 기기에만 저장되거나 사용자가 직접 보낸다)
 */
export function exportSections({ notes = true, saved = true } = {}) {
  const sections = [];
  if (notes) {
    const when = (n) => (n.kind === 'day' ? toISO(n.date) : n.updatedAt);
    const list = listNotes().sort((a, b) => when(a).localeCompare(when(b)));
    sections.push({
      title: `묵상 메모 (${list.length}개)`,
      entries: list.map((n) =>
        n.kind === 'day'
          ? { head: `${n.date.y}년 ${formatDay(n.date.y, n.date.m, n.date.d)}${n.passage ? ` · ${n.passage}` : ''}`, note: n.text }
          : { head: `${verseRef(n)} · 구절 메모`, verse: n.verseText, note: n.text, noteLabel: '메모' },
      ),
    });
  }
  if (saved) {
    const memos = verseNotes();
    const list = listSavedVerses().sort((a, b) => book(a.b).order - book(b.b).order || a.c - b.c || a.v - b.v);
    sections.push({
      title: `저장한 구절 (${list.length}구절)`,
      entries: list.map((x) => ({
        head: `${verseRef(x)}${x.times > 1 ? ` · ${x.times}번 저장` : ''}`,
        verse: x.t,
        note: memos.get(verseKey(x.b, x.c, x.v))?.text ?? null,
        noteLabel: '메모',
      })),
    });
  }
  return {
    title: notes && saved ? '묵상 메모와 저장한 구절' : notes ? '묵상 메모' : '저장한 구절',
    account: listAccounts().length > 1 ? currentAccount().name : null,
    sections,
    hasVerses: sections.some((s) => s.entries.some((e) => e.verse)),
  };
}

const COPYRIGHT = '성경 본문: 새번역·개역개정 © 대한성서공회 · BSB(Berean Standard Bible)는 퍼블릭 도메인';

const metaLine = (data, now) => `${data.account ? `${data.account} · ` : ''}${formatDate(now, { year: true })}에 내보냄`;

/** 텍스트 파일 내용 */
export function exportText(opts = {}, now = today()) {
  const data = exportSections(opts);
  const lines = [`맛있는만나 · ${data.title}`, metaLine(data, now)];
  for (const section of data.sections) {
    lines.push('', '', `■ ${section.title}`);
    for (const e of section.entries) {
      lines.push('', e.head);
      if (e.verse) lines.push(e.verse);
      if (e.note) lines.push(e.noteLabel ? `${e.noteLabel}: ${e.note}` : e.note);
    }
  }
  if (data.hasVerses) lines.push('', '', COPYRIGHT);
  return `${lines.join('\n')}\n`;
}

/** 인쇄용 화면(#print-root)의 HTML. 꾸밈은 app.css의 @media print */
export function exportHtml(opts = {}, now = today()) {
  const data = exportSections(opts);
  return html`<h1>${data.title}</h1>
    <p class="px-meta">맛있는만나 · ${metaLine(data, now)}</p>
    ${data.sections.map(
      (section) => html`<section class="px-section">
        <h2>${section.title}</h2>
        ${section.entries.map(
          (e) => html`<article class="px-entry">
            <h3>${e.head}</h3>
            ${e.verse ? html`<p class="px-verse">${e.verse}</p>` : ''}
            ${e.note ? html`<p class="px-note">${e.noteLabel ? html`<b>${e.noteLabel}</b>` : ''}${e.note}</p>` : ''}
          </article>`,
        )}
      </section>`,
    )}
    ${data.hasVerses ? html`<p class="px-foot">${COPYRIGHT}</p>` : ''}`;
}

/** 파일 이름: 맛있는만나-묵상메모-2026-10-17.txt */
export function exportFileName({ notes = true, saved = true } = {}, now = today()) {
  const what = notes && saved ? '묵상메모와구절' : notes ? '묵상메모' : '저장한구절';
  return `맛있는만나-${what}-${toISO(now)}.txt`;
}
