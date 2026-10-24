import { AI_DEFAULT_USER_DAILY_LIMIT, AiFeature, UsageChannel } from '@tbot/shared';
import { configService } from 'src/configs/configuration';
import { rateLimitService } from 'src/shared/services/rate-limit.service';
import { settingsService } from 'src/shared/services/settings.service';
import { AiDisabledBy, ContextPatch, currentContext, withContext } from 'src/shared/services/telemetry/request-context';

/**
 * AI requests one person can make per day across ALL groups and channels (Telegram, app, MCP).
 * The per-group limits alone let someone multiply their quota by adding the bot to more groups.
 * The owner can change it (Settings → AI) or set it per person (user.ai.dailyLimit).
 */
export const AI_USER_DAILY_LIMIT = AI_DEFAULT_USER_DAILY_LIMIT;

/**
 * Daily AI limits reset at midnight UTC — the same "today" the admin app counts — rather than 24h after
 * the first call. Returns the limiter action for today and the seconds left until the reset.
 */
export function utcDayWindow(action: string, now = new Date()): { action: string; seconds: number } {
  const day = now.toISOString().slice(0, 10);
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return { action: `${action}:${day}`, seconds: Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000)) };
}

/** Per-person / per-group AI overrides set by the bot owner in the admin app. */
export interface AiOverrides {
  ai?: { disabled?: boolean | null; dailyLimit?: number | null } | null;
}

/** user.ai.dailyLimit, else Settings → AI → per-person daily limit, else AI_USER_DAILY_LIMIT. */
export async function userAiDailyLimit(user?: AiOverrides | null): Promise<number> {
  const own = user?.ai?.dailyLimit;
  if (typeof own === 'number') return own;
  const settings = await settingsService.getAi();
  return settings.userDailyLimit ?? AI_USER_DAILY_LIMIT;
}

export async function checkUserAiDailyLimit(telegramUserId: number, user?: AiOverrides | null): Promise<AiLimitResult> {
  const limit = await userAiDailyLimit(user);
  const today = utcDayWindow('ai_user_daily');
  const result = await rateLimitService.checkRateLimit(telegramUserId, today.action, limit, today.seconds);
  return { ...result, scope: 'day', limit };
}

/** A limiter result that says which limit it was: the per-minute burst or the daily one. */
export interface AiLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  scope?: 'minute' | 'day';
  limit?: number;
}

function safeZone(timezone?: string | null): string {
  try {
    if (timezone) {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      return timezone;
    }
  } catch {
    // unknown zone: fall back to UTC
  }
  return 'UTC';
}

/**
 * When the daily AI limits come back, in the reader's clock: "at 07:00 (in 5h)" or "tomorrow at 07:00 (in 21h)".
 * Daily limits reset at midnight UTC, which is a different local hour per group.
 */
export function aiResetTime(timezone?: string | null, now = new Date()): string {
  const zone = safeZone(timezone);
  const { seconds } = utcDayWindow('x', now);
  const reset = new Date(now.getTime() + seconds * 1000);
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(reset);
  const when = day(reset) === day(now) ? `at ${time}` : `tomorrow at ${time}`;
  return `${when} (in ${formatRetryAfter(seconds)})`;
}

/**
 * Why the AI said no, in the reader's terms — one sentence shared by /ai, the Explain button, /new, the web chat
 * and MCP (each surface adds what still works). `who` = the person's own limits or the group's.
 */
export function aiLimitText(who: 'user' | 'group', limit: Pick<AiLimitResult, 'scope' | 'retryAfterSeconds' | 'limit'> | null, timezone?: string | null, now = new Date()): string {
  const daily = limit?.scope === 'day' || (limit?.scope === undefined && (limit?.retryAfterSeconds ?? 0) > 60 * 60);
  if (who === 'user') {
    if (daily) {
      const count = typeof limit?.limit === 'number' ? ` (${limit.limit})` : '';
      return `You've used all your AI requests for today${count}. They come back ${aiResetTime(timezone, now)}.`;
    }
    return `Too many AI requests in a row — try again in ${formatRetryAfter(limit?.retryAfterSeconds ?? 60)}.`;
  }
  if (daily) return `This group has used all its AI requests for today. They come back ${aiResetTime(timezone, now)}.`;
  const wait = limit?.retryAfterSeconds && limit.retryAfterSeconds > 0 ? `in ${formatRetryAfter(limit.retryAfterSeconds)}` : 'in a few minutes';
  return `This group has made a lot of AI requests in the last 10 minutes — try again ${wait}.`;
}

/** "45s", "12 min", "3h" — a human wait time for rate-limit messages. */
export function formatRetryAfter(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 90 * 60) return `${Math.ceil(seconds / 60)} min`;
  return `${Math.ceil(seconds / 3600)}h`;
}

/** The group's clock for reset times (a group left on UTC uses the bot's default zone, like due dates do). */
export function aiTimezone(group?: { timezone?: string | null } | null): string {
  return group?.timezone && group.timezone !== 'UTC' ? group.timezone : configService.timezone || 'UTC';
}

/** The person hit a limit: the burst one ("try again in 40s") or the daily one ("come back at 07:00"). */
export function aiUserLimitText(limit: Pick<AiLimitResult, 'scope' | 'retryAfterSeconds' | 'limit'>, group?: { timezone?: string | null } | null): string {
  return aiLimitText('user', limit, aiTimezone(group));
}

/**
 * The group hit a limit: the owner's daily limit for it when one is set, else the 10-minute one. Pass the
 * limiter's result so the 10-minute text says exactly how long to wait.
 */
export function aiGroupLimitText(
  group?: (AiOverrides & { timezone?: string | null }) | null,
  limit?: Pick<AiLimitResult, 'scope' | 'retryAfterSeconds'> | null,
): string {
  const scope = limit?.scope ?? (typeof group?.ai?.dailyLimit === 'number' ? 'day' : 'minute');
  return aiLimitText('group', { scope, retryAfterSeconds: limit?.retryAfterSeconds ?? 0 }, aiTimezone(group));
}

// ── Owner switches ──────────────────────────────────────────────────────────

export const AI_DISABLED_GROUP_TEXT = "The bot owner turned off AI in this group, so I can't use it here.";
export const AI_DISABLED_USER_TEXT = "The bot owner turned off AI for you, so I can't use it for your requests.";

/** Whether the owner turned AI off for this group (checked first) or this person; null = allowed. */
export function aiDisabledBy(group?: AiOverrides | null, user?: AiOverrides | null): AiDisabledBy | null {
  if (group?.ai?.disabled) return 'group';
  if (user?.ai?.disabled) return 'user';
  return null;
}

export function aiDisabledText(by: AiDisabledBy): string {
  return by === 'group' ? AI_DISABLED_GROUP_TEXT : AI_DISABLED_USER_TEXT;
}

type Doc = AiOverrides & { _id?: unknown };

/**
 * Runs `fn` as one AI feature for this group / person: AI calls inside are tagged with the feature, group,
 * person and channel (cost dashboard) and refused when the owner turned AI off for either. Nested scopes
 * re-tag only their own calls (an explanation inside an /ai request is "explain", the plan "planner").
 */
export function withAiScope<T>(
  feature: AiFeature,
  scope: { group?: Doc | null; user?: Doc | null; channel?: UsageChannel },
  fn: () => T,
): T {
  const patch: ContextPatch = { feature };
  if (scope.group?._id) patch.groupId = scope.group._id;
  if (scope.user?._id) patch.userId = scope.user._id;
  if (scope.channel && !currentContext().channel) patch.channel = scope.channel;
  const disabled = aiDisabledBy(scope.group, scope.user);
  if (disabled) patch.aiDisabledBy = disabled;
  return withContext(patch, fn);
}
