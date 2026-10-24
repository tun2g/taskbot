import { getKv } from 'src/shared/redis';

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
