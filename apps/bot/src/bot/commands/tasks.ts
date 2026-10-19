import {
  isClosedStatus,
  statusesInCategory,
  TASK_STATUS_ORDER,
  TASK_TYPE_ORDER,
  TaskStatusCategory,
} from '@tbot/shared';
import { BotContext } from 'src/bot/interface/context';
import {
  escapeMarkdown,
  mdName,
  populatedUser,
  STATUS_EMOJI,
  truncate,
  typeWord,
} from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import { IUser, User } from 'src/database/models/user.model';
import { groupService } from 'src/database/services/group.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskService } from 'src/database/services/task.service';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import { appLinkButton } from 'src/shared/utils/app-links';

const LIST_LIMIT = 15;

const OPEN_STATUSES = TASK_STATUS_ORDER.filter((status) => !isClosedStatus(status));

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
  'Status: `open`, `backlog`, `todo`, `progress`, `review`, `pending`, `done`, `cancelled`\n' +
  `Type: ${TASK_TYPE_ORDER.map((t) => `\`${t}\``).join(', ')}\n` +
  'People: `mine`, `@username`\n' +
  'Example: `/tasks mine bug`';

interface ParsedFilters {
  status?: { statuses: string[]; title: string };
  type?: string;
  assignee?: IUser;
  mine?: boolean;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class TasksCommand {
  private map: Map<string, (ctx: BotContext) => void>;

  constructor() {
    this.map = new Map<string, (ctx: BotContext) => void>();
  }

  register() {
    this.map.set('tasks', this.onTasks.bind(this));
    return this.map;
  }

  async onTasks(ctx: BotContext) {
    try {
      const chatId = ctx.chat?.id;
      const chatType = ctx.chat?.type;

      if (!chatId || (chatType !== 'group' && chatType !== 'supergroup')) {
        await ctx.reply('⚠️ /tasks can only be used in group chats.');
        return;
      }

      const user = await userService.findOrCreateUser(ctx);
      if (!user) return;

      const chatTitle = 'title' in ctx.chat! ? (ctx.chat as { title: string }).title : 'Group';
      const group = await groupService.findOrCreateGroup(chatId, chatTitle);
      if (!group) {
        await ctx.reply('❌ Could not find this group.');
        return;
      }

      const message = ctx.message;
      if (!message) return;
      const messageText = 'text' in message ? message.text || '' : '';
      const tokens = messageText
        .replace(/^\/tasks(@\w+)?\s*/i, '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      // ── Parse filters ──
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
              `I don't know @${escapeMarkdown(username)} in this group yet — they need to send a message here first.`,
              { parse_mode: 'Markdown' },
            );
            return;
          }
          filters.assignee = target;
        } else {
          await ctx.reply(`I don't understand “${escapeMarkdown(raw)}”.\n${USAGE}`, { parse_mode: 'Markdown' });
          return;
        }
      }

      const stats = await taskService.getTaskStats(group._id);
      const sumOf = (cat: TaskStatusCategory) =>
        statusesInCategory(cat).reduce((sum, status) => sum + (stats[status] || 0), 0);
      const totals = {
        todo: sumOf(TaskStatusCategory.TODO),
        inProgress: sumOf(TaskStatusCategory.IN_PROGRESS),
        done: sumOf(TaskStatusCategory.DONE),
      };
      const total = totals.todo + totals.inProgress + totals.done;

      if (total === 0) {
        await ctx.reply(
          '📋 No tasks in this group yet.\n\nCreate one with `/task Fix login on iOS` — or reply to a message with /task.',
          { parse_mode: 'Markdown' },
        );
        return;
      }

      // ── Fetch: a status filter wins; otherwise show open tasks (to do + in progress) ──
      const statuses = filters.status ? filters.status.statuses : OPEN_STATUSES;
      const results = await Promise.all(
        statuses.map((status) =>
          taskService.getTasksByGroup(group._id, {
            status,
            ...(filters.type ? { type: filters.type } : {}),
            ...(filters.assignee ? { assigneeId: filters.assignee._id } : {}),
            limit: LIST_LIMIT,
          }),
        ),
      );
      const matchCount = results.reduce((sum, r) => sum + (r.total || 0), 0);
      const tasks = results
        .flatMap((r) => r.tasks || [])
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, LIST_LIMIT);

      const isFiltered = tokens.length > 0;
      const lines: string[] = [];

      if (!isFiltered) {
        lines.push(`📋 *Tasks* · ${escapeMarkdown(chatTitle)}`);
        lines.push(`${totals.todo} to do · ${totals.inProgress} in progress · ${totals.done} done`);
      } else {
        lines.push(`📋 ${this.describeFilters(filters)} (${matchCount})`);
      }

      if (tasks.length === 0) {
        lines.push('');
        lines.push(isFiltered ? 'Nothing matches. Try `/tasks` for everything open.' : 'Nothing open right now. 🎉');
      } else {
        lines.push('');
        for (const task of tasks) lines.push(this.formatLine(task));
        if (matchCount > tasks.length) {
          lines.push(`…and ${matchCount - tasks.length} more — open the board`);
        }
      }

      if (!isFiltered) {
        lines.push('');
        lines.push('Filter: `/tasks mine`, `/tasks bug`, `/tasks @name`');
      }

      const board = appLinkButton('📋 Open board', group._id.toString());
      await ctx.reply(lines.join('\n'), {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        ...(board ? { reply_markup: { inline_keyboard: [[board]] } } : {}),
      });
    } catch (error) {
      logger.error(`Error in /tasks command: ${error}`);
      await ctx.reply('❌ Failed to load tasks. Please try again.');
    }
  }

  /** Header like "*Your open bugs*" or "*Open tasks* for @an" — user text stays outside the bold entity. */
  private describeFilters(filters: ParsedFilters): string {
    const status = filters.status ? filters.status.title : 'Open';
    const type = filters.type ? `${typeWord(filters.type).toLowerCase()}s` : 'tasks';
    if (filters.mine) return `*Your ${status.toLowerCase()} ${type}*`;
    const base = `*${status} ${type}*`;
    return filters.assignee ? `${base} for ${mdName(filters.assignee)}` : base;
  }

  /** "🔄 #14 Bug · Fix login on iOS — @an" */
  private formatLine(task: ITask): string {
    const emoji = STATUS_EMOJI[task.status] || STATUS_EMOJI.todo;
    const assignee = populatedUser(task.assigneeId);
    const who = assignee ? ` — ${mdName(assignee)}` : '';
    return `${emoji} #${task.taskNumber} ${typeWord(task.type)} · ${escapeMarkdown(truncate(task.title, 60))}${who}`;
  }
}

export const tasksCommand = new TasksCommand();
