// 읽기 계획과 기록 저장소: 브라우저 안에서 도는 SQLite(sql.js).
// 데이터베이스 파일 전체를 IndexedDB에 보관하고, 바뀔 때마다 다시 저장한다.
/* global initSqlJs */

import { localTimestamp } from './dates.js';

const IDB_NAME = 'conquer-the-bible';
const IDB_STORE = 'files';
const IDB_KEY = 'records.sqlite';

// 스키마 버전별 변경. PRAGMA user_version에 적용된 개수를 기록한다.
const MIGRATIONS = [
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
];

let SQL = null;
let db = null;
let saving = Promise.resolve();

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

function migrate(target) {
  const version = target.exec('PRAGMA user_version')[0].values[0][0];
  for (let v = version; v < MIGRATIONS.length; v++) {
    target.exec('BEGIN');
    try {
      target.exec(MIGRATIONS[v]);
      target.exec(`PRAGMA user_version = ${v + 1}`);
      target.exec('COMMIT');
    } catch (err) {
      target.exec('ROLLBACK');
      throw err;
    }
  }
  target.exec('PRAGMA foreign_keys = ON');
}

export async function openDatabase() {
  SQL = await initSqlJs({ locateFile: (file) => `vendor/${file}` });
  const bytes = await idb('readonly', (s) => s.get(IDB_KEY));
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  migrate(db);
  if (!bytes) await persist();
}

/** 현재 데이터베이스 파일 바이트 */
export function exportFile() {
  const data = db.export();
  // sql.js의 export()는 연결을 닫았다 다시 열기 때문에 연결 단위 설정을 다시 켠다.
  db.exec('PRAGMA foreign_keys = ON');
  return data;
}

function persist() {
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

// ── 계획 ───────────────────────────────────────────────────

function planFromRow(row) {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    title: row.title,
    selection: JSON.parse(row.selection),
    splitChapters: !!row.split_chapters,
    totalChars: row.total_chars,
    createdAt: row.created_at,
  };
}

/** 그 달의 계획과 날짜별 분량·읽음 기록. 없으면 null */
export function getPlan(year, month) {
  const row = one('SELECT * FROM plans WHERE year = $y AND month = $m', { $y: year, $m: month });
  if (!row) return null;
  const plan = planFromRow(row);
  plan.days = all(
    `SELECT d.day, d.segments, d.chars, r.read_at
       FROM plan_days d LEFT JOIN readings r ON r.plan_id = d.plan_id AND r.day = d.day
      WHERE d.plan_id = $id ORDER BY d.day`,
    { $id: plan.id },
  ).map((d) => ({ day: d.day, segments: JSON.parse(d.segments), chars: d.chars, readAt: d.read_at }));
  return plan;
}

/** 모든 계획 요약 (최근 달부터) */
export function listPlans() {
  return all(
    `SELECT p.*,
            (SELECT COUNT(*) FROM plan_days d WHERE d.plan_id = p.id AND d.segments <> '[]') AS reading_days,
            (SELECT COUNT(*) FROM readings r WHERE r.plan_id = p.id) AS read_days
       FROM plans p ORDER BY p.year DESC, p.month DESC`,
  ).map((row) => ({ ...planFromRow(row), readingDays: row.reading_days, readDays: row.read_days }));
}

/**
 * 그 달의 계획을 저장한다. 같은 달에 이미 계획이 있으면 읽음 기록과 함께 지우고 새로 만든다.
 * @param {{year, month, title, selection, splitChapters, days: Array<{segments, chars}>}} plan
 */
export function savePlan({ year, month, title, selection, splitChapters, days }) {
  return write(() => {
    db.run('DELETE FROM plans WHERE year = $y AND month = $m', { $y: year, $m: month });
    db.run(
      `INSERT INTO plans (year, month, title, selection, split_chapters, total_chars, created_at)
       VALUES ($y, $m, $title, $sel, $split, $total, $now)`,
      {
        $y: year,
        $m: month,
        $title: title,
        $sel: JSON.stringify(selection),
        $split: splitChapters ? 1 : 0,
        $total: days.reduce((s, d) => s + d.chars, 0),
        $now: localTimestamp(),
      },
    );
    const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    const stmt = db.prepare('INSERT INTO plan_days (plan_id, day, segments, chars) VALUES (?, ?, ?, ?)');
    try {
      days.forEach((d, i) => stmt.run([id, i + 1, JSON.stringify(d.segments), d.chars]));
    } finally {
      stmt.free();
    }
    return id;
  });
}

export function deletePlan(id) {
  return write(() => db.run('DELETE FROM plans WHERE id = $id', { $id: id }));
}

/** 그날 분량을 읽음/안 읽음으로 표시한다. 읽음이면 기록된 시각을 돌려준다. */
export function setRead(planId, day, read) {
  return write(() => {
    if (!read) {
      db.run('DELETE FROM readings WHERE plan_id = $p AND day = $d', { $p: planId, $d: day });
      return null;
    }
    const now = localTimestamp();
    db.run('INSERT OR IGNORE INTO readings (plan_id, day, read_at) VALUES ($p, $d, $now)', {
      $p: planId,
      $d: day,
      $now: now,
    });
    return one('SELECT read_at FROM readings WHERE plan_id = $p AND day = $d', { $p: planId, $d: day }).read_at;
  });
}

/** 읽음 표시된 모든 날짜 [{y, m, d}] (연속 기록 계산용) */
export function readDates() {
  return all(
    `SELECT p.year AS y, p.month AS m, r.day AS d
       FROM readings r JOIN plans p ON p.id = r.plan_id
      ORDER BY p.year, p.month, r.day`,
  );
}

/** 분량이 배정된 모든 날짜 [{y, m, d}] */
export function scheduledDates() {
  return all(
    `SELECT p.year AS y, p.month AS m, d.day AS d
       FROM plan_days d JOIN plans p ON p.id = d.plan_id
      WHERE d.segments <> '[]'
      ORDER BY p.year, p.month, d.day`,
  );
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
  await persist();
}

export async function resetAll() {
  db.close();
  db = new SQL.Database();
  migrate(db);
  await persist();
}
