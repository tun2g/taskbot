import { UsageKind } from '@tbot/shared';
import { BotContext } from 'src/bot/interface/context';
import { withContext } from 'src/shared/services/telemetry/request-context';
import { recordUsage, touchLastSeen } from 'src/shared/services/telemetry/usage-tracker';

/** Commands the bot handles (set from the command map in src/bot/index.ts); other bots' commands aren't counted. */
const knownCommands = new Set<string>(['start']);

export function trackCommands(names: Iterable<string>): void {
  for (const name of names) knownCommands.add(name.toLowerCase());
}

/**
 * "/task@TBot 3" → "task"; null when the message isn't a command for this bot (another bot's suffix, or a
 * command the bot doesn't have).
 */
export function commandName(text: string | undefined, botUsername?: string): string | null {
  const match = text?.match(/^\/([a-z0-9_]{1,32})(?:@(\w+))?(?:\s|$)/i);
  if (!match) return null;
  if (match[2] && botUsername && match[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  const name = match[1].toLowerCase();
  return knownCommands.has(name) ? name : null;
}

const WORD = /^[a-z][a-z_]{0,23}$/i;

/**
 * The callback's family, never its ids: "task:status_done:k1x9" → "task:status_done", "tdm:explain:<id>" →
 * "tdm:explain", "batch:undo:<key>" → "batch:undo", "help:ai" → "help:ai". At most two word segments.
 */
export function callbackFamily(data: string | undefined): string {
  if (!data) return 'unknown';
  const words: string[] = [];
  for (const part of data.split(':')) {
    if (!WORD.test(part) || words.length === 2) break;
    words.push(part.toLowerCase());
  }
  return words.length ? words.join(':') : 'other';
}

/**
 * Usage stats for the admin app: one event per command / button press (name, ok, latency) attributed to the
 * person and the group, plus the person's lastSeenAt (throttled). Everything in the update runs inside a
 * Telegram request context, so AI calls and rate-limit hits deeper down are attributed too.
 */
export const usageMiddleware = async (ctx: BotContext, next: () => Promise<void>) => {
  const from = ctx.from;
  const chat = ctx.chat;
  const telegramUserId = from && !from.is_bot ? from.id : null;
  const telegramChatId = chat && (chat.type === 'group' || chat.type === 'supergroup') ? chat.id : null;
  if (telegramUserId) touchLastSeen({ telegramUserId, telegramChatId });

  let event: { kind: UsageKind; name: string } | null = null;
  const callback = ctx.callbackQuery;
  if (callback && 'data' in callback) {
    event = { kind: UsageKind.CALLBACK, name: callbackFamily(callback.data) };
  } else {
    const message = ctx.message as { text?: string } | undefined;
    const name = commandName(message?.text, ctx.botInfo?.username);
    if (name) event = { kind: UsageKind.COMMAND, name };
  }

  const started = Date.now();
  let ok = true;
  try {
    await withContext({ channel: 'telegram', telegramUserId, telegramChatId }, () => next());
  } catch (error) {
    ok = false;
    throw error;
  } finally {
    if (event && telegramUserId) {
      recordUsage({ ...event, channel: 'telegram', ok, latencyMs: Date.now() - started, telegramUserId, telegramChatId });
    }
  }
};

/** An "@bot …" message or a question replied to a task card, handed to the AI. */
export function recordMention(ctx: BotContext, name: 'mention' | 'card_question'): void {
  const chat = ctx.chat;
  recordUsage({
    kind: UsageKind.MENTION,
    name,
    channel: 'telegram',
    telegramUserId: ctx.from?.id ?? null,
    telegramChatId: chat && chat.type !== 'private' ? chat.id : null,
  });
}
