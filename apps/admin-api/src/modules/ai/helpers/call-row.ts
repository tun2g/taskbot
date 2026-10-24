import type { AdminAiCallRow, AdminGroupRef, AdminPersonRef } from '@tbot/shared';
import type { LeanAiCall } from 'src/modules/ai/ai.repository';
import { iso } from 'src/shared/format';

/** One call as a list row, with its group and person. */
export function callRow(c: LeanAiCall, groups: Map<string, AdminGroupRef>, people: Map<string, AdminPersonRef>): AdminAiCallRow {
  return {
    id: String(c._id),
    at: iso(c.createdAt)!,
    feature: c.feature,
    provider: c.provider,
    model: c.aiModel,
    status: c.status,
    attempt: c.attempt ?? 1,
    latencyMs: c.latencyMs ?? 0,
    inputTokens: c.inputTokens ?? 0,
    cachedTokens: c.cachedTokens ?? 0,
    outputTokens: c.outputTokens ?? 0,
    costUsd: c.costUsd ?? 0,
    priced: c.priced !== false,
    group: c.groupId ? (groups.get(String(c.groupId)) ?? null) : null,
    person: c.userId ? (people.get(String(c.userId)) ?? null) : null,
    channel: c.channel ?? null,
    error: c.error ?? null,
  };
}
