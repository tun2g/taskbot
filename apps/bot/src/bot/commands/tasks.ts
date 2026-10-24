import { parseListFilters } from 'src/bot/commands/list/filters';
import { buildListLines, fetchListedTasks, groupTotals } from 'src/bot/commands/list/lines';
import { replyGroupOnly } from 'src/bot/commands/private-chat-hint';
import { createFromReplyButton } from 'src/bot/create-from-reply';
import { BotContext } from 'src/bot/interface/context';
import { groupService } from 'src/database/services/group.service';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import { boardButton } from 'src/shared/utils/app-links';

export class TasksCommand {
  private map: Map<string, (ctx: BotContext) => void>;

  constructor() {
    this.map = new Map<string, (ctx: BotContext) => void>();
  }

  register() {
    this.map.set('list', this.onTasks.bind(this));
    this.map.set('mytasks', this.onTasks.bind(this));
    // Old name keeps working (hidden from the menu)
    this.map.set('tasks', this.onTasks.bind(this));
    return this.map;
  }

  async onTasks(ctx: BotContext) {
    try {
      const chatId = ctx.chat?.id;
      const chatType = ctx.chat?.type;

      if (!chatId || (chatType !== 'group' && chatType !== 'supergroup')) {
        const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
        await replyGroupOnly(ctx, /^\/mytasks/i.test(text) ? 'mytasks' : 'list');
        return;
      }

      const user = await userService.findOrCreateUser(ctx);
      if (!user) return;

      const chatTitle = 'title' in ctx.chat! ? (ctx.chat as { title: string }).title : 'Group';
      const group = await groupService.findOrCreateGroup(chatId, chatTitle);
      if (!group) {
        await ctx.reply('❌ Could not find this group.');
        return;
      }

      const message = ctx.message;
      if (!message) return;
      const tokens = this.listTokens('text' in message ? message.text || '' : '');

      // ── Parse filters ──
      const filters = await parseListFilters(ctx, tokens, user, group);
      if (!filters) return;

      const totals = await groupTotals(group._id);
      const total = totals.todo + totals.inProgress + totals.done;

      // Replying to a message with a list command usually means "create from this"
      const createButton = await createFromReplyButton(ctx);
      const board = boardButton(group._id.toString());
      const keyboard = [createButton ? [createButton] : [], board ? [board] : []].filter((row) => row.length > 0);
      const replyMarkup = keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {};

      if (total === 0) {
        await ctx.reply(
          createButton
            ? '📋 No tasks in this group yet.\n\nDid you mean <code>/new</code>? Tap below to turn that message into tasks.'
            : '📋 No tasks in this group yet.\n\nCreate one with <code>/new Fix login on iOS</code> — or reply to a message with /new.',
          { parse_mode: 'HTML', ...replyMarkup },
        );
        return;
      }

      const { tasks, matchCount } = await fetchListedTasks(group._id, filters);
      const lines = await buildListLines({
        chatTitle,
        groupId: group._id,
        totals,
        filters,
        isFiltered: tokens.length > 0,
        tasks,
        matchCount,
        hasBoard: !!board,
      });

      await ctx.reply(lines.join('\n'), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...replyMarkup,
      });
    } catch (error) {
      logger.error(`Error in /list command: ${error}`);
      await ctx.reply('❌ Failed to load tasks. Please try again.');
    }
  }

  /** The filter words after /list; /mytasks is /list mine. */
  private listTokens(messageText: string): string[] {
    const isMyTasks = /^\/mytasks(@\w+)?(\s|$)/i.test(messageText);
    const args = messageText
      .replace(/^\/(list|mytasks|tasks)(@\w+)?\s*/i, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return isMyTasks ? ['mine', ...args] : args;
  }
}

export const tasksCommand = new TasksCommand();
