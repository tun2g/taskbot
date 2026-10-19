import { BotContext } from 'src/bot/interface/context';
import { escapeMarkdown, truncate } from 'src/bot/task-card.renderer';
import { configService } from 'src/configs/configuration';
import { Group } from 'src/database/models/group.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import { isForumChat } from 'src/shared/services/group-messenger.service';
import { appLinkButton, webappBaseUrl } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

const MAX_GROUP_BUTTONS = 20;

export class StartCommand {
  private map: Map<string, (ctx: BotContext) => void>;

  constructor() {
    this.map = new Map<string, (ctx: BotContext) => void>();
  }

  register() {
    this.map.set('start', this.onStart.bind(this));
    return this.map;
  }

  async onStart(ctx: BotContext) {
    try {
      const user = await userService.findOrCreateUser(ctx);
      const name = escapeMarkdown(user?.firstName || user?.username || 'there');

      if (ctx.chat?.type !== 'private') {
        await this.startInGroup(ctx);
        return;
      }

      const groupIds = user ? await groupMemberService.getUserGroups(user._id) : [];
      const groups = groupIds.length ? await Group.find({ _id: { $in: groupIds } }).sort({ groupName: 1 }) : [];
      const base = webappBaseUrl();

      if (groups.length === 0) {
        const addUrl = configService.botUsername ? `https://t.me/${configService.botUsername}?startgroup=true` : null;
        const text = [
          "👋 *Let's get your team set up*",
          `Hi ${name}! I turn group chat messages into tasks, but you're not in a group with me yet.`,
          '',
          '1. Add me to your team group',
          '2. Send `/new Fix login on iOS` there',
          '3. Come back here with /start to open the board',
          '',
          "You'll also get a DM here when someone assigns you a task.",
        ].join('\n');
        await ctx.reply(text, {
          parse_mode: 'Markdown',
          ...(addUrl ? { reply_markup: { inline_keyboard: [[{ text: '➕ Add to group', url: addUrl }]] } } : {}),
        });
        return;
      }

      const rows: InlineKeyboardButton[][] = [];
      for (const group of groups.slice(0, MAX_GROUP_BUTTONS)) {
        const label = `📋 ${truncate(group.groupName, 30)}`;
        // web_app buttons are allowed in private chats and open the Mini App signed in.
        if (base) rows.push([{ text: label, web_app: { url: `${base}/${group._id}/tasks` } }]);
        else {
          const link = appLinkButton(label, group._id.toString());
          if (link) rows.push([link]);
        }
      }

      const text = [
        '📋 *Your task boards*',
        rows.length
          ? `Hi ${name}! Pick a group to open its board:`
          : `You're in ${groups.length} group(s) with me. Use /list inside a group to see its tasks.`,
        '',
        "I'll DM you here when someone assigns you a task or one of yours changes.",
      ].join('\n');

      await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
      });
    } catch (error) {
      logger.error(`Error in /start command: ${error}`);
      await ctx.reply('Something went wrong. Please try /start again.');
    }
  }

  private async startInGroup(ctx: BotContext) {
    const text = [
      "👋 *I'm ready.* Create tasks right here:",
      '• `/new Fix login on iOS @an`',
      '• Reply to a message with /new',
      '',
      ...(isForumChat(ctx)
        ? [
            'Task events (new tasks, status changes, the daily digest) go to a “Task events” topic — I create it if I\'m an admin with Manage topics, or an admin runs /settopic in the topic you want.',
            '',
          ]
        : []),
      'See /help for everything else.',
    ].join('\n');
    await ctx.reply(text, { parse_mode: 'Markdown' });
  }
}

export const startCommand = new StartCommand();
