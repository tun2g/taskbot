import { replyGroupOnly } from 'src/bot/commands/private-chat-hint';
import { BotContext } from 'src/bot/interface/context';
import { IGroup } from 'src/database/models/group.model';
import { IUser } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import logger from 'src/shared/logger/logger';
import { memberSyncService } from 'src/shared/services/member-sync.service';
import { boardButton } from 'src/shared/utils/app-links';
import type { InlineKeyboardButton } from 'telegraf/types';

export const MEMBERS_CALLBACK_PREFIX = 'members:';
const JOIN_DATA = `${MEMBERS_CALLBACK_PREFIX}join`;
const SHOWN_LIMIT = 40;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function memberName(user: IUser): string {
  if (user.username) return `@${user.username}`;
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Someone';
}

/** The list + a "join" button (+ the board). Telegram bots can't list group members, so people opt in once. */
export function renderMembers(
  members: IUser[],
  groupId?: { toString(): string },
): { text: string; keyboard: InlineKeyboardButton[][] } {
  const names = members.map(memberName).sort((a, b) => a.localeCompare(b));
  const shown = names.slice(0, SHOWN_LIMIT).map(escapeHtml).join(', ');
  const more = names.length > SHOWN_LIMIT ? ` …and ${names.length - SHOWN_LIMIT} more` : '';
  const text = [
    `👥 <b>People I can assign tasks to · ${names.length}</b>`,
    names.length ? `${shown}${more}` : 'Nobody yet.',
    '',
    "Not on the list? Tap below once — Telegram doesn't let bots see members who haven't posted.",
  ].join('\n');
  const board = groupId ? boardButton(groupId) : null;
  const keyboard: InlineKeyboardButton[][] = [[{ text: "✋ I'm here", callback_data: JOIN_DATA }]];
  if (board) keyboard.push([board]);
  return { text, keyboard };
}

async function loadGroup(ctx: BotContext): Promise<IGroup | null> {
  const chat = ctx.chat;
  if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return null;
  return groupService.findOrCreateGroup(chat.id, chat.title);
}

export class MembersCommand {
  private map: Map<string, (ctx: BotContext) => void>;

  constructor() {
    this.map = new Map<string, (ctx: BotContext) => void>();
  }

  register() {
    this.map.set('members', this.onMembers.bind(this));
    return this.map;
  }

  async onMembers(ctx: BotContext) {
    try {
      const group = await loadGroup(ctx);
      if (!group) {
        await replyGroupOnly(ctx, 'members');
        return;
      }
      // Pick up admins right away instead of waiting for the hourly sync
      await memberSyncService.syncAdmins(group, ctx.telegram, true);
      const { text, keyboard } = renderMembers(await groupMemberService.getMembers(group._id), group._id);
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    } catch (error) {
      logger.error(`Error in /members: ${error}`);
      await ctx.reply('❌ Could not load members. Please try again.').catch(() => undefined);
    }
  }
}

/** "✋ I'm here": the membership middleware has already registered whoever tapped. */
export async function handleMembersCallback(ctx: BotContext): Promise<void> {
  try {
    const group = await loadGroup(ctx);
    if (!group || !ctx.from) {
      await ctx.answerCbQuery();
      return;
    }
    if (ctx.from.is_bot) {
      await ctx.answerCbQuery();
      return;
    }
    await memberSyncService.addTelegramUser(group, ctx.from);
    const { text, keyboard } = renderMembers(await groupMemberService.getMembers(group._id), group._id);
    await ctx
      .editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } })
      .catch(() => undefined); // "message is not modified" when already listed
    await ctx.answerCbQuery("✅ You're on the list — tasks can be assigned to you now.");
  } catch (error) {
    logger.error(`Members callback failed: ${error}`);
    await ctx.answerCbQuery('Something went wrong. Please try again.').catch(() => undefined);
  }
}

export const membersCommand = new MembersCommand();
