import { BotContext } from 'src/bot/interface/context';
import { IGroup } from 'src/database/models/group.model';
import { User } from 'src/database/models/user.model';
import { groupService } from 'src/database/services/group.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import logger from 'src/shared/logger/logger';
import { memberSyncService } from 'src/shared/services/member-sync.service';
import { redisService } from 'src/shared/services/redis.service';
import type { User as TelegramUser } from 'telegraf/types';

const MEMBER_CACHE_SECONDS = 6 * 60 * 60;

function cacheKey(chatId: number, telegramUserId: number): string {
  return `member:${chatId}:${telegramUserId}`;
}

async function isCached(chatId: number, telegramUserId: number): Promise<boolean> {
  try {
    return Boolean(await redisService.get(cacheKey(chatId, telegramUserId)));
  } catch {
    return false;
  }
}

async function setCached(chatId: number, telegramUserId: number): Promise<void> {
  try {
    await redisService.set(cacheKey(chatId, telegramUserId), '1', { EX: MEMBER_CACHE_SECONDS });
  } catch {
    // cache is best-effort
  }
}

async function clearCached(chatId: number, telegramUserId: number): Promise<void> {
  try {
    await redisService.del(cacheKey(chatId, telegramUserId));
  } catch {
    // cache is best-effort
  }
}

function chatTitle(ctx: BotContext): string {
  return ctx.chat && 'title' in ctx.chat ? ctx.chat.title : 'Group';
}

async function upsertTelegramUser(tgUser: TelegramUser) {
  return User.findOneAndUpdate(
    { telegramUserId: tgUser.id },
    {
      $set: { username: tgUser.username, firstName: tgUser.first_name, lastName: tgUser.last_name },
      $setOnInsert: { telegramUserId: tgUser.id },
    },
    { upsert: true, new: true, runValidators: true },
  );
}

async function registerMember(ctx: BotContext, tgUser: TelegramUser, group?: IGroup | null): Promise<IGroup | null> {
  const chatId = ctx.chat!.id;
  if (tgUser.is_bot) return group ?? null;
  if (await isCached(chatId, tgUser.id)) return group ?? null;

  const user = await upsertTelegramUser(tgUser);
  const resolvedGroup = group ?? (await groupService.findOrCreateGroup(chatId, chatTitle(ctx)));
  if (user && resolvedGroup) {
    const member = await groupMemberService.addMember(resolvedGroup._id, user._id, user.telegramUserId);
    if (member) await setCached(chatId, tgUser.id);
  }
  return resolvedGroup;
}

async function unregisterMember(ctx: BotContext, telegramUserId: number): Promise<void> {
  const chatId = ctx.chat!.id;
  const group = await groupService.findGroupByTelegramId(chatId);
  if (group) await groupMemberService.removeMember(group._id, telegramUserId);
  await clearCached(chatId, telegramUserId);
}

async function syncMembership(ctx: BotContext): Promise<void> {
  const update = ctx.update as unknown as Record<string, any>;

  // chat_member: someone joined/left/was kicked (requires `chat_member` in allowed_updates + admin rights)
  if (update.chat_member) {
    const changed = update.chat_member.new_chat_member;
    const tgUser: TelegramUser | undefined = changed?.user;
    if (tgUser && !tgUser.is_bot) {
      const status: string = changed.status;
      const isIn =
        status === 'member' ||
        status === 'administrator' ||
        status === 'creator' ||
        (status === 'restricted' && changed.is_member);
      if (isIn) await registerMember(ctx, tgUser);
      else await unregisterMember(ctx, tgUser.id);
    }
    return;
  }

  const message = update.message ?? update.edited_message;
  if (message?.new_chat_members) {
    let group: IGroup | null = null;
    for (const member of message.new_chat_members as TelegramUser[]) {
      group = await registerMember(ctx, member, group);
    }
  }
  if (message?.left_chat_member && !message.left_chat_member.is_bot) {
    await unregisterMember(ctx, message.left_chat_member.id);
    return;
  }
  if (message?.new_chat_title) {
    await groupService.findOrCreateGroup(ctx.chat!.id, message.new_chat_title);
  }

  // Anyone who sends a message or taps a button in the group is a member.
  let group: IGroup | null = null;
  if (ctx.from && !ctx.from.is_bot) {
    group = await registerMember(ctx, ctx.from);
  }

  // People the message points at are members too: the author of the replied-to message,
  // and anyone tagged with a text mention (it carries their full user, even without a username).
  // This matters because the Bot API can't list members — silent people are otherwise unknown.
  if (message) {
    const replied: TelegramUser | undefined = message.reply_to_message?.from;
    if (replied && !replied.is_bot && !message.reply_to_message?.forum_topic_created) {
      group = await registerMember(ctx, replied, group);
    }
    const entities = [...(message.entities ?? []), ...(message.caption_entities ?? [])];
    for (const entity of entities) {
      if (entity.type === 'text_mention' && entity.user && !entity.user.is_bot) {
        group = await registerMember(ctx, entity.user, group);
      }
    }
  }

  // Admins are the one list the Bot API exposes; sync it (throttled to hourly) in the background.
  group = group ?? (await groupService.findGroupByTelegramId(ctx.chat!.id));
  if (group) void memberSyncService.syncAdmins(group, ctx.telegram);
}

export const authMiddleware = async (ctx: BotContext, next: () => Promise<void>) => {
  const chatType = ctx.chat?.type;
  if (chatType === 'group' || chatType === 'supergroup') {
    try {
      await syncMembership(ctx);
    } catch (error) {
      logger.error(`Membership sync failed: ${error}`);
    }
  }
  return next();
};
