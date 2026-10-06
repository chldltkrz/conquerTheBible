// bskorea.or.kr 새번역 장 페이지(id="tdBible1" 영역)의 HTML을 구조화된 데이터로 바꾼다.
//
// 페이지 구조(요약):
//   <font class="smallTitle">천지창조</font>          단락 제목 → 다음 절 앞에 붙는다
//   <H VAL=1.1>다윗이 ... 지은 시</font><br />         시편 표제 → 다음 절 앞에 붙는다
//   <span><span class="number">1&nbsp;</span>본문 ...</span>
//   <a class=comment onClick="return clickPopUp('D_123_1', event)"><font size=2>1)</font></a>  각주 표시
//   <div id='D_123_1' class=D2 ...>각주 내용</div>
//
// 결과: { verses: [{v, e?, t}], heads: [{v, t, kind}], notes: [{v, n, t}] }
//   verses[].e 는 묶인 절의 끝 번호 ("22-23"이면 v=22, e=23)
//   heads[].v / notes[].v 는 해당 절 번호(v=0이면 장 전체), kind는 'section'(단락 제목) | 'title'(시편 표제)

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", middot: '·' };

export function cleanText(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '') // 인명 표시(<font class="name">) 같은 인라인 태그는 공백 없이 지운다
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(\w+);/g, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\$/g, '') // 사이트가 특수 글꼴 표시에 쓰는 기호
    .replace(/\(\s*\)/g, '') // 히브리 글자처럼 사이트에서 빠진 글자가 남긴 빈 괄호
    .replace(/\s+/g, ' ')
    .trim();
}

/** 읽는 분량의 기준: 공백을 뺀 글자 수 */
export function verseWeight(text) {
  return text.replace(/\s/g, '').length;
}

function takeHeads(html, into) {
  const rest = html
    .replace(/<font class="smallTitle">([\s\S]*?)<\/font>\s*(?=<br|$)/gi, (_, t) => {
      into.push({ kind: 'section', t: cleanText(t) });
      return '';
    })
    .replace(/<H VAL=[^>]*>([\s\S]*?)(?=<br|$)/gi, (_, t) => {
      into.push({ kind: 'title', t: cleanText(t) });
      return '';
    });
  return rest;
}

export function parseChapter(html) {
  // 듣기 버튼, 각주 본문을 먼저 떼어낸다.
  const footnotes = new Map();
  html = html
    .replace(/<div style='text-align:right'>[\s\S]*?<\/div>/i, '')
    .replace(/<div id='(D_[^']+)'[^>]*>([\s\S]*?)<\/div>/gi, (_, id, body) => {
      footnotes.set(id, cleanText(body));
      return '';
    });

  const parts = html.split('<span class="number">');
  const verses = [];
  const heads = [];
  const notes = [];

  // 각주 표시를 꺼내 notes에 담고 본문에서는 지운다.
  const takeNotes = (chunk, v) =>
    chunk.replace(/<a class=comment[^>]*clickPopUp\('(D_[^']+)'[^>]*>([\s\S]*?)<\/a>/gi, (_, id, label) => {
      const t = footnotes.get(id);
      if (t) notes.push({ v, n: cleanText(label).replace(/\)$/, ''), t });
      return '';
    });

  // 첫 절 앞부분: 장 제목에 달린 각주는 v=0(장 전체)으로 둔다.
  let pending = [];
  takeHeads(takeNotes(parts[0], 0), pending);

  for (const part of parts.slice(1)) {
    // 두 절 이상을 묶어 번역한 곳은 "22-23"처럼 표시된다.
    const m = /^\s*(\d+)(?:\s*-\s*(\d+))?/.exec(part);
    if (!m) throw new Error(`절 번호를 읽을 수 없음: ${part.slice(0, 60)}`);
    const v = Number(m[1]);
    const e = m[2] ? Number(m[2]) : undefined;
    let body = part.slice(part.indexOf('</span>') + '</span>'.length);

    for (const h of pending) heads.push({ v, ...h });
    pending = [];

    body = takeNotes(body, v);

    // 이 절 뒤에 나오는 제목은 다음 절의 것이다.
    body = takeHeads(body, pending);
    verses.push(e ? { v, e, t: cleanText(body) } : { v, t: cleanText(body) });
  }

  return { verses, heads, notes };
}
