/** AI requests refused before reaching the model: limiter refusals plus refused AI calls. */
import type { AdminAiCallRow, AdminAiRefusalReason } from '@tbot/shared';

import { aiCalls, DAY, groups, hash, inDays, iso, people, refused } from '../fixtures';

export interface MockRefusal {
  at: string;
  personId: string;
  groupId: string | null;
  reason: AdminAiRefusalReason;
}

/** Limiter refusals (not AI calls): Duc (10/day limit) runs out most days; Research Lab (50/day) sometimes. */
function makeLimiterRefusals(): MockRefusal[] {
  const out: MockRefusal[] = [];
  for (let d = 0; d <= 12; d++) {
    const at = (h: number) => iso(d * DAY + h * 3_600_000);
    for (let k = 0; k < (hash(`duc${d}`) % 4) + (d === 0 ? 2 : 0); k++) out.push({ at: at(k + 1), personId: people[3]!.id, groupId: groups[0]!.id, reason: 'person_limit' });
    if (d % 3 === 0) out.push({ at: at(5), personId: people[8]!.id, groupId: groups[4]!.id, reason: 'group_limit' });
    if (d % 4 === 1) out.push({ at: at(7), personId: people[1]!.id, groupId: groups[1]!.id, reason: 'person_burst' });
  }
  return out;
}

const limiterRefusals = makeLimiterRefusals();

/** Every refusal: limiter ones plus AI calls refused by the bot-wide cap or because AI is off. */
export function refusals(filter: { days: string[]; groupId?: string | null; userId?: string | null }): MockRefusal[] {
  const fromCalls: MockRefusal[] = aiCalls
    .filter((c) => refused(c.status))
    .map((c: AdminAiCallRow) => ({ at: c.at, personId: c.person?.id ?? '', groupId: c.group?.id ?? null, reason: c.status === 'quota' ? 'bot_limit' : 'ai_off' }));
  return [...limiterRefusals, ...fromCalls].filter(
    (r) => inDays(r.at, filter.days) && (!filter.groupId || r.groupId === filter.groupId) && (!filter.userId || r.personId === filter.userId),
  );
}

export function countReasons(rows: MockRefusal[]): Partial<Record<AdminAiRefusalReason, number>> {
  const out: Partial<Record<AdminAiRefusalReason, number>> = {};
  for (const r of rows) out[r.reason] = (out[r.reason] ?? 0) + 1;
  return out;
}
