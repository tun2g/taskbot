import { BotContext } from 'src/bot/interface/context';
import { groupService } from 'src/database/services/group.service';
import logger from 'src/shared/logger/logger';
import { groupMessengerService, topicOf } from 'src/shared/services/group-messenger.service';

/** `/settopic` — run inside a forum topic to make it the "task events" topic. Admins only. */
export class SetTopicCommand {
  private map: Map<string, (ctx: BotContext) => void>;

  constructor() {
    this.map = new Map<string, (ctx: BotContext) => void>();
  }

  register() {
    this.map.set('settopic', this.onSetTopic.bind(this));
    return this.map;
  }

  async onSetTopic(ctx: BotContext) {
    try {
      const chat = ctx.chat;
      const message = ctx.message as
        | { message_id: number; message_thread_id?: number; is_topic_message?: boolean; sender_chat?: { id: number } }
        | undefined;
      if (!chat || !message || ctx.chat?.type === 'private') {
        await ctx.reply('ℹ️ Use /settopic inside a group topic.');
        return;
      }

      const isForum = chat.type === 'supergroup' && Boolean((chat as { is_forum?: boolean }).is_forum);
      if (!isForum) {
        await ctx.reply('ℹ️ This group has no Topics, so task events are posted right in the chat.');
        return;
      }

      const threadId = topicOf(message);
      if (!threadId) {
        await ctx.reply('👉 Open the topic where task events should go and send /settopic there.');
        return;
      }

      if (!(await this.isAdmin(ctx, chat.id, message))) {
        await ctx.reply('🔒 Only group admins can choose the task events topic.', {
          reply_parameters: { message_id: message.message_id },
        });
        return;
      }

      const group = await groupService.findOrCreateGroup(chat.id, chat.title);
      if (!group) {
        await ctx.reply('❌ Could not save this setting. Please try again.');
        return;
      }

      await groupMessengerService.trackMessage(group, message as Record<string, unknown>, true);
      await groupMessengerService.setEventsTopic(group, threadId);
      await ctx.reply('✅ Task events will be posted in this topic: new tasks, status changes, the daily digest.', {
        message_thread_id: threadId,
      });
    } catch (error) {
      logger.error(`Error in /settopic: ${error}`);
      await ctx.reply('❌ Could not set the topic. Please try again.').catch(() => undefined);
    }
  }

  /** Admins (incl. anonymous admins, who post as the group itself). */
  private async isAdmin(ctx: BotContext, chatId: number, message: { sender_chat?: { id: number } }): Promise<boolean> {
    if (message.sender_chat?.id === chatId) return true;
    if (!ctx.from) return false;
    const member = await ctx.telegram.getChatMember(chatId, ctx.from.id);
    return member.status === 'creator' || member.status === 'administrator';
  }
}

export const setTopicCommand = new SetTopicCommand();
