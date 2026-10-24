import { getKv } from 'src/shared/redis';
import { randomToken, secretHash, TOKEN_FORMAT } from 'src/auth/tokens';

export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const SESSION_COOKIE = 'tbot_admin';

const SESSIONS_INDEX = 'admin:sessions';
const sessionKey = (hash: string) => `admin:session:${hash}`;

export interface StoredSession {
  telegramUserId: number;
  createdAt: string;
  expiresAt: string;
  /** The browser's user agent at sign-in (to recognise it in "Active sessions"). */
  userAgent?: string | null;
  /** Address the sign-in came from. */
  ip?: string | null;
  /** Last request with this session (updated at most once a minute). */
  lastSeenAt?: string | null;
}

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

export async function createSession(
  telegramUserId: number,
  meta: SessionMeta = {},
): Promise<{ id: string; session: StoredSession }> {
  const id = randomToken();
  const now = Date.now();
  const session: StoredSession = {
    telegramUserId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000).toISOString(),
    userAgent: meta.userAgent ? meta.userAgent.slice(0, 512) : null,
    ip: meta.ip ?? null,
    lastSeenAt: new Date(now).toISOString(),
  };
  const hash = secretHash(id);
  await getKv().setEx(sessionKey(hash), SESSION_TTL_SECONDS, JSON.stringify(session));
  await getKv().sAdd(SESSIONS_INDEX, hash);
  return { id, session };
}

export async function getSession(id: string | undefined): Promise<StoredSession | null> {
  if (!id || !TOKEN_FORMAT.test(id)) return null;
  const raw = await getKv().get(sessionKey(secretHash(id)));
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as StoredSession;
    return typeof s.telegramUserId === 'number' ? s : null;
  } catch {
    return null;
  }
}

export async function deleteSession(id: string | undefined): Promise<void> {
  if (!id || !TOKEN_FORMAT.test(id)) return;
  const hash = secretHash(id);
  await getKv().del(sessionKey(hash));
  await getKv().sRem(SESSIONS_INDEX, hash);
}

const TOUCH_EVERY_MS = 60_000;

/** Records that the session was just used (rewrites it with its remaining lifetime; at most once a minute). */
export async function touchSession(id: string, session: StoredSession): Promise<void> {
  const now = Date.now();
  if (session.lastSeenAt && now - Date.parse(session.lastSeenAt) < TOUCH_EVERY_MS) return;
  const left = Math.floor((Date.parse(session.expiresAt) - now) / 1000);
  if (left <= 0) return;
  await getKv().setEx(
    sessionKey(secretHash(id)),
    left,
    JSON.stringify({ ...session, lastSeenAt: new Date(now).toISOString() }),
  );
}

/** Public id of a session (part of its hash — not usable as a cookie). */
const publicId = (hash: string) => hash.slice(0, 24);

export interface LiveSession extends StoredSession {
  id: string;
  current: boolean;
}

/** Every live session, newest first; forgets index entries whose session already expired. */
export async function listSessions(currentId: string | undefined): Promise<LiveSession[]> {
  const kv = getKv();
  const current = currentId && TOKEN_FORMAT.test(currentId) ? secretHash(currentId) : null;
  const out: LiveSession[] = [];
  for (const hash of await kv.sMembers(SESSIONS_INDEX)) {
    const raw = await kv.get(sessionKey(hash));
    if (!raw) {
      await kv.sRem(SESSIONS_INDEX, hash);
      continue;
    }
    try {
      const s = JSON.parse(raw) as StoredSession;
      out.push({ ...s, id: publicId(hash), current: hash === current });
    } catch {
      /* unreadable: skip */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Ends one session by its public id. Returns it (for the audit entry), or null when it no longer exists. */
export async function revokeSession(id: string): Promise<StoredSession | null> {
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  const kv = getKv();
  const hash = (await kv.sMembers(SESSIONS_INDEX)).find((h) => publicId(h) === id);
  if (!hash) return null;
  const raw = await kv.get(sessionKey(hash));
  await kv.del(sessionKey(hash));
  await kv.sRem(SESSIONS_INDEX, hash);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

/** Signs out everywhere. Returns how many sessions were still alive. */
export async function deleteAllSessions(): Promise<number> {
  const kv = getKv();
  const hashes = await kv.sMembers(SESSIONS_INDEX);
  const removed = hashes.length ? await kv.del(hashes.map(sessionKey)) : 0;
  await kv.del(SESSIONS_INDEX);
  return removed;
}
