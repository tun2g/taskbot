import { BotContext } from 'src/bot/interface/context';
import {
  aiPage,
  BACK,
  boardPage,
  createPage,
  HelpPage,
  HelpPageContext,
  homePage,
  managePage,
  remindersPage,
  setupPage,
} from 'src/bot/commands/help/pages';
import { groupService } from 'src/database/services/group.service';
import logger from 'src/shared/logger/logger';
import { renderMcpHelpPage } from 'src/bot/commands/mcp/mcp-help-page';

export { HELP_TOPICS } from 'src/bot/commands/help/pages';
export type { HelpPage, HelpPageContext, HelpTopic } from 'src/bot/commands/help/pages';

export function renderHelpPage(topic: string, ctx: HelpPageContext = {}): HelpPage {
  switch (topic) {
    case 'mcp':
      return renderMcpHelpPage(ctx.chatType === 'private', BACK);
    case 'create':
      return createPage();
    case 'ai':
      return aiPage();
    case 'manage':
      return managePage();
    case 'board':
      return boardPage(ctx);
    case 'reminders':
      return remindersPage();
    case 'setup':
      return setupPage();
    default:
      return homePage();
  }
}

/** Page context for the current chat (group id for the board link). */
export async function helpPageContext(ctx: BotContext): Promise<HelpPageContext> {
  const chatType = ctx.chat?.type;
  if ((chatType === 'group' || chatType === 'supergroup') && ctx.chat?.id) {
    try {
      const group = await groupService.findGroupByTelegramId(ctx.chat.id);
      return { chatType, groupId: group ? group._id.toString() : null };
    } catch (error) {
      logger.warn(`Help: could not load group: ${error}`);
    }
  }
  return { chatType };
}

export class HelpCommand {
  private map: Map<string, (ctx: BotContext) => void>;

  constructor() {
    this.map = new Map<string, (ctx: BotContext) => void>();
  }

  register() {
    this.map.set('help', this.onHelp.bind(this));
    return this.map;
  }

  async onHelp(ctx: BotContext) {
    const page = renderHelpPage('home');
    await ctx.reply(page.text, {
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: page.keyboard },
    });
  }
}

export const helpCommand = new HelpCommand();
