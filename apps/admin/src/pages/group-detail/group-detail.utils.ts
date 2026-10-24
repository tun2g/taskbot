import type { AdminAiSettings, AdminDailyPoint, AdminGroupDetail, UsageChannel, UsageKind } from '@tbot/shared';
import { USAGE_CHANNEL_VALUES, UsageKind as Kind } from '@tbot/shared';

export interface ChannelUsage {
  channel: UsageChannel;
  subtotal: number;
  kinds: { kind: UsageKind; count: number }[];
}

/** Usage rows grouped by channel (biggest first) with subtotals; rate-limit refusals are counted apart. */
export function groupUsageByChannel(usage: AdminGroupDetail['usage']): { channels: ChannelUsage[]; total: number; blocked: number } {
  let blocked = 0;
  const byChannel = new Map<UsageChannel, ChannelUsage>();
  for (const u of usage) {
    if (u.kind === Kind.RATE_LIMITED) {
      blocked += u.count;
      continue;
    }
    const c = byChannel.get(u.channel) ?? { channel: u.channel, subtotal: 0, kinds: [] };
    c.subtotal += u.count;
    c.kinds.push({ kind: u.kind, count: u.count });
    byChannel.set(u.channel, c);
  }
  const channels = USAGE_CHANNEL_VALUES.map((ch) => byChannel.get(ch))
    .filter((c): c is ChannelUsage => !!c && c.subtotal > 0)
    .map((c) => ({ ...c, kinds: [...c.kinds].sort((a, b) => b.count - a.count) }))
    .sort((a, b) => b.subtotal - a.subtotal);
  return { channels, total: channels.reduce((s, c) => s + c.subtotal, 0), blocked };
}

/** AI calls today, the daily average and the busiest day over the loaded range (for sizing a per-group limit). */
export function aiCallStats(daily: AdminDailyPoint[], today = new Date().toISOString().slice(0, 10)) {
  const todayCalls = daily.find((d) => d.day === today)?.aiCalls ?? 0;
  const past = daily.filter((d) => d.day !== today);
  const avg = past.length ? past.reduce((s, d) => s + d.aiCalls, 0) / past.length : 0;
  const peak = past.reduce((m, d) => Math.max(m, d.aiCalls), 0);
  return { today: todayCalls, avg, peak, days: past.length };
}

/** The limits that apply with no override, from Settings, else the server defaults (a global 0 = no limit). */
export function effectiveAiLimits(settings: AdminAiSettings | undefined): { global: number | null; perPerson: number } | null {
  if (!settings) return null;
  const global = settings.dailyCallLimit ?? (settings.defaults.envDailyCallLimit || null);
  const perPerson = settings.userDailyLimit ?? settings.defaults.userDailyLimit;
  return { global, perPerson };
}
