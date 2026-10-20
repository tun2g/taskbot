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
      const current = await redisService.get(key);
      const currentCount = current ? parseInt(current, 10) : 0;

      if (currentCount >= limit) {
        const ttl = await redisService.ttl(key);
        const retryAfter = ttl > 0 ? ttl : windowSeconds;

        logger.warn(`[RateLimit] User ${userId} exceeded ${action} limit (${currentCount}/${limit})`);

        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: retryAfter,
        };
      }

      const newCount = await redisService.incr(key);

      if (newCount === 1) {
        await redisService.expire(key, windowSeconds);
      }

      return {
        allowed: true,
        remaining: limit - newCount,
        retryAfterSeconds: 0,
      };
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
