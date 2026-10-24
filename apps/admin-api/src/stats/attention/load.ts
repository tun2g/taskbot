/** Loads the numbers behind the overview's "Needs attention" list and runs the rules over them. */
import { AiCall, Group, StatsDaily, UsageEvent } from '@tbot/db';
import type { AdminAttentionItem, AdminSystemStatus } from '@tbot/shared';
import { GroupStatus, UsageKind } from '@tbot/shared';
import { Types } from 'mongoose';
import { loadGroupRefs } from 'src/shared/refs';
import { addDays, dayOf, startOfDay } from 'src/stats/range';

import { buildAttention } from './build';
import { AttentionInput, BASELINE_DAYS, findSpikes, PENDING_AFTER_HOURS } from './rules';

type AiRow = { _id: { g: Types.ObjectId | null; s: string }; n: number };
type RateRow = { _id: { g: Types.ObjectId | null; c: string }; n: number };
type McpRow = { _id: { today: boolean }; calls: number; failed: number };
type PendingDoc = { groupName: string; addedAt?: Date | null; createdAt?: Date };

function queryAll(now: Date) {
  const today = dayOf(now);
  const todayStart = startOfDay(today);
  const baselineFrom = addDays(today, -BASELINE_DAYS);
  const sinceToday = { $gte: todayStart };
  const pendingSince = () => ({ status: GroupStatus.PENDING, addedAt: { $lte: new Date(now.getTime() - PENDING_AFTER_HOURS * 3_600_000) } });
  return Promise.all([
    AiCall.aggregate<AiRow>([{ $match: { createdAt: sinceToday } }, { $group: { _id: { g: '$groupId', s: '$status' }, n: { $sum: 1 } } }]),
    StatsDaily.aggregate<{ calls: number; failed: number }>([
      { $match: { day: { $gte: baselineFrom, $lt: today }, groupId: null } },
      { $group: { _id: null, calls: { $sum: '$aiCalls' }, failed: { $sum: '$aiFailed' } } },
    ]),
    StatsDaily.aggregate<{ _id: Types.ObjectId; calls: number }>([
      { $match: { day: { $gte: baselineFrom, $lt: today }, groupId: { $ne: null } } },
      { $group: { _id: '$groupId', calls: { $sum: '$aiCalls' } } },
    ]),
    UsageEvent.aggregate<RateRow>([
      { $match: { kind: UsageKind.RATE_LIMITED, createdAt: sinceToday } },
      { $group: { _id: { g: '$groupId', c: '$channel' }, n: { $sum: 1 } } },
    ]),
    Group.find(pendingSince()).select('groupName addedAt createdAt').sort({ addedAt: 1 }).limit(1).lean<PendingDoc[]>(),
    Group.countDocuments(pendingSince()),
    UsageEvent.aggregate<McpRow>([
      { $match: { kind: UsageKind.MCP_TOOL, createdAt: { $gte: startOfDay(baselineFrom) } } },
      { $group: { _id: { today: { $gte: ['$createdAt', todayStart] } }, calls: { $sum: 1 }, failed: { $sum: { $cond: ['$ok', 0, 1] } } } },
    ]),
  ]);
}

/** Today's AI calls by status, and provider calls per group (for spikes). */
function foldAi(rows: AiRow[]) {
  const ai = { providerCalls: 0, failed: 0, invalid: 0, quota: 0, disabled: 0 };
  const groupCalls = new Map<string, number>();
  for (const r of rows) {
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
  return { ai, groupCalls };
}

/** Rate-limited requests today: total, via MCP, and the group with the most. */
function foldRateLimited(rows: RateRow[]) {
  let total = 0;
  let mcp = 0;
  const byGroup = new Map<string, number>();
  for (const r of rows) {
    total += r.n;
    if (r._id.c === 'mcp') mcp += r.n;
    if (r._id.g) byGroup.set(String(r._id.g), (byGroup.get(String(r._id.g)) ?? 0) + r.n);
  }
  const top = [...byGroup.entries()].sort((a, b) => b[1] - a[1])[0];
  return { total, mcp, top };
}

function oldestPending(docs: PendingDoc[], now: Date): AttentionInput['pending']['oldest'] {
  const oldest = docs[0];
  const oldestAt = oldest ? (oldest.addedAt ?? oldest.createdAt ?? now) : null;
  return oldest && oldestAt ? { name: oldest.groupName, hours: (now.getTime() - new Date(oldestAt).getTime()) / 3_600_000 } : null;
}

/** Loads the inputs. `jobs` comes from the caller (the queue is read by readQueue in src/modules/system). */
export async function loadAttention(opts: { now: Date; callLimit: number | null; jobs: AdminSystemStatus['jobs'] | null }): Promise<AdminAttentionItem[]> {
  const { now } = opts;
  const [aiRows, normRows, groupNorm, rateRows, pendingDocs, pendingCount, mcpRows] = await queryAll(now);

  const { ai, groupCalls } = foldAi(aiRows);
  const spikes = findSpikes(groupCalls, new Map(groupNorm.map((r) => [String(r._id), r.calls]))).slice(0, 3);
  const rl = foldRateLimited(rateRows);
  const refs = await loadGroupRefs([...spikes.map((s) => s.groupId), ...(rl.top ? [rl.top[0]] : [])]);
  const mcpToday = mcpRows.find((r) => r._id.today);
  const mcpBefore = mcpRows.find((r) => !r._id.today);

  return buildAttention({
    ai,
    aiNorm: { calls: normRows[0]?.calls ?? 0, failed: normRows[0]?.failed ?? 0 },
    callLimit: opts.callLimit,
    rateLimited: { total: rl.total, mcp: rl.mcp, topGroup: rl.top ? { group: refs.get(rl.top[0])!, count: rl.top[1] } : null },
    pending: { count: pendingCount, oldest: oldestPending(pendingDocs, now) },
    jobs: opts.jobs,
    spikes: spikes.map((s) => ({ group: refs.get(s.groupId)!, calls: s.calls, average: s.average })),
    mcp: { calls: mcpToday?.calls ?? 0, failed: mcpToday?.failed ?? 0 },
    mcpNorm: { calls: mcpBefore?.calls ?? 0, failed: mcpBefore?.failed ?? 0 },
  });
}
