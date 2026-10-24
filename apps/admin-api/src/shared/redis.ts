import { createClient } from 'redis';
import { config } from 'src/config/configuration';
import logger from 'src/shared/logger';

/** The few Redis operations the admin API needs (kept small so tests can use an in-memory fake). */
export interface AdminKv {
  get(key: string): Promise<string | null>;
  /** Set with a TTL in seconds. */
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
  /** Atomic get + delete (single-use codes). */
  getDel(key: string): Promise<string | null>;
  del(keys: string | string[]): Promise<number>;
  /** INCR; sets the TTL when the key is new. Returns the new count. */
  incrWithTtl(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  sAdd(key: string, member: string): Promise<unknown>;
  sRem(key: string, member: string): Promise<unknown>;
  sMembers(key: string): Promise<string[]>;
  ping(): Promise<string>;
  /** Raw client for queue stats (LLEN/ZCARD on bull keys); null in tests. */
  raw?: ReturnType<typeof createClient> | null;
}

let kv: AdminKv | null = null;

function createRedisKv(): AdminKv {
  const { host, port, database } = config.redis;
  const client = createClient({ url: `redis://${host}:${port}/${database}` });
  client.on('error', (err) => logger.error(`Redis error: ${err}`));
  client
    .connect()
    .then(() => logger.info('Connected to Redis'))
    .catch((err) => logger.error(`Error connecting to Redis: ${err}`));
  return {
    get: (key) => client.get(key),
    setEx: (key, seconds, value) => client.set(key, value, { EX: seconds }),
    getDel: (key) => client.getDel(key),
    del: (keys) => (Array.isArray(keys) && keys.length === 0 ? Promise.resolve(0) : client.del(keys)),
    incrWithTtl: async (key, seconds) => {
      const [count] = (await client.multi().incr(key).expire(key, seconds, 'NX').exec()) as unknown as [number];
      return Number(count);
    },
    ttl: (key) => client.ttl(key),
    sAdd: (key, member) => client.sAdd(key, member),
    sRem: (key, member) => client.sRem(key, member),
    sMembers: (key) => client.sMembers(key),
    ping: () => client.ping(),
    raw: client as ReturnType<typeof createClient>,
  };
}

export function getKv(): AdminKv {
  if (!kv) kv = createRedisKv();
  return kv;
}

/** Tests: swap in a fake. */
export function setKv(next: AdminKv | null) {
  kv = next;
}
