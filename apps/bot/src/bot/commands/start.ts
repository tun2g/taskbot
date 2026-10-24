import { addToGroupButton } from 'src/bot/commands/private-chat-hint';
import { BotContext } from 'src/bot/interface/context';
import { escapeMarkdown, truncate } from 'src/bot/task-card.renderer';
import { Group } from 'src/database/models/group.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import { isForumChat } from 'src/shared/services/group-messenger.service';
import { adminLink, appLinkButton, boardButton, webappBaseUrl } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';
import { isGroupActive } from 'src/shared/utils/group-status';
import { GROUP_STATUS_LABELS, GroupStatus } from '@tbot/shared';
import { configService } from 'src/configs/configuration';
import { groupLifecycleService } from 'src/shared/services/group-lifecycle.service';
import type { IGroup } from 'src/database/models/group.model';

const MAX_GROUP_BUTTONS = 20;
/** Owner's /start re-sends at most this many approval cards (oldest first). */
export const MAX_PENDING_CARDS = 5;

/** "• Team Alpha — waiting for the bot owner's approval" for groups whose board can't open yet. */
function unavailableLine(group: IGroup): string {
  const why =
    group.status === GroupStatus.PENDING
      ? "waiting for the bot owner's approval"
      : group.status === GroupStatus.SUSPENDED
        ? 'paused by the bot owner'
        : GROUP_STATUS_LABELS[group.status].toLowerCase();
  return `• ${escapeMarkdown(truncate(group.groupName, 40))} — ${why}`;
}

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

      if (ctx.from && ctx.from.id === configService.botOwnerTelegramId) await this.sendPendingCards(ctx);

      const groupIds = user ? await groupMemberService.getUserGroups(user._id) : [];
      const allGroups = groupIds.length ? await Group.find({ _id: { $in: groupIds } }).sort({ groupName: 1 }) : [];
      // Boards only open for groups that get service (approved, not paused).
      const groups = allGroups.filter(isGroupActive);
      // Only groups the bot is still meant to be in; rejected / removed ones are history.
      const waiting = allGroups.filter((g) => g.status === GroupStatus.PENDING || g.status === GroupStatus.SUSPENDED);
      const waitingLines = waiting.length
        ? ['', "⏳ *Not ready yet* — you'll see a message in the group when it is:", ...waiting.slice(0, 10).map(unavailableLine)]
        : [];
      const base = webappBaseUrl();

      if (groups.length === 0 && waiting.length > 0) {
        await ctx.reply([`Hi ${name}! None of your groups can be used with me yet.`, ...waitingLines].join('\n'), {
          parse_mode: 'Markdown',
        });
        return;
      }

      if (groups.length === 0) {
        const add = addToGroupButton();
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
          ...(add ? { reply_markup: { inline_keyboard: [[add]] } } : {}),
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
        ...waitingLines,
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

  /** The bot owner's /start: groups still waiting for a decision get their Approve / Reject card again. */
  private async sendPendingCards(ctx: BotContext) {
    try {
      const pending = await Group.find({ status: GroupStatus.PENDING }).sort({ addedAt: 1 }).limit(MAX_PENDING_CARDS + 1);
      if (!pending.length) return;
      const count =
        pending.length > MAX_PENDING_CARDS
          ? `More than ${MAX_PENDING_CARDS} groups are waiting for your approval — the oldest ${MAX_PENDING_CARDS} are below, the rest are in the admin app.`
          : pending.length === 1
            ? '1 group is waiting for your approval:'
            : `${pending.length} groups are waiting for your approval:`;
      const all = pending.length > MAX_PENDING_CARDS ? adminLink(`/groups?status=${GroupStatus.PENDING}`) : null;
      await ctx.reply(`🆕 ${count}`, all ? { reply_markup: { inline_keyboard: [[{ text: '🛠 All waiting groups', url: all }]] } } : {});
      for (const group of pending.slice(0, MAX_PENDING_CARDS)) await groupLifecycleService.sendOwnerCard(ctx.telegram, group);
    } catch (error) {
      logger.warn(`/start: could not list pending groups for the owner: ${error}`);
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

    // url button (web_app buttons aren't allowed in groups); none when the app link isn't configured.
    const chatTitle = ctx.chat && 'title' in ctx.chat ? ctx.chat.title : 'Group';
    const group = ctx.chat ? await groupService.findOrCreateGroup(ctx.chat.id, chatTitle).catch(() => null) : null;
    const open = group ? boardButton(group._id.toString()) : null;

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      ...(open ? { reply_markup: { inline_keyboard: [[open]] } } : {}),
    });
  }
}

export const startCommand = new StartCommand();
