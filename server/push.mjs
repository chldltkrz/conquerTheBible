// 읽기 알림(웹 푸시). 정한 시각에 그날 읽을 분량을 아직 다 읽지 않았으면 기기에 알림을 보낸다.
//
// 서버는 기기의 기록을 해석하지 않는다. 날마다 무엇을 읽는지와 다 읽었는지는 기기(app/js/reminder.js)가
// 계산해 days로 올려 두고, 기록이 바뀔 때마다 다시 올린다. 서버는 알림 시각에 그날 줄만 본다.
// 동기화 중인 기기는 같은 동기화 공간의 다른 기기가 그날 다 읽었다고 올렸어도 보내지 않는다.
//
//   GET    /api/push/key            VAPID 공개 키 → {key, merge: true} (merge: 아래 merge를 안다)
//   PUT    /api/push/subscription   {subscription, time: "21:00", tz: "Asia/Seoul",
//                                    days: {"2026-10-17": {text: "창세기 1–3장 · 약 12분", done: false}}, merge?}
//                                   (동기화 중이면 Authorization: Bearer <동기화 코드>로 같은 공간의 기기와 묶는다)
//                                   merge면 days를 바꾸지 않고 보낸 날만 덮어쓴다 (앱을 떠날 때 오늘·내일만 보낸다)
//   DELETE /api/push/subscription   {endpoint}
//   POST   /api/push/test           {endpoint} 지금 시험 알림을 보낸다
//   POST   /api/push/renew          {old, subscription} 브라우저가 구독을 바꿨을 때 (서비스 워커가 보낸다)

import webpush from 'web-push';
import { HttpError, readJson } from './http.mjs';

export const PUSH_SCHEMA = `
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint   text        PRIMARY KEY,               -- 푸시 서비스 주소 (기기마다 다르고 추측할 수 없다)
    p256dh     text        NOT NULL,                  -- 알림 내용을 암호화할 기기의 키
    auth       text        NOT NULL,
    remind_at  time        NOT NULL,                  -- 기기 시간대의 알림 시각
    tz         text        NOT NULL,                  -- IANA 시간대 'Asia/Seoul'
    space_id   bigint      REFERENCES sync_spaces(id) ON DELETE SET NULL,
    days       jsonb       NOT NULL DEFAULT '{}',     -- 읽을 분량이 있는 날 {"2026-10-17": {"text": …, "done": false}}
    next_at    timestamptz NOT NULL,                  -- 다음 알림 시각
    tested_at  timestamptz,                           -- 마지막 시험 알림
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()     -- 기기가 마지막으로 days를 올린 때
  );
  CREATE INDEX IF NOT EXISTS push_subscriptions_due ON push_subscriptions (next_at);
  CREATE INDEX IF NOT EXISTS push_subscriptions_space ON push_subscriptions (space_id);
`;

/** 알림을 보낼 수 있는 푸시 서비스. 서버가 이 주소로 요청을 보내므로 아무 주소나 받지 않는다 */
export const PUSH_HOSTS = [
  'fcm.googleapis.com', // 크롬, 엣지(안드로이드), 삼성 인터넷, 웨일
  'android.googleapis.com',
  'push.services.mozilla.com', // 파이어폭스
  'push.apple.com', // 사파리 (아이폰은 홈 화면에 추가한 앱)
  'notify.windows.com', // 엣지(윈도)
];

const MAX_BODY = 256 * 1024;
const MAX_ENDPOINT = 1000;
const MAX_DAYS = 400; // 기기는 오늘부터 1년치를 올린다
const MAX_TEXT = 200;
const BATCH = 200; // 한 번에 꺼내는 알림 수
const PARALLEL = 10; // 함께 보내는 알림 수
const REMINDER_TTL = 3 * 60 * 60; // 기기가 꺼져 있으면 푸시 서비스가 이만큼(초) 기다렸다가 버린다
const LATE = '1 hour'; // 서버가 멈췄다가 이보다 늦게 찾은 알림은 보내지 않는다
const STALE = '400 days'; // 이만큼 기기가 다녀가지 않은 구독은 지운다 (올려 둔 날이 모두 지났다)

const TITLE = '오늘 말씀을 읽을 시간입니다';

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TZ_RE = /^[A-Za-z0-9_+\-/]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 지금 다음에 오는 그 시각: 그 시간대의 오늘 그 시각이 지났으면 내일 (서머타임도 시간대 규칙대로) */
function nextAt(time, tz) {
  const day = `date_trunc('day', now() AT TIME ZONE ${tz})`;
  return `(CASE WHEN (${day} + ${time}) AT TIME ZONE ${tz} > now()
    THEN (${day} + ${time}) AT TIME ZONE ${tz}
    ELSE (${day} + interval '1 day' + ${time}) AT TIME ZONE ${tz} END)`;
}

export function isPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > MAX_ENDPOINT) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  return PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

/** 브라우저의 PushSubscription.toJSON() */
function parseSubscription(sub) {
  const endpoint = sub?.endpoint;
  const { p256dh, auth } = sub?.keys ?? {};
  const key = (s, max) => typeof s === 'string' && s.length <= max && B64URL.test(s);
  if (!isPushEndpoint(endpoint) || !key(p256dh, 200) || !key(auth, 100)) throw new HttpError(400, 'bad_subscription');
  return { endpoint, p256dh, auth };
}

function parseDays(days) {
  if (!days || typeof days !== 'object' || Array.isArray(days)) throw new HttpError(400, 'bad_days');
  const entries = Object.entries(days);
  if (entries.length > MAX_DAYS) throw new HttpError(400, 'bad_days');
  const out = {};
  for (const [date, d] of entries) {
    if (!DATE_RE.test(date) || typeof d?.done !== 'boolean' || typeof d.text !== 'string' || d.text.length > MAX_TEXT) {
      throw new HttpError(400, 'bad_days');
    }
    out[date] = { text: d.text.replace(/\u0000/g, ''), done: d.done }; // jsonb에 넣을 수 없는 글자
  }
  return out;
}

/** 웹 푸시로 보내는 함수 (sender). 테스트는 가짜 sender를 넘긴다 */
export function webPushSender({ publicKey, privateKey, subject }) {
  const vapidDetails = { subject, publicKey, privateKey };
  return (sub, payload, { ttl, topic }) =>
    webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
      TTL: ttl,
      topic,
      urgency: 'normal',
      vapidDetails,
      timeout: 10000,
    });
}

/** 알림 시각이 된 구독을 찾아 보낸다. tick()을 주기적으로 부른다 */
export function createReminders(pool, sender) {
  /** 알림 하나를 보낸다 → 'sent' | 'gone'(구독이 없어져 지움) | 'failed' */
  async function deliver(sub, payload, { ttl = REMINDER_TTL } = {}) {
    try {
      await sender(sub, payload, { ttl, topic: payload.tag });
      return 'sent';
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // 브라우저에서 알림을 끄거나 앱을 지웠다
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
        return 'gone';
      }
      // 주소에는 기기를 가리키는 토큰이 있어 서비스 이름만 남긴다
      console.error(`알림을 보내지 못함 (${new URL(sub.endpoint).hostname}):`, err.statusCode ?? '', err.message);
      return 'failed';
    }
  }

  /** 같은 동기화 공간의 기기 중 하나라도 그날 다 읽었다고 올렸는지 */
  async function doneInSpace(spaceId, date) {
    const r = await pool.query(
      `SELECT bool_or(coalesce((days -> $2 ->> 'done')::boolean, false)) AS done
         FROM push_subscriptions WHERE space_id = $1`,
      [spaceId, date],
    );
    return r.rows[0].done === true;
  }

  async function remind(s) {
    if (s.late) return;
    const day = s.days[s.date];
    if (!day || day.done) return;
    if (s.space_id != null && (await doneInSpace(s.space_id, s.date))) return;
    await deliver(s, { title: TITLE, body: day.text, tag: 'reminder', url: './' });
  }

  let running = null;
  let cleanedAt = 0;

  async function run() {
    for (;;) {
      // 보낼 것을 꺼내면서 다음 알림 시각으로 옮긴다 (보내다 실패해도 같은 알림을 되풀이하지 않도록)
      const due = (
        await pool.query(
          `WITH due AS (
             SELECT endpoint, next_at AS due_at FROM push_subscriptions
              WHERE next_at <= now() ORDER BY next_at LIMIT $1 FOR UPDATE SKIP LOCKED
           )
           UPDATE push_subscriptions s SET next_at = ${nextAt('s.remind_at', 's.tz')}
             FROM due WHERE s.endpoint = due.endpoint
           RETURNING s.endpoint, s.p256dh, s.auth, s.space_id, s.days,
                     to_char(due.due_at AT TIME ZONE s.tz, 'YYYY-MM-DD') AS date,
                     now() - due.due_at > interval '${LATE}' AS late`,
          [BATCH],
        )
      ).rows;
      for (let i = 0; i < due.length; i += PARALLEL) await Promise.all(due.slice(i, i + PARALLEL).map(remind));
      if (due.length < BATCH) break;
    }
    if (Date.now() - cleanedAt > 60 * 60 * 1000) {
      cleanedAt = Date.now();
      await pool.query(`DELETE FROM push_subscriptions WHERE updated_at < now() - interval '${STALE}'`);
    }
  }

  return {
    deliver,
    /** 지금 보낼 알림을 모두 보낸다. 이미 하는 중이면 그것을 기다린다 */
    tick() {
      running ??= run().finally(() => {
        running = null;
      });
      return running;
    },
    /** 하던 것이 끝나기를 기다린다 (서버를 닫을 때) */
    idle: () => (running ?? Promise.resolve()).catch(() => {}),
  };
}

/**
 * /api/push/… 요청 처리기 → (route, req) => [status, body]
 * spaceIdFor(req): 요청의 동기화 코드에 맞는 공간 번호(없으면 null), deliver: createReminders()의 deliver,
 * ensureStorage(): 데이터베이스가 한도를 넘었으면 던진다 (새 구독을 받기 전에 부른다)
 */
export function createPushApi(pool, { publicKey, spaceIdFor, deliver, ensureStorage = async () => {} }) {
  async function subscribe(req) {
    const body = await readJson(req, MAX_BODY);
    const sub = parseSubscription(body.subscription);
    if (typeof body.time !== 'string' || !TIME_RE.test(body.time)) throw new HttpError(400, 'bad_time');
    if (typeof body.tz !== 'string' || !TZ_RE.test(body.tz)) throw new HttpError(400, 'bad_tz');
    const days = parseDays(body.days);
    // 새 구독만 데이터베이스 한도를 본다 (구독 주소는 아무나 지어 보낼 수 있다). 있던 구독은 내용을 바꿀 뿐 늘지 않는다
    if (!(await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint])).rowCount) {
      await ensureStorage();
    }
    const spaceId = await spaceIdFor(req);
    try {
      await pool.query(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, remind_at, tz, space_id, days, next_at)
         VALUES ($1, $2, $3, $4::time, $5::text, $6, $7::jsonb, ${nextAt('$4::time', '$5::text')})
         ON CONFLICT (endpoint) DO UPDATE SET
           p256dh = excluded.p256dh, auth = excluded.auth, space_id = excluded.space_id,
           days = CASE WHEN $8 THEN push_subscriptions.days || excluded.days ELSE excluded.days END, updated_at = now(),
           -- 시각이나 시간대를 바꿨을 때만 다음 알림 시각을 다시 정한다 (오늘 보낸 알림을 또 보내지 않도록)
           next_at = CASE WHEN push_subscriptions.remind_at = excluded.remind_at AND push_subscriptions.tz = excluded.tz
                          THEN push_subscriptions.next_at ELSE excluded.next_at END,
           remind_at = excluded.remind_at, tz = excluded.tz`,
        [sub.endpoint, sub.p256dh, sub.auth, body.time, body.tz, spaceId, JSON.stringify(days), body.merge === true],
      );
    } catch (err) {
      if (err.code === '22023') throw new HttpError(400, 'bad_tz'); // 모르는 시간대
      throw err;
    }
    return [204, null];
  }

  async function endpointFrom(req) {
    const { endpoint } = await readJson(req, MAX_BODY);
    if (typeof endpoint !== 'string' || !endpoint || endpoint.length > MAX_ENDPOINT) throw new HttpError(400, 'bad_endpoint');
    return endpoint;
  }

  async function test(req) {
    const endpoint = await endpointFrom(req);
    const r = await pool.query(
      `UPDATE push_subscriptions SET tested_at = now()
        WHERE endpoint = $1 AND (tested_at IS NULL OR tested_at < now() - interval '10 seconds')
        RETURNING endpoint, p256dh, auth`,
      [endpoint],
    );
    if (!r.rowCount) {
      const exists = await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
      throw exists.rowCount ? new HttpError(429, 'busy') : new HttpError(404, 'no_subscription');
    }
    const result = await deliver(
      r.rows[0],
      { title: '읽기 알림이 켜져 있습니다', body: '정한 시각에 오늘 분량이 남아 있으면 이렇게 알려 드립니다.', tag: 'reminder-test', url: './' },
      { ttl: 10 * 60 },
    );
    if (result === 'gone') throw new HttpError(410, 'gone');
    if (result === 'failed') throw new HttpError(502, 'push_failed');
    return [204, null];
  }

  async function renew(req) {
    const body = await readJson(req, MAX_BODY);
    const sub = parseSubscription(body.subscription);
    if (typeof body.old !== 'string' || !body.old) throw new HttpError(400, 'bad_endpoint');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND endpoint <> $2', [sub.endpoint, body.old]);
      const r = await client.query('UPDATE push_subscriptions SET endpoint = $2, p256dh = $3, auth = $4 WHERE endpoint = $1', [
        body.old,
        sub.endpoint,
        sub.p256dh,
        sub.auth,
      ]);
      if (!r.rowCount) throw new HttpError(404, 'no_subscription');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return [204, null];
  }

  return async function push(route, req) {
    switch (route) {
      case 'GET /api/push/key':
        return [200, { key: publicKey, merge: true }];
      case 'PUT /api/push/subscription':
        return subscribe(req);
      case 'DELETE /api/push/subscription':
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [await endpointFrom(req)]);
        return [204, null];
      case 'POST /api/push/test':
        return test(req);
      case 'POST /api/push/renew':
        return renew(req);
      default:
        throw new HttpError(404, 'not_found');
    }
  };
}
