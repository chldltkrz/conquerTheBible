// 기기 간 동기화 서버. 로그인 없이 "동기화 코드" 하나로 여러 기기가 같은 기록을 나눈다.
//
// 기기(app/js/sync.js)는 자기 SQLite에서 바뀐 줄을 보내고, 다른 기기가 바꾼 줄을 받아 간다.
// 서버는 표 이름·열쇠·값(JSON)만 알고 내용은 해석하지 않는다. 줄마다 마지막 값만 두고(지운 줄은 data가 NULL),
// 바뀔 때마다 그 동기화 공간 안에서 1씩 커지는 번호(version)를 붙인다. 기기는 받은 마지막 번호(cursor)
// 다음부터 받아 간다. 같은 줄을 두 기기가 고치면 서버에 나중에 도착한 쪽이 남는다.
// 동기화 코드는 만들 때 한 번만 알려 주고, 서버에는 SHA-256 해시만 둔다.
//
//   POST   /api/sync/spaces   새 동기화 공간 → {code}
//   GET    /api/sync/space    공간 요약: 연결하기 전에 보여 줄 계정 이름과 개수
//   DELETE /api/sync/space    공간과 그 기록을 모두 지운다
//   POST   /api/sync          {v, cursor, replace?, changes: [{t, k, d}]} → {cursor, more, rows: [{t, k, d}], tables}
//                              (tables: 받는 표 이름들. 기기는 여기 든 표만 보낸다)
//   GET    /api/sync/health   서버와 DB 확인
//   (공간을 쓰는 요청은 Authorization: Bearer <동기화 코드>)
//   /api/push/…               읽기 알림 (push.mjs)
//   /api/rooms…               함께 읽기 방 (rooms.mjs)
//
// 실행: DATABASE_URL=postgres://… PORT=5690 node server/sync-server.mjs
// 읽기 알림을 보내려면 VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY도 준다 (README "읽기 알림")

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { bearerCode, hashCode, newCode } from './code.mjs';
import { HttpError, readJson, send } from './http.mjs';
import { PUSH_SCHEMA, createPushApi, createReminders, webPushSender } from './push.mjs';
import { ROOMS_SCHEMA, createRoomsApi } from './rooms.mjs';

export { CODE_ALPHABET, newCode, normalizeCode } from './code.mjs';

export const PROTOCOL = 1;

/** 기기가 보낼 수 있는 표 (app/js/db.js의 SYNC_TABLES) */
export const TABLES = new Set([
  'accounts',
  'plans',
  'plan_tracks',
  'plan_days',
  'readings',
  'saved_verses',
  'day_notes',
  'verse_notes',
  'settings',
  'reading_progress',
  'room_memberships',
]);
const TABLES_JSON = JSON.stringify([...TABLES]);

const MAX_CHANGES = 10000; // 요청 하나에 보내는 줄 수
const MAX_KEY = 200;
const MAX_ROW = 256 * 1024; // 줄 하나의 JSON 길이 (긴 묵상 메모도 들어가도록)
const MAX_SPACE_ROWS = 500000; // 공간 하나에 둘 수 있는 줄 수 (지운 줄 포함)
const PAGE_ROWS = 5000; // 응답 하나에 담는 줄 수
const PAGE_BYTES = 2 * 1024 * 1024;

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sync_spaces (
    id         bigserial   PRIMARY KEY,
    code_hash  bytea       NOT NULL UNIQUE,          -- SHA-256(동기화 코드)
    version    bigint      NOT NULL DEFAULT 0,       -- 마지막으로 붙인 번호
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),   -- 마지막으로 기록이 바뀐 때
    seen_at    timestamptz NOT NULL DEFAULT now()    -- 마지막으로 기기가 다녀간 때
  );
  CREATE TABLE IF NOT EXISTS sync_rows (
    space_id bigint NOT NULL REFERENCES sync_spaces(id) ON DELETE CASCADE,
    tbl      text   NOT NULL,                        -- 기기 SQLite의 표 이름
    key      text   NOT NULL,                        -- 그 표의 기본 키 값들 JSON 배열 '[12,0,3]'
    data     jsonb,                                  -- 줄 전체 {열: 값}. 지운 줄이면 NULL
    version  bigint NOT NULL,
    PRIMARY KEY (space_id, tbl, key)
  );
  CREATE INDEX IF NOT EXISTS sync_rows_by_version ON sync_rows (space_id, version);
`;

// ── HTTP ───────────────────────────────────────────────────

function codeFrom(req) {
  const code = bearerCode(req);
  if (!code) throw new HttpError(401, 'no_code');
  return code;
}

/** 보낸 줄을 검사하고, 같은 줄이 두 번 있으면 나중 것만 남긴다. d는 JSON 문자열(지운 줄은 null)로 바꾼다. */
function parseChanges(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > MAX_CHANGES) throw new HttpError(400, 'bad_changes');
  const byKey = new Map();
  for (const c of list) {
    if (!c || !TABLES.has(c.t) || typeof c.k !== 'string' || !c.k || c.k.length > MAX_KEY) {
      throw new HttpError(400, 'bad_changes');
    }
    if (c.d !== null && (typeof c.d !== 'object' || Array.isArray(c.d))) throw new HttpError(400, 'bad_changes');
    const d = c.d === null ? null : JSON.stringify(c.d);
    if (d && d.length > MAX_ROW) throw new HttpError(413, 'row_too_large');
    const id = `${c.t}\u0000${c.k}`;
    byKey.delete(id);
    byKey.set(id, { t: c.t, k: c.k, d });
  }
  return [...byKey.values()];
}

// ── 동기화 ─────────────────────────────────────────────────

/** 동기화 코드에 맞는 공간 번호. 코드가 없거나 맞지 않으면 null (읽기 알림이 같은 공간의 기기를 묶는 데 쓴다) */
export async function spaceIdFor(pool, req) {
  const code = bearerCode(req);
  if (!code) return null;
  const r = await pool.query('SELECT id FROM sync_spaces WHERE code_hash = $1', [hashCode(code)]);
  return r.rows[0]?.id ?? null;
}

/** push: createPushApi()가 만든 읽기 알림 요청 처리기. 없으면 /api/push/…는 503 */
export function createHandler(pool, { push = null } = {}) {
  const rooms = createRoomsApi(pool);

  async function createSpace() {
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      const r = await pool.query(
        'INSERT INTO sync_spaces (code_hash) VALUES ($1) ON CONFLICT (code_hash) DO NOTHING RETURNING id',
        [hashCode(code)],
      );
      if (r.rowCount) return { code };
    }
    throw new Error('동기화 코드를 만들지 못했습니다');
  }

  async function spaceInfo(code) {
    const space = (await pool.query('SELECT id, updated_at FROM sync_spaces WHERE code_hash = $1', [hashCode(code)]))
      .rows[0];
    if (!space) throw new HttpError(404, 'no_space');
    const counts = Object.fromEntries(
      (
        await pool.query(
          'SELECT tbl, count(*)::int AS n FROM sync_rows WHERE space_id = $1 AND data IS NOT NULL GROUP BY tbl',
          [space.id],
        )
      ).rows.map((r) => [r.tbl, r.n]),
    );
    const accounts = (
      await pool.query(
        `SELECT data->>'name' AS name FROM sync_rows
          WHERE space_id = $1 AND tbl = 'accounts' AND data IS NOT NULL
          ORDER BY data->>'created_at', key`,
        [space.id],
      )
    ).rows.map((r) => r.name);
    return { accounts, counts, updatedAt: space.updated_at.toISOString() };
  }

  async function deleteSpace(code) {
    const r = await pool.query('DELETE FROM sync_spaces WHERE code_hash = $1', [hashCode(code)]);
    if (!r.rowCount) throw new HttpError(404, 'no_space');
  }

  /**
   * 보낸 줄을 저장하고, cursor 다음부터 다른 기기가 바꾼 줄을 돌려준다.
   * replace면 공간의 기록을 이 기기 것으로 통째로 바꾼다: 있던 줄을 모두 지운 줄로 만들고(다른 기기가 받아
   * 지우도록) 보낸 줄을 넣는다. 이때는 돌려줄 것이 없다. (보낸 줄이 많으면 첫 요청에만 replace를 붙인다)
   * 응답은 문자열로 만든다(줄의 JSON을 다시 풀지 않도록).
   */
  async function sync(code, body) {
    if (body?.v !== PROTOCOL) throw new HttpError(400, 'bad_protocol');
    const cursor = body.cursor;
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new HttpError(400, 'bad_cursor');
    const changes = parseChanges(body.changes);
    const replace = body.replace === true;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 같은 공간의 요청은 차례로: 번호를 붙이는 순서와 저장되는 순서가 같아야 cursor로 빠짐없이 받아 간다.
      const space = (
        await client.query('SELECT id, version FROM sync_spaces WHERE code_hash = $1 FOR UPDATE', [hashCode(code)])
      ).rows[0];
      if (!space) throw new HttpError(404, 'no_space');
      const before = Number(space.version);
      if (cursor > before) throw new HttpError(409, 'cursor_ahead'); // 서버 DB를 되돌린 경우 등
      let version = before;

      if (replace) {
        const r = await client.query(
          `WITH alive AS (
             SELECT tbl, key, row_number() OVER (ORDER BY version, tbl, key) AS n
               FROM sync_rows WHERE space_id = $1 AND data IS NOT NULL
           )
           UPDATE sync_rows s SET data = NULL, version = $2 + alive.n
             FROM alive WHERE s.space_id = $1 AND s.tbl = alive.tbl AND s.key = alive.key`,
          [space.id, version],
        );
        version += r.rowCount;
      }
      if (changes.length) {
        const total = (await client.query('SELECT count(*)::int AS n FROM sync_rows WHERE space_id = $1', [space.id]))
          .rows[0].n;
        if (total + changes.length > MAX_SPACE_ROWS) throw new HttpError(413, 'space_full');
        await client.query(
          `INSERT INTO sync_rows (space_id, tbl, key, data, version)
           SELECT $1, c.t, c.k, c.d, $2 + c.n
             FROM unnest($3::text[], $4::text[], $5::jsonb[]) WITH ORDINALITY AS c(t, k, d, n)
           ON CONFLICT (space_id, tbl, key) DO UPDATE SET data = excluded.data, version = excluded.version`,
          [space.id, version, changes.map((c) => c.t), changes.map((c) => c.k), changes.map((c) => c.d)],
        );
        version += changes.length;
      }

      // 이번에 보낸 줄(before 다음 번호들)은 돌려주지 않는다. 이 기기에 이미 있다.
      const rows = [];
      let more = false;
      let next = version;
      if (!replace && cursor < before) {
        const r = await client.query(
          `SELECT tbl, key, data::text AS data, version FROM sync_rows
            WHERE space_id = $1 AND version > $2 AND version <= $3
            ORDER BY version LIMIT $4`,
          [space.id, cursor, before, PAGE_ROWS + 1],
        );
        let bytes = 0;
        for (const row of r.rows) {
          if (rows.length >= PAGE_ROWS || bytes >= PAGE_BYTES) {
            more = true;
            break;
          }
          const text = `{"t":${JSON.stringify(row.tbl)},"k":${JSON.stringify(row.key)},"d":${row.data ?? 'null'}}`;
          rows.push(text);
          bytes += text.length;
          next = Number(row.version);
        }
        if (!more) next = version;
      }

      await client.query(
        `UPDATE sync_spaces SET version = $2, seen_at = now(),
                updated_at = CASE WHEN $2 > version THEN now() ELSE updated_at END
          WHERE id = $1`,
        [space.id, version],
      );
      await client.query('COMMIT');
      return `{"cursor":${next},"more":${more},"rows":[${rows.join(',')}],"tables":${TABLES_JSON}}`;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      // jsonb에 넣을 수 없는 글자(\u0000)
      if (err.code === '22P05') throw new HttpError(400, 'bad_text');
      throw err;
    } finally {
      client.release();
    }
  }

  return async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${pathname}`;
    try {
      if (route === 'POST /api/sync') send(res, 200, await sync(codeFrom(req), await readJson(req)));
      else if (route === 'POST /api/sync/spaces') send(res, 201, await createSpace());
      else if (route === 'GET /api/sync/space') send(res, 200, await spaceInfo(codeFrom(req)));
      else if (route === 'DELETE /api/sync/space') {
        await deleteSpace(codeFrom(req));
        send(res, 204);
      } else if (route === 'GET /api/sync/health') {
        await pool.query('SELECT 1');
        send(res, 200, { ok: true });
      } else if (pathname.startsWith('/api/push/')) {
        if (!push) throw new HttpError(503, 'push_off');
        const [status, body] = await push(route, req);
        send(res, status, body);
      } else if (pathname === '/api/rooms' || pathname.startsWith('/api/rooms/')) {
        const [status, body] = await rooms(req, pathname);
        send(res, status, body);
      } else send(res, 404, { error: 'not_found' });
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.code });
      } else {
        // 요청 본문과 헤더(동기화 코드)는 남기지 않는다.
        console.error(`${route} 실패:`, err.message);
        send(res, 500, { error: 'server_error' });
      }
    }
  };
}

/**
 * 서버를 띄운다. 테스트에서는 port 0으로 빈 포트를 쓴다.
 * push: 읽기 알림 {publicKey, sender, interval}. sender(구독, 내용, 옵션)가 실제로 보내고,
 *       interval(ms)마다 보낼 알림을 찾는다(0이면 찾지 않는다: 테스트는 reminders.tick()을 직접 부른다).
 */
export async function startServer({ databaseUrl, port = 5690, host = '127.0.0.1', push = null }) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  await pool.query(SCHEMA);
  await pool.query(PUSH_SCHEMA);
  await pool.query(ROOMS_SCHEMA);
  const reminders = push && createReminders(pool, push.sender);
  const pushApi =
    push && createPushApi(pool, { ...push, spaceIdFor: (req) => spaceIdFor(pool, req), deliver: reminders.deliver });
  const server = http.createServer(createHandler(pool, { push: pushApi }));
  await new Promise((resolve) => server.listen(port, host, resolve));
  const tick = () => reminders.tick().catch((err) => console.error('읽기 알림 실패:', err.message));
  const timer = push?.interval ? setInterval(tick, push.interval) : null;
  return {
    server,
    pool,
    reminders,
    url: `http://${host}:${server.address().port}`,
    close: async () => {
      clearInterval(timer);
      await reminders?.idle();
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL이 없습니다 (예: postgres://사용자:암호@127.0.0.1:5432/ctb_sync)');
    process.exit(1);
  }
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = process.env;
  const subject = process.env.VAPID_SUBJECT ?? 'https://delicious-manna.com';
  const app = await startServer({
    databaseUrl: process.env.DATABASE_URL,
    port: Number(process.env.PORT ?? 5690),
    host: process.env.HOST ?? '127.0.0.1',
    push:
      publicKey && privateKey
        ? { publicKey, sender: webPushSender({ publicKey, privateKey, subject }), interval: 30 * 1000 }
        : null,
  });
  console.log(`동기화 서버: ${app.url}${app.reminders ? '' : ' (VAPID 키가 없어 읽기 알림은 꺼 둠)'}`);
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
