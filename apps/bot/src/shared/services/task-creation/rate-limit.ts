import { AI_DEFAULT_GROUP_BURST, AI_LIMITER } from '@tbot/shared';
import { AiLimitResult, AiOverrides, utcDayWindow } from 'src/shared/services/ai-quota';
import { rateLimitService } from 'src/shared/services/rate-limit.service';

const AI_RATE_LIMIT = AI_DEFAULT_GROUP_BURST.limit;
const AI_RATE_WINDOW_SECONDS = AI_DEFAULT_GROUP_BURST.windowMinutes * 60;

/**
 * Per-group AI rate limit shared by /task and /ai. `allowed` when the call may go ahead; otherwise the result
 * says which limit it was and how long until it frees up (for aiGroupLimitText). When the owner set a daily
 * limit for the group (group.ai.dailyLimit) it replaces the 10-minute window with that many requests per UTC day.
 */
export async function checkGroupAiRateLimit(chatId: number, group?: AiOverrides | null): Promise<AiLimitResult> {
  const daily = group?.ai?.dailyLimit;
  if (typeof daily === 'number') {
    const today = utcDayWindow(AI_LIMITER.groupDaily);
    const result = await rateLimitService.checkRateLimit(chatId, today.action, daily, today.seconds);
    return { ...result, scope: 'day', limit: daily };
  }
  const result = await rateLimitService.checkRateLimit(chatId, AI_LIMITER.groupBurst, AI_RATE_LIMIT, AI_RATE_WINDOW_SECONDS);
  return { ...result, scope: 'minute', limit: AI_RATE_LIMIT };
}
