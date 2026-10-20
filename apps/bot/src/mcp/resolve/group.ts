import mongoose from 'mongoose';
import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { Group, IGroup } from 'src/database/models/group.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import type { McpContext } from 'src/mcp/context';
import { McpToolError } from 'src/mcp/context';

const MAX_LISTED = 10;

export const NOT_A_MEMBER_TOOL_MESSAGE =
  "You don't have access to that group (it doesn't exist or you're not a member). Call list_groups to see the groups you can use.";

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** `"Team Alpha" (id …)`, … for error messages. */
export function groupChoices(groups: IGroup[]): string {
  const shown = groups.slice(0, MAX_LISTED).map((g) => `"${g.groupName}" (id ${g._id})`);
  return `${shown.join(', ')}${groups.length > MAX_LISTED ? ` …and ${groups.length - MAX_LISTED} more` : ''}`;
}

/** The user's groups, by title. */
export async function userGroups(ctx: McpContext): Promise<IGroup[]> {
  const ids = await groupMemberService.getUserGroups(ctx.user._id as mongoose.Types.ObjectId);
  return ids.length ? Group.find({ _id: { $in: ids } }).sort({ groupName: 1 }) : [];
}

function matchesGroup(group: IGroup, ref: string): boolean {
  return String(group._id) === ref.trim() || norm(group.groupName) === norm(ref);
}

/** A group of the user by exact title (case-insensitive), else a unique partial match. */
function findByTitle(groups: IGroup[], ref: string): IGroup {
  const exact = groups.filter((g) => norm(g.groupName) === norm(ref));
  const candidates = exact.length ? exact : groups.filter((g) => norm(g.groupName).includes(norm(ref)));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new McpToolError(
      `Several of your groups match "${ref}": ${groupChoices(candidates)}. Pass the group id instead.`,
    );
  }
  throw new McpToolError(
    groups.length
      ? `None of your groups is called "${ref}". Your groups: ${groupChoices(groups)}.`
      : "You aren't in any group with the bot yet. Add the bot to a Telegram group and post there once.",
  );
}

/**
 * The group a tool works on, after checking the caller may use it.
 * - Group-scoped token: always the token's group; another `ref` is an error.
 * - All-groups token: `ref` is an id or title; without it, the user's only group — or an error listing the groups
 *   so the agent can ask the user which one.
 */
export async function requireGroup(ctx: McpContext, ref?: string): Promise<IGroup> {
  if (ctx.scopeGroup) {
    if (ref && !matchesGroup(ctx.scopeGroup, ref)) {
      throw new McpToolError(
        `This token only works for group "${ctx.scopeGroup.groupName}" (id ${ctx.scopeGroup._id}). Omit \`group\` or pass that one; ` +
          'for other groups, create an all-groups token with /mcp in a private chat with the bot.',
      );
    }
    return ctx.scopeGroup;
  }

  let groupId: string;
  if (ref && mongoose.Types.ObjectId.isValid(ref.trim())) {
    groupId = ref.trim();
  } else {
    const groups = await userGroups(ctx);
    if (ref) {
      groupId = String(findByTitle(groups, ref)._id);
    } else if (groups.length === 1) {
      groupId = String(groups[0]._id);
    } else if (groups.length === 0) {
      throw new McpToolError(
        "You aren't in any group with the bot yet. Add the bot to a Telegram group and post there once.",
      );
    } else {
      throw new McpToolError(
        `Which group? Pass \`group\` (id or title). Your groups: ${groupChoices(groups)}. If the user didn't say, ask them.`,
      );
    }
  }

  const access = await checkGroupAccess(groupId, ctx.user);
  if (!access.ok) throw new McpToolError(NOT_A_MEMBER_TOOL_MESSAGE);
  return access.group;
}
