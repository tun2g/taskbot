import type { AdminAiOverrideInput } from '@tbot/shared';

type Override = { disabled?: boolean | null; dailyLimit?: number | null; reason?: string | null } | null | undefined;

/**
 * The $set for PATCH /groups/:id/ai and /users/:id/ai. The reason belongs to the override: a new one replaces
 * it, leaving it out keeps it, and going back to the defaults (AI on, no limit) clears it.
 */
export function aiOverrideSet(input: AdminAiOverrideInput, before: Override): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (input.disabled !== undefined) set['ai.disabled'] = input.disabled;
  if (input.dailyLimit !== undefined) set['ai.dailyLimit'] = input.dailyLimit;
  const disabled = input.disabled ?? !!before?.disabled;
  const limit = input.dailyLimit !== undefined ? input.dailyLimit : (before?.dailyLimit ?? null);
  if (!disabled && limit == null) set['ai.reason'] = null;
  else if (input.reason !== undefined) set['ai.reason'] = input.reason.trim() || null;
  return set;
}

/** before / after snapshot for the audit entry. */
export const overrideSnapshot = (ai: Override) => ({ disabled: !!ai?.disabled, dailyLimit: ai?.dailyLimit ?? null, reason: ai?.reason ?? null });
