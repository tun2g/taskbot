import { IGroup } from 'src/database/models/group.model';
import { IUser } from 'src/database/models/user.model';
import { issueToken, TOO_MANY_TOKENS_TEXT } from 'src/bot/commands/mcp/issue-token';
import { MCP_NOT_CONFIGURED_TEXT, renderSetupMessage } from 'src/bot/commands/mcp/setup-message';
import { configService } from 'src/configs/configuration';
import { manageTokensButton } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

export interface OutgoingMessage {
  text: string;
  keyboard: InlineKeyboardButton[][];
}

/**
 * Issues a token for `group` (null = all groups) and builds the DM to send: the setup message, or the
 * "not configured" / "too many tokens" message (no token then). `tokenId` lets the caller revoke it if the DM fails.
 */
export async function buildTokenMessage(
  user: IUser,
  group: IGroup | null,
): Promise<OutgoingMessage & { tokenId: string | null }> {
  const url = configService.mcpPublicUrl();
  if (!url) return { text: MCP_NOT_CONFIGURED_TEXT, keyboard: [], tokenId: null };

  const issued = await issueToken(user, group);
  if (!issued.ok) {
    const manage = manageTokensButton(true);
    return { text: TOO_MANY_TOKENS_TEXT, keyboard: manage ? [[manage]] : [], tokenId: null };
  }
  return {
    ...renderSetupMessage({ secret: issued.secret, url, groupTitle: group?.groupName ?? null }),
    tokenId: issued.tokenId,
  };
}
