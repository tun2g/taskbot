/**
 * AI requests refused before reaching the model. Two sources, never counted twice:
 *  - ai_calls with status "quota" (the bot-wide daily cap) or "disabled" (AI turned off by the owner);
 *  - usage events of kind rate_limited from the bot's AI limiters (the person's daily / burst limit, the group's
 *    limit). The bot-wide cap also logs a rate_limited event; it is left out here because its ai_call counts it.
 */
import { AiCall, UsageEvent } from '@tbot/db';
import type { AdminAiRefusalReason } from '@tbot/shared';
import { AI_LIMITER, UsageKind } from '@tbot/shared';

const LIMITER_REASON: Record<string, AdminAiRefusalReason> = {
  [AI_LIMITER.personDaily]: 'person_limit',
  [AI_LIMITER.personBurst]: 'person_burst',
  [AI_LIMITER.groupDaily]: 'group_limit',
  [AI_LIMITER.groupBurst]: 'group_limit',
};
const STATUS_REASON: Record<string, AdminAiRefusalReason> = { quota: 'bot_limit', disabled: 'ai_off' };

export const AI_LIMITER_EVENT_NAMES = Object.keys(LIMITER_REASON);
export const REFUSAL_REASONS: AdminAiRefusalReason[] = ['person_limit', 'person_burst', 'group_limit', 'bot_limit', 'ai_off'];

export type ReasonCounts = Partial<Record<AdminAiRefusalReason, number>>;

export const sumReasons = (r: ReasonCounts | undefined) => Object.values(r ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0);

/**
 * Refusals matching `match` (createdAt / userId / groupId only — fields both collections have), keyed by
 * `by` ("" = not tied to a person / group, or everything when `by` is null).
 */
export async function refusalsBy(match: Record<string, unknown>, by: 'userId' | 'groupId' | null): Promise<Map<string, ReasonCounts>> {
  const key = by ? `$${by}` : null;
  const [calls, events] = await Promise.all([
    AiCall.aggregate([
      { $match: { ...match, status: { $in: Object.keys(STATUS_REASON) } } },
      { $group: { _id: { k: key, r: '$status' }, n: { $sum: 1 } } },
    ]),
    UsageEvent.aggregate([
      { $match: { ...match, kind: UsageKind.RATE_LIMITED, name: { $in: AI_LIMITER_EVENT_NAMES } } },
      { $group: { _id: { k: key, r: '$name' }, n: { $sum: 1 } } },
    ]),
  ]);
  const out = new Map<string, ReasonCounts>();
  const add = (rows: { _id?: { k?: unknown; r?: string }; n: number }[], reasonOf: Record<string, AdminAiRefusalReason>) => {
    for (const row of rows ?? []) {
      const reason = reasonOf[String(row._id?.r)];
      if (!reason) continue;
      const k = row._id?.k == null ? '' : String(row._id.k);
      const cur = out.get(k) ?? {};
      cur[reason] = (cur[reason] ?? 0) + row.n;
      out.set(k, cur);
    }
  };
  add(calls, STATUS_REASON);
  add(events, LIMITER_REASON);
  return out;
}

/** Everything matching `match`, by reason (in REFUSAL_REASONS order, zeros left out). */
export async function refusalTotals(match: Record<string, unknown>): Promise<{ total: number; byReason: { reason: AdminAiRefusalReason; count: number }[] }> {
  const all = (await refusalsBy(match, null)).get('') ?? {};
  const byReason = REFUSAL_REASONS.filter((r) => (all[r] ?? 0) > 0).map((reason) => ({ reason, count: all[reason]! }));
  return { total: sumReasons(all), byReason };
}
