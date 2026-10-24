import { Types } from 'mongoose';
import { findGroupDoc, LeanGroup } from 'src/modules/groups/groups.repository';
import { HttpError } from 'src/shared/http';
import { statusOf } from 'src/shared/refs';

/** Public entry of the groups module for other modules: groupRows, normalizeGroup (and findGroup inside the module). */
export { groupRows } from 'src/modules/groups/services/rows.service';

/** Lean group with a guaranteed status (see statusOf). */
export function normalizeGroup<T extends LeanGroup | null>(g: T): T {
  return (g ? { ...g, status: statusOf(g) } : g) as T;
}

/** The group, or a 404 with a plain message. */
export async function findGroup(id: Types.ObjectId): Promise<LeanGroup> {
  const g = await findGroupDoc(id);
  if (!g) throw new HttpError(404, "This group doesn't exist (it may have been deleted).");
  return normalizeGroup(g);
}
