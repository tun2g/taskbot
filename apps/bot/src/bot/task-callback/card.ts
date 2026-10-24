import { BotContext } from 'src/bot/interface/context';
import { cardSubtaskProgress } from 'src/bot/subtasks/card-progress';
import { buildTaskButtons, formatTaskCard, groupTimezone, populatedUser, refId } from 'src/bot/task-card.renderer';
import { Group } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser, User } from 'src/database/models/user.model';
import logger from 'src/shared/logger/logger';
import { InlineKeyboardButton } from 'telegraf/types';

export async function showKeyboard(ctx: BotContext, rows: InlineKeyboardButton[][], toast?: string) {
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: rows });
  } catch (error) {
    logger.warn(`Failed to swap task keyboard: ${error}`);
  }
  await ctx.answerCbQuery(toast);
}

async function getTimezone(task: ITask): Promise<string> {
  try {
    return groupTimezone(await Group.findById(task.groupId));
  } catch {
    return groupTimezone(null);
  }
}

export async function findUser(ref: unknown): Promise<IUser | null> {
  const id = refId(ref);
  if (!id) return null;
  try {
    return await User.findById(id);
  } catch {
    return null;
  }
}

/** Re-render the card text (plus an optional legend) with the given keyboard, in place. */
export async function renderCard(ctx: BotContext, task: ITask, rows: InlineKeyboardButton[][], extraText?: string) {
  try {
    const creator = populatedUser(task.createdBy) ?? (await findUser(task.createdBy));
    const assignee = populatedUser(task.assigneeId) ?? (await findUser(task.assigneeId));
    const tz = await getTimezone(task);

    const card = formatTaskCard(task, creator, assignee, tz, await cardSubtaskProgress(task));
    await ctx.editMessageText(extraText ? `${card}\n\n${extraText}` : card, {
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: rows },
    });
  } catch (error) {
    // "message is not modified" is expected when nothing visible changed.
    if (!String(error).includes('message is not modified')) {
      logger.error(`Failed to update task card message: ${error}`);
    }
  }
}

export async function updateTaskCardMessage(ctx: BotContext, task: ITask) {
  await renderCard(ctx, task, await buildTaskButtons(task));
}
