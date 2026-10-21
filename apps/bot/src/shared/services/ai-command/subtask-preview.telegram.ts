import { groupTimezone, todayIn } from 'src/bot/task-card.renderer';
import type { BotContext } from 'src/bot/interface/context';
import { groupService } from 'src/database/services/group.service';
import logger from 'src/shared/logger/logger';
import { decidePreview, SUBTASK_PREVIEW_PREFIX } from 'src/shared/services/ai-command/subtask-preview';
import { telegramSubtasksButtons, telegramSubtasksText } from 'src/shared/services/ai-command/subtasks.render';

// `subprev:add:<id>` / `subprev:cancel:<id>` — the ✅ Add all / ✖ Cancel buttons under an AI-proposed
// breakdown. The preview message is edited in place into the result (with ↩️ Undo), or into "Cancelled".

const EXPIRED_ALERT = '⏱ These suggestions expired. Ask /ai again to get new ones.';

/** True when `data` belongs to this handler (for the bot's callback router). */
export const isSubtaskPreviewCallback = (data: string | undefined): boolean =>
  !!data?.startsWith(`${SUBTASK_PREVIEW_PREFIX}:`);

export async function handleSubtaskPreviewCallback(ctx: BotContext): Promise<void> {
  const query = ctx.callbackQuery;
  if (!query || !('data' in query)) return;
  const [, action, id] = query.data.split(':');
  if ((action !== 'add' && action !== 'cancel') || !id) {
    await ctx.answerCbQuery('This button is no longer active.').catch(() => undefined);
    return;
  }

  try {
    const result = await decidePreview(id, action, { telegramUserId: query.from.id }, 'telegram');
    switch (result.status) {
      case 'expired':
        await ctx.answerCbQuery(EXPIRED_ALERT, { show_alert: true });
        await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
        return;
      case 'forbidden':
        await ctx.answerCbQuery(`Only ${result.requesterName} can add or cancel these.`, { show_alert: true });
        return;
      case 'busy':
        await ctx.answerCbQuery('Already on it…');
        return;
      case 'cancelled':
        await ctx.editMessageText(`✖ Cancelled — no subtasks were added to #${result.parentNumber}.`, {
          link_preview_options: { is_disabled: true },
        });
        await ctx.answerCbQuery('Cancelled');
        return;
      case 'added': {
        const { outcome } = result;
        const group = await groupService.findGroupById(outcome.parent.groupId);
        const today = todayIn(groupTimezone(group));
        const buttons = telegramSubtasksButtons(outcome);
        await ctx.editMessageText(telegramSubtasksText(outcome, today, outcome.parent.groupId), {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
        });
        const n = outcome.created.length;
        await ctx.answerCbQuery(n ? `Added ${n} subtask${n === 1 ? '' : 's'}` : 'Nothing was added');
        return;
      }
    }
  } catch (error) {
    logger.error(`Subtask preview callback error: ${error}`);
    await ctx.answerCbQuery('Something went wrong. Please try again.').catch(() => undefined);
  }
}
