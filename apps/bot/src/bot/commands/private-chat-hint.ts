import { BotContext } from 'src/bot/interface/context';
import { configService } from 'src/configs/configuration';
import { InlineKeyboardButton } from 'telegraf/types';

/** "➕ Add to group" url button, or null when the bot username isn't known. */
export function addToGroupButton(): InlineKeyboardButton | null {
  return configService.botUsername
    ? { text: '➕ Add to group', url: `https://t.me/${configService.botUsername}?startgroup=true` }
    : null;
}

/** Reply for group-only commands sent in a private chat: point to /start (boards) and offer adding the bot. */
export async function replyGroupOnly(ctx: BotContext, command: string): Promise<void> {
  const add = addToGroupButton();
  await ctx.reply(
    `👥 /${command} works in group chats. Send /start to open your task boards, or add me to your team group.`,
    add ? { reply_markup: { inline_keyboard: [[add]] } } : {},
  );
}
