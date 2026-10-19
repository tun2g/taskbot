import { BotContext } from 'src/bot/interface/context';
import { IGroup, Group } from 'src/database/models/group.model';
import logger from 'src/shared/logger/logger';
import { Telegram } from 'telegraf';
import { Message } from 'telegraf/types';

export const EVENTS_TOPIC_NAME = 'Task events';
// One of Telegram's six preset topic colors (light blue); createForumTopic rejects any other value.
const EVENTS_TOPIC_ICON_COLOR = 0x6fb9f0;
/** After a failed createForumTopic (usually: no "Manage topics" right), don't retry for a while. */
const CREATE_RETRY_MS = 10 * 60 * 1000;
const SETUP_HINT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export const TOPIC_SETUP_HINT =
  'ℹ️ Tip for admins: make me an admin with “Manage topics”, or run /settopic in the topic where task events should go.';

type SendExtra = NonNullable<Parameters<Telegram['sendMessage']>[2]>;

export interface EventSource {
  /** The message the event is about (e.g. the message a task was created from). */
  messageId: number;
  /** Its forum topic (undefined = General / no topics). Used to tell same-topic from cross-topic replies and for the link. */
  threadId?: number;
  /** Add an "Original message" link when the cross-topic reply is refused (default true). */
  linkFallback?: boolean;
}

export interface SendEventOptions {
  /** Reply to this message, even if it sits in another topic; falls back to a link if Telegram refuses. */
  source?: EventSource;
  extra?: SendExtra;
  /** Topic to use when no events topic can be resolved (e.g. the topic a command came from). Default: General. */
  fallbackThreadId?: number;
}

export interface CommandEventOptions {
  /** Defaults to the command message itself. */
  source?: EventSource;
  extra?: SendExtra;
}

export interface CommandEventResult {
  message: Message.TextMessage;
  /** True when the event went to another topic (the command got a 👌 reaction instead). */
  elsewhere: boolean;
}

/** "📋 Task-Events " → "task events" — topic names match case- and emoji-insensitively. */
export function normalizeTopicName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const EVENTS_TOPIC_KEY = normalizeTopicName(EVENTS_TOPIC_NAME);

export function isEventsTopicName(name: string): boolean {
  return normalizeTopicName(name) === EVENTS_TOPIC_KEY;
}

/** Public link to a message; topic-aware so it opens inside the right topic. Supergroups only (else null). */
export function buildMessageLink(chatId: number, messageId: number, threadId?: number): string | null {
  const id = String(chatId);
  if (!id.startsWith('-100')) return null;
  const channel = id.slice(4);
  return threadId ? `https://t.me/c/${channel}/${threadId}/${messageId}` : `https://t.me/c/${channel}/${messageId}`;
}

/** The forum topic a message belongs to (undefined for General, normal groups and reply threads). */
export function topicOf(message: { is_topic_message?: boolean; message_thread_id?: number } | undefined | null) {
  return message?.is_topic_message ? message.message_thread_id : undefined;
}

export function isForumChat(ctx: BotContext): boolean {
  return ctx.chat?.type === 'supergroup' && Boolean((ctx.chat as { is_forum?: boolean }).is_forum);
}

function sourceLinkLine(link: string, parseMode: SendExtra['parse_mode']): string {
  if (parseMode === 'HTML') return `\n\n💬 <a href="${link}">Original message</a>`;
  if (parseMode === 'Markdown' || parseMode === 'MarkdownV2') return `\n\n💬 [Original message](${link})`;
  return `\n\n💬 Original message: ${link}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The target topic is gone ("message thread not found") or was deleted. */
function isTopicGone(message: string): boolean {
  return /message thread not found|TOPIC_DELETED/i.test(message);
}

/** The target topic is closed and the bot may not post there. */
function isTopicClosed(message: string): boolean {
  return /TOPIC_CLOSED/i.test(message);
}

/**
 * Sends bot "events" (task cards, status lines, digests…) to a group. In groups with
 * Topics, events go to one "Task events" topic instead of wherever the command was typed.
 */
export class GroupMessengerService {
  private creating = new Map<string, Promise<number | null>>();
  private createFailedAt = new Map<string, number>();

  /** Records forum state and topic names seen in an incoming message. Never throws. */
  async trackMessage(group: IGroup, message: Record<string, unknown>, isForum: boolean): Promise<void> {
    try {
      const updates: Record<string, unknown> = {};
      if (isForum !== Boolean(group.isForum)) updates.isForum = isForum;

      const threadId = message.message_thread_id as number | undefined;
      const created = message.forum_topic_created as { name?: string } | undefined;
      const edited = message.forum_topic_edited as { name?: string } | undefined;
      const replyCreated = (message.reply_to_message as { forum_topic_created?: { name?: string } } | undefined)
        ?.forum_topic_created;
      const name = created?.name ?? edited?.name ?? replyCreated?.name;
      const knownTopics = group.knownTopics ?? [];

      if (threadId && name) {
        const known = knownTopics.find((t) => t.id === threadId);
        if (!known || known.name !== name) {
          updates.knownTopics = [...knownTopics.filter((t) => t.id !== threadId), { id: threadId, name }];
        }
      }

      if (Object.keys(updates).length > 0) {
        await Group.updateOne({ _id: group._id }, { $set: updates });
        Object.assign(group, updates);
      }
    } catch (error) {
      logger.warn(`[GroupMessenger] Could not track topic info for group ${group.telegramGroupId}: ${error}`);
    }
  }

  async setEventsTopic(group: IGroup, threadId: number | null): Promise<void> {
    await Group.updateOne({ _id: group._id }, { $set: { eventsTopicId: threadId } });
    group.eventsTopicId = threadId;
    if (threadId) this.createFailedAt.delete(String(group._id));
  }

  /** The events topic was deleted: forget it (and its name, so it isn't picked again). */
  private async forgetTopic(group: IGroup, threadId: number): Promise<void> {
    logger.warn(`[GroupMessenger] Events topic ${threadId} of group ${group.telegramGroupId} is gone; forgetting it`);
    try {
      await Group.updateOne(
        { _id: group._id },
        { $set: { eventsTopicId: null }, $pull: { knownTopics: { id: threadId } } },
      );
    } catch (error) {
      logger.warn(`[GroupMessenger] Could not reset events topic: ${errorText(error)}`);
    }
    group.eventsTopicId = null;
    group.knownTopics = (group.knownTopics ?? []).filter((t) => t.id !== threadId);
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
      pending = this.createEventsTopic(telegram, group).finally(() => this.creating.delete(key));
      this.creating.set(key, pending);
    }
    const created = await pending;
    if (created) group.eventsTopicId = created;
    return created ?? undefined;
  }

  private async createEventsTopic(telegram: Telegram, group: IGroup): Promise<number | null> {
    const key = String(group._id);
    let topic;
    try {
      topic = await telegram.createForumTopic(group.telegramGroupId, EVENTS_TOPIC_NAME, {
        icon_color: EVENTS_TOPIC_ICON_COLOR,
      });
    } catch (error) {
      // Usually: the bot isn't an admin with "Manage topics"
      this.createFailedAt.set(key, Date.now());
      logger.info(`[GroupMessenger] Could not create events topic in ${group.telegramGroupId}: ${errorText(error)}`);
      return null;
    }

    this.createFailedAt.delete(key);
    const entry = { id: topic.message_thread_id, name: topic.name };
    group.eventsTopicId = topic.message_thread_id;
    group.knownTopics = [...(group.knownTopics ?? []).filter((t) => t.id !== entry.id), entry];
    try {
      await Group.updateOne(
        { _id: group._id },
        { $set: { eventsTopicId: topic.message_thread_id, knownTopics: group.knownTopics } },
      );
    } catch (error) {
      logger.warn(`[GroupMessenger] Created events topic but could not save it: ${errorText(error)}`);
    }
    logger.info(`[GroupMessenger] Created "${EVENTS_TOPIC_NAME}" topic in group ${group.telegramGroupId}`);
    return topic.message_thread_id;
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
      return await this.deliver(telegram, group, text, threadId, options);
    } catch (error) {
      const message = errorText(error);
      if (!threadId || !(isTopicGone(message) || isTopicClosed(message))) throw error;

      let retryThread: number | undefined;
      if (threadId === eventsThread && isTopicGone(message)) {
        // Deleted events topic: forget it and resolve again (may create a fresh one), once.
        await this.forgetTopic(group, threadId);
        retryThread = (await this.resolveEventsThread(telegram, group)) ?? options.fallbackThreadId;
        if (retryThread === threadId) retryThread = undefined;
      } else {
        // Closed topic, or the fallback topic vanished: this one event goes to General.
        logger.warn(`[GroupMessenger] Topic ${threadId} unusable (${message}); posting in General`);
      }
      try {
        return await this.deliver(telegram, group, text, retryThread, options);
      } catch (retryError) {
        if (retryThread === undefined || !(isTopicGone(errorText(retryError)) || isTopicClosed(errorText(retryError)))) {
          throw retryError;
        }
        return this.deliver(telegram, group, text, undefined, options);
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
    const now = Date.now();
    const last = group.topicSetupHintAt ? new Date(group.topicSetupHintAt).getTime() : 0;
    if (now - last < SETUP_HINT_INTERVAL_MS) return false;
    try {
      const cutoff = new Date(now - SETUP_HINT_INTERVAL_MS);
      const result = await Group.updateOne(
        { _id: group._id, $or: [{ topicSetupHintAt: null }, { topicSetupHintAt: { $lt: cutoff } }] },
        { $set: { topicSetupHintAt: new Date(now) } },
      );
      group.topicSetupHintAt = new Date(now);
      return result.modifiedCount === 1;
    } catch (error) {
      logger.warn(`[GroupMessenger] Could not record setup hint: ${errorText(error)}`);
      return false;
    }
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

  private async deliver(
    telegram: Telegram,
    group: IGroup,
    text: string,
    threadId: number | undefined,
    options: SendEventOptions,
  ): Promise<Message.TextMessage> {
    const chatId = group.telegramGroupId;
    const extra: SendExtra = { ...options.extra };
    delete extra.message_thread_id;
    if (threadId) extra.message_thread_id = threadId;

    const source = options.source;
    if (!source) return this.post(telegram, chatId, text, extra);

    // Same topic: a normal reply that still goes out if the source was deleted.
    if (source.threadId === threadId) {
      return this.post(telegram, chatId, text, {
        ...extra,
        reply_parameters: { message_id: source.messageId, allow_sending_without_reply: true },
      });
    }

    // Cross-topic reply (Bot API 7.0+). allow_sending_without_reply only works within one topic.
    try {
      const sent = await this.post(telegram, chatId, text, { ...extra, reply_parameters: { message_id: source.messageId } });
      if (threadId && sent?.message_thread_id !== undefined && sent.message_thread_id !== threadId) {
        // Telegram put the reply in the source's topic instead of ours: move it.
        await telegram.deleteMessage(chatId, sent.message_id).catch(() => undefined);
        throw new Error(`reply landed in topic ${sent.message_thread_id}`);
      }
      return sent;
    } catch (error) {
      const message = errorText(error);
      if (isTopicGone(message) || isTopicClosed(message)) throw error;
      logger.info(`[GroupMessenger] Cross-topic reply failed (${message}); sending with a link instead`);
      const link = source.linkFallback === false ? null : buildMessageLink(chatId, source.messageId, source.threadId);
      return this.post(telegram, chatId, link ? text + sourceLinkLine(link, extra.parse_mode) : text, extra);
    }
  }

  /** sendMessage; a formatting mistake never costs the message (retried as plain text). */
  private async post(telegram: Telegram, chatId: number, text: string, extra: SendExtra): Promise<Message.TextMessage> {
    try {
      return await telegram.sendMessage(chatId, text, extra);
    } catch (error) {
      if (extra.parse_mode && errorText(error).includes("can't parse entities")) {
        logger.warn(`[GroupMessenger] Formatting rejected, resending as plain text: ${errorText(error)}`);
        const { parse_mode: _ignored, ...plain } = extra;
        return telegram.sendMessage(chatId, text, plain);
      }
      throw error;
    }
  }
}

export const groupMessengerService = new GroupMessengerService();
