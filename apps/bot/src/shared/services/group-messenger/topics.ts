import { BotContext } from 'src/bot/interface/context';
import { Telegram } from 'telegraf';
import { Message } from 'telegraf/types';

export const EVENTS_TOPIC_NAME = 'Task events';
// One of Telegram's six preset topic colors (light blue); createForumTopic rejects any other value.
export const EVENTS_TOPIC_ICON_COLOR = 0x6fb9f0;
/** After a failed createForumTopic (usually: no "Manage topics" right), don't retry for a while. */
export const CREATE_RETRY_MS = 10 * 60 * 1000;
export const SETUP_HINT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export const TOPIC_SETUP_HINT =
  'ℹ️ Tip for admins: make me an admin with “Manage topics”, or run /settopic in the topic where task events should go.';

export type SendExtra = NonNullable<Parameters<Telegram['sendMessage']>[2]>;

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

export function sourceLinkLine(link: string, parseMode: SendExtra['parse_mode']): string {
  if (parseMode === 'HTML') return `\n\n💬 <a href="${link}">Original message</a>`;
  if (parseMode === 'Markdown' || parseMode === 'MarkdownV2') return `\n\n💬 [Original message](${link})`;
  return `\n\n💬 Original message: ${link}`;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The target topic is gone ("message thread not found") or was deleted. */
export function isTopicGone(message: string): boolean {
  return /message thread not found|TOPIC_DELETED/i.test(message);
}

/** The target topic is closed and the bot may not post there. */
export function isTopicClosed(message: string): boolean {
  return /TOPIC_CLOSED/i.test(message);
}
