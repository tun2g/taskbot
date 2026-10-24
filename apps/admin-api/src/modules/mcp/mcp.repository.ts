import { ApiToken, UsageEvent, User } from '@tbot/db';
import { Types } from 'mongoose';
import { Pagination } from 'src/shared/http';
import { DAY_EXPR } from 'src/stats/queries';

export interface LeanToken {
  _id: Types.ObjectId;
  name: string;
  prefix: string;
  userId: Types.ObjectId | null;
  groupId: Types.ObjectId | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt?: Date | null;
}

export const TOKEN_FIELDS = 'name prefix userId groupId lastUsedAt createdAt expiresAt revokedAt';

// --- tokens ---

/** Ids of people whose first / last name or username matches (at most 200). */
export async function findOwnerIds(re: RegExp, usernameRe: RegExp | null): Promise<Types.ObjectId[]> {
  const owners = await User.find({ $or: [{ firstName: re }, { lastName: re }, { username: usernameRe }] })
    .select('_id')
    .limit(200)
    .lean<{ _id: Types.ObjectId }[]>();
  return owners.map((o) => o._id);
}

/** One page of tokens matching the filter, and how many match. */
export async function findTokenPage(filter: Record<string, unknown>, sort: Record<string, 1 | -1>, p: Pagination) {
  const [total, docs] = await Promise.all([
    ApiToken.countDocuments(filter),
    ApiToken.find(filter).select(TOKEN_FIELDS).sort(sort).skip(p.skip).limit(p.limit).lean<LeanToken[]>(),
  ]);
  return { total, docs };
}

export async function findToken(id: Types.ObjectId): Promise<LeanToken | null> {
  return ApiToken.findById(id).select(TOKEN_FIELDS).lean<LeanToken>();
}

/** Sets revokedAt unless the token is already revoked; false when nothing changed. */
export async function markTokenRevoked(id: Types.ObjectId, revokedAt: Date): Promise<boolean> {
  const res = await ApiToken.updateOne({ _id: id, revokedAt: null }, { $set: { revokedAt } });
  return (res.modifiedCount ?? 0) > 0;
}

// --- usage ---

const FAILED = { $sum: { $cond: ['$ok', 0, 1] } };

const top = (match: Record<string, unknown>, by: string, limit: number) =>
  UsageEvent.aggregate([{ $match: match }, { $group: { _id: `$${by}`, calls: { $sum: 1 }, failed: FAILED } }, { $sort: { calls: -1 } }, { $limit: limit }]);

/** Token counts plus the MCP call / rate-limit aggregations behind GET /mcp. */
export async function mcpUsage(calls: Record<string, unknown>, limited: Record<string, unknown>, activeTokens: Record<string, unknown>) {
  const [tokenCount, owners, totals, rateLimited, byTool, byClient, topUsers, daily, byGroup, limitedBy] = await Promise.all([
    ApiToken.countDocuments(activeTokens),
    ApiToken.distinct('userId', activeTokens),
    UsageEvent.aggregate([{ $match: calls }, { $group: { _id: null, calls: { $sum: 1 }, failed: FAILED } }]),
    UsageEvent.countDocuments(limited),
    top(calls, 'name', 50),
    top(calls, 'client', 20),
    top({ ...calls, userId: { $ne: null } }, 'userId', 10),
    UsageEvent.aggregate([{ $match: calls }, { $group: { _id: DAY_EXPR('createdAt'), calls: { $sum: 1 }, failed: FAILED } }]),
    top({ ...calls, groupId: { $ne: null } }, 'groupId', 10),
    UsageEvent.aggregate([{ $match: { ...limited, userId: { $ne: null } } }, { $group: { _id: '$userId', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]),
  ]);
  return { tokenCount, owners, totals, rateLimited, byTool, byClient, topUsers, daily, byGroup, limitedBy };
}
