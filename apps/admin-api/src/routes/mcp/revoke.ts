import { ApiToken } from '@tbot/db';
import type { AdminTokenRevokeResult } from '@tbot/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { writeAudit } from 'src/shared/audit';
import { HttpError } from 'src/shared/http';
import { LeanToken, TOKEN_FIELDS, tokenRows } from './tokens';

/**
 * Revokes one MCP token (the person's other tokens keep working). Revoking an already-revoked token is a 409;
 * an expired one can still be revoked, so it can never come back.
 */
export async function revokeToken(req: Request, id: Types.ObjectId): Promise<AdminTokenRevokeResult> {
  const before = await ApiToken.findById(id).select(TOKEN_FIELDS).lean<LeanToken>();
  if (!before) throw new HttpError(404, "This token doesn't exist (it may have been deleted with its group).");
  if (before.revokedAt) throw new HttpError(409, 'This token was already revoked.');
  const revokedAt = new Date();
  const res = await ApiToken.updateOne({ _id: id, revokedAt: null }, { $set: { revokedAt } });
  if ((res.modifiedCount ?? 0) === 0) throw new HttpError(409, 'This token was already revoked.');
  const [token] = await tokenRows([{ ...before, revokedAt }]);
  const auditId = await writeAudit(req, {
    action: 'token.revoke',
    targetType: 'user',
    targetId: token.person?.id ?? null,
    targetLabel: token.person?.name ?? null,
    details: { tokenId: token.id, name: token.name, prefix: token.prefix, groupId: token.group?.id ?? null, groupName: token.group?.name ?? null },
  });
  return { token, auditId };
}
