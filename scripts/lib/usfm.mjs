// USFM(성경 본문 표준 형식) 한 권을 앱의 책 JSON 형식으로 바꾼다. (BSB 변환에 쓴다)
//
//   {code, name, chapters: [{c, verses: [{v, e?, t}], heads: [{v, kind: 'section'|'title', t}], notes: [{v, n, t}]}]}
//
// 단락·시 줄 나눔(\p, \q1 …)은 앱이 절 단위로 보여 주므로 이어 붙이고, 단락 제목(\s1, \s2, \ms, \qa)과
// 시편 표제(\d)는 그다음 절 앞의 제목으로, 각주(\f … \f*)는 그 장의 각주 목록으로 옮긴다.
// 관주(\r, \x)와 글자 꾸밈(\wj 예수님 말씀, \add 등)은 빼고 글자만 남긴다.

const SKIP = new Set(['id', 'ide', 'usfm', 'h', 'toc1', 'toc2', 'toc3', 'mt', 'mt1', 'mt2', 'mt3', 'r', 'rem', 'b']);
const SECTION = new Set(['s', 's1', 's2', 's3', 'ms', 'ms1', 'ms2', 'qa', 'sp']);

/** 각주 하나 "\fr 1:8 \ft 설명 \fqa 낱말\ft …" → {ref, text} */
function parseNote(body) {
  const ref = /\\fr\s+([^\\]*)/.exec(body)?.[1].trim() ?? '';
  const text = cleanInline(body.replace(/^\s*[+-]\s*/, '').replace(/\\fr\s+[^\\]*/, '').replace(/\\fv\s+([^\\]*)\\fv\*/g, '($1) '));
  return { ref, text };
}

/** 글자 꾸밈 표지를 빼고 글자만. "\ref 보이는 글|대상\ref*"는 보이는 글만 남긴다. */
function cleanInline(s) {
  return s
    .replace(/\\x\s.*?\\x\*/g, '')
    .replace(/\\ref\s+([^|\\]*)(?:\|[^\\]*)?\\ref\*/g, '$1')
    .replace(/\\\+?[a-z]+\d*\*/g, '')
    .replace(/\\\+?[a-z]+\d*\s?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text USFM 파일 내용
 * @param {string} code 앱의 책 코드 ('gen' 등)
 */
export function parseUsfm(text, code) {
  const book = { code, name: '', chapters: [] };
  let ch = null;
  let verse = null;
  let pending = []; // 다음 절 앞에 붙일 제목 [{kind, t, tag}]
  let noteNo = 0;

  const startVerse = (v, e) => {
    verse = { v: Number(v), ...(e ? { e: Number(e) } : {}), t: '' };
    ch.verses.push(verse);
    for (const h of pending) ch.heads.push({ v: verse.v, kind: h.kind, t: h.t });
    pending = [];
  };

  /** 각주를 떼어 내 그 장의 각주로 옮긴 본문 */
  const takeNotes = (s) =>
    s.replace(/\\f\s(.*?)\\f\*/g, (_, body) => {
      const { ref, text: t } = parseNote(body);
      const m = /:(\d+)/.exec(ref);
      if (t && ch) ch.notes.push({ v: m ? Number(m[1]) : (verse?.v ?? 0), n: String(++noteNo), t });
      return '';
    });

  /** 단락 안의 글. \v가 나오면 새 절을 시작하고, 그 앞의 글은 지금 절에 이어 붙인다. */
  const addText = (s) => {
    const parts = takeNotes(s).split(/\\v\s+(\d+)(?:-(\d+))?\s?/);
    for (let i = 0; i < parts.length; i += 3) {
      if (i > 0) startVerse(parts[i - 2], parts[i - 1]);
      const t = cleanInline(parts[i]);
      if (t && verse) verse.t = verse.t ? `${verse.t} ${t}` : t;
    }
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^\\([a-z]+\d*)\s?(.*)$/.exec(line);
    if (!m) {
      addText(line);
      continue;
    }
    const [, tag, rest] = m;
    if (tag === 'h') book.name = rest.trim();
    if (SKIP.has(tag)) continue;
    if (tag === 'c') {
      ch = { c: Number(rest), verses: [], heads: [], notes: [] };
      book.chapters.push(ch);
      verse = null;
      noteNo = 0;
    } else if (SECTION.has(tag)) {
      const t = cleanInline(takeNotes(rest));
      const last = pending.at(-1);
      // 시편 119편의 "א"와 "ALEPH"처럼 이어진 답관체 제목은 하나로 합친다.
      if (tag === 'qa' && last?.tag === 'qa') last.t += ` ${t}`;
      else if (t) pending.push({ kind: 'section', t, tag });
    } else if (tag === 'd') {
      // 시편 표제. "\d \v 1 다윗의 시"처럼 1절 표지가 함께 오면 표제는 1절 앞에 두고, 1절 본문은 다음 줄부터 이어진다.
      const vm = /^\\v\s+(\d+)(?:-(\d+))?\s?(.*)$/.exec(rest);
      if (vm) {
        startVerse(vm[1], vm[2]);
        const t = cleanInline(takeNotes(vm[3]));
        if (t) ch.heads.push({ v: verse.v, kind: 'title', t });
      } else {
        const t = cleanInline(takeNotes(rest));
        // "\ms BOOK I" 다음의 "\d Psalms 1–41"은 시편 권 구분이라 단락 제목으로 본다.
        if (t) pending.push({ kind: pending.at(-1)?.tag === 'ms' ? 'section' : 'title', t, tag: 'd' });
      }
    } else if (tag === 'mr') {
      // 하박국 3:19 끝의 "For the choirmaster…"처럼 절 뒤에 붙는 표기
      addText(rest);
    } else {
      // \p \m \q1 \q2 \li1 \pmo \pc \qr 등: 줄 나눔만 다르고 모두 본문
      addText(rest);
    }
  }
  return book;
}
