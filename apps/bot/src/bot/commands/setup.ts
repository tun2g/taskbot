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
      {
        command: 'start',
        description: 'Open your task boards',
      },
      {
        command: 'help',
        description: 'What I can do',
      },
      {
        command: 'task',
        description: 'Create tasks: /task text, reply /task, /task all, /task 10',
      },
      {
        command: 'ai',
        description: "Ask in plain words: /ai assign this to @an, /ai #12 done, /ai what's on my plate?",
      },
      {
        command: 'tasks',
        description: 'Open tasks: /tasks mine, bug, done, @name',
      },
      {
        command: 'done',
        description: 'Finish a task: /done 12 or reply to its card',
      },
      {
        command: 'settopic',
        description: 'Admins: post task events in this topic',
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
