import { BotContext } from 'src/bot/interface/context';
import { IGroup, Group } from 'src/database/models/group.model';
import logger from 'src/shared/logger/logger';
import { Telegram } from 'telegraf';
import { Message } from 'telegraf/types';
import { deliverEvent } from './delivery';
import { claimSetupHint, createEventsTopic, forgetEventsTopic, trackTopicInfo } from './topic-store';
import {
  CommandEventOptions,
  CommandEventResult,
  CREATE_RETRY_MS,
  errorText,
  isEventsTopicName,
  isForumChat,
  isTopicClosed,
  isTopicGone,
  SendEventOptions,
  TOPIC_SETUP_HINT,
  topicOf,
} from './topics';

/**
 * Sends bot "events" (task cards, status lines, digests…) to a group. In groups with
 * Topics, events go to one "Task events" topic instead of wherever the command was typed.
 */
export class GroupMessengerService {
  private creating = new Map<string, Promise<number | null>>();
  private createFailedAt = new Map<string, number>();

  /** Records forum state and topic names seen in an incoming message. Never throws. */
  async trackMessage(group: IGroup, message: Record<string, unknown>, isForum: boolean): Promise<void> {
    return trackTopicInfo(group, message, isForum);
  }

  async setEventsTopic(group: IGroup, threadId: number | null): Promise<void> {
    await Group.updateOne({ _id: group._id }, { $set: { eventsTopicId: threadId } });
    group.eventsTopicId = threadId;
    if (threadId) this.createFailedAt.delete(String(group._id));
  }

  /**
   * The topic events go to: the configured one, else a known topic named "task events"
   * (any case/emoji), else a newly created "Task events" topic. `undefined` = no topic
   * (normal group, or a forum where the bot can't create topics).
   */
  async resolveEventsThread(telegram: Telegram, group: IGroup): Promise<number | undefined> {
    if (!group.isForum) return undefined;
    if (group.eventsTopicId) return group.eventsTopicId;

    const known = (group.knownTopics ?? []).find((t) => isEventsTopicName(t.name));
    if (known) {
      await this.setEventsTopic(group, known.id);
      return known.id;
    }

    const key = String(group._id);
    const failedAt = this.createFailedAt.get(key);
    if (failedAt && Date.now() - failedAt < CREATE_RETRY_MS) return undefined;

    // One creation per group even if several events fire at once
    let pending = this.creating.get(key);
    if (!pending) {
      pending = createEventsTopic(telegram, group, this.createFailedAt).finally(() => this.creating.delete(key));
      this.creating.set(key, pending);
    }
    const created = await pending;
    if (created) group.eventsTopicId = created;
    return created ?? undefined;
  }

  /**
   * Posts an event. In forums it goes to the events topic, replying to `source` across
   * topics when possible, else with a link to it. `fallbackThreadId` (e.g. the topic the
   * command came from) is used when no events topic can be resolved; otherwise General.
   * Throws only when Telegram refuses the message itself.
   */
  async sendEvent(
    telegram: Telegram,
    group: IGroup,
    text: string,
    options: SendEventOptions = {},
  ): Promise<Message.TextMessage> {
    const eventsThread = await this.resolveEventsThread(telegram, group);
    const threadId = eventsThread ?? options.fallbackThreadId;
    try {
      return await deliverEvent(telegram, group, text, threadId, options);
    } catch (error) {
      const message = errorText(error);
      if (!threadId || !(isTopicGone(message) || isTopicClosed(message))) throw error;

      let retryThread: number | undefined;
      if (threadId === eventsThread && isTopicGone(message)) {
        // Deleted events topic: forget it and resolve again (may create a fresh one), once.
        await forgetEventsTopic(group, threadId);
        retryThread = (await this.resolveEventsThread(telegram, group)) ?? options.fallbackThreadId;
        if (retryThread === threadId) retryThread = undefined;
      } else {
        // Closed topic, or the fallback topic vanished: this one event goes to General.
        logger.warn(`[GroupMessenger] Topic ${threadId} unusable (${message}); posting in General`);
      }
      try {
        return await deliverEvent(telegram, group, text, retryThread, options);
      } catch (retryError) {
        if (retryThread === undefined || !(isTopicGone(errorText(retryError)) || isTopicClosed(errorText(retryError)))) {
          throw retryError;
        }
        return deliverEvent(telegram, group, text, undefined, options);
      }
    }
  }

  /**
   * An event caused by a command. Normal groups: a plain `ctx.reply`, exactly as before.
   * Forums: the event goes to the events topic (replying to `source`, default the command),
   * and the command gets a 👌 reaction when that's another topic. When no events topic can
   * be resolved it's posted in the command's topic, with a setup tip for admins once a week.
   */
  async sendCommandEvent(ctx: BotContext, group: IGroup, text: string, options: CommandEventOptions = {}) {
    const command = ctx.message;
    if (isForumChat(ctx) && !group.isForum) group.isForum = true;
    if (!group.isForum) {
      const message = await ctx.reply(text, options.extra);
      return { message, elsewhere: false } satisfies CommandEventResult;
    }

    const commandThread = topicOf(command as { is_topic_message?: boolean; message_thread_id?: number });
    const eventsThread = await this.resolveEventsThread(ctx.telegram, group);
    let body = text;
    if (eventsThread === undefined && (await this.claimSetupHint(group))) body += `\n\n${TOPIC_SETUP_HINT}`;

    const source = options.source ?? (command ? { messageId: command.message_id, threadId: commandThread } : undefined);
    const message = await this.sendEvent(ctx.telegram, group, body, {
      source,
      extra: options.extra,
      fallbackThreadId: commandThread,
    });

    const sentThread = message?.message_thread_id !== undefined ? topicOf(message) : (eventsThread ?? commandThread);
    const elsewhere = sentThread !== commandThread;
    if (elsewhere && command) await this.react(ctx.telegram, group.telegramGroupId, command.message_id);
    return { message, elsewhere } satisfies CommandEventResult;
  }

  /**
   * In a forum, the topic events go to (undefined = no events topic). Used by flows that
   * answer in place and only add a separate event line when it lands somewhere else.
   */
  async eventsTopicFor(ctx: BotContext, group: IGroup): Promise<number | undefined> {
    if (isForumChat(ctx) && !group.isForum) group.isForum = true;
    return this.resolveEventsThread(ctx.telegram, group);
  }

  /** True at most once per 7 days per group: time to show the "set up the events topic" tip. */
  async claimSetupHint(group: IGroup): Promise<boolean> {
    return claimSetupHint(group);
  }

  /** 👌 on the user's message (👍 if the group doesn't allow 👌). Never throws. */
  async react(telegram: Telegram, chatId: number, messageId: number): Promise<void> {
    for (const emoji of ['👌', '👍'] as const) {
      try {
        await telegram.setMessageReaction(chatId, messageId, [{ type: 'emoji', emoji }]);
        return;
      } catch (error) {
        logger.info(`[GroupMessenger] Reaction ${emoji} refused: ${errorText(error)}`);
      }
    }
  }
}

export const groupMessengerService = new GroupMessengerService();
