import { AiCall, Group, StatsDaily, UsageEvent } from '@tbot/db';
import type { AdminAttentionItem, AdminGroupRef, AdminSystemStatus } from '@tbot/shared';
import { backgroundJobInfo, GroupStatus, UsageKind } from '@tbot/shared';
import { Types } from 'mongoose';
import { loadGroupRefs } from 'src/shared/refs';
import { addDays, dayOf, startOfDay } from 'src/stats/range';

/**
 * The overview's "Needs attention" list: anomalies the owner should act on today, each with a link to the
 * page that explains it. Pure rules here (`buildAttention`), data loading below (`loadAttention`).
 */

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

const pct = (r: number) => `${Math.round(r * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const waited = (hours: number) => (hours < 48 ? `${Math.floor(hours)} hours` : `${Math.floor(hours / 24)} days`);

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

export function buildAttention(input: AttentionInput): AdminAttentionItem[] {
  const out: AdminAttentionItem[] = [];

  // Background jobs: a failing job means reminders / digests / alerts silently stop.
  if (input.jobs === null) {
    out.push({
      kind: 'failed_jobs',
      severity: 'danger',
      title: 'Background jobs can’t be checked',
      detail: 'The job queue (Redis) isn’t answering, so reminders, digests and your alerts may not be running.',
      link: '/system',
      linkLabel: 'Open System',
    });
  } else {
    const failing = input.jobs.filter((j) => j.lastError);
    if (failing.length) {
      const names = failing.map((j) => backgroundJobInfo(j.name, j.cron).label);
      const first = failing[0]!;
      out.push({
        kind: 'failed_jobs',
        severity: 'danger',
        title: failing.length === 1 ? `“${names[0]}” failed on its last run` : `${failing.length} background jobs failed on their last run`,
        detail: `${failing.length === 1 ? backgroundJobInfo(first.name, first.cron).ifFailing : names.join(', ') + '.'} Error: ${first.lastError}`,
        link: '/system',
        linkLabel: 'See the job errors',
      });
    }
  }

  // AI stopped for everyone: the global daily call limit is used up.
  const limitReached = input.callLimit != null && input.ai.providerCalls >= input.callLimit;
  const refusedAi = input.ai.quota;
  if (limitReached || refusedAi > 0 || input.rateLimited.total >= RATE_LIMITED_MIN) {
    const parts: string[] = [];
    if (refusedAi > 0) parts.push(`${plural(refusedAi, 'AI request')} refused by a daily AI limit`);
    if (input.rateLimited.total > 0) {
      const where = input.rateLimited.topGroup ? ` (most in “${input.rateLimited.topGroup.group.name}”)` : '';
      parts.push(`${plural(input.rateLimited.total, 'request')} blocked for coming too fast${where}`);
    }
    const link =
      refusedAi > 0
        ? '/ai?range=7d&status=quota'
        : input.rateLimited.mcp * 2 > input.rateLimited.total
          ? '/mcp?range=7d'
          : input.rateLimited.topGroup && !input.rateLimited.topGroup.group.deleted
            ? `/groups/${input.rateLimited.topGroup.group.id}`
            : '/mcp?range=7d';
    out.push({
      kind: 'refused',
      severity: limitReached ? 'danger' : 'warn',
      title: limitReached
        ? `AI is stopped for everyone until midnight UTC — the daily limit of ${input.callLimit!.toLocaleString('en-US')} calls is used up`
        : 'Requests were refused by limits today',
      detail: `${parts.join('; ') || 'No requests refused yet'}. Raise the limit in Settings if this is expected use.`,
      link: limitReached && refusedAi === 0 ? '/settings' : link,
      linkLabel: refusedAi > 0 ? 'See the refused requests' : link.startsWith('/groups/') ? 'Open the group' : limitReached ? 'Open Settings' : 'See MCP',
    });
  }

  const ai = unusualRate(input.ai.providerCalls, input.ai.failed + input.ai.invalid, input.aiNorm);
  if (ai) {
    out.push({
      kind: 'ai_failures',
      severity: ai.rate >= FAILURE_RATE_DANGER ? 'danger' : 'warn',
      title: `${pct(ai.rate)} of AI calls didn’t work today`,
      detail:
        `${plural(input.ai.failed, 'provider error')} and ${plural(input.ai.invalid, 'unusable reply', 'unusable replies')} out of ${plural(input.ai.providerCalls, 'call')}` +
        (ai.normRate != null ? ` — usually ${pct(ai.normRate)} over the last ${BASELINE_DAYS} days.` : '.') +
        ' People get an error instead of an AI answer.',
      link: `/ai?range=7d&status=${input.ai.failed >= input.ai.invalid ? 'failed' : 'invalid'}`,
      linkLabel: 'See the failed calls',
    });
  }

  for (const s of input.spikes.slice(0, 3)) {
    const usual = s.average < 1 ? 'usually almost none' : `usually about ${Math.round(s.average)} a day`;
    out.push({
      kind: 'ai_spike',
      severity: 'warn',
      title: `Unusual AI use in “${s.group.name}”`,
      detail: `${plural(s.calls, 'AI call')} today — ${usual} over the last ${BASELINE_DAYS} days. You can set a daily AI limit for this group.`,
      link: s.group.deleted ? '/ai?range=7d&groupBy=group' : `/ai?range=7d&groupId=${s.group.id}`,
      linkLabel: 'See its AI calls',
    });
  }

  const mcp = unusualRate(input.mcp.calls, input.mcp.failed, input.mcpNorm);
  if (mcp) {
    out.push({
      kind: 'mcp_errors',
      severity: mcp.rate >= FAILURE_RATE_DANGER ? 'danger' : 'warn',
      title: `${pct(mcp.rate)} of MCP tool calls failed today`,
      detail:
        `${plural(input.mcp.failed, 'failed call')} out of ${plural(input.mcp.calls, 'call')}` +
        (mcp.normRate != null ? ` — usually ${pct(mcp.normRate)}.` : '.') +
        ' AI clients (Claude, Cursor…) get errors back.',
      link: '/mcp?range=7d',
      linkLabel: 'See which tools fail',
    });
  }

  if (input.pending.count > 0 && input.pending.oldest) {
    out.push({
      kind: 'pending_groups',
      severity: 'warn',
      title:
        input.pending.count === 1
          ? `“${input.pending.oldest.name}” has waited ${waited(input.pending.oldest.hours)} for your approval`
          : `${input.pending.count} groups have waited over a day for your approval`,
      detail: 'They were told it usually takes less than a day, and can’t use the bot until you decide.',
      link: '/groups?status=pending',
      linkLabel: 'Review them',
    });
  }

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'danger' ? -1 : 1));
}

/** Loads the inputs. `jobs` comes from the caller (the queue is read in system.routes). */
export async function loadAttention(opts: {
  now: Date;
  callLimit: number | null;
  jobs: AdminSystemStatus['jobs'] | null;
}): Promise<AdminAttentionItem[]> {
  const { now } = opts;
  const today = dayOf(now);
  const todayStart = startOfDay(today);
  const baselineFrom = addDays(today, -BASELINE_DAYS);
  const baselineStart = startOfDay(baselineFrom);
  const sinceToday = { $gte: todayStart };

  const [aiRows, normRows, groupNorm, rateRows, pendingDocs, pendingCount, mcpRows] = await Promise.all([
    AiCall.aggregate([{ $match: { createdAt: sinceToday } }, { $group: { _id: { g: '$groupId', s: '$status' }, n: { $sum: 1 } } }]),
    StatsDaily.aggregate([
      { $match: { day: { $gte: baselineFrom, $lt: today }, groupId: null } },
      { $group: { _id: null, calls: { $sum: '$aiCalls' }, failed: { $sum: '$aiFailed' } } },
    ]),
    StatsDaily.aggregate([
      { $match: { day: { $gte: baselineFrom, $lt: today }, groupId: { $ne: null } } },
      { $group: { _id: '$groupId', calls: { $sum: '$aiCalls' } } },
    ]),
    UsageEvent.aggregate([
      { $match: { kind: UsageKind.RATE_LIMITED, createdAt: sinceToday } },
      { $group: { _id: { g: '$groupId', c: '$channel' }, n: { $sum: 1 } } },
    ]),
    Group.find({ status: GroupStatus.PENDING, addedAt: { $lte: new Date(now.getTime() - PENDING_AFTER_HOURS * 3_600_000) } })
      .select('groupName addedAt createdAt')
      .sort({ addedAt: 1 })
      .limit(1)
      .lean<{ groupName: string; addedAt?: Date | null; createdAt?: Date }[]>(),
    Group.countDocuments({ status: GroupStatus.PENDING, addedAt: { $lte: new Date(now.getTime() - PENDING_AFTER_HOURS * 3_600_000) } }),
    UsageEvent.aggregate([
      { $match: { kind: UsageKind.MCP_TOOL, createdAt: { $gte: baselineStart } } },
      { $group: { _id: { today: { $gte: ['$createdAt', todayStart] } }, calls: { $sum: 1 }, failed: { $sum: { $cond: ['$ok', 0, 1] } } } },
    ]),
  ]);

  const ai = { providerCalls: 0, failed: 0, invalid: 0, quota: 0, disabled: 0 };
  const groupCalls = new Map<string, number>();
  for (const r of aiRows as { _id: { g: Types.ObjectId | null; s: string }; n: number }[]) {
    const s = r._id.s;
    if (s === 'quota') ai.quota += r.n;
    else if (s === 'disabled') ai.disabled += r.n;
    else {
      ai.providerCalls += r.n;
      if (s === 'failed') ai.failed += r.n;
      if (s === 'invalid') ai.invalid += r.n;
      if (r._id.g) groupCalls.set(String(r._id.g), (groupCalls.get(String(r._id.g)) ?? 0) + r.n);
    }
  }
  const baseline = new Map((groupNorm as { _id: Types.ObjectId; calls: number }[]).map((r) => [String(r._id), r.calls]));
  const spikes = findSpikes(groupCalls, baseline);

  let rlTotal = 0;
  let rlMcp = 0;
  const rlByGroup = new Map<string, number>();
  for (const r of rateRows as { _id: { g: Types.ObjectId | null; c: string }; n: number }[]) {
    rlTotal += r.n;
    if (r._id.c === 'mcp') rlMcp += r.n;
    if (r._id.g) rlByGroup.set(String(r._id.g), (rlByGroup.get(String(r._id.g)) ?? 0) + r.n);
  }
  const topRl = [...rlByGroup.entries()].sort((a, b) => b[1] - a[1])[0];

  const refs = await loadGroupRefs([...spikes.slice(0, 3).map((s) => s.groupId), ...(topRl ? [topRl[0]] : [])]);
  const mcpToday = (mcpRows as { _id: { today: boolean }; calls: number; failed: number }[]).find((r) => r._id.today);
  const mcpBefore = (mcpRows as { _id: { today: boolean }; calls: number; failed: number }[]).find((r) => !r._id.today);
  const oldest = pendingDocs[0];
  const oldestAt = oldest ? (oldest.addedAt ?? oldest.createdAt ?? now) : null;

  return buildAttention({
    ai,
    aiNorm: { calls: normRows[0]?.calls ?? 0, failed: normRows[0]?.failed ?? 0 },
    callLimit: opts.callLimit,
    rateLimited: { total: rlTotal, mcp: rlMcp, topGroup: topRl ? { group: refs.get(topRl[0])!, count: topRl[1] } : null },
    pending: {
      count: pendingCount,
      oldest: oldest && oldestAt ? { name: oldest.groupName, hours: (now.getTime() - new Date(oldestAt).getTime()) / 3_600_000 } : null,
    },
    jobs: opts.jobs,
    spikes: spikes.slice(0, 3).map((s) => ({ group: refs.get(s.groupId)!, calls: s.calls, average: s.average })),
    mcp: { calls: mcpToday?.calls ?? 0, failed: mcpToday?.failed ?? 0 },
    mcpNorm: { calls: mcpBefore?.calls ?? 0, failed: mcpBefore?.failed ?? 0 },
  });
}
