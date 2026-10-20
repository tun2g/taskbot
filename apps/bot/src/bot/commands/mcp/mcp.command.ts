import mongoose from 'mongoose';
import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { buildTokenMessage, OutgoingMessage } from 'src/bot/commands/mcp/deliver-token';
import { renderGroupPicker } from 'src/bot/commands/mcp/group-picker';
import { MCP_START_PAYLOAD } from 'src/bot/commands/mcp/mcp-help-page';
import { MCP_NOT_CONFIGURED_TEXT } from 'src/bot/commands/mcp/setup-message';
import { addToGroupButton } from 'src/bot/commands/private-chat-hint';
import { BotContext } from 'src/bot/interface/context';
import { configService } from 'src/configs/configuration';
import { Group } from 'src/database/models/group.model';
import { IUser } from 'src/database/models/user.model';
import { apiTokenService } from 'src/database/services/api-token.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import { botStartLink } from 'src/shared/utils/app-links';

/** `/start mcp_<groupId>` — issued from a group when the bot couldn't DM the user yet. */
export const MCP_GROUP_START_PREFIX = 'mcp_';

export const SENT_TO_DM_TEXT = '📩 Sent you a token for this group in DM.';
export const START_DM_FIRST_TEXT =
  "🔒 I can't message you yet. Tap below to open a private chat — I'll send the token there.";
export const NOT_A_MEMBER_TEXT =
  "👥 You're not a member of that group (or it was removed), so I can't make a token for it. Send /mcp to pick another.";
const NO_GROUPS_TEXT = [
  "👥 <b>You're not in a group with me yet</b>",
  'Tokens work on the tasks of your groups. Add me to your team group, post there once, then send /mcp again.',
].join('\n');
const ERROR_TEXT = '❌ Could not create a token. Please try again in a moment.';

const isPrivate = (ctx: BotContext) => ctx.chat?.type === 'private';
const isGroup = (ctx: BotContext) => ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';

function htmlExtra(message: Pick<OutgoingMessage, 'keyboard'>) {
  return {
    parse_mode: 'HTML' as const,
    link_preview_options: { is_disabled: true },
    ...(message.keyboard.length ? { reply_markup: { inline_keyboard: message.keyboard } } : {}),
  };
}

/** Text after "/start " (deep-link payload), or ''. */
function startPayload(ctx: BotContext): string {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  return text.split(/\s+/)[1]?.trim() ?? '';
}

export class McpCommand {
  private map = new Map<string, (ctx: BotContext) => void>();

  register() {
    this.map.set('mcp', this.onMcp.bind(this));
    return this.map;
  }

  /** /mcp — DM: pick the token's group; group: a token for this group, delivered by DM. */
  async onMcp(ctx: BotContext) {
    try {
      if (!configService.mcpPublicUrl()) {
        await ctx.reply(MCP_NOT_CONFIGURED_TEXT, { parse_mode: 'HTML' });
        return;
      }
      const user = await userService.findOrCreateUser(ctx);
      if (!user) {
        await ctx.reply(ERROR_TEXT);
        return;
      }
      if (isPrivate(ctx)) await this.showPicker(ctx, user);
      else if (isGroup(ctx)) await this.issueFromGroup(ctx, user);
    } catch (error) {
      logger.error(`Error in /mcp: ${error}`);
      await ctx.reply(ERROR_TEXT).catch(() => undefined);
    }
  }

  /** `/start mcp` and `/start mcp_<groupId>` in a private chat. True when handled. */
  async handleStartPayload(ctx: BotContext): Promise<boolean> {
    const payload = startPayload(ctx);
    if (!isPrivate(ctx) || (payload !== MCP_START_PAYLOAD && !payload.startsWith(MCP_GROUP_START_PREFIX))) return false;

    try {
      if (!configService.mcpPublicUrl()) {
        await ctx.reply(MCP_NOT_CONFIGURED_TEXT, { parse_mode: 'HTML' });
        return true;
      }
      const user = await userService.findOrCreateUser(ctx);
      if (!user) {
        await ctx.reply(ERROR_TEXT);
        return true;
      }
      if (payload === MCP_START_PAYLOAD) {
        await this.showPicker(ctx, user);
        return true;
      }

      const access = await checkGroupAccess(payload.slice(MCP_GROUP_START_PREFIX.length), user);
      if (!access.ok) {
        await ctx.reply(NOT_A_MEMBER_TEXT);
        return true;
      }
      const message = await buildTokenMessage(user, access.group);
      await ctx.reply(message.text, htmlExtra(message));
    } catch (error) {
      logger.error(`Error in /start mcp: ${error}`);
      await ctx.reply(ERROR_TEXT).catch(() => undefined);
    }
    return true;
  }

  private async showPicker(ctx: BotContext, user: IUser) {
    const ids = await groupMemberService.getUserGroups(user._id as mongoose.Types.ObjectId);
    const groups = ids.length ? await Group.find({ _id: { $in: ids } }).sort({ groupName: 1 }) : [];
    if (groups.length === 0) {
      const add = addToGroupButton();
      await ctx.reply(NO_GROUPS_TEXT, {
        parse_mode: 'HTML',
        ...(add ? { reply_markup: { inline_keyboard: [[add]] } } : {}),
      });
      return;
    }
    const picker = renderGroupPicker(groups);
    await ctx.reply(picker.text, htmlExtra(picker));
  }

  /** The secret never goes to the group: DM it, or point to the DM when the bot can't write there yet. */
  private async issueFromGroup(ctx: BotContext, user: IUser) {
    const chat = ctx.chat!;
    const group = await groupService.findOrCreateGroup(chat.id, 'title' in chat ? chat.title : 'Group');
    if (!group) {
      await ctx.reply(ERROR_TEXT);
      return;
    }
    const access = await checkGroupAccess(String(group._id), user);
    if (!access.ok) {
      await ctx.reply(NOT_A_MEMBER_TEXT);
      return;
    }

    const message = await buildTokenMessage(user, group);
    try {
      await ctx.telegram.sendMessage(user.telegramUserId, message.text, htmlExtra(message));
    } catch (error) {
      // Bots can't start a conversation: drop the unseen token and offer the deep link that issues it in DM.
      logger.info(`/mcp: could not DM user ${user.telegramUserId}: ${error}`);
      if (message.tokenId) {
        await Promise.resolve(apiTokenService.revoke(user._id as mongoose.Types.ObjectId, message.tokenId)).catch((e) =>
          logger.warn(`/mcp: could not revoke undelivered token ${message.tokenId}: ${e}`),
        );
      }
      const link = botStartLink(`${MCP_GROUP_START_PREFIX}${group._id}`);
      await ctx.reply(
        START_DM_FIRST_TEXT,
        link ? { reply_markup: { inline_keyboard: [[{ text: '🔑 Get token in DM', url: link }]] } } : {},
      );
      return;
    }

    const open = botStartLink();
    await ctx.reply(
      SENT_TO_DM_TEXT,
      open ? { reply_markup: { inline_keyboard: [[{ text: '💬 Open DM', url: open }]] } } : {},
    );
  }
}

export const mcpCommand = new McpCommand();
