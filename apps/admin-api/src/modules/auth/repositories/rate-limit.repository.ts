import { getKv } from 'src/shared/redis';

const rateLimitKey = (key: string) => `admin:rl:${key}`;

/** Increments a fixed-window counter (the TTL is set when the window starts). Returns the new count. */
export async function incrementCounter(key: string, windowSeconds: number): Promise<number> {
  return getKv().incrWithTtl(rateLimitKey(key), windowSeconds);
}

/** Seconds left in the counter's window (Redis TTL semantics: negative when unknown). */
export async function counterTtl(key: string): Promise<number> {
  return getKv().ttl(rateLimitKey(key));
}
