/** A person as a People row, with the owner's AI overrides (changed by PATCH /users/:id/ai). */
import type { AdminRange, AdminUserRow } from '@tbot/shared';

import { DAY, groups, iso, people, personRef } from '../fixtures';
import { HttpError } from '../http';

import { personTotals } from './person';
import { activeTokensOf } from './tokens';

/** AI overrides saved in this session, by person id. */
export const userOverrides = new Map<string, Partial<AdminUserRow>>();

export function userRow(i: number, range: AdminRange = '30d'): AdminUserRow {
  const p = people[i]!;
  const memberOf = groups.filter((g) => g.seed.members.includes(i));
  const last = memberOf.map((g) => g.lastActivityAt).filter(Boolean).sort().pop() ?? null;
  return {
    person: personRef(p),
    groups: memberOf.length,
    lastSeenAt: last,
    range,
    totals: personTotals(i, range),
    activeTokens: activeTokensOf(p.id),
    aiDisabled: i === 10,
    aiDailyLimit: i === 3 ? 10 : null,
    aiReason: i === 10 ? 'Kept pasting customer data into /ai — off until we talk.' : i === 3 ? 'Trial account' : null,
    createdAt: iso(p.createdDaysAgo * DAY),
    ...userOverrides.get(p.id),
  };
}

export function personIndex(id: string): number {
  const i = people.findIndex((p) => p.id === id);
  if (i < 0) throw new HttpError(404, 'This person was not found.');
  return i;
}
