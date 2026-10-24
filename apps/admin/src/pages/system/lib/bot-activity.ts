import type { AdminSystemStatus, UsageChannel } from '@tbot/shared';

import type { Tone } from '@/components/ui/badge';
import { formatNumber, plural } from '@/lib/format';

export const HOUR = 3_600_000;
/** Fewer requests than this per hour is too little to call silence unusual. */
const BUSY_HOUR = 5;
/** A waiting job older than this means nothing is processing the queue. */
export const STUCK_SECONDS = 10 * 60;

/** Is the bot alive? Compares the last hour with what's usual at this hour, and channels with each other. */
export function botActivity(d: AdminSystemStatus) {
  const since = d.lastEventAt ? Date.now() - new Date(d.lastEventAt).getTime() : null;
  const a = d.activity;
  if (a) {
    if (a.lastHour > 0)
      return {
        badge: { tone: 'good' as Tone, text: 'Active' },
        text: `${plural(a.lastHour, 'request')} in the last hour (usually about ${formatNumber(Math.round(a.usualThisHour))} at this time of day).`,
      };
    if (a.usualThisHour >= BUSY_HOUR)
      return {
        badge: { tone: 'danger' as Tone, text: 'Unusually quiet' },
        text: `No requests in the last hour, but there are usually about ${formatNumber(Math.round(a.usualThisHour))} at this time of day. Check that the bot is running and Telegram can reach it.`,
      };
    return {
      badge: { tone: 'neutral' as Tone, text: 'Quiet' },
      text: `No requests in the last hour — normal for this time of day (usually ${a.usualThisHour < 1 ? 'almost none' : `about ${formatNumber(Math.round(a.usualThisHour))}`}).`,
    };
  }
  const quiet = since == null || since > HOUR;
  return {
    badge: { tone: (quiet ? 'warn' : 'good') as Tone, text: quiet ? 'Quiet' : 'Active' },
    text: quiet
      ? 'Nothing recorded for over an hour. That can be normal at night — if not, check the bot is running.'
      : 'The last time anyone used the bot in any group.',
  };
}

export const CHANNEL_ORDER: UsageChannel[] = ['telegram', 'app', 'mcp'];

/** Telegram silent while the Mini App / MCP are busy = Telegram updates aren't reaching the bot (webhook). */
export function telegramStalled(byChannel: Partial<Record<UsageChannel, string>> | undefined): boolean {
  if (!byChannel) return false;
  const age = (c: UsageChannel) => (byChannel[c] ? Date.now() - new Date(byChannel[c]!).getTime() : Infinity);
  return age('telegram') > 6 * HOUR && Math.min(age('app'), age('mcp')) < HOUR;
}
