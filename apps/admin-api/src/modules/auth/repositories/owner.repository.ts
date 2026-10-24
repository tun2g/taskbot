import { User } from '@tbot/db';

/** The owner's user document (only the name fields), or null when the bot has never seen them. */
export async function findOwnerUser(telegramUserId: number) {
  return User.findOne({ telegramUserId }).select('telegramUserId username firstName lastName').lean();
}
