// 함께 읽기 방. 같은 계획을 여럿이 함께 읽으며 서로 오늘 읽었는지 본다 ("오늘 5명 중 3명 읽음").
//
// 방은 초대 코드로 연다. 코드를 아는 사람은 방 이름, 계획, 멤버 이름과 날짜별 읽음 정도를 보고 방에 들어올 수 있다.
// 동기화 코드와 꼴은 같지만 따로 만든 코드라서, 초대 코드로는 다른 사람의 메모나 저장한 구절에 닿지 못한다.
// 멤버는 들어올 때 받은 멤버 키로만 자기 줄을 고친다(X-Room-Member: <멤버 번호>:<멤버 키>).
// 서버는 기기의 기록을 해석하지 않는다. 날짜마다 그날 분량을 몇 퍼센트 읽었는지는 기기(app/js/rooms.js)가
// 계산해 days로 올리고, 기록이 바뀔 때마다 다시 올린다. 계획(plan)도 기기가 만든 그대로 두었다가 돌려준다.
//
//   POST   /api/rooms                 {name, plan, member: {name, color}} → {code, member: {id, key}}
//   GET    /api/rooms/room            → {name, plan, createdAt, members: [{id, name, color, owner, days, progress, …}]}
//   POST   /api/rooms/members         {name, color} → {id, key}       방에 들어온다 (가득 차면 409 room_full)
//   PUT    /api/rooms/members/me      {name, color, days, progress, reading?}  내 상태를 올린다
//                                     (reading: 각자 계획 방에서 지금 읽는 계획 {title, range, start, end, mode})
//   DELETE /api/rooms/members/me      방에서 나간다 (방장이 나가면 먼저 들어온 멤버가 방장, 아무도 없으면 방을 지운다)
//   DELETE /api/rooms/members/<번호>  방장이 멤버를 내보낸다
//   DELETE /api/rooms/room            방장이 방을 없앤다
//   (방 만들기 말고는 Authorization: Bearer <초대 코드>. 멤버 요청은 X-Room-Member도)

import { bearerCode, hashCode, newCode, randomToken } from './code.mjs';
import { HttpError, readJson } from './http.mjs';

export const ROOMS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS reading_rooms (
    id         bigserial   PRIMARY KEY,
    code_hash  bytea       NOT NULL UNIQUE,          -- SHA-256(초대 코드)
    name       text        NOT NULL,
    plan       jsonb       NOT NULL,                 -- 함께 읽는 계획 (기기가 만든 그대로)
    created_at timestamptz NOT NULL DEFAULT now(),
    seen_at    timestamptz NOT NULL DEFAULT now()    -- 마지막으로 멤버가 상태를 올린 때
  );
  CREATE TABLE IF NOT EXISTS room_members (
    room_id    bigint      NOT NULL REFERENCES reading_rooms(id) ON DELETE CASCADE,
    id         text        NOT NULL,                 -- 방 안에서 멤버를 가리키는 번호 (다른 멤버에게도 보인다)
    key_hash   bytea       NOT NULL,                 -- SHA-256(멤버 키). 키는 그 멤버의 기기만 안다
    name       text        NOT NULL,
    color      text        NOT NULL,
    owner      boolean     NOT NULL DEFAULT false,
    days       jsonb       NOT NULL DEFAULT '{}',    -- {"2026-10-22": 40} 그날 분량을 몇 퍼센트 읽었는지 (분량이 있는 날만)
    progress   smallint,                             -- 계획 전체 진도 (퍼센트)
    joined_at  timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, id)
  );
  -- 각자 계획 방에서 그 멤버가 지금 읽는 계획 {title, range, start, end, mode} (멤버를 누르면 보인다. 같은 계획 방은 NULL)
  ALTER TABLE room_members ADD COLUMN IF NOT EXISTS reading jsonb;
`;

export const MAX_MEMBERS = 30;
const MAX_BODY = 128 * 1024;
const MAX_PLAN = 64 * 1024; // 계획 JSON 길이 (1년 1독 계획도 들어간다)
const MAX_DAYS = 400;
const ROOM_NAME = 30;
const MEMBER_NAME = 20;
const STALE = '400 days'; // 이만큼 아무도 상태를 올리지 않은 방은 지운다

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const READING_MODES = new Set(['sequential', 'parallel', 'group']);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MEMBER_RE = /^([0-9A-Z]{10}):([0-9A-Z]{26})$/;

const sha256 = hashCode;

function parseName(value, max) {
  // 줄바꿈 같은 제어 문자는 빼고, 앞뒤 공백을 지운다
  const name = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  if (!name || [...name].length > max) throw new HttpError(400, 'bad_name');
  return name;
}

function parseColor(value) {
  if (typeof value !== 'string' || !COLOR_RE.test(value)) throw new HttpError(400, 'bad_color');
  return value.toLowerCase();
}

/** 값 안의 모든 문자열(열쇠 포함)에서 jsonb에 넣을 수 없는 글자(\u0000)를 뺀다 */
function withoutNul(value) {
  if (typeof value === 'string') return value.replace(/\u0000/g, '');
  if (Array.isArray(value)) return value.map(withoutNul);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [withoutNul(k), withoutNul(v)]));
  }
  return value;
}

function parsePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new HttpError(400, 'bad_plan');
  const text = JSON.stringify(withoutNul(plan));
  if (text.length > MAX_PLAN) throw new HttpError(413, 'plan_too_large');
  return text;
}

function parseDays(days) {
  if (!days || typeof days !== 'object' || Array.isArray(days)) throw new HttpError(400, 'bad_days');
  const entries = Object.entries(days);
  if (entries.length > MAX_DAYS) throw new HttpError(400, 'bad_days');
  for (const [date, pct] of entries) {
    if (!DATE_RE.test(date) || !Number.isInteger(pct) || pct < 0 || pct > 100) throw new HttpError(400, 'bad_days');
  }
  return JSON.stringify(Object.fromEntries(entries));
}

/** 지금 읽는 계획 {title, range, start, end, mode}. 없으면 null (같은 계획 방, 예전 앱, 오늘 계획이 없는 사람) */
function parseReading(value) {
  if (value == null) return null;
  const ok =
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.title === 'string' &&
    value.title.length <= 100 &&
    typeof value.range === 'string' &&
    value.range.length <= 200 &&
    DATE_RE.test(value.start) &&
    DATE_RE.test(value.end) &&
    READING_MODES.has(value.mode);
  if (!ok) throw new HttpError(400, 'bad_reading');
  const clean = (t) => t.replace(/[\u0000-\u001f\u007f]/g, '');
  return JSON.stringify({ title: clean(value.title), range: clean(value.range), start: value.start, end: value.end, mode: value.mode });
}

function parseProgress(value) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new HttpError(400, 'bad_progress');
  return value;
}

function codeFrom(req) {
  const code = bearerCode(req);
  if (!code) throw new HttpError(401, 'no_code');
  return code;
}

/** X-Room-Member 헤더 → {id, key}. 없거나 꼴이 맞지 않으면 401 */
function memberFrom(req) {
  const m = MEMBER_RE.exec(req.headers['x-room-member'] ?? '');
  if (!m) throw new HttpError(401, 'no_member');
  return { id: m[1], key: m[2] };
}

const memberJson = (r) => ({
  id: r.id,
  name: r.name,
  color: r.color,
  owner: r.owner,
  days: r.days,
  progress: r.progress,
  reading: r.reading ?? null,
  joinedAt: r.joined_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/**
 * /api/rooms… 요청 처리기 → (req, pathname) => [status, body]
 * ensureStorage(): 데이터베이스가 한도를 넘었으면 던진다 (방 만들기·들어가기 전에 부른다)
 */
export function createRoomsApi(pool, { ensureStorage = async () => {} } = {}) {
  /** 트랜잭션 안에서 fn(client)을 부른다 */
  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** 초대 코드에 맞는 방 (forUpdate면 잠근다: 멤버 수를 세거나 방장을 넘길 때) */
  async function roomOf(client, req, { forUpdate = false } = {}) {
    const r = await client.query(`SELECT id FROM reading_rooms WHERE code_hash = $1${forUpdate ? ' FOR UPDATE' : ''}`, [
      sha256(codeFrom(req)),
    ]);
    if (!r.rowCount) throw new HttpError(404, 'no_room');
    return r.rows[0].id;
  }

  /** 요청을 보낸 멤버. 키가 맞지 않거나 내보내진 멤버면 404 no_member */
  async function memberOf(client, req, roomId) {
    const { id, key } = memberFrom(req);
    const r = await client.query('SELECT id, owner FROM room_members WHERE room_id = $1 AND id = $2 AND key_hash = $3', [
      roomId,
      id,
      sha256(key),
    ]);
    if (!r.rowCount) throw new HttpError(404, 'no_member');
    return r.rows[0];
  }

  /** 새 멤버를 넣고 {id, key}를 돌려준다 */
  async function addMember(client, roomId, { name, color }, owner = false) {
    for (let i = 0; i < 5; i++) {
      const member = { id: randomToken(10), key: randomToken(26) };
      const r = await client.query(
        `INSERT INTO room_members (room_id, id, key_hash, name, color, owner) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [roomId, member.id, sha256(member.key), name, color, owner],
      );
      if (r.rowCount) return member;
    }
    throw new Error('멤버 번호를 만들지 못했습니다');
  }

  const parseMember = (m) => ({ name: parseName(m?.name, MEMBER_NAME), color: parseColor(m?.color) });

  async function createRoom(req) {
    const body = await readJson(req, MAX_BODY);
    const name = parseName(body.name, ROOM_NAME);
    const plan = parsePlan(body.plan);
    const first = parseMember(body.member);
    await ensureStorage();
    await pool.query(`DELETE FROM reading_rooms WHERE seen_at < now() - interval '${STALE}'`);
    return transaction(async (client) => {
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const r = await client.query(
          'INSERT INTO reading_rooms (code_hash, name, plan) VALUES ($1, $2, $3::jsonb) ON CONFLICT (code_hash) DO NOTHING RETURNING id',
          [sha256(code), name, plan],
        );
        if (r.rowCount) return [201, { code, member: await addMember(client, r.rows[0].id, first, true) }];
      }
      throw new Error('초대 코드를 만들지 못했습니다');
    });
  }

  async function getRoom(req) {
    const room = (
      await pool.query('SELECT id, name, plan, created_at FROM reading_rooms WHERE code_hash = $1', [sha256(codeFrom(req))])
    ).rows[0];
    if (!room) throw new HttpError(404, 'no_room');
    const members = await pool.query('SELECT * FROM room_members WHERE room_id = $1 ORDER BY joined_at, id', [room.id]);
    return [200, { name: room.name, plan: room.plan, createdAt: room.created_at.toISOString(), members: members.rows.map(memberJson) }];
  }

  async function join(req) {
    const member = parseMember(await readJson(req, MAX_BODY));
    await ensureStorage();
    return transaction(async (client) => {
      const roomId = await roomOf(client, req, { forUpdate: true });
      const n = (await client.query('SELECT count(*)::int AS n FROM room_members WHERE room_id = $1', [roomId])).rows[0].n;
      if (n >= MAX_MEMBERS) throw new HttpError(409, 'room_full');
      // 아무도 없는 방(모두 나간 뒤 지워지기 전)은 없다. 첫 멤버는 방장으로 들어온 사람이다.
      return [201, await addMember(client, roomId, member)];
    });
  }

  async function update(req) {
    const body = await readJson(req, MAX_BODY);
    const { name, color } = parseMember(body);
    const days = parseDays(body.days);
    const progress = parseProgress(body.progress);
    const reading = parseReading(body.reading);
    return transaction(async (client) => {
      const roomId = await roomOf(client, req);
      const me = await memberOf(client, req, roomId);
      await client.query(
        `UPDATE room_members SET name = $3, color = $4, days = $5::jsonb, progress = $6, reading = $7::jsonb, updated_at = now()
          WHERE room_id = $1 AND id = $2`,
        [roomId, me.id, name, color, days, progress, reading],
      );
      await client.query("UPDATE reading_rooms SET seen_at = now() WHERE id = $1 AND seen_at < now() - interval '1 hour'", [
        roomId,
      ]);
      return [204, null];
    });
  }

  async function leave(req) {
    return transaction(async (client) => {
      const roomId = await roomOf(client, req, { forUpdate: true });
      const me = await memberOf(client, req, roomId);
      await client.query('DELETE FROM room_members WHERE room_id = $1 AND id = $2', [roomId, me.id]);
      const next = (
        await client.query('SELECT id FROM room_members WHERE room_id = $1 ORDER BY joined_at, id LIMIT 1', [roomId])
      ).rows[0];
      if (!next) await client.query('DELETE FROM reading_rooms WHERE id = $1', [roomId]);
      else if (me.owner) await client.query('UPDATE room_members SET owner = true WHERE room_id = $1 AND id = $2', [roomId, next.id]);
      return [204, null];
    });
  }

  async function removeMember(req, id) {
    return transaction(async (client) => {
      const roomId = await roomOf(client, req, { forUpdate: true });
      const me = await memberOf(client, req, roomId);
      if (!me.owner) throw new HttpError(403, 'not_owner');
      if (id === me.id) throw new HttpError(400, 'is_owner'); // 방장은 나가기로
      const r = await client.query('DELETE FROM room_members WHERE room_id = $1 AND id = $2', [roomId, id]);
      if (!r.rowCount) throw new HttpError(404, 'no_such_member');
      return [204, null];
    });
  }

  async function deleteRoom(req) {
    return transaction(async (client) => {
      const roomId = await roomOf(client, req, { forUpdate: true });
      const me = await memberOf(client, req, roomId);
      if (!me.owner) throw new HttpError(403, 'not_owner');
      await client.query('DELETE FROM reading_rooms WHERE id = $1', [roomId]);
      return [204, null];
    });
  }

  return async function rooms(req, pathname) {
    const route = `${req.method} ${pathname}`;
    if (route === 'POST /api/rooms') return createRoom(req);
    if (route === 'GET /api/rooms/room') return getRoom(req);
    if (route === 'DELETE /api/rooms/room') return deleteRoom(req);
    if (route === 'POST /api/rooms/members') return join(req);
    if (route === 'PUT /api/rooms/members/me') return update(req);
    if (route === 'DELETE /api/rooms/members/me') return leave(req);
    const m = /^DELETE \/api\/rooms\/members\/([0-9A-Z]{10})$/.exec(route);
    if (m) return removeMember(req, m[1]);
    throw new HttpError(404, 'not_found');
  };
}
