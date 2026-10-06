import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChapter, cleanText, verseWeight } from '../scripts/lib/parse.mjs';

// bskorea.or.kr 장 페이지 구조를 흉내 낸 합성 HTML (실제 본문 아님)
const note = (id, n) =>
  `<font size=2><a class=comment href="#" onClick="return clickPopUp('${id}', event)" ><font size=2>${n})</font></a></font>`;
const noteBody = (id, text) =>
  `<div id='${id}' class=D2  onclick="popDown2('${id}')" style='display:none;z-index:100' >${text}</div>`;

const HTML = `id="tdBible1" class="bible_read">
  <div style='text-align:right'><a href="#none" id="voice1"><img src="btn_listen.png" /></a></div>
  <b>새번역</b><br/><font class="chapNum">제 3 편</font>${note('D_1_1', 1)}<br /><br />
  <font class="smallTitle">첫 단락</font><br /><H VAL=1.1><font class="name">가나다</font>의 노래</font><br /><br />
  <span style="color:#376BCB;"><span class="number">1&nbsp;&nbsp;&nbsp;</span>첫째 절, <font class="name">라마</font>에서 ${note('D_2_1', 2)}&quot;말&quot;하였다.
  ${noteBody('D_1_1', "장 제목 각주 $히브리$어 ( )")}${noteBody('D_2_1', "또는 '다른 말'")}</font></span><br />
  <span><span class="number">2&nbsp;&nbsp;&nbsp;</span><font size='1'></font>둘째  절  </font></span><br /><br />
  <font class="smallTitle">둘째 단락(마 1:1-2 ; 막 2:3)</font><br /><br />
  <span><span class="number">3-4&nbsp;&nbsp;&nbsp;</span>묶인 절</font></span><br />
  <span><span class="number">6&nbsp;&nbsp;&nbsp;</span>5절이 빠진 다음 절</font></span>
</div>`;

test('절, 묶인 절, 빠진 절 번호를 읽는다', () => {
  const { verses } = parseChapter(HTML);
  assert.deepEqual(
    verses.map((v) => [v.v, v.e]),
    [
      [1, undefined],
      [2, undefined],
      [3, 4],
      [6, undefined],
    ],
  );
  assert.equal(verses[0].t, '첫째 절, 라마에서 "말"하였다.');
  assert.equal(verses[1].t, '둘째 절');
});

test('단락 제목과 시편 표제를 해당 절 앞에 붙인다', () => {
  const { heads } = parseChapter(HTML);
  assert.deepEqual(heads, [
    { v: 1, kind: 'section', t: '첫 단락' },
    { v: 1, kind: 'title', t: '가나다의 노래' },
    { v: 3, kind: 'section', t: '둘째 단락(마 1:1-2 ; 막 2:3)' },
  ]);
});

test('각주를 본문에서 떼어 절 번호와 함께 모은다', () => {
  const { notes, verses } = parseChapter(HTML);
  assert.deepEqual(notes, [
    { v: 0, n: '1', t: '장 제목 각주 히브리어' },
    { v: 1, n: '2', t: "또는 '다른 말'" },
  ]);
  assert.ok(verses.every((v) => !/\d\)|D_/.test(v.t)));
});

test('cleanText와 verseWeight', () => {
  assert.equal(cleanText('<font class="name">예수</font>께서&nbsp;말씀하셨다<br/>그리고'), '예수께서 말씀하셨다 그리고');
  assert.equal(verseWeight('가 나 다'), 3);
});
