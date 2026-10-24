import { rateLimitService } from 'src/shared/services/rate-limit.service';

/**
 * AI requests one person can make per day across ALL groups and channels (Telegram, app, MCP).
 * The per-group limits alone let someone multiply their quota by adding the bot to more groups.
 */
export const AI_USER_DAILY_LIMIT = 100;
const AI_USER_DAILY_WINDOW_SECONDS = 24 * 60 * 60;

export function checkUserAiDailyLimit(telegramUserId: number) {
  return rateLimitService.checkRateLimit(telegramUserId, 'ai_user_daily', AI_USER_DAILY_LIMIT, AI_USER_DAILY_WINDOW_SECONDS);
}

/** "45s", "12 min", "3h" — a human wait time for rate-limit messages. */
export function formatRetryAfter(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 90 * 60) return `${Math.ceil(seconds / 60)} min`;
  return `${Math.ceil(seconds / 3600)}h`;
}
