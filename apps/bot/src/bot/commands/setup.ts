import { configService } from 'src/configs/configuration';
import logger from 'src/shared/logger/logger';
import { telegramApiService } from 'src/shared/services/telegram-api.service';

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
        command: 'members',
        description: 'Who I can assign tasks to — tap ✋ to join',
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

  async process() {
    await telegramApiService.setMyCommands(this.commands);
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
