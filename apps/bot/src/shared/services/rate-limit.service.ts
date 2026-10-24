import { UsageKind } from '@tbot/shared';
import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';
import { recordUsage, UsageInput } from 'src/shared/services/telemetry/usage-tracker';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Who hit a limit, when the request context doesn't say (e.g. the MCP auth middleware). */
export type RateLimitMeta = Pick<UsageInput, 'userId' | 'groupId' | 'channel' | 'client'>;

/** "ai_command:-100123" → "ai_command": the limit's name without the per-chat suffix. */
export const limitName = (action: string) => action.split(':')[0];

export class RateLimitService {
  async checkRateLimit(
    userId: number | string,
    action: string,
    limit: number,
    windowSeconds: number,
    meta: RateLimitMeta = {},
  ): Promise<RateLimitResult> {
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
        recordUsage({ kind: UsageKind.RATE_LIMITED, name: limitName(action), ok: false, ...meta });
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
