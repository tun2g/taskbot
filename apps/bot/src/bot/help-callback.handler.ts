import { helpPageContext, HELP_TOPICS, renderHelpPage } from 'src/bot/commands/help';
import { BotContext } from 'src/bot/interface/context';
import logger from 'src/shared/logger/logger';

/** Handles `help:<topic>` taps: edits the /help message in place to that page (or home). */
export async function handleHelpCallback(ctx: BotContext) {
  const callbackQuery = ctx.callbackQuery;
  const data = callbackQuery && 'data' in callbackQuery ? callbackQuery.data : '';
  if (!data?.startsWith('help:')) return;

  const requested = data.slice('help:'.length);
  const topic = (HELP_TOPICS as readonly string[]).includes(requested) ? requested : 'home';

  try {
    const page = renderHelpPage(topic, await helpPageContext(ctx));
    await ctx.editMessageText(page.text, {
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: page.keyboard },
    });
  } catch (error) {
    if (!String(error).includes('message is not modified')) {
      logger.warn(`Help page "${topic}" failed: ${error}`);
    }
  }

  try {
    await ctx.answerCbQuery();
  } catch {
    // already answered or expired
  }
}
