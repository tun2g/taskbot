/**
 * One person's numbers — every number is derived from the same raw rows, so the People list, the person page,
 * the AI page and the MCP page agree (like the real API).
 */
import type { AdminPersonTotals, AdminRange, AdminUserGroupRow } from '@tbot/shared';

import { aiCalls, DAY, dayStr, days, groups, hash, inDays, iso, people, refused, settings, trackingSince } from '../fixtures';

import { refusals } from './refusals';

/** Groups a person is in (by index) and "" for actions not tied to a group. */
const scopesOf = (i: number) => [...groups.filter((g) => g.seed.members.includes(i)).map((g) => g.id), ''];

/** Bot actions of one person in one group ("" = no group) on one day. */
export function eventsOn(i: number, groupId: string, day: string): number {
  if (day < trackingSince) return 0;
  return hash(`${people[i]!.id}|${groupId}|${day}`) % (groupId ? 14 : 5);
}

export const callsOf = (i: number, range: AdminRange) => {
  const list = days(range);
  return aiCalls.filter((c) => c.person?.id === people[i]!.id && inDays(c.at, list));
};

/** Calls that reached the model. */
const sentCallsOf = (i: number, range: AdminRange) => callsOf(i, range).filter((c) => !refused(c.status));

export function personTotals(i: number, range: AdminRange): AdminPersonTotals {
  const list = days(range);
  const calls = sentCallsOf(i, range);
  return {
    events: scopesOf(i).reduce((s, g) => s + list.reduce((t, d) => t + eventsOn(i, g, d), 0), 0),
    aiCalls: calls.length,
    aiFailed: calls.filter((c) => c.status === 'failed' || c.status === 'invalid').length,
    aiCostUsd: calls.reduce((s, c) => s + c.costUsd, 0),
    aiUnpriced: calls.filter((c) => !c.priced).length,
    aiRefused: refusals({ days: list, userId: people[i]!.id }).length,
  };
}

export function personDaily(i: number, range: AdminRange) {
  const calls = sentCallsOf(i, range);
  return days(range).map((day) => {
    const dc = calls.filter((c) => c.at.startsWith(day));
    return { day, events: scopesOf(i).reduce((s, g) => s + eventsOn(i, g, day), 0), aiCalls: dc.length, aiCostUsd: dc.reduce((s, c) => s + c.costUsd, 0) };
  });
}

/** Their groups plus "No group"; the rows add up to personTotals. */
export function personGroups(i: number, range: AdminRange): AdminUserGroupRow[] {
  const list = days(range);
  const calls = sentCallsOf(i, range);
  return scopesOf(i)
    .map((gid) => {
      const g = groups.find((x) => x.id === gid);
      const mine = calls.filter((c) => (c.group?.id ?? '') === gid);
      return {
        group: g ? { id: g.id, name: g.name, status: g.status } : null,
        member: !!g,
        joinedAt: g ? iso((g.seed.addedDaysAgo - 1) * DAY) : null,
        events: list.reduce((t, d) => t + eventsOn(i, gid, d), 0),
        aiCalls: mine.length,
        aiCostUsd: mine.reduce((s, c) => s + c.costUsd, 0),
      };
    })
    .sort((a, b) => (a.group ? 0 : 1) - (b.group ? 0 : 1) || b.events - a.events);
}

export function personToday(i: number, own: number | null) {
  const limit = own ?? settings.userDailyLimit ?? settings.defaults.userDailyLimit;
  const today = callsOf(i, '7d').filter((c) => c.at.startsWith(dayStr(0)) && !refused(c.status)).length;
  const refusedToday = refusals({ days: [dayStr(0)], userId: people[i]!.id });
  // Refused by their own daily limit today → the limit was used up.
  const usedUp = refusedToday.some((r) => r.reason === 'person_limit');
  return { used: usedUp ? limit : Math.min(limit, today), refused: refusedToday.length, limit, limitSource: own != null ? ('override' as const) : ('settings' as const) };
}
