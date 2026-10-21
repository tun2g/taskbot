import { isClosedStatus } from '@tbot/shared';
import { bot } from 'src/bot';
import { resolveParentRef } from 'src/bot/subtasks/parent-ref';
import { parentLine } from 'src/bot/subtasks/subtask-lines';
import {
  describeDue,
  dueState,
  escapeMarkdown,
  groupTimezone,
  mdName,
  populatedUser,
  PRIMARY_ACTION,
  refId,
  statusLabel,
  statusWord,
  typeEmoji,
  typeWord,
} from 'src/bot/task-card.renderer';
import { Group } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser, User } from 'src/database/models/user.model';
import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';
import { openTaskLabel, taskButton } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

const NOTIFICATION_WINDOW_SECONDS = 300;

/**
 * Outcome of a DM attempt. Callers may ignore it.
 * - `not_started`: the user never opened a private chat with the bot (Telegram refuses the DM).
 * - `blocked`: the user blocked the bot.
 * - `skipped`: self-action or throttled.
 */
export type NotifyResult = 'sent' | 'skipped' | 'not_started' | 'blocked' | 'failed';

export type ReminderReason = 'assignee' | 'creator';

/** Status words come from the shared labels ("⏸ Pending" → "is now pending") so DMs match cards and the board. */
function statusHeadline(status: string, taskNumber: number): string {
  const emoji = statusLabel(status).split(' ')[0];
  switch (status) {
    case 'done':
      return `${emoji} *#${taskNumber} is done*`;
    case 'cancelled':
      return `${emoji} *#${taskNumber} was cancelled*`;
    default:
      return `${emoji} *#${taskNumber} is now ${statusWord(status).toLowerCase()}*`;
  }
}

/**
 * DM quick actions: `tdm:<status>:<taskId>` (or `tdm:noop:<taskId>` for a state-only button).
 * Self-contained — no Redis entry to expire — and under Telegram's 64-byte limit.
 * Handled in task-callback.handler (only the DM's buttons change, never its text).
 */
export const DM_TASK_CALLBACK_PREFIX = 'tdm:';

/** "✅ Marked done" / "🚫 Cancelled" — a closed task shows its state instead of an action. */
function closedStateText(status: string): string {
  return status === 'done' ? '✅ Marked done' : statusLabel(status);
}

/** `tdm:close:<taskId>` — "✅ Done #N" that closes the task whatever its status (all subtasks done, confirmed closes). */
export const DM_CLOSE_ACTION = 'close';

/** `tdm:explain:<taskId>` — "💡 Explain" under a DM: a short AI explanation of the task, as a new DM. */
export const DM_EXPLAIN_ACTION = 'explain';

/**
 * Assignee DM keyboard: [next status step, e.g. ▶ Start / 👀 Review / ✅ Done] [💡 Explain] [📱 Open #N].
 * Closed tasks get a state button instead of a step.
 */
export function dmTaskKeyboard(task: ITask): InlineKeyboardButton[][] {
  const taskId = task._id.toString();
  const row: InlineKeyboardButton[] = [];
  if (isClosedStatus(task.status)) {
    row.push({ text: closedStateText(task.status), callback_data: `${DM_TASK_CALLBACK_PREFIX}noop:${taskId}` });
  } else {
    const next = PRIMARY_ACTION[task.status] || PRIMARY_ACTION.todo;
    row.push({ text: next.text, callback_data: `${DM_TASK_CALLBACK_PREFIX}${next.to}:${taskId}` });
  }
  row.push({ text: '💡 Explain', callback_data: `${DM_TASK_CALLBACK_PREFIX}${DM_EXPLAIN_ACTION}:${taskId}` });
  const open = taskButton(task);
  if (open) row.push(open);
  return [row];
}

/** The open button, relabelled for the creator of an unassigned task: "👤 Assign #N" (or "👤 Assign on card"). */
function assignButton(task: ITask): InlineKeyboardButton | null {
  const open = taskButton(task);
  if (!open || !('url' in open)) return open;
  const text = open.text === openTaskLabel(task.taskNumber) ? `👤 Assign #${task.taskNumber}` : '👤 Assign on card';
  return { text, url: open.url };
}

/** How to assign without the app: the card's 👤 Assign, or /ai when the task has no card (/sub, /ai, MCP batches). */
function assignHint(task: ITask): string {
  if (task.taskCardMessageId) return 'Use 👤 Assign on its card in the group.';
  return `Assign it in the group with \`/ai giao #${task.taskNumber} cho @name\`.`;
}

function openOnly(task: ITask): InlineKeyboardButton[][] {
  const open = taskButton(task);
  return open ? [[open]] : [];
}

export class NotificationService {
  // One DM per (task, user, event kind) within the window, so rapid edits don't spam
  // but an assignment DM never swallows a later "done" DM.
  private async shouldNotify(taskId: string, telegramUserId: number, kind: string): Promise<boolean> {
    const key = `notif:${kind}:${taskId}:${telegramUserId}`;
    try {
      const existing = await redisService.get(key);
      if (existing) return false;
      await redisService.set(key, '1', { EX: NOTIFICATION_WINDOW_SECONDS });
      return true;
    } catch (error) {
      logger.warn(`Notification rate-limit check failed for ${key}: ${error}`);
      return true;
    }
  }

  private async loadGroup(task: ITask) {
    try {
      return await Group.findById(task.groupId);
    } catch {
      return null;
    }
  }

  /** "🐞 Bug — Fix login on iOS" */
  private taskLine(task: ITask): string {
    return `${typeEmoji(task.type)} ${typeWord(task.type)} — ${escapeMarkdown(task.title)}`;
  }

  /** "🐞 Bug — Fix login on iOS", plus "↳ Subtask of #42 · Login" for a subtask. */
  private async taskLines(task: ITask): Promise<string[]> {
    const parent = parentLine(await resolveParentRef(task));
    return parent ? [this.taskLine(task), parent] : [this.taskLine(task)];
  }

  /** " in Team" (escaped), or "" when the group is unknown. */
  private inGroup(group: { groupName?: string } | null): string {
    return group?.groupName ? ` in ${escapeMarkdown(group.groupName)}` : '';
  }

  private async findCreator(task: ITask): Promise<IUser | null> {
    const populated = populatedUser(task.createdBy);
    if (populated) return populated;
    const id = refId(task.createdBy);
    if (!id) return null;
    try {
      return await User.findById(id);
    } catch {
      return null;
    }
  }

  /** Default keyboard: just "📱 Open #N" (or "💬 View card" when the app link isn't configured). */
  private async send(
    task: ITask,
    user: IUser,
    text: string,
    keyboard: InlineKeyboardButton[][] = openOnly(task),
  ): Promise<NotifyResult> {
    try {
      await bot.telegram.sendMessage(user.telegramUserId, text, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard.length ? { inline_keyboard: keyboard } : undefined,
      });
      return 'sent';
    } catch (error: unknown) {
      return this.classifyError(error, user.telegramUserId);
    }
  }

  private classifyError(error: unknown, telegramUserId: number): NotifyResult {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes('bot was blocked')) {
      logger.info(`Can't DM user ${telegramUserId} — bot blocked`);
      return 'blocked';
    }
    if (
      errMsg.includes("can't initiate conversation") ||
      errMsg.includes('chat not found') ||
      errMsg.includes('FORBIDDEN') ||
      errMsg.includes('Forbidden')
    ) {
      logger.info(`Can't DM user ${telegramUserId} — bot not started`);
      return 'not_started';
    }
    logger.error(`Notification error for user ${telegramUserId}: ${errMsg}`);
    return 'failed';
  }

  async notifyAssignment(task: ITask, assignee: IUser, assignedBy: IUser): Promise<NotifyResult> {
    if (assignee.telegramUserId === assignedBy.telegramUserId) return 'skipped';
    if (!(await this.shouldNotify(task._id.toString(), assignee.telegramUserId, 'assign'))) return 'skipped';

    const group = await this.loadGroup(task);
    const lines = [`👤 *You were assigned #${task.taskNumber}*`, ...(await this.taskLines(task))];
    const due = describeDue(task, groupTimezone(group));
    if (due) lines.push(`Due: ${due}`);
    lines.push(`By ${mdName(assignedBy)}${this.inGroup(group)}`);

    return this.send(task, assignee, lines.join('\n'), dmTaskKeyboard(task));
  }

  async notifyUnassigned(task: ITask, previousAssignee: IUser, changedBy: IUser): Promise<NotifyResult> {
    if (previousAssignee.telegramUserId === changedBy.telegramUserId) return 'skipped';
    if (!(await this.shouldNotify(task._id.toString(), previousAssignee.telegramUserId, 'unassign'))) return 'skipped';

    const group = await this.loadGroup(task);
    const lines = [
      `*You're no longer assigned #${task.taskNumber}*`,
      ...(await this.taskLines(task)),
      `Changed by ${mdName(changedBy)}${this.inGroup(group)}`,
    ];
    return this.send(task, previousAssignee, lines.join('\n'));
  }

  async notifyStatusChange(task: ITask, changedBy: IUser, assignee: IUser): Promise<NotifyResult> {
    if (assignee.telegramUserId === changedBy.telegramUserId) return 'skipped';
    if (!(await this.shouldNotify(task._id.toString(), assignee.telegramUserId, `status_${task.status}`))) {
      return 'skipped';
    }

    const group = await this.loadGroup(task);
    const headline = statusHeadline(task.status, task.taskNumber);
    const lines = [
      headline,
      ...(await this.taskLines(task)),
      `By ${mdName(changedBy)}${this.inGroup(group)}`,
      `You're the assignee.`,
    ];
    return this.send(task, assignee, lines.join('\n'));
  }

  /**
   * Every counted subtask of `parent` is done → nudge the parent's owner to close it:
   *   🧩 *All 3 subtasks of #42 are done*
   *   🐞 Bug — Fix login
   *   In Team · close #42 too?
   *   [✅ Done #42] [📱 Open #42]
   */
  async notifyAllSubtasksDone(parent: ITask, owner: IUser, total: number): Promise<NotifyResult> {
    const group = await this.loadGroup(parent);
    const what = total === 1 ? 'The only subtask' : `All ${total} subtasks`;
    const lines = [
      `🧩 *${what} of #${parent.taskNumber} ${total === 1 ? 'is' : 'are'} done*`,
      this.taskLine(parent),
      `${group?.groupName ? `In ${escapeMarkdown(group.groupName)} · ` : ''}close #${parent.taskNumber} too?`,
    ];
    const row: InlineKeyboardButton[] = [
      { text: `✅ Done #${parent.taskNumber}`, callback_data: `${DM_TASK_CALLBACK_PREFIX}${DM_CLOSE_ACTION}:${parent._id}` },
    ];
    const open = taskButton(parent);
    if (open) row.push(open);
    return this.send(parent, owner, lines.join('\n'), [row]);
  }

  async notifyDueReminder(task: ITask, targetUser: IUser, reason?: ReminderReason): Promise<NotifyResult> {
    const group = await this.loadGroup(task);
    const tz = groupTimezone(group);

    let headline = `⏰ *#${task.taskNumber} is due soon*`;
    if (task.dueDate) {
      const state = dueState(task.dueDate, tz);
      if (state === 'today') headline = `⏰ *#${task.taskNumber} is due today*`;
      else if (state === 'tomorrow') headline = `⏰ *#${task.taskNumber} is due tomorrow*`;
      else if (state === 'overdue') headline = `⏰ *#${task.taskNumber} is overdue*`;
    }

    const asAssignee =
      (reason ?? (refId(task.assigneeId) === targetUser._id.toString() ? 'assignee' : 'creator')) === 'assignee';

    const lines = [headline, ...(await this.taskLines(task))];
    const due = describeDue(task, tz);
    if (due) lines.push(`Due: ${due}`);

    if (asAssignee) {
      // Same "By @a in Team" line as the other DMs (the creator, here).
      const creator = await this.findCreator(task);
      if (creator && creator.telegramUserId !== targetUser.telegramUserId) {
        lines.push(`By ${mdName(creator)}${this.inGroup(group)}`);
      } else if (group) {
        lines.push(`In ${escapeMarkdown(group.groupName)}`);
      }
      lines.push("You're the assignee.");
      return this.send(task, targetUser, lines.join('\n'), dmTaskKeyboard(task));
    }

    // Creator of an unassigned task: let them act on it right away.
    const assign = assignButton(task);
    lines.push(
      `You created it${this.inGroup(group)} and nobody is assigned yet.` +
        (assign ? ` Tap “${assign.text}” to pick someone.` : ` ${assignHint(task)}`),
    );
    return this.send(task, targetUser, lines.join('\n'), assign ? [[assign]] : []);
  }
}

export const notificationService = new NotificationService();
