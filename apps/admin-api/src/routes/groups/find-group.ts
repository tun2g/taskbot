import { Group } from '@tbot/db';
import { Types } from 'mongoose';
import { GROUP_FIELDS, LeanGroup, normalizeGroup } from 'src/routes/group-rows';
import { HttpError } from 'src/shared/http';

/** The group, or a 404 with a plain message. */
export async function findGroup(id: Types.ObjectId): Promise<LeanGroup> {
  const g = await Group.findById(id).select(GROUP_FIELDS).lean<LeanGroup>();
  if (!g) throw new HttpError(404, "This group doesn't exist (it may have been deleted).");
  return normalizeGroup(g);
}
