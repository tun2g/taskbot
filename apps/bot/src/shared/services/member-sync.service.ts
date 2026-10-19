import { IGroup } from 'src/database/models/group.model';
import { IUser, User } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';
import type { Telegram } from 'telegraf';
import type { User as TelegramUser } from 'telegraf/types';

const ADMIN_SYNC_SECONDS = 60 * 60;
const NOT_MEMBER_CACHE_SECONDS = 5 * 60;

/**
 * The Bot API can't list a group's members — only its admins. So the bot learns members
 * from what it sees (messages, joins, mentions), syncs the admin list, and verifies
 * individual users with getChatMember when they show up elsewhere (e.g. open the board).
 */
export class MemberSyncService {
  /** Lazily imported: the bot module imports services that import this file. */
  private async telegram(): Promise<Telegram> {
    const { bot } = await import('src/bot');
    return bot.telegram;
  }

  async upsertTelegramUser(tgUser: TelegramUser): Promise<IUser | null> {
    return User.findOneAndUpdate(
      { telegramUserId: tgUser.id },
      {
        $set: { username: tgUser.username, firstName: tgUser.first_name, lastName: tgUser.last_name },
        $setOnInsert: { telegramUserId: tgUser.id },
      },
      { upsert: true, new: true, runValidators: true },
    );
  }

  /** Adds a Telegram user seen in this group (sender, mentioned person, joiner). */
  async addTelegramUser(group: IGroup, tgUser: TelegramUser): Promise<IUser | null> {
    if (tgUser.is_bot) return null;
    const user = await this.upsertTelegramUser(tgUser);
    if (user) await groupMemberService.addMember(group._id, user._id, user.telegramUserId);
    return user;
  }

  /** Registers every (human) admin of the group. At most once an hour per group. Never throws. */
  async syncAdmins(group: IGroup, telegram?: Telegram, force = false): Promise<number> {
    const key = `admins-synced:${group.telegramGroupId}`;
    try {
      if (!force && (await redisService.get(key))) return 0;
      await redisService.set(key, '1', { EX: ADMIN_SYNC_SECONDS });
      const admins = await (telegram ?? (await this.telegram())).getChatAdministrators(group.telegramGroupId);
      let added = 0;
      for (const admin of admins) {
        if (admin.user.is_bot) continue;
        if (await this.addTelegramUser(group, admin.user)) added++;
      }
      return added;
    } catch (error) {
      logger.warn(`[MemberSync] Could not sync admins of ${group.telegramGroupId}: ${error}`);
      return 0;
    }
  }

  /**
   * True if the user is in the group according to Telegram — and records the membership.
   * Used when someone who never spoke in the group opens its board. Never throws.
   */
  async verifyAndAddMember(group: IGroup, user: IUser): Promise<boolean> {
    const negativeKey = `not-member:${group.telegramGroupId}:${user.telegramUserId}`;
    try {
      if (await redisService.get(negativeKey)) return false;
      const member = await (await this.telegram()).getChatMember(group.telegramGroupId, user.telegramUserId);
      const inGroup =
        member.status === 'creator' ||
        member.status === 'administrator' ||
        member.status === 'member' ||
        (member.status === 'restricted' && member.is_member);
      if (!inGroup) {
        await redisService.set(negativeKey, '1', { EX: NOT_MEMBER_CACHE_SECONDS });
        return false;
      }
      await groupMemberService.addMember(group._id, user._id, user.telegramUserId);
      return true;
    } catch (error) {
      logger.warn(`[MemberSync] Could not verify ${user.telegramUserId} in ${group.telegramGroupId}: ${error}`);
      return false;
    }
  }
}

export const memberSyncService = new MemberSyncService();
