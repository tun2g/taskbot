import type { AdminGroupRef, AdminSystemStatus } from '@tbot/shared';

/** Same rule as the bot's spike alert (apps/bot/src/jobs/ai-alerts.ts). */
export const SPIKE_FACTOR = 5;
export const SPIKE_MIN_CALLS = 30;
export const BASELINE_DAYS = 7;
/** A failure rate is "unusual" from this rate, when it's also at least NORM_MULTIPLIER × the 7-day norm. */
export const FAILURE_RATE_MIN = 0.1;
export const FAILURE_RATE_DANGER = 0.3;
export const NORM_MULTIPLIER = 2;
/** Too few calls to judge a rate. */
export const MIN_CALLS_FOR_RATE = 10;
export const RATE_LIMITED_MIN = 20;
export const PENDING_AFTER_HOURS = 24;

export interface AttentionInput {
  /** Today (UTC) so far. */
  ai: { providerCalls: number; failed: number; invalid: number; quota: number; disabled: number };
  /** Provider calls / failed+invalid over the previous 7 days (stats_daily). */
  aiNorm: { calls: number; failed: number };
  callLimit: number | null;
  rateLimited: { total: number; mcp: number; topGroup: { group: AdminGroupRef; count: number } | null };
  pending: { count: number; oldest: { name: string; hours: number } | null };
  /** null = the queue couldn't be read. */
  jobs: AdminSystemStatus['jobs'] | null;
  spikes: { group: AdminGroupRef; calls: number; average: number }[];
  mcp: { calls: number; failed: number };
  mcpNorm: { calls: number; failed: number };
}

/** "Unusual" rate: enough volume, above the floor, and well above the norm (when there is one). */
export function unusualRate(calls: number, failed: number, norm: { calls: number; failed: number }): { rate: number; normRate: number | null } | null {
  if (calls < MIN_CALLS_FOR_RATE) return null;
  const rate = failed / calls;
  const normRate = norm.calls >= MIN_CALLS_FOR_RATE ? norm.failed / norm.calls : null;
  if (rate < FAILURE_RATE_MIN) return null;
  if (normRate != null && rate < NORM_MULTIPLIER * normRate) return null;
  return { rate, normRate };
}

export function findSpikes(today: Map<string, number>, baseline: Map<string, number>, days = BASELINE_DAYS): { groupId: string; calls: number; average: number }[] {
  return [...today.entries()]
    .map(([groupId, calls]) => ({ groupId, calls, average: (baseline.get(groupId) ?? 0) / days }))
    .filter((s) => s.calls > SPIKE_MIN_CALLS && s.calls > SPIKE_FACTOR * s.average)
    .sort((a, b) => b.calls - a.calls);
}
