import { GroupStatus } from '@tbot/shared';
import { BotContext } from 'src/bot/interface/context';
import { IGroup } from 'src/database/models/group.model';
import { groupService } from 'src/database/services/group.service';
import logger from 'src/shared/logger/logger';
import { ApprovalChat, groupLifecycleService } from 'src/shared/services/group-lifecycle.service';
import type { ChatMember, User as TelegramUser } from 'telegraf/types';

/** Updates still in flight when the bot left must not count as "the bot is back". */
const LEFT_GRACE_MS = 60 * 1000;

function isIn(member: ChatMember | undefined): boolean {
  if (!member) return false;
  if (member.status === 'restricted') return member.is_member;
  return member.status === 'member' || member.status === 'administrator' || member.status === 'creator';
}

/**
 * Keeps the group record in step with Telegram before anything else looks at it (runs before membership sync):
 * - the bot added / removed (my_chat_member) → request approval, restore a previous approval, or mark LEFT;
 * - a basic group upgraded to a supergroup → move the group (and its tasks) to the new chat id;
 * - a chat the bot never saw (the add event was missed) or one it was re-added to silently → same as an add.
 * Sets `ctx.state.group` for the approval gate (`lastActivityAt` is recorded by the usage tracker).
 */
export const groupLifecycleMiddleware = async (ctx: BotContext, next: () => Promise<void>) => {
  const chat = ctx.chat;
  if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return next();

  const botName = ctx.botInfo?.first_name || 'TaskBot';
  const approvalChat = chat as ApprovalChat;
  const update = ctx.update as unknown as Record<string, any>;

  try {
    const membership = update.my_chat_member;
    if (membership) {
      const was = isIn(membership.old_chat_member);
      const now = isIn(membership.new_chat_member);
      if (!was && now) {
        ctx.state.group = await groupLifecycleService.onBotAdded(ctx.telegram, approvalChat, membership.from, botName);
      } else if (was && !now) {
        await groupLifecycleService.onBotRemoved(ctx.telegram, chat.id);
        return; // the bot is gone — nothing else to do for this chat
      }
      return next();
    }

    const message = update.message;
    if (message?.migrate_to_chat_id) {
      await groupLifecycleService.migrateChat(ctx.telegram, chat.id, message.migrate_to_chat_id);
      return; // the old chat is closed; don't let later middlewares recreate a group for its id
    }
    if (message?.migrate_from_chat_id) {
      await groupLifecycleService.migrateChat(ctx.telegram, message.migrate_from_chat_id, chat.id, Boolean(approvalChat.is_forum));
      return;
    }

    let group: IGroup | null = await groupService.findGroupByTelegramId(chat.id);
    const botJoined = Boolean(
      ctx.botInfo && (message?.new_chat_members as TelegramUser[] | undefined)?.some((m) => m.id === ctx.botInfo.id),
    );
    const leftLongAgo =
      group?.status === GroupStatus.LEFT && Date.now() - new Date(group.botLeftAt ?? 0).getTime() > LEFT_GRACE_MS;
    // A rejected group only counts as re-added on an explicit join (a late message must not re-open the request).
    const readded = botJoined && (group?.status === GroupStatus.LEFT || group?.status === GroupStatus.REJECTED);
    // Created by some other path without a request going out (e.g. this middleware failed once, or a new
    // supergroup's deferred announcement was lost to a restart): ask now.
    const neverRequested = group?.status === GroupStatus.PENDING && !group.addedAt;
    if (!group || leftLongAgo || readded || neverRequested) {
      group = await groupLifecycleService.onBotAdded(ctx.telegram, approvalChat, botJoined ? (ctx.from ?? null) : null, botName);
    }
    ctx.state.group = group;
  } catch (error) {
    logger.error(`[GroupLifecycle] ${error}`);
  }
  return next();
};
