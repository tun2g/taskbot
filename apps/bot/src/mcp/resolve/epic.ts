import mongoose from 'mongoose';
import { IEpic } from 'src/database/models/epic.model';
import { IGroup } from 'src/database/models/group.model';
import { epicService } from 'src/database/services/epic.service';
import { McpToolError } from 'src/mcp/context';

const MAX_LISTED = 10;

/** An epic of this group by id or (case-insensitive) title; the error lists the group's open epics. */
export async function resolveEpic(group: IGroup, ref: string): Promise<IEpic> {
  const groupId = group._id as mongoose.Types.ObjectId;
  const value = ref.trim();
  const byId = mongoose.Types.ObjectId.isValid(value) ? await epicService.findInGroup(groupId, value) : null;
  const epic = byId ?? (await epicService.findByTitle(groupId, value));
  if (epic) return epic;

  const open = await epicService.listOpen(groupId);
  const list = open.length
    ? `Open epics: ${open
        .slice(0, MAX_LISTED)
        .map((e) => `"${e.title}"`)
        .join(', ')}${open.length > MAX_LISTED ? ` …and ${open.length - MAX_LISTED} more` : ''}.`
    : 'This group has no epics yet.';
  throw new McpToolError(
    `No epic "${value}" in this group. ${list} Pass an exact epic title or id (see list_epics), or create it first with create_epic.`,
  );
}
