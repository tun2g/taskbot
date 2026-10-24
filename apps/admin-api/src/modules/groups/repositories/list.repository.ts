import { Group } from '@tbot/db';
import { Types } from 'mongoose';
import { GROUP_FIELDS, LeanGroup } from 'src/modules/groups/groups.repository';
import type { Pagination } from 'src/shared/http';

export function countGroups(filter: Record<string, unknown>): Promise<number> {
  return Group.countDocuments(filter);
}

/** Every matching group's id and creation time (what ranking needs before paging). */
export function findGroupIds(filter: Record<string, unknown>): Promise<{ _id: Types.ObjectId; createdAt: Date }[]> {
  return Group.find(filter).select('_id createdAt').lean<{ _id: Types.ObjectId; createdAt: Date }[]>();
}

/** The groups with these ids, in no particular order. */
export function findGroupsByIds(ids: Types.ObjectId[]): Promise<LeanGroup[]> {
  return Group.find({ _id: { $in: ids } })
    .select(GROUP_FIELDS)
    .lean<LeanGroup[]>();
}

/** One page of groups in a Mongo sort order. */
export function findGroupsSorted(
  filter: Record<string, unknown>,
  sort: Record<string, 1 | -1>,
  p: Pagination,
): Promise<LeanGroup[]> {
  return Group.find(filter).select(GROUP_FIELDS).sort(sort).skip(p.skip).limit(p.limit).lean<LeanGroup[]>();
}
