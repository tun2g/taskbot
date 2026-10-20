import { EPIC_STATUS_VALUES, EPIC_TITLE_MAX, EpicColor, EpicStatus } from '@tbot/shared';
import mongoose from 'mongoose';
import { refreshTaskCards } from 'src/api/controllers/epic.controller';
import { IEpic } from 'src/database/models/epic.model';
import { EpicProgress, EpicTitleTakenError, epicService } from 'src/database/services/epic.service';
import { McpToolError } from 'src/mcp/context';
import { epicEventsService } from 'src/shared/services/epic-events.service';
import { requireGroup } from 'src/mcp/resolve/group';
import { resolveEpic } from 'src/mcp/resolve/epic';
import { epicArg, epicColorEnum } from 'src/mcp/tools/schemas';
import { ADDITIVE, defineTool, groupArg, IDEMPOTENT_WRITE, READ_ONLY } from 'src/mcp/tools/types';
import { z } from 'zod';

const epicTitleArg = z
  .string()
  .trim()
  .min(1, 'The epic title is empty.')
  .max(EPIC_TITLE_MAX, `Epic titles can be at most ${EPIC_TITLE_MAX} characters.`)
  .describe('Short name of the epic, e.g. "Login" or "Billing v2".');
const epicDescriptionArg = z.string().max(2000, 'Epic descriptions can be at most 2000 characters.');

export interface EpicSummary {
  id: string;
  title: string;
  description: string | null;
  color: string;
  status: string;
  progress: EpicProgress;
}

type EpicLike = Pick<IEpic, 'title' | 'color' | 'status'> & { _id: unknown; description?: string | null };

export function epicSummary(epic: EpicLike, progress: EpicProgress): EpicSummary {
  return {
    id: String(epic._id),
    title: epic.title,
    description: epic.description || null,
    color: epic.color,
    status: epic.status ?? EpicStatus.OPEN,
    progress,
  };
}

/** "Login — open, blue · 3/5 done, 1 in progress (epicId: …)" */
export function epicLine(e: EpicSummary): string {
  const p = e.progress;
  const progress = p.total
    ? `${p.done}/${p.total} done${p.inProgress ? `, ${p.inProgress} in progress` : ''}`
    : 'no tasks yet';
  return `${e.title} — ${e.status}, ${e.color} · ${progress} (epicId: ${e.id})`;
}

function titleTaken(error: unknown): never {
  if (error instanceof EpicTitleTakenError)
    throw new McpToolError(`${error.message} Use list_epics to see existing epics.`);
  throw error;
}

export const listEpicsTool = defineTool({
  name: 'list_epics',
  title: 'List epics',
  description:
    'Lists the epics (groups of related tasks) of a group with their progress: tasks done / total (cancelled excluded).',
  inputSchema: { group: groupArg },
  annotations: READ_ONLY,
  handler: async ({ group: groupRef }, ctx) => {
    const group = await requireGroup(ctx, groupRef);
    const rows = await epicService.listWithProgress(group._id as mongoose.Types.ObjectId);
    const epics = rows.map((row) => epicSummary(row as unknown as EpicLike, row.progress));
    epics.sort((a, b) => Number(a.status !== EpicStatus.OPEN) - Number(b.status !== EpicStatus.OPEN));
    const text = epics.length
      ? [`${epics.length} epic${epics.length === 1 ? '' : 's'}:`, ...epics.map((e) => `- ${epicLine(e)}`)].join('\n')
      : 'This group has no epics yet. Create one with create_epic.';
    return { text, data: { epics } };
  },
});

export const createEpicTool = defineTool({
  name: 'create_epic',
  title: 'Create an epic',
  description:
    'Creates an epic in a group (titles are unique per group, case-insensitive). The color is picked automatically unless given. ' +
    'Put tasks in it with create_tasks / update_task `epic`.',
  inputSchema: {
    group: groupArg,
    title: epicTitleArg,
    description: epicDescriptionArg.optional().describe('What the epic is about.'),
    color: epicColorEnum.optional(),
  },
  annotations: ADDITIVE,
  handler: async ({ group: groupRef, title, description, color }, ctx) => {
    const group = await requireGroup(ctx, groupRef);
    let epic: IEpic;
    try {
      epic = await epicService.create({
        groupId: group._id as mongoose.Types.ObjectId,
        createdBy: ctx.user._id as mongoose.Types.ObjectId,
        title,
        description: description ?? null,
        ...(color ? { color: color as EpicColor } : {}),
      });
    } catch (error) {
      titleTaken(error);
    }
    void epicEventsService.created(epic, ctx.user, ctx.clientLabel, { group });
    const summary = epicSummary(epic, { total: 0, done: 0, inProgress: 0, cancelled: 0 });
    return { text: `Created epic ${epicLine(summary)}.`, data: { epic: summary } };
  },
});

export const updateEpicTool = defineTool({
  name: 'update_epic',
  title: 'Update an epic',
  description:
    'Renames, recolors, re-describes or closes / reopens an epic (status "done" / "open"). Only the fields you pass change; ' +
    'task cards in the group are refreshed when the title or color changes.',
  inputSchema: {
    group: groupArg,
    epic: epicArg,
    title: epicTitleArg.optional(),
    description: epicDescriptionArg.nullable().optional().describe('New description; null or "" clears it.'),
    color: epicColorEnum.optional(),
    status: z.enum(EPIC_STATUS_VALUES).optional().describe('open or done.'),
  },
  annotations: IDEMPOTENT_WRITE,
  handler: async ({ group: groupRef, epic: ref, title, description, color, status }, ctx) => {
    const group = await requireGroup(ctx, groupRef);
    const before = await resolveEpic(group, ref);
    if (title === undefined && description === undefined && color === undefined && status === undefined) {
      throw new McpToolError('Pass at least one field to change: title, description, color or status.');
    }
    const previous = { title: before.title, color: before.color, status: before.status };

    let epic: IEpic | null = null;
    try {
      epic = await epicService.update(before, {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(color !== undefined ? { color: color as EpicColor } : {}),
        ...(status !== undefined ? { status: status as EpicStatus } : {}),
      });
    } catch (error) {
      titleTaken(error);
    }
    if (!epic)
      throw new McpToolError('That epic was deleted in the meantime. Call list_epics to see the current ones.');

    // Cards show "🔵 Login" — refresh them when the name or color changed (same as the app).
    if (epic.title !== previous.title || epic.color !== previous.color) {
      epicService
        .taskIds(epic)
        .then(refreshTaskCards)
        .catch(() => {});
    }
    if (epic.status !== previous.status) {
      void epicEventsService.statusChanged(previous.status, epic, ctx.user, ctx.clientLabel, { group });
    }
    const progress = (await epicService.getProgress(epic.groupId, [epic._id as mongoose.Types.ObjectId])).get(
      String(epic._id),
    );
    const summary = epicSummary(epic, progress ?? { total: 0, done: 0, inProgress: 0, cancelled: 0 });
    return { text: `Updated epic ${epicLine(summary)}.`, data: { epic: summary } };
  },
});
