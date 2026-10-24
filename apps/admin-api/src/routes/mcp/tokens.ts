import { ApiToken, User } from '@tbot/db';
import type { AdminMcpTokenFilter, AdminMcpTokenRow, AdminMcpTokenStatus } from '@tbot/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { iso } from 'src/routes/group-rows';
import { HttpError, Pagination, searchRegex } from 'src/shared/http';
import { loadGroupRefs, loadPersonRefs } from 'src/shared/refs';

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
export const TOKEN_FILTERS: AdminMcpTokenFilter[] = ['active', 'revoked', 'expired', 'ended'];

export const activeTokenFilter = (now: Date) => ({ revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });

const STATUS_MATCH: Record<AdminMcpTokenFilter, (now: Date) => Record<string, unknown>> = {
  active: activeTokenFilter,
  revoked: () => ({ revokedAt: { $ne: null } }),
  expired: (now) => ({ revokedAt: null, expiresAt: { $ne: null, $lte: now } }),
  ended: (now) => ({ $or: [{ revokedAt: { $ne: null } }, { expiresAt: { $ne: null, $lte: now } }] }),
};

export function tokenStatus(t: Pick<LeanToken, 'revokedAt' | 'expiresAt'>, now = new Date()): AdminMcpTokenStatus {
  if (t.revokedAt) return 'revoked';
  if (t.expiresAt && t.expiresAt <= now) return 'expired';
  return 'active';
}

const objectId = (v: unknown, what: string) => {
  if (!/^[a-f0-9]{24}$/i.test(String(v))) throw new HttpError(400, `The ${what} filter is not a valid id.`);
  return new Types.ObjectId(String(v));
};

/** The api_tokens filter for ?status=&userId=&q= (q = token name, prefix, or the owner's name / @username). */
export async function tokenFilter(query: Request['query'], now = new Date()): Promise<Record<string, unknown>> {
  const status = String(query.status ?? 'active') as AdminMcpTokenFilter;
  if (!TOKEN_FILTERS.includes(status)) throw new HttpError(400, `Unknown token status “${status}”.`);
  const and: Record<string, unknown>[] = [STATUS_MATCH[status](now)];
  if (query.userId) and.push({ userId: objectId(query.userId, 'person') });
  const re = searchRegex(query.q);
  if (re) {
    const owners = await User.find({ $or: [{ firstName: re }, { lastName: re }, { username: searchRegex(String(query.q).trim().replace(/^@/, '')) }] })
      .select('_id')
      .limit(200)
      .lean<{ _id: Types.ObjectId }[]>();
    and.push({ $or: [{ name: re }, { prefix: re }, { userId: { $in: owners.map((o) => o._id) } }] });
  }
  return and.length === 1 ? and[0]! : { $and: and };
}

/** Rows for these tokens, with owner and group refs. */
export async function tokenRows(docs: LeanToken[], now = new Date()): Promise<AdminMcpTokenRow[]> {
  const [people, groups] = await Promise.all([loadPersonRefs(docs.map((t) => t.userId)), loadGroupRefs(docs.map((t) => t.groupId))]);
  return docs.map((t) => ({
    id: String(t._id),
    name: t.name,
    prefix: t.prefix,
    person: t.userId ? (people.get(String(t.userId)) ?? null) : null,
    group: t.groupId ? (groups.get(String(t.groupId)) ?? null) : null,
    lastUsedAt: iso(t.lastUsedAt),
    createdAt: iso(t.createdAt) ?? new Date(0).toISOString(),
    expiresAt: iso(t.expiresAt),
    status: tokenStatus(t, now),
    revokedAt: iso(t.revokedAt),
  }));
}

/** One page of tokens: newest first, or most recently ended first for history. */
export async function tokenPage(filter: Record<string, unknown>, ended: boolean, p: Pagination) {
  const sort: Record<string, 1 | -1> = ended ? { revokedAt: -1, expiresAt: -1, _id: -1 } : { createdAt: -1, _id: -1 };
  const [total, docs] = await Promise.all([
    ApiToken.countDocuments(filter),
    ApiToken.find(filter).select(TOKEN_FIELDS).sort(sort).skip(p.skip).limit(p.limit).lean<LeanToken[]>(),
  ]);
  return { total, rows: await tokenRows(docs) };
}
