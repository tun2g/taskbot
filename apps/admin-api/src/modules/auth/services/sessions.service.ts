import { randomToken, secretHash, TOKEN_FORMAT } from 'src/modules/auth/helpers/tokens';
import {
  findSessionRaw,
  forgetSessionHash,
  listSessionHashes,
  removeAllSessions,
  removeSession,
  rewriteSession,
  saveSession,
} from 'src/modules/auth/repositories/sessions.repository';

export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const SESSION_COOKIE = 'tbot_admin';

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
  await saveSession(secretHash(id), SESSION_TTL_SECONDS, JSON.stringify(session));
  return { id, session };
}

export async function getSession(id: string | undefined): Promise<StoredSession | null> {
  if (!id || !TOKEN_FORMAT.test(id)) return null;
  const raw = await findSessionRaw(secretHash(id));
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
  await removeSession(secretHash(id));
}

const TOUCH_EVERY_MS = 60_000;

/** Records that the session was just used (rewrites it with its remaining lifetime; at most once a minute). */
export async function touchSession(id: string, session: StoredSession): Promise<void> {
  const now = Date.now();
  if (session.lastSeenAt && now - Date.parse(session.lastSeenAt) < TOUCH_EVERY_MS) return;
  const left = Math.floor((Date.parse(session.expiresAt) - now) / 1000);
  if (left <= 0) return;
  await rewriteSession(secretHash(id), left, JSON.stringify({ ...session, lastSeenAt: new Date(now).toISOString() }));
}

/** Public id of a session (part of its hash — not usable as a cookie). */
const publicId = (hash: string) => hash.slice(0, 24);

export interface LiveSession extends StoredSession {
  id: string;
  current: boolean;
}

/** Every live session, newest first; forgets index entries whose session already expired. */
export async function listSessions(currentId: string | undefined): Promise<LiveSession[]> {
  const current = currentId && TOKEN_FORMAT.test(currentId) ? secretHash(currentId) : null;
  const out: LiveSession[] = [];
  for (const hash of await listSessionHashes()) {
    const raw = await findSessionRaw(hash);
    if (!raw) {
      await forgetSessionHash(hash);
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
  const hash = (await listSessionHashes()).find((h) => publicId(h) === id);
  if (!hash) return null;
  const raw = await findSessionRaw(hash);
  await removeSession(hash);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

/** Signs out everywhere. Returns how many sessions were still alive. */
export async function deleteAllSessions(): Promise<number> {
  return removeAllSessions(await listSessionHashes());
}
