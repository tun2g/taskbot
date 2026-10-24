import { configService } from 'src/configs/configuration';
import logger from 'src/shared/logger/logger';
import { telegramApiService } from 'src/shared/services/telegram-api.service';
import type { BotCommandScope } from 'telegraf/types';

const COMMAND_SCOPES: (BotCommandScope | undefined)[] = [
  undefined,
  { type: 'all_private_chats' },
  { type: 'all_group_chats' },
  { type: 'all_chat_administrators' },
];

interface BotCommand {
  command: string;
  description: string;
}

export class SetUpBotCommand {
  private commands: BotCommand[] = [];

  constructor() {
    this.commands = [
      // Menu order = how often people need them. /task and /tasks still work but are hidden:
      // they differed by one letter and were easy to mix up.
      {
        command: 'new',
        description: 'New task: /new text, or reply /new to a message',
      },
      {
        command: 'list',
        description: 'List tasks: /list bug, done, @name',
      },
      {
        command: 'mytasks',
        description: 'Tasks assigned to me',
      },
      {
        command: 'update',
        description: 'Change a task in plain words: reply /update to its card, or /update #12 …',
      },
      {
        command: 'ai',
        description: "Ask in plain words: /ai assign this to @an, /ai #12 done",
      },
      {
        command: 'done',
        description: 'Finish a task: /done 12 or reply to its card',
      },
      {
        command: 'sub',
        description: 'Add subtasks: /sub 12 Write tests @an, or reply /sub to a card',
      },
      {
        command: 'members',
        description: 'Who I can assign tasks to — tap ✋ to join',
      },
      {
        command: 'mcp',
        description: 'Connect Claude Code / Cursor to your tasks',
      },
      {
        command: 'settopic',
        description: 'Admins: post task events in this topic',
      },
      {
        command: 'help',
        description: 'What I can do',
      },
      {
        command: 'start',
        description: 'Open your task boards',
      },
    ];
  }

  /**
   * The same list on every broad scope. Telegram shows a chat the narrowest scope that has commands
   * (chat > all_chat_administrators > all_group_chats > all_private_chats > default), so a list left on a
   * narrower scope (e.g. by BotFather or an older deploy) would hide the default one: an approved group's
   * "/" menu came up empty. Writing each scope on startup keeps them all current.
   */
  async process() {
    for (const scope of COMMAND_SCOPES) {
      await telegramApiService.setMyCommands(this.commands, scope);
    }
    await this.setupMenuButton();
  }

  // Telegram only accepts an HTTPS URL for a web_app menu button, and the button
  // is configured as the default for all private chats (per-group web_app menu
  // buttons aren't supported by the Bot API).
  private async setupMenuButton() {
    const url = configService.webappUrl;
    if (!url || !url.startsWith('https://')) {
      logger.info('Skipping menu button setup — WEBAPP_URL is missing or not HTTPS');
      return;
    }

    await telegramApiService.setChatMenuButton('Task Board', url);
  }
}

export const setUpBotCommand = new SetUpBotCommand();
