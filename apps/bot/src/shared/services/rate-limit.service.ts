import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class RateLimitService {
  async checkRateLimit(userId: number | string, action: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const key = `ratelimit:${action}:${userId}`;

    try {
      // INCR first, then compare: atomic, so a burst of parallel requests can't all pass a GET check.
      const count = await redisService.incr(key);
      if (count === 1) await redisService.expire(key, windowSeconds);

      if (count > limit) {
        let ttl = await redisService.ttl(key);
        // A key left without a TTL (expire failed after incr) would block forever.
        if (ttl === -1) {
          await redisService.expire(key, windowSeconds);
          ttl = windowSeconds;
        }
        logger.warn(`[RateLimit] User ${userId} exceeded ${action} limit (${count}/${limit})`);
        return { allowed: false, remaining: 0, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
      }

      return { allowed: true, remaining: limit - count, retryAfterSeconds: 0 };
    } catch (error) {
      logger.error(`[RateLimit] Redis error for ${action}:${userId}: ${error}`);
      return {
        allowed: true,
        remaining: limit,
        retryAfterSeconds: 0,
      };
    }
  }
}

export const rateLimitService = new RateLimitService();
