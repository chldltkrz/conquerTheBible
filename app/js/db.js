// 읽기 계획과 기록 저장소: 브라우저 안에서 도는 SQLite(sql.js).
// 데이터베이스 파일 전체를 IndexedDB에 보관하고, 바뀔 때마다 다시 저장한다.
// 계획·읽음 기록·저장한 구절은 계정마다 따로 두고, 화면 설정은 기기 공통이다.
/* global initSqlJs */

import { addDays, daysBetween, fromISO, localTimestamp, toISO } from './dates.js';

const IDB_NAME = 'conquer-the-bible';
const IDB_STORE = 'files';
const IDB_KEY = 'records.sqlite';

export const ACCOUNT_COLORS = ['#2f6a55', '#3b64b0', '#b0532a', '#7a4fa3', '#a3476b', '#2f7f8f', '#8a6d1f'];

// 스키마 버전별 변경. PRAGMA user_version에 적용된 개수를 기록한다.
export const MIGRATIONS = [
  // v1: 계획, 날짜별 분량, 읽음 기록, 설정
  `
  CREATE TABLE plans (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    year           INTEGER NOT NULL,
    month          INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    title          TEXT    NOT NULL,
    selection      TEXT    NOT NULL,           -- 선택한 장 JSON: {"gen":[1,2,...], ...}
    split_chapters INTEGER NOT NULL DEFAULT 1, -- 0이면 장 중간에서 나누지 않음
    total_chars    INTEGER NOT NULL,
    created_at     TEXT    NOT NULL,
    UNIQUE (year, month)
  );
  CREATE TABLE plan_days (
    plan_id  INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    day      INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
    segments TEXT    NOT NULL,                 -- 그날 읽을 범위 JSON: [{"b":"gen","c":1,"from":1,"to":20}, ...]
    chars    INTEGER NOT NULL,
    PRIMARY KEY (plan_id, day)
  );
  CREATE TABLE readings (
    plan_id INTEGER NOT NULL,
    day     INTEGER NOT NULL,
    read_at TEXT    NOT NULL,                  -- 읽음 표시한 현지 시각
    PRIMARY KEY (plan_id, day),
    FOREIGN KEY (plan_id, day) REFERENCES plan_days(plan_id, day) ON DELETE CASCADE
  );
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2: 계정, 저장한 구절. 기존 계획은 기본 계정 '나'로 옮긴다.
  `
  CREATE TABLE accounts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  INSERT INTO accounts (id, name, color, created_at)
  VALUES (1, '나', '${ACCOUNT_COLORS[0]}', datetime('now', 'localtime'));

  CREATE TABLE plans_v2 (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    year           INTEGER NOT NULL,
    month          INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    title          TEXT    NOT NULL,
    selection      TEXT    NOT NULL,
    split_chapters INTEGER NOT NULL DEFAULT 1,
    total_chars    INTEGER NOT NULL,
    created_at     TEXT    NOT NULL,
    UNIQUE (account_id, year, month)           -- 계정마다 한 달에 계획 하나
  );
  INSERT INTO plans_v2 (id, account_id, year, month, title, selection, split_chapters, total_chars, created_at)
  SELECT id, 1, year, month, title, selection, split_chapters, total_chars, created_at FROM plans;
  DROP TABLE plans;
  ALTER TABLE plans_v2 RENAME TO plans;

  CREATE TABLE saved_verses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    book       TEXT    NOT NULL,
    chapter    INTEGER NOT NULL,
    verse      INTEGER NOT NULL,
    verse_end  INTEGER,                        -- 묶인 절(예: 30-32)의 끝 번호
    text       TEXT    NOT NULL,               -- 저장할 때의 본문
    plan_id    INTEGER REFERENCES plans(id) ON DELETE SET NULL, -- 어느 날 읽다가 저장했는지
    day        INTEGER,
    saved_at   TEXT    NOT NULL,
    UNIQUE (account_id, plan_id, day, book, chapter, verse) -- 같은 날 같은 절은 한 번만
  );
  CREATE INDEX saved_verses_by_verse ON saved_verses (account_id, book, chapter, verse);
  `,
  // v3: 병렬 읽기. 계획 안에 묶음(track)을 두고 묶음마다 따로 나누고 따로 읽음 표시한다.
  //     이어서 읽기 계획은 묶음이 하나(track 0)뿐인 계획이다.
  `
  ALTER TABLE plans ADD COLUMN mode TEXT NOT NULL DEFAULT 'sequential'; -- 'sequential' | 'parallel'

  CREATE TABLE plan_tracks (
    plan_id     INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    track       INTEGER NOT NULL,
    title       TEXT    NOT NULL,              -- 병렬 읽기에서는 책 이름
    total_chars INTEGER NOT NULL,
    PRIMARY KEY (plan_id, track)
  );
  INSERT INTO plan_tracks (plan_id, track, title, total_chars) SELECT id, 0, title, total_chars FROM plans;

  CREATE TABLE plan_days_v3 (
    plan_id  INTEGER NOT NULL,
    track    INTEGER NOT NULL,
    day      INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
    segments TEXT    NOT NULL,
    chars    INTEGER NOT NULL,
    PRIMARY KEY (plan_id, track, day),
    FOREIGN KEY (plan_id, track) REFERENCES plan_tracks(plan_id, track) ON DELETE CASCADE
  );
  INSERT INTO plan_days_v3 (plan_id, track, day, segments, chars) SELECT plan_id, 0, day, segments, chars FROM plan_days;

  CREATE TABLE readings_v3 (
    plan_id INTEGER NOT NULL,
    track   INTEGER NOT NULL,
    day     INTEGER NOT NULL,
    read_at TEXT    NOT NULL,
    PRIMARY KEY (plan_id, track, day),
    FOREIGN KEY (plan_id, track, day) REFERENCES plan_days(plan_id, track, day) ON DELETE CASCADE
  );
  INSERT INTO readings_v3 (plan_id, track, day, read_at) SELECT plan_id, 0, day, read_at FROM readings;

  DROP TABLE readings;
  DROP TABLE plan_days;
  ALTER TABLE plan_days_v3 RENAME TO plan_days;
  ALTER TABLE readings_v3 RENAME TO readings;
  `,
  // v4: 계획 기간을 달 대신 시작일·마지막 날로 정한다. day는 시작일부터 센 번호(1부터)라서
  //     달 계획은 지금처럼 그 달의 날짜와 같다. 한 계정 안에서 기간이 겹치지 않게 하는 것은 savePlan이 맡는다.
  `
  CREATE TABLE plans_v4 (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    start_date     TEXT    NOT NULL,           -- 첫날(day 1) 'YYYY-MM-DD'
    end_date       TEXT    NOT NULL,           -- 마지막 날 (포함)
    title          TEXT    NOT NULL,
    mode           TEXT    NOT NULL DEFAULT 'sequential',
    selection      TEXT    NOT NULL,
    split_chapters INTEGER NOT NULL DEFAULT 1,
    total_chars    INTEGER NOT NULL,
    created_at     TEXT    NOT NULL,
    CHECK (end_date >= start_date)
  );
  INSERT INTO plans_v4 (id, account_id, start_date, end_date, title, mode, selection, split_chapters, total_chars, created_at)
  SELECT id, account_id, printf('%04d-%02d-01', year, month), date(printf('%04d-%02d-01', year, month), '+1 month', '-1 day'),
         title, mode, selection, split_chapters, total_chars, created_at
    FROM plans;
  DROP TABLE plans;
  ALTER TABLE plans_v4 RENAME TO plans;
  CREATE INDEX plans_by_start ON plans (account_id, start_date);

  CREATE TABLE plan_days_v4 (
    plan_id  INTEGER NOT NULL,
    track    INTEGER NOT NULL,
    day      INTEGER NOT NULL CHECK (day >= 1), -- 시작일부터 센 번호
    segments TEXT    NOT NULL,
    chars    INTEGER NOT NULL,
    PRIMARY KEY (plan_id, track, day),
    FOREIGN KEY (plan_id, track) REFERENCES plan_tracks(plan_id, track) ON DELETE CASCADE
  );
  INSERT INTO plan_days_v4 (plan_id, track, day, segments, chars) SELECT plan_id, track, day, segments, chars FROM plan_days;
  DROP TABLE plan_days;
  ALTER TABLE plan_days_v4 RENAME TO plan_days;
  `,
  // v5: 밀린 분량 다시 나누기, 묵상 메모
  `
  -- 1이면 다시 나누기로 이 날의 분량을 뒤로 옮겨 비운 날 (쉬는 날과 달리 연속 읽기가 끊긴다)
  ALTER TABLE plan_days ADD COLUMN moved INTEGER NOT NULL DEFAULT 0;

  -- 그날 읽은 분량에 남긴 묵상 메모. 계획을 다시 만들어도 남도록 계획이 아니라 날짜에 단다.
  CREATE TABLE day_notes (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date       TEXT    NOT NULL,               -- 'YYYY-MM-DD'
    passage    TEXT    NOT NULL,               -- 메모를 쓸 때 그날 읽은 범위 ("창세기 1–3장")
    text       TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    PRIMARY KEY (account_id, date)
  );

  -- 저장한 구절에 남긴 메모 (절마다 하나)
  CREATE TABLE verse_notes (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    book       TEXT    NOT NULL,
    chapter    INTEGER NOT NULL,
    verse      INTEGER NOT NULL,
    text       TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    PRIMARY KEY (account_id, book, chapter, verse)
  );
  `,
];

/** 한 계획의 최대 기간 (1년 1독 계획까지) */
export const MAX_PLAN_DAYS = 366;

// 날짜별 상태: 분량이 있는 묶음 수(parts)와 그중 읽은 수(done). 둘이 같으면 그날을 다 읽은 것이다.
const DAY_STATUS = `
  day_status AS (
    SELECT d.plan_id, d.day, COUNT(*) AS parts, COUNT(r.read_at) AS done
      FROM plan_days d
      LEFT JOIN readings r ON r.plan_id = d.plan_id AND r.track = d.track AND r.day = d.day
     WHERE d.segments <> '[]'
     GROUP BY d.plan_id, d.day
  )`;

let SQL = null;
let db = null;
let saving = Promise.resolve();
let accountId = null;

// ── IndexedDB ──────────────────────────────────────────────

let idbPromise = null;
function openIdb() {
  idbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idbPromise;
}

async function idb(mode, fn) {
  const conn = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(IDB_STORE, mode);
    const req = fn(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// ── SQLite ─────────────────────────────────────────────────

/** 밀린 마이그레이션을 적용한다. 하나라도 적용했으면 true. (테스트에서도 쓴다) */
export function migrate(target) {
  const version = target.exec('PRAGMA user_version')[0].values[0][0];
  // 테이블을 다시 만드는 동안 연쇄 삭제가 일어나지 않도록 외래 키 검사를 끈다. (트랜잭션 밖에서만 바꿀 수 있다)
  target.exec('PRAGMA foreign_keys = OFF');
  for (let v = version; v < MIGRATIONS.length; v++) {
    target.exec('BEGIN');
    try {
      target.exec(MIGRATIONS[v]);
      if (target.exec('PRAGMA foreign_key_check').length) throw new Error('외래 키가 맞지 않습니다');
      target.exec(`PRAGMA user_version = ${v + 1}`);
      target.exec('COMMIT');
    } catch (err) {
      target.exec('ROLLBACK');
      throw err;
    }
  }
  target.exec('PRAGMA foreign_keys = ON');
  return version < MIGRATIONS.length;
}

export async function openDatabase() {
  SQL = await initSqlJs({ locateFile: (file) => `vendor/${file}` });
  const bytes = await idb('readonly', (s) => s.get(IDB_KEY));
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  const migrated = migrate(db);
  loadCurrentAccount();
  if (migrated) await persist();
}

let memoryOnly = false;

/** 테스트용: IndexedDB 없이 주어진 sql.js 데이터베이스를 그대로 쓴다. (저장하지 않는다) */
export function useMemoryDatabase(database) {
  memoryOnly = true;
  db = database;
  migrate(db);
  loadCurrentAccount();
}

/** 현재 데이터베이스 파일 바이트 */
export function exportFile() {
  const data = db.export();
  // sql.js의 export()는 연결을 닫았다 다시 열기 때문에 연결 단위 설정을 다시 켠다.
  db.exec('PRAGMA foreign_keys = ON');
  return data;
}

function persist() {
  if (memoryOnly) return Promise.resolve();
  const data = exportFile();
  saving = saving.catch(() => {}).then(() => idb('readwrite', (s) => s.put(data, IDB_KEY)));
  return saving;
}

function all(sql, params = {}) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

const one = (sql, params) => all(sql, params)[0] ?? null;
const lastId = () => db.exec('SELECT last_insert_rowid()')[0].values[0][0];

/** 트랜잭션으로 묶어 실행하고 IndexedDB에 저장한다. */
async function write(fn) {
  db.exec('BEGIN');
  let result;
  try {
    result = fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  await persist();
  return result;
}

// ── 계정 ───────────────────────────────────────────────────

function loadCurrentAccount() {
  const saved = getSetting('currentAccount');
  const exists = saved != null && one('SELECT id FROM accounts WHERE id = $id', { $id: saved });
  accountId = exists ? saved : one('SELECT id FROM accounts ORDER BY id LIMIT 1').id;
}

const accountFromRow = (r) => ({ id: r.id, name: r.name, color: r.color });

export function listAccounts() {
  return all('SELECT id, name, color FROM accounts ORDER BY id').map(accountFromRow);
}

export function currentAccount() {
  return accountFromRow(one('SELECT id, name, color FROM accounts WHERE id = $id', { $id: accountId }));
}

export async function switchAccount(id) {
  if (!one('SELECT id FROM accounts WHERE id = $id', { $id: id })) throw new Error('없는 계정입니다');
  accountId = id;
  await setSetting('currentAccount', id);
}

/** 새 계정을 만들고 id를 돌려준다. 색은 아직 안 쓴 것부터 고른다. */
export function createAccount(name) {
  return write(() => {
    const used = new Set(all('SELECT color FROM accounts').map((r) => r.color));
    const count = one('SELECT COUNT(*) AS n FROM accounts').n;
    const color = ACCOUNT_COLORS.find((c) => !used.has(c)) ?? ACCOUNT_COLORS[count % ACCOUNT_COLORS.length];
    db.run('INSERT INTO accounts (name, color, created_at) VALUES ($name, $color, $now)', {
      $name: name,
      $color: color,
      $now: localTimestamp(),
    });
    return lastId();
  });
}

export function renameAccount(id, name) {
  return write(() => db.run('UPDATE accounts SET name = $name WHERE id = $id', { $id: id, $name: name }));
}

/** 계정과 그 계정의 계획·기록·저장한 구절을 모두 지운다. 마지막 계정은 지울 수 없다. */
export async function deleteAccount(id) {
  if (one('SELECT COUNT(*) AS n FROM accounts').n <= 1) throw new Error('계정이 하나뿐이라 지울 수 없습니다');
  await write(() => db.run('DELETE FROM accounts WHERE id = $id', { $id: id }));
  if (id === accountId) await switchAccount(listAccounts()[0].id);
}

// ── 계획 ───────────────────────────────────────────────────

function planFromRow(row) {
  const start = fromISO(row.start_date);
  const end = fromISO(row.end_date);
  return {
    id: row.id,
    accountId: row.account_id,
    start,
    end,
    length: daysBetween(start, end) + 1, // 날 수
    title: row.title,
    mode: row.mode,
    selection: JSON.parse(row.selection),
    splitChapters: !!row.split_chapters,
    totalChars: row.total_chars,
    createdAt: row.created_at,
  };
}

/** 그 날짜가 들어 있는 계획. 없으면 null. account를 주지 않으면 지금 계정. (한 계정의 계획 기간은 겹치지 않는다) */
export function planOn(date, account = accountId) {
  const row = one('SELECT * FROM plans WHERE account_id = $a AND start_date <= $d AND end_date >= $d', {
    $a: account,
    $d: toISO(date),
  });
  return row && loadPlan(row);
}

/** 기간 [start, end]와 하루라도 겹치는 계획들 (이른 순) */
export function plansOverlapping(start, end, account = accountId) {
  return all(
    'SELECT * FROM plans WHERE account_id = $a AND start_date <= $e AND end_date >= $s ORDER BY start_date',
    { $a: account, $s: toISO(start), $e: toISO(end) },
  ).map(loadPlan);
}

/**
 * 계획 전체.
 *   plan.tracks: [{track, title, totalChars}]  (이어서 읽기는 하나, 병렬 읽기는 책마다 하나)
 *   plan.days[i]: i+1번째 날 전체 — {day, date, parts, segments, chars, readAt, readParts, moved}
 *     day: 시작일부터 센 번호(1부터), date: 그날 {y, m, d}
 *     parts: 분량이 있는 묶음별 [{track, title, segments, chars, readAt}]
 *     segments/chars: 모든 묶음을 합친 것, readAt: 모든 묶음을 읽었을 때만 마지막 시각
 *     moved: 다시 나누기로 분량을 뒤로 옮긴 묶음이 있는 날
 */
function loadPlan(row) {
  const plan = planFromRow(row);
  plan.tracks = all('SELECT track, title, total_chars FROM plan_tracks WHERE plan_id = $id ORDER BY track', {
    $id: plan.id,
  }).map((t) => ({ track: t.track, title: t.title, totalChars: t.total_chars }));
  const titles = new Map(plan.tracks.map((t) => [t.track, t.title]));

  const byDay = new Map();
  const moved = new Set();
  for (const d of all(
    `SELECT d.track, d.day, d.segments, d.chars, d.moved, r.read_at
       FROM plan_days d
       LEFT JOIN readings r ON r.plan_id = d.plan_id AND r.track = d.track AND r.day = d.day
      WHERE d.plan_id = $id ORDER BY d.day, d.track`,
    { $id: plan.id },
  )) {
    if (!byDay.has(d.day)) byDay.set(d.day, []);
    if (d.moved) moved.add(d.day);
    const segments = JSON.parse(d.segments);
    if (segments.length) {
      byDay.get(d.day).push({ track: d.track, title: titles.get(d.track), segments, chars: d.chars, readAt: d.read_at });
    }
  }
  plan.days = [...byDay].map(([day, parts]) => {
    const readParts = parts.filter((p) => p.readAt).length;
    return {
      day,
      date: addDays(plan.start, day - 1),
      parts,
      segments: parts.flatMap((p) => p.segments),
      chars: parts.reduce((s, p) => s + p.chars, 0),
      readParts,
      readAt: parts.length && readParts === parts.length ? parts.map((p) => p.readAt).sort().at(-1) : null,
      moved: moved.has(day),
    };
  });
  return plan;
}

/**
 * 다시 나누기 결과를 저장한다. 분량 합계는 그대로라 계획·묶음의 total_chars는 바꾸지 않는다.
 * @param {Array<{track, changes: Array<{index, segments, chars, moved}>}>} trackChanges index는 0부터
 */
export function rebalancePlan(planId, trackChanges) {
  return write(() => {
    const stmt = db.prepare('UPDATE plan_days SET segments = ?, chars = ?, moved = ? WHERE plan_id = ? AND track = ? AND day = ?');
    try {
      for (const { track, changes } of trackChanges) {
        for (const c of changes) stmt.run([JSON.stringify(c.segments), c.chars, c.moved ? 1 : 0, planId, track, c.index + 1]);
      }
    } finally {
      stmt.free();
    }
  });
}

/** 지금 계정의 모든 계획 요약 (최근 계획부터). readDays는 모든 묶음을 다 읽은 날 수 */
export function listPlans() {
  return all(
    `WITH ${DAY_STATUS}
     SELECT p.*,
            (SELECT COUNT(*) FROM day_status s WHERE s.plan_id = p.id) AS reading_days,
            (SELECT COUNT(*) FROM day_status s WHERE s.plan_id = p.id AND s.done = s.parts) AS read_days
       FROM plans p WHERE p.account_id = $a ORDER BY p.start_date DESC`,
    { $a: accountId },
  ).map((row) => ({ ...planFromRow(row), readingDays: row.reading_days, readDays: row.read_days }));
}

/**
 * 지금 계정에 start부터 end까지(포함)의 계획을 저장한다. 기간이 겹치는 계획이 있으면
 * 읽음 기록과 함께 지우고 새로 만든다. (그 계획에서 저장한 구절은 남는다)
 * @param {{start, end, title, selection, splitChapters, mode: 'sequential'|'parallel',
 *          tracks: Array<{title, days: Array<{segments, chars}>}>}} plan  묶음마다 days 길이 = 기간의 날 수
 */
export function savePlan({ start, end, title, selection, splitChapters, mode, tracks }) {
  const length = daysBetween(start, end) + 1;
  if (!(length >= 1 && length <= MAX_PLAN_DAYS)) throw new Error(`기간은 1일부터 ${MAX_PLAN_DAYS}일까지 정할 수 있습니다`);
  if (tracks.some((t) => t.days.length !== length)) throw new Error('날짜별 분량이 기간과 맞지 않습니다');
  const sum = (days) => days.reduce((s, d) => s + d.chars, 0);
  return write(() => {
    db.run('DELETE FROM plans WHERE account_id = $a AND start_date <= $e AND end_date >= $s', {
      $a: accountId,
      $s: toISO(start),
      $e: toISO(end),
    });
    db.run(
      `INSERT INTO plans (account_id, start_date, end_date, title, mode, selection, split_chapters, total_chars, created_at)
       VALUES ($a, $s, $e, $title, $mode, $sel, $split, $total, $now)`,
      {
        $a: accountId,
        $s: toISO(start),
        $e: toISO(end),
        $title: title,
        $mode: mode,
        $sel: JSON.stringify(selection),
        $split: splitChapters ? 1 : 0,
        $total: tracks.reduce((s, t) => s + sum(t.days), 0),
        $now: localTimestamp(),
      },
    );
    const id = lastId();
    const insTrack = db.prepare('INSERT INTO plan_tracks (plan_id, track, title, total_chars) VALUES (?, ?, ?, ?)');
    const insDay = db.prepare('INSERT INTO plan_days (plan_id, track, day, segments, chars) VALUES (?, ?, ?, ?, ?)');
    try {
      tracks.forEach((t, track) => {
        insTrack.run([id, track, t.title, sum(t.days)]);
        t.days.forEach((d, i) => insDay.run([id, track, i + 1, JSON.stringify(d.segments), d.chars]));
      });
    } finally {
      insTrack.free();
      insDay.free();
    }
    return id;
  });
}

export function deletePlan(id) {
  return write(() => db.run('DELETE FROM plans WHERE id = $id', { $id: id }));
}

/**
 * 읽음/안 읽음 표시. track을 주면 그 묶음만, 주지 않으면 그날의 모든 묶음.
 * 읽음이면 기록된 시각(여러 묶음이면 가장 늦은 시각)을 돌려준다.
 */
export function setRead(planId, day, read, track = null) {
  const where = `plan_id = $p AND day = $d ${track == null ? '' : 'AND track = $t'}`;
  const params = { $p: planId, $d: day, ...(track == null ? {} : { $t: track }) };
  return write(() => {
    if (!read) {
      db.run(`DELETE FROM readings WHERE ${where}`, params);
      return null;
    }
    db.run(
      `INSERT OR IGNORE INTO readings (plan_id, track, day, read_at)
       SELECT plan_id, track, day, $now FROM plan_days WHERE ${where} AND segments <> '[]'`,
      { ...params, $now: localTimestamp() },
    );
    return one(`SELECT MAX(read_at) AS t FROM readings WHERE ${where}`, params).t;
  });
}

/** 지금 계정에서 모든 묶음을 다 읽은 날짜 [{y, m, d}] (연속 기록 계산용) */
export function readDates() {
  return dayStatusDates('AND s.done = s.parts');
}

/** 지금 계정에서 분량이 배정된 모든 날짜 [{y, m, d}] */
export function scheduledDates() {
  return dayStatusDates('');
}

/** 지금 계정에서 다시 나누기로 분량을 뒤로 옮긴 날짜들 (연속 읽기를 끊는다) */
export function movedDates() {
  return all(
    `SELECT DISTINCT date(p.start_date, '+' || (d.day - 1) || ' days') AS date
       FROM plan_days d JOIN plans p ON p.id = d.plan_id
      WHERE p.account_id = $a AND d.moved = 1`,
    { $a: accountId },
  ).map((r) => fromISO(r.date));
}

function dayStatusDates(filter) {
  return all(
    `WITH ${DAY_STATUS}
     SELECT date(p.start_date, '+' || (s.day - 1) || ' days') AS date
       FROM day_status s JOIN plans p ON p.id = s.plan_id
      WHERE p.account_id = $a ${filter}
      ORDER BY date`,
    { $a: accountId },
  ).map((r) => fromISO(r.date));
}

// ── 저장한 구절 ────────────────────────────────────────────
// 같은 절을 다른 날 다시 저장하면 횟수가 늘어난다. 같은 날(계획의 같은 날짜) 안에서는 한 번만 센다.

export const verseKey = (b, c, v) => `${b}:${c}:${v}`;

/** 이 날 읽기에서 저장한 절의 키 집합 */
export function savedInReading(planId, day) {
  return new Set(
    all(
      'SELECT book, chapter, verse FROM saved_verses WHERE account_id = $a AND plan_id = $p AND day = $d',
      { $a: accountId, $p: planId, $d: day },
    ).map((r) => verseKey(r.book, r.chapter, r.verse)),
  );
}

/** 한 장에서 절마다 지금까지 저장한 횟수 Map(절 → 횟수) */
export function verseCounts(book, chapter) {
  return new Map(
    all(
      `SELECT verse, COUNT(*) AS n FROM saved_verses
        WHERE account_id = $a AND book = $b AND chapter = $c GROUP BY verse`,
      { $a: accountId, $b: book, $c: chapter },
    ).map((r) => [r.verse, r.n]),
  );
}

/** @param {Array<{b, c, v, e?, t}>} verses */
export function saveVerses(planId, day, verses) {
  return write(() => {
    const now = localTimestamp();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO saved_verses (account_id, book, chapter, verse, verse_end, text, plan_id, day, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    try {
      for (const x of verses) stmt.run([accountId, x.b, x.c, x.v, x.e ?? null, x.t, planId, day, now]);
    } finally {
      stmt.free();
    }
  });
}

/** 이 날 읽기에서 저장한 것만 취소한다. @param {Array<{b, c, v}>} verses */
export function unsaveVerses(planId, day, verses) {
  return write(() => {
    for (const x of verses) {
      db.run(
        `DELETE FROM saved_verses WHERE account_id = $a AND plan_id = $p AND day = $d
            AND book = $b AND chapter = $c AND verse = $v`,
        { $a: accountId, $p: planId, $d: day, $b: x.b, $c: x.c, $v: x.v },
      );
    }
  });
}

/** 지금 계정이 저장한 구절을 절마다 하나씩, 저장 횟수와 날짜들과 함께 (많이 저장한 순) */
export function listSavedVerses() {
  return all(
    `SELECT book, chapter, verse, MAX(verse_end) AS verse_end, MAX(text) AS text,
            COUNT(*) AS times, MAX(saved_at) AS last_at, GROUP_CONCAT(saved_at, '|') AS dates
       FROM saved_verses WHERE account_id = $a
      GROUP BY book, chapter, verse
      ORDER BY times DESC, last_at DESC`,
    { $a: accountId },
  ).map((r) => ({
    b: r.book,
    c: r.chapter,
    v: r.verse,
    e: r.verse_end,
    t: r.text,
    times: r.times,
    lastAt: r.last_at,
    dates: r.dates.split('|').sort().reverse(),
  }));
}

/**
 * 계획과 상관없이(검색 결과 등에서) 오늘 날짜로 한 절을 저장한다. 오늘 이미 저장한 절이면 다시 세지 않는다.
 * @returns {Promise<boolean>} 새로 저장했으면 true
 */
export function saveVerseToday(x) {
  return write(() => {
    const now = localTimestamp();
    db.run(
      `INSERT INTO saved_verses (account_id, book, chapter, verse, verse_end, text, plan_id, day, saved_at)
       SELECT $a, $b, $c, $v, $e, $t, NULL, NULL, $now
        WHERE NOT EXISTS (SELECT 1 FROM saved_verses
                           WHERE account_id = $a AND book = $b AND chapter = $c AND verse = $v
                             AND substr(saved_at, 1, 10) = substr($now, 1, 10))`,
      { $a: accountId, $b: x.b, $c: x.c, $v: x.v, $e: x.e ?? null, $t: x.t, $now: now },
    );
    return db.getRowsModified() > 0;
  });
}

/** 그 절의 저장 기록과 메모를 모두 지운다 */
export function deleteSavedVerse(b, c, v) {
  const params = { $a: accountId, $b: b, $c: c, $v: v };
  return write(() => {
    db.run('DELETE FROM saved_verses WHERE account_id = $a AND book = $b AND chapter = $c AND verse = $v', params);
    db.run('DELETE FROM verse_notes WHERE account_id = $a AND book = $b AND chapter = $c AND verse = $v', params);
  });
}

// ── 묵상 메모 ──────────────────────────────────────────────

/** 그 날짜의 묵상 메모 {text, passage, updatedAt}. 없으면 null */
export function getDayNote(date) {
  const r = one('SELECT text, passage, updated_at FROM day_notes WHERE account_id = $a AND date = $d', {
    $a: accountId,
    $d: toISO(date),
  });
  return r && { text: r.text, passage: r.passage, updatedAt: r.updated_at };
}

/** 그 날짜의 묵상 메모를 저장한다. 빈 글이면 지운다. 저장한 시각(지웠으면 null)을 돌려준다. */
export function saveDayNote(date, passage, text) {
  return write(() => {
    if (!text.trim()) {
      db.run('DELETE FROM day_notes WHERE account_id = $a AND date = $d', { $a: accountId, $d: toISO(date) });
      return null;
    }
    const now = localTimestamp();
    db.run(
      `INSERT INTO day_notes (account_id, date, passage, text, updated_at) VALUES ($a, $d, $p, $t, $now)
       ON CONFLICT (account_id, date) DO UPDATE SET passage = excluded.passage, text = excluded.text, updated_at = excluded.updated_at`,
      { $a: accountId, $d: toISO(date), $p: passage, $t: text, $now: now },
    );
    return now;
  });
}

/** 구절 메모 Map("b:c:v" → {text, updatedAt}) */
export function verseNotes() {
  return new Map(
    all('SELECT book, chapter, verse, text, updated_at FROM verse_notes WHERE account_id = $a', { $a: accountId }).map(
      (r) => [verseKey(r.book, r.chapter, r.verse), { text: r.text, updatedAt: r.updated_at }],
    ),
  );
}

/** 구절 메모를 저장한다. 빈 글이면 지운다. */
export function saveVerseNote(b, c, v, text) {
  const params = { $a: accountId, $b: b, $c: c, $v: v };
  return write(() => {
    if (!text.trim()) {
      db.run('DELETE FROM verse_notes WHERE account_id = $a AND book = $b AND chapter = $c AND verse = $v', params);
      return null;
    }
    const now = localTimestamp();
    db.run(
      `INSERT INTO verse_notes (account_id, book, chapter, verse, text, updated_at) VALUES ($a, $b, $c, $v, $t, $now)
       ON CONFLICT (account_id, book, chapter, verse) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
      { ...params, $t: text, $now: now },
    );
    return now;
  });
}

/**
 * 지금 계정의 모든 메모 (최근에 고친 것부터).
 *   {kind: 'day', date, passage, text, updatedAt} | {kind: 'verse', b, c, v, e, verseText, text, updatedAt}
 */
export function listNotes() {
  const days = all('SELECT date, passage, text, updated_at FROM day_notes WHERE account_id = $a', { $a: accountId }).map(
    (r) => ({ kind: 'day', date: fromISO(r.date), passage: r.passage, text: r.text, updatedAt: r.updated_at }),
  );
  const verses = all(
    `SELECT n.book, n.chapter, n.verse, n.text, n.updated_at,
            (SELECT MAX(s.verse_end) FROM saved_verses s WHERE s.account_id = n.account_id
                AND s.book = n.book AND s.chapter = n.chapter AND s.verse = n.verse) AS verse_end,
            (SELECT MAX(s.text) FROM saved_verses s WHERE s.account_id = n.account_id
                AND s.book = n.book AND s.chapter = n.chapter AND s.verse = n.verse) AS verse_text
       FROM verse_notes n WHERE n.account_id = $a`,
    { $a: accountId },
  ).map((r) => ({
    kind: 'verse',
    b: r.book,
    c: r.chapter,
    v: r.verse,
    e: r.verse_end,
    verseText: r.verse_text,
    text: r.text,
    updatedAt: r.updated_at,
  }));
  return [...days, ...verses].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
}

// ── 설정 ───────────────────────────────────────────────────

export function getSetting(key, fallback = null) {
  const row = one('SELECT value FROM settings WHERE key = $k', { $k: key });
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  return write(() =>
    db.run(
      'INSERT INTO settings (key, value) VALUES ($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      { $k: key, $v: JSON.stringify(value) },
    ),
  );
}

// ── 백업 ───────────────────────────────────────────────────

/** 백업 파일로 현재 기록을 모두 바꾼다. 형식이 맞지 않으면 예외를 던지고 아무것도 바꾸지 않는다. */
export async function importFile(bytes) {
  let incoming;
  try {
    incoming = new SQL.Database(bytes);
    const tables = incoming.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values.flat() ?? [];
    for (const t of ['plans', 'plan_days', 'readings']) {
      if (!tables.includes(t)) throw new Error(`'${t}' 테이블이 없습니다`);
    }
    migrate(incoming);
  } catch (err) {
    incoming?.close();
    throw new Error(`이 앱의 백업 파일이 아닙니다 (${err.message})`);
  }
  db.close();
  db = incoming;
  loadCurrentAccount();
  await persist();
}

export async function resetAll() {
  db.close();
  db = new SQL.Database();
  migrate(db);
  loadCurrentAccount();
  await persist();
}
