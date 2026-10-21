import {
  isClosedStatus,
  statusesInCategory,
  TASK_STATUS_ORDER,
  TASK_TYPE_ORDER,
  TaskStatusCategory,
} from '@tbot/shared';
import { replyGroupOnly } from 'src/bot/commands/private-chat-hint';
import { createFromReplyButton } from 'src/bot/create-from-reply';
import { BotContext } from 'src/bot/interface/context';
import {
  displayName,
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
import { escapeHtml } from 'src/shared/services/task-event-lines';
import { listSuffixHtml, populatedParent } from 'src/bot/subtasks/subtask-lines';
import { SubtaskProgress, subtaskService } from 'src/database/services/subtask.service';
import { boardButton, taskNumberHtml } from 'src/shared/utils/app-links';

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
  'Status: <code>open</code>, <code>backlog</code>, <code>todo</code>, <code>progress</code>, <code>review</code>, ' +
  '<code>pending</code>, <code>done</code>, <code>cancelled</code>\n' +
  `Type: ${TASK_TYPE_ORDER.map((t) => `<code>${t}</code>`).join(', ')}\n` +
  'People: <code>mine</code>, <code>@username</code>\n' +
  'Example: <code>/list mine bug</code> · <code>/mytasks</code> = <code>/list mine</code>';

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
    this.map.set('list', this.onTasks.bind(this));
    this.map.set('mytasks', this.onTasks.bind(this));
    // Old name keeps working (hidden from the menu)
    this.map.set('tasks', this.onTasks.bind(this));
    return this.map;
  }

  async onTasks(ctx: BotContext) {
    try {
      const chatId = ctx.chat?.id;
      const chatType = ctx.chat?.type;

      if (!chatId || (chatType !== 'group' && chatType !== 'supergroup')) {
        const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
        await replyGroupOnly(ctx, /^\/mytasks/i.test(text) ? 'mytasks' : 'list');
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
      // /mytasks is /list mine
      const isMyTasks = /^\/mytasks(@\w+)?(\s|$)/i.test(messageText);
      const args = messageText
        .replace(/^\/(list|mytasks|tasks)(@\w+)?\s*/i, '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const tokens = isMyTasks ? ['mine', ...args] : args;

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
              `I don't know @${escapeHtml(username)} in this group yet — they need to send a message here first.`,
              { parse_mode: 'HTML' },
            );
            return;
          }
          filters.assignee = target;
        } else {
          await ctx.reply(`I don't understand “${escapeHtml(raw)}”.\n${USAGE}`, { parse_mode: 'HTML' });
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

      // Replying to a message with a list command usually means "create from this"
      const createButton = await createFromReplyButton(ctx);
      const board = boardButton(group._id.toString());
      const keyboard = [createButton ? [createButton] : [], board ? [board] : []].filter((row) => row.length > 0);
      const replyMarkup = keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {};

      if (total === 0) {
        await ctx.reply(
          createButton
            ? '📋 No tasks in this group yet.\n\nDid you mean <code>/new</code>? Tap below to turn that message into tasks.'
            : '📋 No tasks in this group yet.\n\nCreate one with <code>/new Fix login on iOS</code> — or reply to a message with /new.',
          { parse_mode: 'HTML', ...replyMarkup },
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
        lines.push(`📋 <b>Tasks</b> · ${escapeHtml(chatTitle)}`);
        lines.push(`${totals.todo} to do · ${totals.inProgress} in progress · ${totals.done} done`);
      } else {
        lines.push(`📋 ${this.describeFilters(filters)} (${matchCount})`);
      }

      if (tasks.length === 0) {
        lines.push('');
        lines.push(isFiltered ? 'Nothing matches. Try <code>/list</code> for everything open.' : 'Nothing open right now. 🎉');
      } else {
        lines.push('');
        // One query: "🧩 2/5" after parents in the list.
        const progress = await subtaskService.progress(tasks.filter((t) => !t.parentTaskId).map((t) => String(t._id)));
        for (const task of tasks) lines.push(this.formatLine(task, group._id, progress.get(String(task._id))));
        if (matchCount > tasks.length) {
          const more = matchCount - tasks.length;
          // Only point at the board when there's a button for it
          lines.push(
            board
              ? `…and ${more} more — open the board`
              : `…and ${more} more — narrow it down, e.g. <code>/list bug</code> or <code>/list @name</code>`,
          );
        }
      }

      if (!isFiltered) {
        lines.push('');
        lines.push('Filter: <code>/mytasks</code>, <code>/list bug</code>, <code>/list @name</code>');
      }

      await ctx.reply(lines.join('\n'), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...replyMarkup,
      });
    } catch (error) {
      logger.error(`Error in /list command: ${error}`);
      await ctx.reply('❌ Failed to load tasks. Please try again.');
    }
  }

  /** Header like "<b>Your open bugs</b>" or "<b>Open tasks</b> for @an" (HTML). */
  private describeFilters(filters: ParsedFilters): string {
    const status = filters.status ? filters.status.title : 'Open';
    const type = filters.type ? `${typeWord(filters.type).toLowerCase()}s` : 'tasks';
    if (filters.mine) return `<b>Your ${status.toLowerCase()} ${type}</b>`;
    const base = `<b>${status} ${type}</b>`;
    return filters.assignee ? `${base} for ${escapeHtml(displayName(filters.assignee))}` : base;
  }

  /**
   * "🔄 #14 Bug · Fix login on iOS — @an" (HTML; #14 opens the task when the app link exists).
   * A subtask ends its title with "↳ #12"; a parent with "· 🧩 2/5".
   */
  private formatLine(task: ITask, groupId: { toString(): string }, subtasks?: SubtaskProgress): string {
    const emoji = STATUS_EMOJI[task.status] || STATUS_EMOJI.todo;
    const assignee = populatedUser(task.assigneeId);
    const who = assignee ? ` — ${escapeHtml(displayName(assignee))}` : '';
    const num = taskNumberHtml(task.taskNumber, groupId, task._id);
    const sub = listSuffixHtml(populatedParent(task.parentTaskId), subtasks);
    return `${emoji} ${num} ${typeWord(task.type)} · ${escapeHtml(truncate(task.title, 60))}${sub}${who}`;
  }
}

export const tasksCommand = new TasksCommand();
