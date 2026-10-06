import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIGRATIONS, migrate } from '../app/js/db.js';

const initSqlJs = createRequire(import.meta.url)('sql.js');
const SQL = await initSqlJs();

const rows = (db, sql) => {
  const r = db.exec(sql)[0];
  return r ? r.values : [];
};

/** v1 스키마에 계획 하나(3일, 2일 읽음)가 있는 데이터베이스 */
function v1Database() {
  const db = new SQL.Database();
  db.exec(MIGRATIONS[0]);
  db.exec('PRAGMA user_version = 1');
  db.exec(`
    INSERT INTO plans (id, year, month, title, selection, total_chars, created_at)
    VALUES (7, 2026, 10, '신약', '{"mat":[1,2,3]}', 300, '2026-10-01 08:00:00');
    INSERT INTO plan_days VALUES (7, 1, '[{"b":"mat","c":1}]', 100), (7, 2, '[{"b":"mat","c":2}]', 100), (7, 3, '[{"b":"mat","c":3}]', 100);
    INSERT INTO readings VALUES (7, 1, '2026-10-01 21:00:00'), (7, 2, '2026-10-02 21:00:00');
    INSERT INTO settings VALUES ('fontSize', '20');
  `);
  return db;
}

test('v1 기록을 기본 계정으로 옮기며 아무것도 잃지 않는다', () => {
  const db = v1Database();
  assert.equal(migrate(db), true);
  assert.equal(rows(db, 'PRAGMA user_version')[0][0], MIGRATIONS.length);
  assert.deepEqual(rows(db, 'SELECT id, name FROM accounts'), [[1, '나']]);
  assert.deepEqual(rows(db, 'SELECT id, account_id, year, month, title FROM plans'), [[7, 1, 2026, 10, '신약']]);
  assert.equal(rows(db, 'SELECT COUNT(*) FROM plan_days')[0][0], 3);
  assert.equal(rows(db, 'SELECT COUNT(*) FROM readings')[0][0], 2);
  assert.deepEqual(rows(db, 'PRAGMA foreign_key_check'), []);
  // 이미 최신이면 다시 적용하지 않는다
  assert.equal(migrate(db), false);
});

test('계정마다 같은 달에 계획을 하나씩 가질 수 있다', () => {
  const db = v1Database();
  migrate(db);
  db.exec("INSERT INTO accounts (id, name, color, created_at) VALUES (2, '엄마', '#3b64b0', 'now')");
  db.exec(`INSERT INTO plans (account_id, year, month, title, selection, total_chars, created_at)
           VALUES (2, 2026, 10, '시편', '{}', 0, 'now')`);
  assert.throws(() =>
    db.exec(`INSERT INTO plans (account_id, year, month, title, selection, total_chars, created_at)
             VALUES (2, 2026, 10, '중복', '{}', 0, 'now')`),
  );
});

test('저장한 구절: 같은 날 한 번, 계획을 지워도 남고, 계정을 지우면 함께 지워진다', () => {
  const db = v1Database();
  migrate(db);
  const save = (plan, day) =>
    db.exec(`INSERT OR IGNORE INTO saved_verses (account_id, book, chapter, verse, text, plan_id, day, saved_at)
             VALUES (1, 'mat', 1, 1, '본문', ${plan}, ${day}, 'now')`);
  save(7, 1);
  save(7, 1); // 같은 날 다시 저장해도 한 번
  save(7, 2);
  assert.equal(rows(db, 'SELECT COUNT(*) FROM saved_verses')[0][0], 2);

  db.exec('DELETE FROM plans WHERE id = 7');
  assert.equal(rows(db, 'SELECT COUNT(*) FROM readings')[0][0], 0, '읽음 기록은 계획과 함께 지워진다');
  assert.deepEqual(rows(db, 'SELECT plan_id FROM saved_verses'), [[null], [null]], '구절은 남는다');

  db.exec('DELETE FROM accounts WHERE id = 1');
  assert.equal(rows(db, 'SELECT COUNT(*) FROM saved_verses')[0][0], 0);
});
