import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { buildTokenMessage } from 'src/bot/commands/mcp/deliver-token';
import { parsePick } from 'src/bot/commands/mcp/group-picker';
import { renderMcpHelpPage } from 'src/bot/commands/mcp/mcp-help-page';
import { MCP_HELP_CALLBACK } from 'src/bot/commands/mcp/setup-message';
import { BotContext } from 'src/bot/interface/context';
import { IGroup } from 'src/database/models/group.model';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';

export const MCP_CALLBACK_PREFIX = 'mcp:';

async function answer(ctx: BotContext, text?: string) {
  await Promise.resolve(ctx.answerCbQuery(text)).catch(() => undefined);
}

/**
 * `mcp:new:<groupId|all>` — the group picker: issues the token and turns the picker into the setup message.
 * `mcp:help` — "📖 How it works" under a setup message: sent as a NEW message so the token stays visible.
 */
export async function handleMcpCallback(ctx: BotContext): Promise<void> {
  const query = ctx.callbackQuery;
  const data = query && 'data' in query ? query.data : '';

  try {
    if (data === MCP_HELP_CALLBACK) {
      const page = renderMcpHelpPage(ctx.chat?.type === 'private');
      await ctx.reply(page.text, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        ...(page.keyboard.length ? { reply_markup: { inline_keyboard: page.keyboard } } : {}),
      });
      await answer(ctx);
      return;
    }

    const pick = parsePick(data ?? '');
    if (pick === undefined || ctx.chat?.type !== 'private') {
      await answer(ctx);
      return;
    }

    const user = await userService.findOrCreateUser(ctx);
    if (!user) {
      await answer(ctx, 'Something went wrong. Please try again.');
      return;
    }
    let group: IGroup | null = null;
    if (pick) {
      const access = await checkGroupAccess(pick, user);
      if (!access.ok) {
        await answer(ctx, "You're not a member of that group anymore.");
        return;
      }
      group = access.group;
    }

    const message = await buildTokenMessage(user, group);
    await ctx.editMessageText(message.text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(message.keyboard.length ? { reply_markup: { inline_keyboard: message.keyboard } } : {}),
    });
    await answer(ctx, message.tokenId ? '🔑 Token created' : undefined);
  } catch (error) {
    logger.error(`MCP callback failed: ${error}`);
    await answer(ctx, 'Something went wrong. Please try again.');
  }
}
