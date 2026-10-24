import { User } from '@tbot/db';
import { config } from 'src/config/configuration';
import { personName } from 'src/stats/aggregate';
import { telegram } from 'src/shared/telegram';

export interface OwnerProfile {
  telegramUserId: number;
  name: string;
  username: string | null;
}

let ownerCache: { profile: OwnerProfile; at: number } | null = null;

/** The owner's name: from the users collection, else Telegram getChat, else a generic label. Cached 10 min. */
export async function ownerProfile(): Promise<OwnerProfile> {
  const id = config.ownerTelegramId;
  if (ownerCache && ownerCache.profile.telegramUserId === id && Date.now() - ownerCache.at < 600_000)
    return ownerCache.profile;
  let profile: OwnerProfile | null = null;
  const user = await User.findOne({ telegramUserId: id }).select('telegramUserId username firstName lastName').lean();
  if (user) {
    profile = { telegramUserId: id, name: personName(user), username: user.username || null };
  } else {
    const chat = await telegram.getChat(id);
    if (chat.ok) {
      const name =
        [chat.result.first_name, chat.result.last_name].filter(Boolean).join(' ') ||
        (chat.result.username ? `@${chat.result.username}` : 'Bot owner');
      profile = { telegramUserId: id, name, username: chat.result.username || null };
    }
  }
  if (profile) ownerCache = { profile, at: Date.now() };
  return profile ?? { telegramUserId: id, name: 'Bot owner', username: null };
}

/** Tests. */
export function resetOwnerCache() {
  ownerCache = null;
}
