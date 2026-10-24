/** MCP tokens: every token ever made, newest first (revoking mutates them in place). */
import type { AdminMcpTokenRow } from '@tbot/shared';

import { DAY, groups, iso, type MockPerson, people, personRef } from '../fixtures';

function personTokens(p: MockPerson, i: number): AdminMcpTokenRow[] {
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
}

/** Active ones per person, plus revoked / expired history. */
export const tokens: AdminMcpTokenRow[] = people.flatMap(personTokens).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const activeTokensOf = (personId: string) => tokens.filter((t) => t.status === 'active' && t.person?.id === personId).length;

/** GET /mcp/tokens filters: status (active / revoked / expired / ended), person and search. */
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
