/** The audit log, newest first (routes prepend to it as the owner acts). */
import type { AdminAuditEntry } from '@tbot/shared';

import { DAY, iso } from './clock';
import { groups } from './groups';
import { people } from './people';
import { oid } from './random';

const g = (name: string) => groups.find((x) => x.name === name)!;

export const auditLog: AdminAuditEntry[] = [
  { id: oid(9001), at: iso(9 * DAY), action: 'group.suspend', summary: 'Suspended group “Old Startup HQ”', targetType: 'group', targetId: g('Old Startup HQ').id, targetLabel: 'Old Startup HQ', reason: 'Paused until the team confirms they still need it.', details: { notifiedGroup: true } },
  { id: oid(9002), at: iso(20 * DAY), action: 'group.reject', summary: 'Rejected group “Crypto Signals 💰”', targetType: 'group', targetId: g('Crypto Signals 💰').id, targetLabel: 'Crypto Signals 💰', reason: 'Not a work group.', details: { notifiedGroup: true } },
  { id: oid(9003), at: iso(30 * DAY), action: 'group.ai', summary: 'Changed AI limits for group “Indie Game Jam”', targetType: 'group', targetId: g('Indie Game Jam').id, targetLabel: 'Indie Game Jam', reason: null, details: { disabled: true }, changes: ['AI turned off'] },
  { id: oid(9004), at: iso(6 * DAY), action: 'settings.ai.update', summary: 'Changed AI settings', targetType: 'settings', targetId: null, targetLabel: 'AI settings', reason: null, details: {
      before: { dailyCallLimit: 500, dailyBudgetUsd: null, alertAtPercent: 80, userDailyLimit: 40, pricing: {} },
      after: { dailyCallLimit: 400, dailyBudgetUsd: 1.5, alertAtPercent: 80, userDailyLimit: 40, pricing: { 'gemini-2.5-flash': { input: 0.3, cachedInput: 0.03, output: 2.5 } } },
    },
    changes: ['Daily AI call limit: 500 → 400', 'Daily budget: none → $1.50', 'gemini-2.5-flash cached input: $0.075 → $0.03 per 1M tokens'] },
  { id: oid(9005), at: iso(2 * 3_600_000), action: 'auth.login', summary: 'Signed in to the admin app', targetType: 'session', targetId: null, targetLabel: null, reason: null, details: { browser: 'Chrome on Mac', ip: '113.161.42.7' }, changes: ['Chrome on Mac · 113.161.42.7'] },
  { id: oid(9010), at: iso(3 * DAY), action: 'auth.login', summary: 'Signed in to the admin app', targetType: 'session', targetId: null, targetLabel: null, reason: null, details: { browser: 'Safari on iPhone', ip: '27.72.98.15' }, changes: ['Safari on iPhone · 27.72.98.15'] },
  { id: oid(9006), at: iso(40 * DAY), action: 'group.approve', summary: 'Approved group “Research Lab”', targetType: 'group', targetId: g('Research Lab').id, targetLabel: 'Research Lab', reason: null, details: null },
  { id: oid(9008), at: iso(14 * DAY), action: 'group.reject', summary: 'Rejected group “Book Club Planning”', targetType: 'group', targetId: g('Book Club Planning').id, targetLabel: 'Book Club Planning', reason: 'Looks like a personal chat, not a work team.', details: null },
  { id: oid(9009), at: iso(8 * DAY), action: 'group.delete', summary: 'Deleted group “Weekend Hikers”', targetType: 'group', targetId: oid(8_888), targetLabel: 'Weekend Hikers', reason: null, details: null, changes: ['Removed 41 tasks, 2 epics, 9 member links and 120 activity entries; revoked 1 MCP token'] },
  { id: oid(9007), at: iso(4 * DAY), action: 'user.revoke_tokens', summary: 'Revoked all MCP tokens of Tom Becker', targetType: 'user', targetId: people[6]!.id, targetLabel: 'Tom Becker', reason: null, details: { revoked: 2 }, changes: ['2 tokens revoked'] },
].sort((a, b) => b.at.localeCompare(a.at)) as AdminAuditEntry[];

/** Prepend an entry the way the API records the owner's actions. */
export function recordAudit(entry: Omit<AdminAuditEntry, 'id' | 'at' | 'targetId' | 'reason'> & { targetId?: string | null; reason?: string | null; at?: string; id?: string }) {
  auditLog.unshift({ id: `mock-${Date.now()}`, at: new Date().toISOString(), reason: null, targetId: null, ...entry });
}
