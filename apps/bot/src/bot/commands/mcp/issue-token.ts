import mongoose from 'mongoose';
import { IGroup } from 'src/database/models/group.model';
import { IUser } from 'src/database/models/user.model';
import { apiTokenService, MAX_ACTIVE_TOKENS, TooManyTokensError } from 'src/database/services/api-token.service';

export type IssueResult = { ok: true; secret: string; tokenId: string } | { ok: false; reason: 'limit' };

export const TOO_MANY_TOKENS_TEXT = `🔑 You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one you don't use (🔑 Manage tokens), then send /mcp again.`;

/** "Telegram /mcp 2026-10-20" */
export function tokenName(now = new Date()): string {
  return `Telegram /mcp ${now.toISOString().slice(0, 10)}`;
}

/** Creates a token for `group` (null = all the user's groups). Membership must already be checked. */
export async function issueToken(user: IUser, group: IGroup | null): Promise<IssueResult> {
  try {
    const { token, secret } = await apiTokenService.create(
      user._id as mongoose.Types.ObjectId,
      tokenName(),
      group ? (group._id as mongoose.Types.ObjectId) : null,
    );
    return { ok: true, secret, tokenId: String(token._id) };
  } catch (error) {
    if (error instanceof TooManyTokensError) return { ok: false, reason: 'limit' };
    throw error;
  }
}
