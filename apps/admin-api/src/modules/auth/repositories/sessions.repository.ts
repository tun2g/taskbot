import { getKv } from 'src/shared/redis';

/** Redis keys of the admin sessions (always by the hash of the session id, never the id itself). */
const SESSIONS_INDEX = 'admin:sessions';
const sessionKey = (hash: string) => `admin:session:${hash}`;

/** Writes a session record and adds it to the index. */
export async function saveSession(hash: string, ttlSeconds: number, json: string): Promise<void> {
  await getKv().setEx(sessionKey(hash), ttlSeconds, json);
  await getKv().sAdd(SESSIONS_INDEX, hash);
}

/** Rewrites a session record (keeps its index entry). */
export async function rewriteSession(hash: string, ttlSeconds: number, json: string): Promise<void> {
  await getKv().setEx(sessionKey(hash), ttlSeconds, json);
}

export async function findSessionRaw(hash: string): Promise<string | null> {
  return getKv().get(sessionKey(hash));
}

/** Deletes a session record and its index entry. */
export async function removeSession(hash: string): Promise<void> {
  await getKv().del(sessionKey(hash));
  await getKv().sRem(SESSIONS_INDEX, hash);
}

export async function listSessionHashes(): Promise<string[]> {
  return getKv().sMembers(SESSIONS_INDEX);
}

/** Drops an index entry whose session already expired. */
export async function forgetSessionHash(hash: string): Promise<void> {
  await getKv().sRem(SESSIONS_INDEX, hash);
}

/** Deletes every session in `hashes` and the whole index. Returns how many records still existed. */
export async function removeAllSessions(hashes: string[]): Promise<number> {
  const kv = getKv();
  const removed = hashes.length ? await kv.del(hashes.map(sessionKey)) : 0;
  await kv.del(SESSIONS_INDEX);
  return removed;
}
