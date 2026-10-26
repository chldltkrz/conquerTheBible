// 사용설명서 화면 사진에 쓰는 예시 기록. 앱의 db.js로 만들어 .sqlite 바이트로 돌려준다(앱의 "가져오기"와 같은 형식).
// 오늘은 2026년 10월 17일(토)로 정해 둔다(scripts/manual.mjs가 브라우저의 시각도 이 날로 맞춘다).
// 기록마다 그때 한 것처럼 시각을 맞추려고 Date를 잠시 바꿔 가며 만든다. TZ=Asia/Seoul에서 불러야 한다.

import fs from 'node:fs';
import { buildGroupPlan, buildParallelPlan, buildPlan } from '../../app/js/planner.js';
import { describeSelection, formatSegments, getIndex, selectionToChapters, useIndex } from '../../app/js/bible.js';
import {
  createAccount,
  exportFile,
  renameAccount,
  listPlans,
  saveDayNote,
  savePlan,
  saveVerseNote,
  saveVerses,
  saveVerseToday,
  saveYearVerse,
  setRead,
  switchAccount,
  useMemoryDatabase,
} from '../../app/js/db.js';

export const TODAY = { y: 2026, m: 10, d: 17 };
export const NOW_ISO = '2026-10-17T08:40:00+09:00';

const ROOT = new URL('../../', import.meta.url).pathname;
const books = new Map();
const bookData = (b) => {
  if (!books.has(b)) books.set(b, JSON.parse(fs.readFileSync(`${ROOT}app/data/books/${b}.json`, 'utf8')));
  return books.get(b);
};
const verse = (b, c, v) => ({ b, c, v, t: bookData(b).chapters[c - 1].verses.find((x) => x.v === v).t });

/** 그때 한 일처럼: fn 안에서 new Date()가 iso를 가리킨다 */
async function at(iso, fn) {
  const Real = Date;
  class Fake extends Real {
    constructor(...args) {
      if (args.length) super(...args);
      else super(iso);
    }
    static now() {
      return new Real(iso).getTime();
    }
  }
  globalThis.Date = Fake;
  try {
    return await fn();
  } finally {
    globalThis.Date = Real;
  }
}

const day = (d, time = '07:30') => `2026-10-${String(d).padStart(2, '0')}T${time}:00+09:00`;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const chaptersOf = (code) => range(1, getIndex().books.find((b) => b.code === code).chapters.length);

async function monthPlan(selection, mode, { title, groups } = {}) {
  const start = { y: 2026, m: 10, d: 1 };
  const end = { y: 2026, m: 10, d: 31 };
  const index = getIndex();
  const chapters = selectionToChapters(selection);
  let tracks;
  if (mode === 'sequential') tracks = [{ title: title ?? describeSelection(selection), days: buildPlan(index, chapters, 31) }];
  else if (mode === 'parallel') {
    tracks = buildParallelPlan(index, chapters, 31).map((t) => ({ title: index.books.find((b) => b.code === t.b).name, days: t.days }));
  } else {
    const plans = buildGroupPlan(index, groups.map((g) => selectionToChapters(g.selection)), 31);
    tracks = plans.map((days, i) => ({ title: groups[i].title, days }));
  }
  await at(day(1, '06:50'), () =>
    savePlan({ start, end, title: title ?? describeSelection(selection), selection, splitChapters: true, mode, tracks }),
  );
  return { id: listPlans().find((p) => p.start.m === 10).id, tracks };
}

/** 그 절을 읽는 날(1부터) */
function dayOf(tracks, b, c, v) {
  const i = tracks[0].days.findIndex((d) =>
    d.segments.some((s) => s.b === b && s.c === c && (s.from ?? 1) <= v && (s.to ?? Infinity) >= v),
  );
  if (i < 0) throw new Error(`계획에 없는 절: ${b} ${c}:${v}`);
  return i + 1;
}

/**
 * kind: 'fresh' (처음 연 앱: 아무 기록 없음) | 'main' (계정 셋, 계획·읽음·구절·메모)
 * SQL: sql.js, index: app/data/index.json
 */
export async function buildDemo(SQL, index, kind = 'main') {
  useIndex(index);
  useMemoryDatabase(new SQL.Database(), SQL);
  // 처음 연 앱의 기본 계정은 "기쁜 수달" 같은 무작위 이름이다. 화면 사진이 늘 같도록 정해 둔다.
  // 계정 셋인 예시 기록은 오래 써 온 기록이라 예전 기본 이름 '나'를 그대로 쓴다.
  await renameAccount(1, kind === 'fresh' ? '기쁜 수달' : '나');
  if (kind === 'fresh') return exportFile();

  // ── 나: 사복음서 한 달. 8·9일은 밀렸고, 10일부터 어제(16일)까지 이어 읽었다(연속 7일). 오늘은 아직.
  const gospels = { mat: chaptersOf('mat'), mrk: chaptersOf('mrk'), luk: chaptersOf('luk'), jhn: chaptersOf('jhn') };
  const { id: me, tracks } = await monthPlan(gospels, 'sequential', { title: '사복음서 한 달 통독' });
  for (const d of range(1, 16).filter((d) => d !== 8 && d !== 9)) await at(day(d, d % 3 ? '07:20' : '21:40'), () => setRead(me, d, true));
  // 읽은 날 본문에서 저장한 구절. extra: 그 뒤 다른 날 검색 등에서 또 저장한 날들 (저장 횟수)
  const saves = [
    [verse('mat', 5, 3), [11, 15]],
    [verse('mat', 11, 28), [13]],
    [verse('mrk', 10, 45), []],
    [verse('luk', 6, 38), []],
    [verse('luk', 7, 47), []],
    [verse('luk', 15, 20), []],
    [verse('jhn', 3, 16), [16]],
    [verse('jhn', 15, 5), []],
  ];
  for (const [v, extra] of saves) {
    const d = dayOf(tracks, v.b, v.c, v.v);
    if (d <= 16) await at(day(d, '07:35'), () => saveVerses(me, d, [v]));
    for (const e of extra) await at(day(e, '21:10'), () => saveVerseToday(v));
  }
  const passage = (d) => formatSegments(tracks[0].days[d - 1].segments);
  const notes = [
    [3, '22:10', '"수고하며 무거운 짐을 진 사람은 모두 내게로 오너라." 쉼을 주시겠다는 약속을 붙든다.'],
    [14, '07:50', '빈 무덤 앞의 여인들. 두려움 속에서도 먼저 달려간 발걸음을 묵상했다.'],
    [16, '07:45', '"깊은 데로 저어 나가서, 그물을 내려라." 밤새 허탕 친 그 자리에서 다시 한번.'],
  ];
  for (const [d, time, text] of notes) await at(day(d, time), () => saveDayNote({ y: 2026, m: 10, d }, passage(d), text));
  await at(day(15, '21:12'), () => saveVerseNote('mat', 5, 3, '가난한 마음이 복이라는 말씀을 오래 붙들고 싶다.'));
  await at(day(16, '07:46'), () => saveVerseNote('luk', 6, 38, '주는 만큼 넘치도록. 오늘 먼저 나누자.'));
  const yv = verse('php', 4, 13);
  await at(day(1, '06:45'), () => saveYearVerse({ year: 2026, text: yv.t, ref: '빌립보서 4:13', b: 'php', c: 4, v: 13 }));

  // ── 엄마: 여러 권 동시에 (창세기·출애굽기·레위기). 오늘은 창세기만 읽었다.
  const mom = await at(day(1, '06:40'), () => createAccount('엄마'));
  await switchAccount(mom);
  const torah = { gen: chaptersOf('gen'), exo: chaptersOf('exo'), lev: chaptersOf('lev') };
  const { id: momPlan } = await monthPlan(torah, 'parallel', { title: '모세오경 함께 읽기' });
  for (const d of range(1, 16)) await at(day(d, '06:10'), () => setRead(momPlan, d, true));
  await at(day(17, '06:15'), () => setRead(momPlan, 17, true, 0));

  // ── 하은: 그룹별로 동시에 (신약 + 시편). 오늘까지 다 읽었다.
  const kid = await at(day(1, '06:41'), () => createAccount('하은'));
  await switchAccount(kid);
  const nt = Object.fromEntries(
    ['mat', 'mrk', 'luk', 'jhn', 'act', 'rom', '1co', '2co', 'gal', 'eph', 'php', 'col'].map((b) => [b, chaptersOf(b)]),
  );
  const { id: kidPlan } = await monthPlan({ ...nt, psa: range(1, 31) }, 'group', {
    title: '신약과 시편',
    groups: [
      { title: '신약', selection: nt },
      { title: '시편', selection: { psa: range(1, 31) } },
    ],
  });
  for (const d of range(1, 17)) await at(day(d, '20:30'), () => setRead(kidPlan, d, true));

  await switchAccount(1);
  // 기본 계정 '나'는 처음 열 때 지금 시각으로 만들어져 맨 뒤에 놓인다. 가장 먼저 만든 계정으로 돌려놓는다.
  const out = new SQL.Database(exportFile());
  out.run("UPDATE accounts SET created_at = '2026-09-28 21:00:00' WHERE id = 1");
  const bytes = out.export();
  out.close();
  return bytes;
}
