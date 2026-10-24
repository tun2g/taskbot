import { UsageEvent } from '@tbot/db';
import type { UsageChannel } from '@tbot/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DAY_MS, withTimeout } from 'src/system/queue';

const HOUR_MS = 60 * 60 * 1000;

/** Ping with a latency, never throwing. */
export async function timed(fn: () => Promise<unknown>): Promise<{ ok: boolean; latencyMs: number | null }> {
  const t0 = Date.now();
  try {
    await withTimeout(fn());
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

/** Requests in the last hour, the average for the same clock hour over the previous 7 days, and the last event per channel. */
export async function activityNow(now: Date) {
  const t = now.getTime();
  const sameHour = Array.from({ length: 7 }, (_, i) => ({
    createdAt: { $gte: new Date(t - (i + 1) * DAY_MS - HOUR_MS), $lt: new Date(t - (i + 1) * DAY_MS) },
  }));
  const [lastHour, usual, byChannel] = await Promise.all([
    UsageEvent.countDocuments({ createdAt: { $gte: new Date(t - HOUR_MS) } }),
    UsageEvent.countDocuments({ $or: sameHour }),
    UsageEvent.aggregate([
      { $match: { createdAt: { $gte: new Date(t - 7 * DAY_MS) } } },
      { $group: { _id: '$channel', at: { $max: '$createdAt' } } },
    ]),
  ]);
  const lastByChannel: Partial<Record<UsageChannel, string>> = {};
  for (const c of byChannel as { _id: UsageChannel | null; at: Date | null }[])
    if (c._id && c.at) lastByChannel[c._id] = new Date(c.at).toISOString();
  return { lastHour, usualThisHour: Math.round((usual / 7) * 10) / 10, lastByChannel };
}

let version: string | null = null;
export function adminApiVersion(): string {
  if (version) return version;
  try {
    version =
      process.env.APP_VERSION ||
      (JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')).version as string);
  } catch {
    version = 'unknown';
  }
  return version;
}
