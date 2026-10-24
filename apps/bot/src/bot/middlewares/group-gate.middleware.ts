import { GROUP_NOTICES, GroupStatus } from '@tbot/shared';
import { BotContext } from 'src/bot/interface/context';
import { IGroup } from 'src/database/models/group.model';
import { groupService } from 'src/database/services/group.service';
import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';
import { groupUnavailableToast, isGroupActive } from 'src/shared/utils/group-status';

/** "Still waiting / paused" replies go out at most once per group in this window — the group shouldn't hear it on every command. */
export const GATE_NOTICE_SECONDS = 6 * 60 * 60;

/** Was this message meant for the bot: a command (not addressed to another bot), a reply to it, or a mention? */
function addressedToBot(ctx: BotContext): boolean {
  const message = ctx.message;
  if (!message || !('text' in message)) return false;
  const botUsername = ctx.botInfo?.username?.toLowerCase();
  const text = message.text || '';
  const entities = message.entities || [];

  const command = entities.find((e) => e.type === 'bot_command' && e.offset === 0);
  if (command) {
    const target = text.slice(0, command.length).split('@')[1]?.toLowerCase();
    return !target || target === botUsername;
  }
  if (!botUsername) return false;
  if (message.reply_to_message?.from?.username?.toLowerCase() === botUsername) return true;
  if (text.toLowerCase().includes(`@${botUsername}`)) return true;
  return entities.some((e) => e.type === 'text_mention' && e.user?.username?.toLowerCase() === botUsername);
}

function notice(group: IGroup): string | null {
  // Not announced yet (a new supergroup waits a few seconds in case it is an upgraded group): stay quiet too.
  if (group.status === GroupStatus.PENDING) return group.addedAt ? GROUP_NOTICES.stillPending : null;
  if (group.status === GroupStatus.SUSPENDED) return GROUP_NOTICES.stillSuspended(group.statusReason);
  return null; // rejected / left / migrated: the bot shouldn't be here — stay silent
}

async function claimNotice(chatId: number): Promise<boolean> {
  try {
    return (await redisService.set(`group:gate-notice:${chatId}`, '1', { NX: true, EX: GATE_NOTICE_SECONDS })) === 'OK';
  } catch {
    return false; // when unsure, stay quiet
  }
}

/**
 * Only ACTIVE groups get service. In any other group, every update stops here (after membership was recorded,
 * so the owner can see who is in a pending group — but before any message content is buffered for AI):
 * commands and mentions get one short "waiting for approval" / "paused" reply per 6 hours, buttons a toast.
 * Private chats always pass.
 */
export const groupGateMiddleware = async (ctx: BotContext, next: () => Promise<void>) => {
  const chat = ctx.chat;
  if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return next();

  let group: IGroup | null = (ctx.state.group as IGroup | null | undefined) ?? null;
  try {
    group = group ?? (await groupService.findGroupByTelegramId(chat.id));
  } catch (error) {
    logger.error(`[GroupGate] Could not load group ${chat.id}: ${error}`);
  }
  if (!group || isGroupActive(group)) return next();

  try {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(groupUnavailableToast(group), { show_alert: true });
      return;
    }
    if (!addressedToBot(ctx)) return;
    const text = notice(group);
    if (text && (await claimNotice(chat.id))) {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...(ctx.message ? { reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true } } : {}),
      });
    }
  } catch (error) {
    logger.warn(`[GroupGate] Could not tell group ${chat.id} it is ${group.status}: ${error}`);
  }
};
