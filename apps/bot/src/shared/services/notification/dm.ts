import { bot } from 'src/bot';
import { resolveParentRef } from 'src/bot/subtasks/parent-ref';
import { parentLine } from 'src/bot/subtasks/subtask-lines';
import {
  escapeMarkdown,
  populatedUser,
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
import { InlineKeyboardButton } from 'telegraf/types';
import { openOnly } from './keyboards';

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
export function statusHeadline(status: string, taskNumber: number): string {
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

// One DM per (task, user, event kind) within the window, so rapid edits don't spam
// but an assignment DM never swallows a later "done" DM.
export async function shouldNotify(taskId: string, telegramUserId: number, kind: string): Promise<boolean> {
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

export async function loadGroup(task: ITask) {
  try {
    return await Group.findById(task.groupId);
  } catch {
    return null;
  }
}

/** "🐞 Bug — Fix login on iOS" */
export function taskLine(task: ITask): string {
  return `${typeEmoji(task.type)} ${typeWord(task.type)} — ${escapeMarkdown(task.title)}`;
}

/** "🐞 Bug — Fix login on iOS", plus "↳ Subtask of #42 · Login" for a subtask. */
export async function taskLines(task: ITask): Promise<string[]> {
  const parent = parentLine(await resolveParentRef(task));
  return parent ? [taskLine(task), parent] : [taskLine(task)];
}

/** " in Team" (escaped), or "" when the group is unknown. */
export function inGroup(group: { groupName?: string } | null): string {
  return group?.groupName ? ` in ${escapeMarkdown(group.groupName)}` : '';
}

export async function findCreator(task: ITask): Promise<IUser | null> {
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
export async function sendDm(
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
    return classifyDmError(error, user.telegramUserId);
  }
}

export function classifyDmError(error: unknown, telegramUserId: number): NotifyResult {
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
