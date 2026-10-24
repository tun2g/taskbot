/** AI usage and cost: breakdowns, individual calls, refusals and per-group / per-person overrides. */
import type { AiCallStatus, AiFeature, UsageChannel } from '../../constants/group.js';
import type { AdminGroupRef, AdminPersonRef, AdminRange } from './common.js';

export interface AdminAiBreakdownRow {
  /** feature id / model id / group id / user id / day, depending on groupBy. */
  key: string;
  /** Human label (feature label, model id, group name, person name, day). */
  label: string;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Calls whose model had no price — cost is a lower bound when > 0. */
  unpriced: number;
  /** Requests refused before reaching the model (a daily limit, or AI turned off) — not in calls / failed. */
  refused?: number;
}

/**
 * GET /ai/usage?range=30d&groupBy=day|feature|model|group|user&groupId=&userId= — rows always add up to `totals`
 * (calls without a group / person get a row with key "none"). `totals.refused` counts every refusal (see AdminAiRefusalReason).
 */
export interface AdminAiUsage {
  range: AdminRange;
  groupBy: 'day' | 'feature' | 'model' | 'group' | 'user';
  totals: Omit<AdminAiBreakdownRow, 'key' | 'label'>;
  rows: AdminAiBreakdownRow[];
  /** Refusals in the range, by reason (sums to totals.refused). */
  refusedByReason?: { reason: AdminAiRefusalReason; count: number }[];
}

/** GET /ai/calls?status=&feature=&groupId=&userId=&page=&limit= — the individual calls behind any total. */
export interface AdminAiCallRow {
  id: string;
  at: string;
  feature: AiFeature;
  provider: string;
  model: string;
  status: AiCallStatus;
  attempt: number;
  latencyMs: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  priced: boolean;
  group: AdminGroupRef | null;
  person: AdminPersonRef | null;
  channel: UsageChannel | null;
  error: string | null;
}

/**
 * Why an AI request was refused before reaching the model: their own daily limit, too many in a row, the group's
 * limit, the bot-wide daily cap, or AI turned off by you.
 */
export type AdminAiRefusalReason = 'person_limit' | 'person_burst' | 'group_limit' | 'bot_limit' | 'ai_off';

/** GET /ai/refused?by=person|group&range=&groupId=&userId=&page=&limit= — who was refused, most first (paginated). */
export interface AdminAiRefusalRow {
  /** Set when by=person (null = not tied to a person). */
  person?: AdminPersonRef | null;
  /** Set when by=group (null = not tied to a group). */
  group?: AdminGroupRef | null;
  count: number;
  byReason: Partial<Record<AdminAiRefusalReason, number>>;
}

/** PATCH /groups/:id/ai and /users/:id/ai → AdminAiOverrideResult */
export interface AdminAiOverrideInput {
  disabled?: boolean;
  /** null = default limits; otherwise at least 1 (turning AI off is `disabled`). */
  dailyLimit?: number | null;
  /** Why (kept with the override, shown next to it and told to the person when the bot refuses). Cleared when back to defaults. */
  reason?: string;
}

/** PATCH /groups/:id/ai and /users/:id/ai respond with the row plus these. */
export interface AdminAiOverrideResult {
  appliesWithinSeconds: number;
  auditId: string | null;
}
