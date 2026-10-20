import mongoose from 'mongoose';
import { IGroup } from 'src/database/models/group.model';
import { IUser } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { McpContext, McpToolError } from 'src/mcp/context';
import { userDisplayName } from 'src/shared/services/task-event-lines';
import { resolveMember } from 'src/shared/services/task-extraction.service';

const SELF = new Set(['me', 'myself', '@me']);
const MAX_SUGGESTIONS = 5;
const MAX_LISTED = 15;

/** Lower-case, accents removed ("Bình" → "binh"), so near-miss suggestions work for Vietnamese names. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();

function names(user: IUser): string[] {
  return [
    user.username ?? '',
    user.firstName ?? '',
    user.lastName ?? '',
    [user.firstName, user.lastName].filter(Boolean).join(' '),
  ]
    .map(fold)
    .filter(Boolean);
}

/** Edit distance (small strings only). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** Members whose name contains the query (or is a near miss of it), best first. */
export function closeMatches(query: string, members: IUser[]): IUser[] {
  const q = fold(query.replace(/^@/, ''));
  if (!q) return [];
  // Short names allow one typo, longer ones two.
  const tolerance = q.length <= 5 ? 1 : 2;
  const contains = (n: string) => n.length >= 3 && q.length >= 3 && (n.includes(q) || q.includes(n));
  const scored = members
    .map((m) => ({ m, best: Math.min(...names(m).map((n) => (contains(n) ? 0 : distance(n, q)))) }))
    .filter((x) => x.best <= tolerance);
  return scored
    .sort((a, b) => a.best - b.best)
    .map((x) => x.m)
    .slice(0, MAX_SUGGESTIONS);
}

/** "@an, Bình Trần, …" */
export function memberList(members: IUser[], max = MAX_LISTED): string {
  const shown = members.slice(0, max).map(userDisplayName).join(', ');
  return members.length > max ? `${shown} …and ${members.length - max} more` : shown;
}

/**
 * A group member from "@username", a (first / full) name, or "me". Throws an McpToolError that lists close
 * matches (or the members) so the model can retry with a valid name.
 */
export async function resolveAssignee(ctx: McpContext, group: IGroup, name: string): Promise<IUser> {
  const raw = name.trim();
  if (SELF.has(raw.toLowerCase())) return ctx.user;

  const members = await groupMemberService.getMembers(group._id as mongoose.Types.ObjectId);
  if (!members.some((m) => String(m._id) === String(ctx.user._id))) members.push(ctx.user);
  const found = resolveMember(raw, members);
  if (found) return found;

  const close = closeMatches(raw, members);
  const hint = close.length
    ? `Did you mean ${memberList(close)}?`
    : members.length
      ? `Members: ${memberList(members)}.`
      : 'Nobody in this group can be assigned yet.';
  throw new McpToolError(
    `No group member matches "${raw}". ${hint} Use an exact @username or name from list_members, or "me". ` +
      '(People who never posted in the group are unknown to the bot — they can send /members in the group and tap ✋.)',
  );
}
