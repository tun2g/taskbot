import { counterTtl, incrementCounter } from 'src/modules/auth/repositories/rate-limit.repository';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Fixed-window counter in Redis. */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const count = await incrementCounter(key, windowSeconds);
  if (count <= limit) return { allowed: true, retryAfterSeconds: 0 };
  const ttl = await counterTtl(key);
  return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
}
