import { BotContext } from 'src/bot/interface/context';
import { groupService } from 'src/database/services/group.service';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import {
  BufferedMessage,
  messageBufferService,
  messageText,
  toBufferedMessage,
  TopicScope,
} from 'src/shared/services/message-buffer.service';
import { isForumChat, topicOf } from 'src/shared/services/group-messenger.service';
import { createTasksFromInput } from 'src/shared/services/task-creation.service';
import { Message } from 'telegraf/types';

export const MAX_RECENT_MESSAGES = 50;

export const USAGE_MESSAGE =
  '<b>📋 Turn chat into tasks</b>\n' +
  '<code>/new Fix login on iOS @an</code> — from your text\n' +
  'Reply <code>/new</code> — from that message\n' +
  'Reply <code>/new all</code> — from there to now\n' +
  '<code>/new 10</code> — from the last 10 messages';

export const PRIVACY_MODE_MESSAGE =
  "🙈 I can't see recent messages here. The bot owner needs to turn off privacy mode: " +
  '@BotFather → /setprivacy → Disable, then re-add me to the group. ' +
  'Until then, reply to a message with /new.';

type Mode =
  | { kind: 'text'; text: string }
  | { kind: 'reply'; note?: string }
  | { kind: 'all' }
  | { kind: 'recent'; count: number };

type CommandMessage = Message.TextMessage | Message.CaptionableMessage;
type TopicMessage = { is_topic_message?: boolean; message_thread_id?: number };

export class TaskCommand {
  private map: Map<string, (ctx: BotContext) => void>;

  constructor() {
    this.map = new Map<string, (ctx: BotContext) => void>();
  }

  register() {
    this.map.set('new', this.onTask.bind(this));
    // Old names keep working (hidden from the menu): /task was too close to /tasks
    this.map.set('create', this.onTask.bind(this));
    this.map.set('task', this.onTask.bind(this));
    return this.map;
  }

  async onTask(ctx: BotContext) {
    try {
      const chat = ctx.chat;
      if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
        await ctx.reply('📋 /new works in group chats. Add me to your team group and use it there.');
        return;
      }

      const message = ctx.message as CommandMessage | undefined;
      if (!message) return;

      const mode = this.parseMode(message);
      if (!mode) {
        await ctx.reply(USAGE_MESSAGE, { parse_mode: 'HTML' });
        return;
      }

      const user = await userService.findOrCreateUser(ctx);
      if (!user) {
        await ctx.reply("❌ I couldn't identify you. Please try again in a moment.");
        return;
      }
      const chatTitle = 'title' in chat ? chat.title : 'Group';
      const group = await groupService.findOrCreateGroup(chat.id, chatTitle);
      if (!group) {
        await ctx.reply("❌ I couldn't set up this group. Please try again in a moment.");
        return;
      }

      const collected = await this.collectMessages(ctx, message, mode);
      if ('error' in collected) {
        await ctx.reply(collected.error, collected.html ? { parse_mode: 'HTML' } : {});
        return;
      }
      const { messages, note, warnings } = collected;

      await createTasksFromInput(ctx, {
        messages,
        note,
        warnings,
        requester: user,
        group,
        multiMessage: mode.kind === 'all' || mode.kind === 'recent',
      });
    } catch (error) {
      logger.error(`Error in /task command: ${error instanceof Error ? error.stack : error}`);
      await ctx
        .reply('❌ Something went wrong and no task was created. Please try /new again in a moment.')
        .catch(() => undefined);
    }
  }

  parseMode(message: CommandMessage): Mode | null {
    const raw = messageText(message);
    const args = raw.replace(/^\/(new|create|task)(@\w+)?/i, '').trim();
    const reply = this.getReplyTarget(message);

    if (reply) {
      if (args.toLowerCase() === 'all') return { kind: 'all' };
      return { kind: 'reply', note: args || undefined };
    }
    if (/^\d+$/.test(args)) {
      const count = Math.min(Math.max(parseInt(args, 10), 1), MAX_RECENT_MESSAGES);
      return { kind: 'recent', count };
    }
    if (!args || args.toLowerCase() === 'all') return null;
    return { kind: 'text', text: args };
  }

  /** The replied-to message, ignoring the implicit reply to a forum topic's first message. */
  private getReplyTarget(message: CommandMessage): Message | null {
    const reply = 'reply_to_message' in message ? message.reply_to_message : undefined;
    if (!reply || 'forum_topic_created' in reply) return null;
    return reply as Message;
  }

  private async collectMessages(
    ctx: BotContext,
    message: CommandMessage,
    mode: Mode,
  ): Promise<{ messages: BufferedMessage[]; note?: string; warnings: string[] } | { error: string; html?: boolean }> {
    const chatId = ctx.chat!.id;
    const warnings: string[] = [];
    const privacyOn = ctx.botInfo?.can_read_all_group_messages === false;
    // In a forum, "the last N messages" means this topic's messages, not the whole group's.
    const topicArgs: [TopicScope] | [] = isForumChat(ctx) ? [{ threadId: topicOf(message as TopicMessage) }] : [];

    switch (mode.kind) {
      case 'text':
        return { messages: [toBufferedMessage(message, chatId, mode.text)], warnings };

      case 'reply': {
        const reply = this.getReplyTarget(message)!;
        const text = messageText(reply);
        if (!text && !mode.note) {
          return {
            error:
              "That message has no text I can turn into a task. Reply to a text message, or add a title: <code>/new Fix the printer</code>",
            html: true,
          };
        }
        // Text-less message (e.g. a photo) + note: the note is the content, the message stays the source.
        const buffered = toBufferedMessage(reply, chatId, text || mode.note);
        return { messages: [buffered], note: text ? mode.note : undefined, warnings };
      }

      case 'all': {
        const reply = this.getReplyTarget(message)!;
        const first = toBufferedMessage(reply, chatId);
        const after = await messageBufferService.getAfter(chatId, reply.message_id, ...topicArgs);
        let messages = [first, ...after].filter((m) => m.text);
        if (messages.length === 0) {
          return { error: 'That message has no text I can turn into a task. Reply to a text message with /new all.' };
        }
        if (messages.length > MAX_RECENT_MESSAGES) {
          messages = messages.slice(0, MAX_RECENT_MESSAGES);
          warnings.push(`ℹ️ Read the first ${MAX_RECENT_MESSAGES} messages from there.`);
        }
        if (after.length === 0 && privacyOn) {
          warnings.push(
            'ℹ️ I could only read the message you replied to — privacy mode is on (@BotFather → /setprivacy → Disable).',
          );
        }
        return { messages, warnings };
      }

      case 'recent': {
        const messages = await messageBufferService.getRecent(chatId, mode.count, ...topicArgs);
        if (messages.length === 0) {
          return {
            error: privacyOn
              ? PRIVACY_MODE_MESSAGE
              : "🤷 I haven't seen any messages here in the last 48 hours. Reply to a message with /new instead.",
          };
        }
        return { messages, warnings };
      }
    }
  }
}

export const taskCommand = new TaskCommand();
