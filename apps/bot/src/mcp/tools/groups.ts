import { GROUP_STATUS_LABELS, GroupStatus, isClosedStatus, TASK_STATUS_ORDER } from '@tbot/shared';
import mongoose from 'mongoose';
import { Group } from 'src/database/models/group.model';
import { Task } from 'src/database/models/task.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { requireGroup } from 'src/mcp/resolve/group';
import { defineTool, groupArg, READ_ONLY } from 'src/mcp/tools/types';
import { userDisplayName } from 'src/shared/services/task-event-lines';
import { isGroupActive } from 'src/shared/utils/group-status';

const CLOSED_STATUSES = TASK_STATUS_ORDER.filter((s) => isClosedStatus(s));

export const listGroupsTool = defineTool({
  name: 'list_groups',
  title: 'List my groups',
  description:
    'Lists the Telegram groups (workspaces) you share with the TaskBot bot, with how many tasks are still open in each. ' +
    "Call this first when you don't know which group the user means: other tools take `group` (an id or title from here). " +
    'Groups marked unavailable (waiting for approval, paused, bot removed) cannot be used by any tool until that changes.',
  inputSchema: {},
  annotations: READ_ONLY,
  handler: async (_args, ctx) => {
    // A group-scoped token only ever sees its own group.
    const groupIds = ctx.scopeGroup
      ? [ctx.scopeGroup._id as mongoose.Types.ObjectId]
      : await groupMemberService.getUserGroups(ctx.user._id as mongoose.Types.ObjectId);
    if (groupIds.length === 0) {
      return {
        text: "You aren't in any group with the bot yet. Add the bot to a Telegram group and post there once, then try again.",
        data: { groups: [] },
      };
    }

    const [groups, rows] = await Promise.all([
      Group.find({ _id: { $in: groupIds } }).sort({ groupName: 1 }),
      Task.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
        { $match: { groupId: { $in: groupIds }, status: { $nin: CLOSED_STATUSES } } },
        { $group: { _id: '$groupId', count: { $sum: 1 } } },
      ]),
    ]);
    const open = new Map(rows.map((r) => [String(r._id), r.count]));
    const list = groups.map((g) => ({
      id: String(g._id),
      title: g.groupName,
      openTasks: open.get(String(g._id)) ?? 0,
      status: g.status ?? GroupStatus.ACTIVE,
      available: isGroupActive(g),
    }));

    const lines = [
      ctx.scopeGroup
        ? `This connection is limited to one group — \`group\` can be omitted everywhere:`
        : `${list.length} group${list.length === 1 ? '' : 's'}:`,
    ];
    for (const g of list) {
      const state = g.available
        ? `${g.openTasks} open task${g.openTasks === 1 ? '' : 's'}`
        : `unavailable: ${GROUP_STATUS_LABELS[g.status].toLowerCase()}`;
      lines.push(`- ${g.title} — ${state} (id: ${g.id})`);
    }
    return { text: lines.join('\n'), data: { groups: list, scoped: !!ctx.scopeGroup } };
  },
});

export const listMembersTool = defineTool({
  name: 'list_members',
  title: 'List group members',
  description:
    'Lists the people tasks in this group can be assigned to (the bot only knows members who have posted, been mentioned or tapped ✋ in /members). ' +
    'Use the @username (or name) shown here as `assignee`.',
  inputSchema: { group: groupArg },
  annotations: READ_ONLY,
  handler: async ({ group: groupRef }, ctx) => {
    const group = await requireGroup(ctx, groupRef);
    const members = await groupMemberService.getMembers(group._id as mongoose.Types.ObjectId);
    const list = members
      .map((m) => ({
        name: userDisplayName(m),
        username: m.username ?? null,
        fullName: [m.firstName, m.lastName].filter(Boolean).join(' ') || null,
        isMe: String(m._id) === String(ctx.user._id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const lines = [`${list.length} member${list.length === 1 ? '' : 's'} in ${group.groupName}:`];
    for (const m of list) {
      const extra = m.username && m.fullName ? ` (${m.fullName})` : '';
      lines.push(`- ${m.name}${extra}${m.isMe ? ' — you' : ''}`);
    }
    if (list.length === 0)
      lines.push('Nobody yet — people appear once they post in the group or tap ✋ under /members.');
    return { text: lines.join('\n'), data: { members: list } };
  },
});
