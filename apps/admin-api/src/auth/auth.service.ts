import { User } from '@tbot/db';
import { createHmac, randomBytes } from 'node:crypto';
import { config } from 'src/config/configuration';
import { personName } from 'src/stats/aggregate';
import { getKv } from 'src/shared/redis';
import { telegram } from 'src/shared/telegram';

export const LOGIN_CODE_TTL_SECONDS = 5 * 60;
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const SESSION_COOKIE = 'tbot_admin';

const SESSIONS_INDEX = 'admin:sessions';
const loginKey = (hash: string) => `admin:login:${hash}`;
const sessionKey = (hash: string) => `admin:session:${hash}`;

/**
 * Keyed SHA-256 of a secret value. Redis only ever holds hashes of login codes and session ids, so reading
 * Redis (or a backup of it) doesn't give a usable link or cookie.
 */
export function secretHash(value: string): string {
  return createHmac('sha256', config.sessionSecret).update(value).digest('hex');
}

const randomToken = () => randomBytes(32).toString('base64url');
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

// ── One-time login codes ────────────────────────────────────────────────────

export async function createLoginCode(): Promise<string> {
  const code = randomToken();
  await getKv().setEx(loginKey(secretHash(code)), LOGIN_CODE_TTL_SECONDS, JSON.stringify({ createdAt: new Date().toISOString() }));
  return code;
}

/** True once per valid, unexpired code (atomic GETDEL — a second use or a racing request gets false). */
export async function consumeLoginCode(code: string): Promise<boolean> {
  if (!TOKEN_FORMAT.test(code)) return false;
  return (await getKv().getDel(loginKey(secretHash(code)))) !== null;
}

export async function discardLoginCode(code: string): Promise<void> {
  await getKv().del(loginKey(secretHash(code)));
}

// ── Sessions ────────────────────────────────────────────────────────────────

export interface StoredSession {
  telegramUserId: number;
  createdAt: string;
  expiresAt: string;
}

export async function createSession(telegramUserId: number): Promise<{ id: string; session: StoredSession }> {
  const id = randomToken();
  const now = Date.now();
  const session: StoredSession = {
    telegramUserId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000).toISOString(),
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

/** Signs out everywhere. Returns how many sessions were still alive. */
export async function deleteAllSessions(): Promise<number> {
  const kv = getKv();
  const hashes = await kv.sMembers(SESSIONS_INDEX);
  const removed = hashes.length ? await kv.del(hashes.map(sessionKey)) : 0;
  await kv.del(SESSIONS_INDEX);
  return removed;
}

// ── Rate limiting ───────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Fixed-window counter in Redis. */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const kv = getKv();
  const count = await kv.incrWithTtl(`admin:rl:${key}`, windowSeconds);
  if (count <= limit) return { allowed: true, retryAfterSeconds: 0 };
  const ttl = await kv.ttl(`admin:rl:${key}`);
  return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
}

// ── Owner profile ───────────────────────────────────────────────────────────

export interface OwnerProfile {
  telegramUserId: number;
  name: string;
  username: string | null;
}

let ownerCache: { profile: OwnerProfile; at: number } | null = null;

/** The owner's name: from the users collection, else Telegram getChat, else a generic label. Cached 10 min. */
export async function ownerProfile(): Promise<OwnerProfile> {
  const id = config.ownerTelegramId;
  if (ownerCache && ownerCache.profile.telegramUserId === id && Date.now() - ownerCache.at < 600_000) return ownerCache.profile;
  let profile: OwnerProfile | null = null;
  const user = await User.findOne({ telegramUserId: id }).select('telegramUserId username firstName lastName').lean();
  if (user) {
    profile = { telegramUserId: id, name: personName(user), username: user.username || null };
  } else {
    const chat = await telegram.getChat(id);
    if (chat.ok) {
      const name = [chat.result.first_name, chat.result.last_name].filter(Boolean).join(' ') || (chat.result.username ? `@${chat.result.username}` : 'Bot owner');
      profile = { telegramUserId: id, name, username: chat.result.username || null };
    }
  }
  if (profile) ownerCache = { profile, at: Date.now() };
  return profile ?? { telegramUserId: id, name: 'Bot owner', username: null };
}

/** Tests. */
export function resetOwnerCache() {
  ownerCache = null;
}
