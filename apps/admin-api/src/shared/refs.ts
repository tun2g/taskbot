import { Group, User } from '@tbot/db';
import type { AdminGroupRef, AdminPersonRef } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';
import { Types } from 'mongoose';
import { personName } from 'src/stats/aggregate';

export interface LeanUser {
  _id: Types.ObjectId;
  telegramUserId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface LeanGroupRef {
  _id: Types.ObjectId;
  groupName: string;
  status: GroupStatus;
}

/** Groups created before approvals existed have no status until the bot's migration runs: they are active. */
export const statusOf = (g: { status?: GroupStatus | null }): GroupStatus => g.status ?? GroupStatus.ACTIVE;

export const USER_REF_FIELDS = 'telegramUserId username firstName lastName';

export function personRef(u: LeanUser): AdminPersonRef {
  return { id: String(u._id), telegramUserId: u.telegramUserId, name: personName(u), username: u.username || null };
}

export function groupRef(g: LeanGroupRef): AdminGroupRef {
  return { id: String(g._id), name: g.groupName, status: statusOf(g) };
}

const toIds = (ids: Iterable<unknown>) =>
  [...new Set([...ids].filter((v) => v && Types.ObjectId.isValid(String(v))).map(String))].map((s) => new Types.ObjectId(s));

export async function loadPersonRefs(userIds: Iterable<unknown>): Promise<Map<string, AdminPersonRef>> {
  const ids = toIds(userIds);
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids } }).select(USER_REF_FIELDS).lean<LeanUser[]>();
  return new Map(users.map((u) => [String(u._id), personRef(u)]));
}

/** Placeholder for a group that was deleted after the record (AI call, stats row) was written. */
export function deletedGroupRef(id: string): AdminGroupRef {
  return { id, name: 'Deleted group', status: GroupStatus.LEFT, deleted: true };
}

/** Refs for every requested id — ids whose group was deleted get a `deleted` placeholder, so history stays complete. */
export async function loadGroupRefs(groupIds: Iterable<unknown>): Promise<Map<string, AdminGroupRef>> {
  const ids = toIds(groupIds);
  if (!ids.length) return new Map();
  const groups = await Group.find({ _id: { $in: ids } }).select('groupName status').lean<LeanGroupRef[]>();
  const out = new Map(groups.map((g) => [String(g._id), groupRef(g)]));
  for (const id of ids) if (!out.has(String(id))) out.set(String(id), deletedGroupRef(String(id)));
  return out;
}
