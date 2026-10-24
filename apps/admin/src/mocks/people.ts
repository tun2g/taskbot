/**
 * Mock People / AI refusals / MCP tokens — every number is derived from the same raw rows, so the People list,
 * the person page, the AI page and the MCP page agree (like the real API).
 */
import type { AdminAiCallRow, AdminAiRefusalReason, AdminMcpTokenRow, AdminPersonTotals, AdminRange, AdminUserGroupRow } from '@tbot/shared';

import { aiCalls, dayStr, groups, iso, people, personRef, refused, settings, trackingSince } from './fixtures';

const DAY = 86_400_000;
const RANGE_DAYS: Record<AdminRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const rangeDays = (range: AdminRange, offset = 0) => Array.from({ length: RANGE_DAYS[range] }, (_, i) => dayStr(RANGE_DAYS[range] - 1 - i + offset));
const inDays = (at: string, days: string[]) => at.slice(0, 10) >= days[0]! && at.slice(0, 10) <= days[days.length - 1]!;

/** Groups a person is in (by index) and "" for actions not tied to a group. */
const scopesOf = (i: number) => [...groups.filter((g) => g.seed.members.includes(i)).map((g) => g.id), ''];

/** Bot actions of one person in one group ("" = no group) on one day. */
export function eventsOn(i: number, groupId: string, day: string): number {
  if (day < trackingSince) return 0;
  return hash(`${people[i]!.id}|${groupId}|${day}`) % (groupId ? 14 : 5);
}

export const callsOf = (i: number, range: AdminRange) => {
  const days = rangeDays(range);
  return aiCalls.filter((c) => c.person?.id === people[i]!.id && inDays(c.at, days));
};

// ── Refusals ────────────────────────────────────────────────────────────────

export interface MockRefusal {
  at: string;
  personId: string;
  groupId: string | null;
  reason: AdminAiRefusalReason;
}

/** Limiter refusals (not AI calls): Duc (10/day limit) runs out most days; Research Lab (50/day) sometimes. */
const limiterRefusals: MockRefusal[] = [];
for (let d = 0; d <= 12; d++) {
  const at = (h: number) => iso(d * DAY + h * 3_600_000);
  for (let k = 0; k < (hash(`duc${d}`) % 4) + (d === 0 ? 2 : 0); k++) limiterRefusals.push({ at: at(k + 1), personId: people[3]!.id, groupId: groups[0]!.id, reason: 'person_limit' });
  if (d % 3 === 0) limiterRefusals.push({ at: at(5), personId: people[8]!.id, groupId: groups[4]!.id, reason: 'group_limit' });
  if (d % 4 === 1) limiterRefusals.push({ at: at(7), personId: people[1]!.id, groupId: groups[1]!.id, reason: 'person_burst' });
}

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

// ── One person's numbers ────────────────────────────────────────────────────

export function personTotals(i: number, range: AdminRange): AdminPersonTotals {
  const days = rangeDays(range);
  const calls = callsOf(i, range).filter((c) => !refused(c.status));
  return {
    events: scopesOf(i).reduce((s, g) => s + days.reduce((t, d) => t + eventsOn(i, g, d), 0), 0),
    aiCalls: calls.length,
    aiFailed: calls.filter((c) => c.status === 'failed' || c.status === 'invalid').length,
    aiCostUsd: calls.reduce((s, c) => s + c.costUsd, 0),
    aiUnpriced: calls.filter((c) => !c.priced).length,
    aiRefused: refusals({ days, userId: people[i]!.id }).length,
  };
}

export function personDaily(i: number, range: AdminRange) {
  const calls = callsOf(i, range).filter((c) => !refused(c.status));
  return rangeDays(range).map((day) => {
    const dc = calls.filter((c) => c.at.startsWith(day));
    return { day, events: scopesOf(i).reduce((s, g) => s + eventsOn(i, g, day), 0), aiCalls: dc.length, aiCostUsd: dc.reduce((s, c) => s + c.costUsd, 0) };
  });
}

/** Their groups plus "No group"; the rows add up to personTotals. */
export function personGroups(i: number, range: AdminRange): AdminUserGroupRow[] {
  const days = rangeDays(range);
  const calls = callsOf(i, range).filter((c) => !refused(c.status));
  return scopesOf(i)
    .map((gid) => {
      const g = groups.find((x) => x.id === gid);
      const mine = calls.filter((c) => (c.group?.id ?? '') === gid);
      return {
        group: g ? { id: g.id, name: g.name, status: g.status } : null,
        member: !!g,
        joinedAt: g ? iso((g.seed.addedDaysAgo - 1) * DAY) : null,
        events: days.reduce((t, d) => t + eventsOn(i, gid, d), 0),
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

// ── MCP tokens ──────────────────────────────────────────────────────────────

/** Every token ever made, newest first: active ones per person, plus revoked / expired history. */
export const tokens: AdminMcpTokenRow[] = people
  .flatMap((p, i) => {
    const g = groups.find((x) => x.seed.members.includes(i));
    const active = i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0;
    const make = (k: number, status: AdminMcpTokenRow['status']): AdminMcpTokenRow => ({
      id: `6720${String(i * 10 + k).padStart(20, '0')}`,
      name: ['Claude Desktop', 'Cursor (work laptop)', 'Claude Code', 'Old laptop'][k % 4]!,
      prefix: `tbot_${p.id.slice(-4)}${k}`,
      person: personRef(p),
      group: k % 2 === 0 && g ? { id: g.id, name: g.name, status: g.status } : null,
      lastUsedAt: i === 9 ? null : iso((k + 1) * (i + 1) * 3_600_000),
      createdAt: iso((20 + k * 7 + i) * DAY),
      expiresAt: status === 'expired' ? iso(5 * DAY) : k === 1 ? iso(-60 * DAY) : null,
      status,
      revokedAt: status === 'revoked' ? iso((3 + k) * DAY) : null,
    });
    const history = i % 2 === 0 ? [make(2, 'revoked'), make(3, 'expired')] : i % 5 === 1 ? [make(3, 'revoked')] : [];
    return [...Array.from({ length: active }, (_, k) => make(k, 'active')), ...history];
  })
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const activeTokensOf = (personId: string) => tokens.filter((t) => t.status === 'active' && t.person?.id === personId).length;

export function tokenQuery(q: URLSearchParams): AdminMcpTokenRow[] {
  const status = q.get('status') ?? 'active';
  const userId = q.get('userId');
  const search = q.get('q')?.toLowerCase().replace(/^@/, '');
  const rows = tokens.filter(
    (t) =>
      (status === 'ended' ? t.status !== 'active' : t.status === status) &&
      (!userId || t.person?.id === userId) &&
      (!search || [t.name, t.prefix, t.person?.name ?? '', t.person?.username ?? ''].some((s) => s.toLowerCase().includes(search))),
  );
  return status === 'active' ? rows : [...rows].sort((a, b) => (b.revokedAt ?? b.expiresAt ?? '').localeCompare(a.revokedAt ?? a.expiresAt ?? ''));
}
