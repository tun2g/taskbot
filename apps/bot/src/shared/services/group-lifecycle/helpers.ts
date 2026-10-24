import logger from 'src/shared/logger/logger';
import { NoticeTarget, sendGroupNotice } from 'src/shared/services/group-messenger.service';
import { redisService } from 'src/shared/services/redis.service';
import type { Telegram } from 'telegraf';
import type { User as TelegramUser } from 'telegraf/types';

/** One approval request per chat per minute — my_chat_member and the first message can arrive together. */
export const REQUEST_CLAIM_SECONDS = 60;

export function personName(user: TelegramUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id);
}

export async function claim(key: string, seconds: number): Promise<boolean> {
  try {
    return (await redisService.set(key, '1', { NX: true, EX: seconds })) === 'OK';
  } catch (error) {
    logger.warn(`[GroupLifecycle] Redis claim ${key} failed: ${error}`);
    return true;
  }
}

export async function memberCount(telegram: Telegram, chatId: number): Promise<number | null> {
  try {
    return await telegram.getChatMembersCount(chatId);
  } catch {
    return null;
  }
}

/** A group-wide notice (General in a forum); never throws. */
export async function post(telegram: Telegram, target: number | NoticeTarget, text: string): Promise<void> {
  const group = typeof target === 'number' ? { telegramGroupId: target } : target;
  try {
    await sendGroupNotice(telegram, group, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  } catch (error) {
    logger.warn(`[GroupLifecycle] Could not post in ${group.telegramGroupId}: ${error}`);
  }
}
