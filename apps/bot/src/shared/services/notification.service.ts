import { bot } from 'src/bot';
import {
  describeDue,
  dueState,
  escapeMarkdown,
  groupTimezone,
  mdName,
  refId,
  statusLabel,
  statusWord,
  typeEmoji,
  typeWord,
} from 'src/bot/task-card.renderer';
import { Group } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';
import { appLinkButton } from 'src/shared/utils/app-links';

const NOTIFICATION_WINDOW_SECONDS = 300;

/**
 * Outcome of a DM attempt. Callers may ignore it.
 * - `not_started`: the user never opened a private chat with the bot (Telegram refuses the DM).
 * - `blocked`: the user blocked the bot.
 * - `skipped`: self-action or throttled.
 */
export type NotifyResult = 'sent' | 'skipped' | 'not_started' | 'blocked' | 'failed';

export type ReminderReason = 'assignee' | 'creator';

function statusHeadline(status: string, taskNumber: number): string {
  const emoji = statusLabel(status).split(' ')[0];
  switch (status) {
    case 'done':
      return `${emoji} *#${taskNumber} is done*`;
    case 'cancelled':
      return `${emoji} *#${taskNumber} was cancelled*`;
    case 'pending':
      return `${emoji} *#${taskNumber} is on hold*`;
    default:
      return `${emoji} *#${taskNumber} is now ${statusWord(status).toLowerCase()}*`;
  }
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

  private async send(task: ITask, user: IUser, text: string, buttonText = '📱 Open task'): Promise<NotifyResult> {
    try {
      const button = appLinkButton(buttonText, task.groupId, task._id.toString());
      await bot.telegram.sendMessage(user.telegramUserId, text, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        reply_markup: button ? { inline_keyboard: [[button]] } : undefined,
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
    const lines = [`👤 *You were assigned #${task.taskNumber}*`, this.taskLine(task)];
    const due = describeDue(task, groupTimezone(group));
    if (due) lines.push(`Due: ${due}`);
    lines.push(`By ${mdName(assignedBy)}${group ? ` in ${escapeMarkdown(group.groupName)}` : ''}`);

    return this.send(task, assignee, lines.join('\n'));
  }

  async notifyUnassigned(task: ITask, previousAssignee: IUser, changedBy: IUser): Promise<NotifyResult> {
    if (previousAssignee.telegramUserId === changedBy.telegramUserId) return 'skipped';
    if (!(await this.shouldNotify(task._id.toString(), previousAssignee.telegramUserId, 'unassign'))) return 'skipped';

    const group = await this.loadGroup(task);
    const lines = [
      `*You're no longer assigned #${task.taskNumber}*`,
      this.taskLine(task),
      `Changed by ${mdName(changedBy)}${group ? ` in ${escapeMarkdown(group.groupName)}` : ''}`,
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
      this.taskLine(task),
      `By ${mdName(changedBy)}${group ? ` in ${escapeMarkdown(group.groupName)}` : ''}`,
      `You're the assignee.`,
    ];
    return this.send(task, assignee, lines.join('\n'));
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

    const why =
      (reason ?? (refId(task.assigneeId) === targetUser._id.toString() ? 'assignee' : 'creator')) === 'assignee'
        ? "You're the assignee."
        : 'You created this task and nobody is assigned yet.';

    const lines = [headline, this.taskLine(task)];
    const due = describeDue(task, tz);
    if (due) lines.push(`Due: ${due}`);
    if (group) lines.push(`Group: ${escapeMarkdown(group.groupName)}`);
    lines.push(why);

    return this.send(task, targetUser, lines.join('\n'));
  }
}

export const notificationService = new NotificationService();
