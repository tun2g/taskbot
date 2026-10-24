import { isClosedStatus, statusesInCategory, TASK_STATUS_ORDER, TASK_TYPE_ORDER, TaskStatusCategory } from '@tbot/shared';
import { BotContext } from 'src/bot/interface/context';
import { displayName, typeWord } from 'src/bot/task-card.renderer';
import { IGroup } from 'src/database/models/group.model';
import { IUser, User } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { escapeHtml } from 'src/shared/services/task-event-lines';

export const OPEN_STATUSES = TASK_STATUS_ORDER.filter((status) => !isClosedStatus(status));

/** Filter word → statuses it matches (and a header word). */
const STATUS_ARGS: Record<string, { statuses: string[]; title: string }> = {
  open: { statuses: OPEN_STATUSES, title: 'Open' },
  backlog: { statuses: ['backlog'], title: 'Backlog' },
  todo: { statuses: ['todo'], title: 'To do' },
  progress: { statuses: ['in_progress'], title: 'In progress' },
  in_progress: { statuses: ['in_progress'], title: 'In progress' },
  doing: { statuses: ['in_progress'], title: 'In progress' },
  review: { statuses: ['in_review'], title: 'In review' },
  in_review: { statuses: ['in_review'], title: 'In review' },
  pending: { statuses: ['pending'], title: 'Pending' },
  hold: { statuses: ['pending'], title: 'Pending' },
  done: { statuses: ['done'], title: 'Done' },
  cancelled: { statuses: ['cancelled'], title: 'Cancelled' },
  canceled: { statuses: ['cancelled'], title: 'Cancelled' },
  closed: { statuses: statusesInCategory(TaskStatusCategory.DONE), title: 'Closed' },
};

/** Type words, singular and plural. */
const TYPE_ARGS: Record<string, string> = Object.fromEntries(
  TASK_TYPE_ORDER.flatMap((type) => [
    [type, type],
    [`${type}s`, type],
  ]),
);

const USAGE =
  'Status: <code>open</code>, <code>backlog</code>, <code>todo</code>, <code>progress</code>, <code>review</code>, ' +
  '<code>pending</code>, <code>done</code>, <code>cancelled</code>\n' +
  `Type: ${TASK_TYPE_ORDER.map((t) => `<code>${t}</code>`).join(', ')}\n` +
  'People: <code>mine</code>, <code>@username</code>\n' +
  'Example: <code>/list mine bug</code> · <code>/mytasks</code> = <code>/list mine</code>';

export interface ParsedFilters {
  status?: { statuses: string[]; title: string };
  type?: string;
  assignee?: IUser;
  mine?: boolean;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parses the /list words; replies and returns null on an unknown word or person. */
export async function parseListFilters(
  ctx: BotContext,
  tokens: string[],
  user: IUser,
  group: IGroup,
): Promise<ParsedFilters | null> {
  const filters: ParsedFilters = {};
  for (const raw of tokens) {
    const token = raw.toLowerCase();
    if (token === 'mine' || token === 'me' || token === 'my') {
      filters.mine = true;
      filters.assignee = user;
    } else if (STATUS_ARGS[token]) {
      filters.status = STATUS_ARGS[token];
    } else if (TYPE_ARGS[token]) {
      filters.type = TYPE_ARGS[token];
    } else if (token.startsWith('@') && token.length > 1) {
      const username = raw.slice(1);
      const target = await User.findOne({ username: { $regex: `^${escapeRegex(username)}$`, $options: 'i' } });
      const known = target ? await groupMemberService.isMember(group._id, target._id) : false;
      if (!target || !known) {
        await ctx.reply(
          `I don't know @${escapeHtml(username)} in this group yet — they need to send a message here first.`,
          { parse_mode: 'HTML' },
        );
        return null;
      }
      filters.assignee = target;
    } else {
      await ctx.reply(`I don't understand “${escapeHtml(raw)}”.\n${USAGE}`, { parse_mode: 'HTML' });
      return null;
    }
  }
  return filters;
}

/** Header like "<b>Your open bugs</b>" or "<b>Open tasks</b> for @an" (HTML). */
export function describeFilters(filters: ParsedFilters): string {
  const status = filters.status ? filters.status.title : 'Open';
  const type = filters.type ? `${typeWord(filters.type).toLowerCase()}s` : 'tasks';
  if (filters.mine) return `<b>Your ${status.toLowerCase()} ${type}</b>`;
  const base = `<b>${status} ${type}</b>`;
  return filters.assignee ? `${base} for ${escapeHtml(displayName(filters.assignee))}` : base;
}
