import { ApiToken, UsageEvent } from '@tbot/db';
import type { AdminMcpOverview } from '@tbot/shared';
import { UsageKind } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import { Types } from 'mongoose';
import { iso } from 'src/routes/group-rows';
import { asyncHandler } from 'src/shared/http';
import { loadGroupRefs, loadPersonRefs } from 'src/shared/refs';
import { DAY_EXPR } from 'src/stats/queries';
import { parseRange, rangeWindows } from 'src/stats/range';

export const mcpRouter: Router = Router();

/** Label the API uses for calls whose client didn't say what it is (also accepted back as ?client=). */
export const UNKNOWN_CLIENT = 'Unknown client';

const FAILED = { $sum: { $cond: ['$ok', 0, 1] } };

function textParam(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null;
}

interface LeanToken {
  _id: Types.ObjectId;
  name: string;
  prefix: string;
  userId: Types.ObjectId | null;
  groupId: Types.ObjectId | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}

// GET /mcp?range=30d&tool=&client= — MCP usage from the raw usage events (kept 90 days, the longest range).
mcpRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { current: window } = rangeWindows(parseRange(req.query.range));
    const now = new Date();
    const tool = textParam(req.query.tool);
    const client = textParam(req.query.client);
    const createdAt = { $gte: window.start, $lt: window.end };
    const calls: Record<string, unknown> = { kind: UsageKind.MCP_TOOL, createdAt };
    if (tool) calls.name = tool;
    if (client) calls.client = client === UNKNOWN_CLIENT ? null : client;
    // Rate-limited MCP requests don't carry a tool name, so a tool filter can't narrow them; a client filter can.
    const limited: Record<string, unknown> = { kind: UsageKind.RATE_LIMITED, channel: 'mcp', createdAt };
    if (client) limited.client = calls.client;
    const activeTokens = { revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] };

    const [tokenCount, owners, tokenDocs, totals, rateLimited, byTool, byClient, topUsers, daily, byGroup, limitedBy] = await Promise.all([
      ApiToken.countDocuments(activeTokens),
      ApiToken.distinct('userId', activeTokens),
      ApiToken.find(activeTokens)
        .select('name prefix userId groupId lastUsedAt createdAt expiresAt')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean<LeanToken[]>(),
      UsageEvent.aggregate([{ $match: calls }, { $group: { _id: null, calls: { $sum: 1 }, failed: FAILED } }]),
      UsageEvent.countDocuments(limited),
      UsageEvent.aggregate([{ $match: calls }, { $group: { _id: '$name', calls: { $sum: 1 }, failed: FAILED } }, { $sort: { calls: -1 } }, { $limit: 50 }]),
      UsageEvent.aggregate([{ $match: calls }, { $group: { _id: '$client', calls: { $sum: 1 }, failed: FAILED } }, { $sort: { calls: -1 } }, { $limit: 20 }]),
      UsageEvent.aggregate([
        { $match: { ...calls, userId: { $ne: null } } },
        { $group: { _id: '$userId', calls: { $sum: 1 }, failed: FAILED } },
        { $sort: { calls: -1 } },
        { $limit: 10 },
      ]),
      UsageEvent.aggregate([{ $match: calls }, { $group: { _id: DAY_EXPR('createdAt'), calls: { $sum: 1 }, failed: FAILED } }]),
      UsageEvent.aggregate([
        { $match: { ...calls, groupId: { $ne: null } } },
        { $group: { _id: '$groupId', calls: { $sum: 1 }, failed: FAILED } },
        { $sort: { calls: -1 } },
        { $limit: 10 },
      ]),
      UsageEvent.aggregate([
        { $match: { ...limited, userId: { $ne: null } } },
        { $group: { _id: '$userId', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 10 },
      ]),
    ]);
    const people = await loadPersonRefs([...topUsers.map((u) => u._id), ...limitedBy.map((u) => u._id), ...tokenDocs.map((t) => t.userId)]);
    const groups = await loadGroupRefs([...byGroup.map((g) => g._id), ...tokenDocs.map((t) => t.groupId)]);
    const perDay = new Map(daily.map((d) => [String(d._id), d as { calls: number; failed: number }]));
    const limitedByUser = new Map(limitedBy.map((u) => [String(u._id), u.n as number]));

    const body: AdminMcpOverview = {
      activeTokens: tokenCount,
      tokenOwners: owners.length,
      calls: totals[0]?.calls ?? 0,
      failed: totals[0]?.failed ?? 0,
      rateLimited,
      byTool: byTool.map((t) => ({ tool: String(t._id), calls: t.calls, failed: t.failed })),
      byClient: byClient.map((c) => ({ client: c._id ? String(c._id) : UNKNOWN_CLIENT, calls: c.calls, failed: c.failed })),
      topUsers: topUsers
        .filter((u) => people.has(String(u._id)))
        .map((u) => ({ person: people.get(String(u._id))!, calls: u.calls, failed: u.failed, rateLimited: limitedByUser.get(String(u._id)) ?? 0 })),
      daily: window.days.map((day) => ({ day, calls: perDay.get(day)?.calls ?? 0, failed: perDay.get(day)?.failed ?? 0 })),
      byGroup: byGroup.map((g) => ({ group: groups.get(String(g._id))!, calls: g.calls, failed: g.failed })).filter((g) => g.group),
      rateLimitedBy: limitedBy.filter((u) => people.has(String(u._id))).map((u) => ({ person: people.get(String(u._id))!, count: u.n })),
      tokens: tokenDocs.map((t) => ({
        id: String(t._id),
        name: t.name,
        prefix: t.prefix,
        person: t.userId ? (people.get(String(t.userId)) ?? null) : null,
        group: t.groupId ? (groups.get(String(t.groupId)) ?? null) : null,
        lastUsedAt: iso(t.lastUsedAt),
        createdAt: iso(t.createdAt) ?? new Date(0).toISOString(),
        expiresAt: iso(t.expiresAt),
      })),
      filter: { tool, client },
    };
    res.json({ data: body });
  }),
);
