import { bot } from 'src/bot';
import logger from 'src/shared/logger/logger';

/** True when the user is the creator or an administrator of the Telegram group. Errors → false. */
export async function isTelegramGroupAdmin(telegramGroupId: number, telegramUserId: number): Promise<boolean> {
  try {
    const member = await bot.telegram.getChatMember(telegramGroupId, telegramUserId);
    return member.status === 'creator' || member.status === 'administrator';
  } catch (error) {
    logger.warn(`Could not check admin status of ${telegramUserId} in ${telegramGroupId}: ${error}`);
    return false;
  }
}
