import { SETTINGS_CACHE_SECONDS } from '@tbot/db';
import type { AdminAiOverrideInput, AdminUserRow } from '@tbot/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { findUser, userRows } from 'src/modules/users/services/rows.service';
import { revokeTokensOf, setUserFields } from 'src/modules/users/users.repository';
import { aiOverrideSet, overrideSnapshot } from 'src/shared/ai-override';
import { writeAudit } from 'src/shared/audit';
import { personRef } from 'src/shared/refs';

/** PATCH /users/:id/ai — sets the person's AI override and records it in the audit log. */
export async function updateUserAi(
  req: Request,
  id: Types.ObjectId,
  input: AdminAiOverrideInput,
): Promise<AdminUserRow & { appliesWithinSeconds: number; auditId: string | null }> {
  const before = await findUser(id);
  await setUserFields(id, aiOverrideSet(input, before.ai));
  const after = await findUser(id);
  const [row] = await userRows([after]);
  const auditId = await writeAudit(req, {
    action: 'user.ai',
    targetType: 'user',
    targetId: String(id),
    targetLabel: row.person.name,
    reason: after.ai?.reason ?? null,
    details: { before: overrideSnapshot(before.ai), after: overrideSnapshot(after.ai) },
  });
  return { ...row, appliesWithinSeconds: SETTINGS_CACHE_SECONDS, auditId };
}

/** POST /users/:id/revoke-tokens — revokes every MCP token of this person (takes effect immediately). */
export async function revokeUserTokens(req: Request, id: Types.ObjectId): Promise<{ revoked: number }> {
  const u = await findUser(id);
  const revoked = await revokeTokensOf(id);
  await writeAudit(req, { action: 'user.revoke_tokens', targetType: 'user', targetId: String(id), targetLabel: personRef(u).name, details: { revoked } });
  return { revoked };
}
