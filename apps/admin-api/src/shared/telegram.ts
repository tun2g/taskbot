import { openBoardButton } from '@tbot/shared';
import axios from 'axios';
import { config } from 'src/config/configuration';
import logger from 'src/shared/logger';

/**
 * Minimal Telegram Bot API client (plain HTTPS; the admin API never polls or receives updates — the bot
 * process owns that). Calls never throw: they return `{ ok: false, error }` so a failed notice doesn't undo a
 * decision; callers turn failures into `warnings`.
 */
export type TgResult<T> = { ok: true; result: T } | { ok: false; error: string };

const TIMEOUT_MS = 8000;

export interface InlineKeyboard {
  inline_keyboard: { text: string; url?: string; callback_data?: string }[][];
}

async function call<T>(method: string, payload: Record<string, unknown>): Promise<TgResult<T>> {
  try {
    const res = await axios.post(`${config.telegramApiUrl}/bot${config.botToken}/${method}`, payload, {
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (res.data?.ok) return { ok: true, result: res.data.result as T };
    const error = String(res.data?.description || `HTTP ${res.status}`);
    logger.warn(`Telegram ${method} failed: ${error}`);
    return { ok: false, error };
  } catch (err) {
    // Never log the URL (it contains the bot token).
    const error = (err as { code?: string; message?: string }).code || 'network error';
    logger.warn(`Telegram ${method} failed: ${error}`);
    return { ok: false, error };
  }
}

export interface TgChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export const telegram = {
  /** `threadId`: a forum topic (omitted = the main chat, General in a forum). */
  sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboard, threadId?: number) {
    return call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      ...(threadId ? { message_thread_id: threadId } : {}),
    });
  },
  /** Edits a message and removes its inline buttons. */
  editMessageText(chatId: number, messageId: number, text: string) {
    return call<unknown>('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [] },
    });
  },
  editMessageReplyMarkup(chatId: number, messageId: number, replyMarkup: InlineKeyboard = { inline_keyboard: [] }) {
    return call<unknown>('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup });
  },
  leaveChat(chatId: number) {
    return call<boolean>('leaveChat', { chat_id: chatId });
  },
  getChat(chatId: number) {
    return call<TgChat>('getChat', { chat_id: chatId });
  },
  getChatMemberCount(chatId: number) {
    return call<number>('getChatMemberCount', { chat_id: chatId });
  },
  getMe() {
    return call<{ id: number; first_name: string; username?: string; has_main_web_app?: boolean }>('getMe', {});
  },
};

/** What the admin API needs to know about the bot: its name for notices and what its board links look like. */
export interface BotProfile {
  name: string;
  username: string | null;
  hasMainWebApp: boolean;
}

let profileCache: { profile: BotProfile; at: number } | null = null;

/** getMe, cached for an hour (a failed call isn't cached). */
export async function botProfile(): Promise<BotProfile> {
  if (profileCache && Date.now() - profileCache.at < 3600_000) return profileCache.profile;
  const me = await telegram.getMe();
  if (!me.ok) return { name: 'the bot', username: null, hasMainWebApp: false };
  const profile = {
    name: me.result.first_name || me.result.username || 'the bot',
    username: me.result.username ?? null,
    hasMainWebApp: Boolean(me.result.has_main_web_app),
  };
  profileCache = { profile, at: Date.now() };
  return profile;
}

/** The bot's display name for group notices ("TaskBot"). */
export async function botDisplayName(): Promise<string> {
  return (await botProfile()).name;
}

/** "📋 Open board" for a group — the same link the bot puts on its own messages — or null when none is configured. */
export async function boardButton(groupId: string): Promise<{ text: string; url: string } | null> {
  const bot = await botProfile();
  return openBoardButton({ botUsername: bot.username, hasMainWebApp: bot.hasMainWebApp, webappUrl: config.webappUrl }, groupId);
}
