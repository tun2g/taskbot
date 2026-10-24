import { BotContext } from 'src/bot/interface/context';
import { AiReply } from 'src/shared/services/ai-command.service';
import { ReplyProgress } from 'src/shared/services/task-creation.service';
import { Message } from 'telegraf/types';

const TYPING_INTERVAL_MS = 4500;

export type CommandMessage = Message.TextMessage | Message.CaptionableMessage;

/** Exactly one HTML reply, threaded to the user's /ai message (plain-text retry on a formatting error). */
export async function sendAiReply(ctx: BotContext, reply: AiReply) {
  const messageId = ctx.message?.message_id;
  const progress = new ReplyProgress(ctx, '');
  await progress.finish(reply.text, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(messageId ? { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } } : {}),
    ...(reply.buttons ? { reply_markup: { inline_keyboard: reply.buttons } } : {}),
  });
}

/** "typing…" right away and while the AI thinks (Telegram clears it after ~5s). */
export function keepTyping(ctx: BotContext): () => void {
  const ping = () => void Promise.resolve(ctx.sendChatAction?.('typing')).catch(() => undefined);
  ping();
  const timer = setInterval(ping, TYPING_INTERVAL_MS);
  return () => clearInterval(timer);
}

/** The replied-to message, ignoring the implicit reply to a forum topic's first message. */
export function getReplyTarget(message: CommandMessage): Message | null {
  const reply = 'reply_to_message' in message ? message.reply_to_message : undefined;
  if (!reply || 'forum_topic_created' in reply) return null;
  return reply as Message;
}
