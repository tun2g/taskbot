/** A mock group as the API returns it: refs, list rows and the detail-only extras. */
import type { AdminGroupRef, AdminGroupRow, AdminRange } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';

import { aiCalls, auditLog, groups, type MockGroup, since } from '../fixtures';
import { HttpError } from '../http';

export const ref = (g: MockGroup): AdminGroupRef => ({ id: g.id, name: g.name, status: g.status });

/** Like the real API: a group deleted after the record was written shows as "Deleted group". */
export function liveRef(r: AdminGroupRef | null): AdminGroupRef | null {
  if (!r) return null;
  const g = groups.find((x) => x.id === r.id);
  return g ? ref(g) : { id: r.id, name: 'Deleted group', status: GroupStatus.LEFT, deleted: true };
}

export function findGroup(id: string): MockGroup {
  const g = groups.find((x) => x.id === id);
  if (!g) throw new HttpError(404, 'This group no longer exists.');
  return g;
}

/** Fields the real API adds to every group row: unpriced AI calls (30 days) and where a moved group went. */
function groupRowExtras(g: MockGroup): { aiCalls30d: number; aiUnpriced30d: number; migratedTo?: AdminGroupRef | null } {
  const mine = aiCalls.filter((c) => c.group?.id === g.id && c.status !== 'quota' && c.status !== 'disabled');
  const target = g.migratedToChatId != null ? groups.find((x) => x.telegramGroupId === g.migratedToChatId && x.id !== g.id) : undefined;
  return {
    aiCalls30d: mine.length,
    aiUnpriced30d: mine.filter((c) => !c.priced).length,
    ...(g.status === GroupStatus.MIGRATED ? { migratedTo: target ? ref(target) : null } : {}),
  };
}

const DECISIONS = { 'group.reject': 'rejected', 'group.suspend': 'suspended', 'group.leave': 'removed', 'group.reconsider': 'reconsidered' } as const;

/** Pending groups: the owner's last decision about the group, from the audit log. */
function previousDecision(g: MockGroup): AdminGroupRow['previousDecision'] {
  const last = auditLog.find((e) => e.targetId === g.id && e.action in DECISIONS);
  return last ? { action: DECISIONS[last.action as keyof typeof DECISIONS], at: last.at, reason: last.reason } : null;
}

export function groupRow(g: MockGroup): AdminGroupRow {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { seed, timezone, approvedAt, botLeftAt, migratedToChatId, publicLink, epics, activities, activeTokens, ...base } = g;
  const row: AdminGroupRow = { ...base, ...groupRowExtras(g) };
  if (g.status !== GroupStatus.PENDING) return row;
  return { ...row, previousDecision: previousDecision(g) };
}

/** Detail-only extras: AI refusals in the range and what a re-add restores. */
export function groupDetailExtras(g: MockGroup, range: AdminRange) {
  return {
    aiRefused: aiCalls.filter((c) => c.group?.id === g.id && Date.parse(c.at) >= since(range) && (c.status === 'quota' || c.status === 'disabled')).length,
    statusBeforeLeft: g.status === GroupStatus.LEFT ? (g.seed.statusBeforeLeft ?? GroupStatus.ACTIVE) : null,
  };
}
