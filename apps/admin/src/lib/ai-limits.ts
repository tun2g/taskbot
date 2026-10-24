import type { AdminAiSettings } from '@tbot/shared';
import { AI_DEFAULT_GROUP_BURST } from '@tbot/shared';

import { formatNumber } from './format';

/** The per-person daily limit from Settings (else the built-in one). */
export function defaultPersonLimit(settings: AdminAiSettings | undefined): number | null {
  if (!settings) return null;
  return settings.userDailyLimit ?? settings.defaults.userDailyLimit;
}

/** The bot-wide daily cap ("no cap" when neither Settings nor the server sets one). */
export function botWideLimitText(settings: AdminAiSettings | undefined): string {
  if (!settings) return 'bot-wide cap from Settings';
  const cap = settings.dailyCallLimit ?? settings.defaults.envDailyCallLimit;
  return cap ? `bot-wide ${formatNumber(cap)} calls/day` : 'no bot-wide cap';
}

const perDay = (n: number) => (n === 0 ? '0/day (blocks every request)' : `${formatNumber(n)}/day`);

/** "Right now: 10/day (your override) · group limits … · bot-wide 400 calls/day" for one person. */
export function personLimitsNow(settings: AdminAiSettings | undefined, ai: { disabled: boolean; dailyLimit: number | null }): string {
  const fallback = defaultPersonLimit(settings);
  const own = ai.disabled
    ? 'AI is off for this person (your override)'
    : ai.dailyLimit != null
      ? `${perDay(ai.dailyLimit)} (your override)`
      : fallback == null
        ? 'the default per-person limit'
        : `${perDay(fallback)} (default from Settings)`;
  const group = `group limit: each group’s own, else ${AI_DEFAULT_GROUP_BURST.limit} per ${AI_DEFAULT_GROUP_BURST.windowMinutes} min`;
  return `Right now: ${own} · ${group} · ${botWideLimitText(settings)}.`;
}

/** "Right now: 50/day (your override) · each person … · bot-wide …" for one group. */
export function groupLimitsNow(settings: AdminAiSettings | undefined, ai: { disabled: boolean; dailyLimit: number | null }): string {
  const own = ai.disabled
    ? 'AI is off in this group (your override)'
    : ai.dailyLimit != null
      ? `${perDay(ai.dailyLimit)} (your override)`
      : `${AI_DEFAULT_GROUP_BURST.limit} per ${AI_DEFAULT_GROUP_BURST.windowMinutes} min (default)`;
  const person = defaultPersonLimit(settings);
  return `Right now: ${own} · each person ${person == null ? 'has their own daily limit' : `${perDay(person)} unless you set theirs`} · ${botWideLimitText(settings)}.`;
}

/** What "default" means for a person's badge: "Default (40/day)". */
export function defaultLimitLabel(settings: AdminAiSettings | undefined): string {
  const n = defaultPersonLimit(settings);
  return n == null ? 'Default' : `Default (${formatNumber(n)}/day)`;
}
