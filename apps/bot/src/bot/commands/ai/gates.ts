import { BotContext } from 'src/bot/interface/context';
import { sendAiReply } from 'src/bot/commands/ai/reply';
import { sendUnavailable, UnavailableInput } from 'src/bot/commands/ai/unavailable';
import { checkUserAiRateLimit } from 'src/shared/services/ai-command.service';
import { escapeHtml } from 'src/shared/services/ai-command/format';
import { AI_STILL_WORKS } from 'src/shared/services/ai-command/telegram.renderer';
import { aiService } from 'src/shared/services/ai/ai.service';
import { aiDisabledBy, aiDisabledText, aiGroupLimitText, aiUserLimitText } from 'src/shared/services/ai-quota';
import { checkGroupAiRateLimit } from 'src/shared/services/task-creation.service';

/**
 * Everything that must hold before an AI call: AI configured (checked first — no AI, no AI cost), not
 * switched off by the owner, and the per-user / per-group limits. Replies and returns false when blocked.
 */
export async function passAiGates(
  ctx: BotContext,
  chatId: number,
  mode: 'ai' | 'update',
  input: UnavailableInput,
): Promise<boolean> {
  const { user, group } = input;
  if (!aiService.isConfigured()) {
    await sendUnavailable(ctx, mode, input);
    return false;
  }

  // The bot owner turned AI off for this group / person: like "AI unavailable", with the reason.
  const disabledBy = aiDisabledBy(group, user);
  if (disabledBy) {
    await sendUnavailable(ctx, mode, input, undefined, `🚫 ${escapeHtml(aiDisabledText(disabledBy, group, user))} ${AI_STILL_WORKS}`);
    return false;
  }

  const userLimit = await checkUserAiRateLimit(user.telegramUserId, chatId, user);
  if (!userLimit.allowed) {
    await sendAiReply(ctx, {
      text: `⏳ ${aiUserLimitText(userLimit, group)} ${AI_STILL_WORKS}`,
    });
    return false;
  }
  const groupLimit = await checkGroupAiRateLimit(chatId, group);
  if (!groupLimit.allowed) {
    await sendAiReply(ctx, {
      text: `⏳ ${aiGroupLimitText(group, groupLimit)} ${AI_STILL_WORKS}`,
    });
    return false;
  }
  return true;
}
