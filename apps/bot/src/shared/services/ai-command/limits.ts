import { AI_LIMITER, AiFeature, UsageChannel } from '@tbot/shared';
import type { AiRequestContext } from 'src/shared/services/ai-command/context';
import { AiOverrides, checkUserAiDailyLimit, withAiScope } from 'src/shared/services/ai-quota';
import { rateLimitService } from 'src/shared/services/rate-limit.service';

/** Per-user AI limit, shared by Telegram /ai and the web chat (same Redis key). */
export const AI_USER_RATE_LIMIT = 6;
export const AI_USER_RATE_WINDOW_SECONDS = 60;

/** Usage channel of an AI request: MCP (ask_taskbot), the web chat, or Telegram. */
export function aiChannelOf(c: Pick<AiRequestContext, 'channel' | 'activityVia'>): UsageChannel {
  if (c.activityVia === 'mcp') return 'mcp';
  return c.channel === 'web' ? 'app' : 'telegram';
}

/** Runs `fn` as `feature` for this request (cost tagging + the owner's AI switches). */
export function withRequestAiScope<T>(feature: AiFeature, c: AiRequestContext, fn: () => T): T {
  return withAiScope(feature, { group: c.group, user: c.requester, channel: aiChannelOf(c) }, fn);
}

/**
 * Per-user AI limits: the per-minute burst in this group, then the daily quota across all groups
 * (`user` carries the owner's per-person override).
 */
export async function checkUserAiRateLimit(telegramUserId: number, chatId: number, user?: AiOverrides | null) {
  const burst = await rateLimitService.checkRateLimit(
    telegramUserId,
    `${AI_LIMITER.personBurst}:${chatId}`,
    AI_USER_RATE_LIMIT,
    AI_USER_RATE_WINDOW_SECONDS,
  );
  if (!burst.allowed) return { ...burst, scope: 'minute' as const };
  return checkUserAiDailyLimit(telegramUserId, user);
}
