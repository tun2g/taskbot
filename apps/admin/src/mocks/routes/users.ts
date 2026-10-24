/** People: the list, one person, their AI override and "revoke all tokens". */
import type { AdminUserDetail, AdminUserRow } from '@tbot/shared';

import { featureRows } from '../derive/ai';
import { personDaily, personGroups, personToday } from '../derive/person';
import { tokens } from '../derive/tokens';
import { personIndex, userOverrides, userRow } from '../derive/user-row';
import { aiCalls, dayStr, inRange, people, recordAudit } from '../fixtures';
import { HttpError, paginate, rangeOf, type Route, searchOf } from '../http';

const SORTS: Record<string, (a: AdminUserRow, b: AdminUserRow) => number> = {
  lastSeen: (a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''),
  aiCost: (a, b) => b.totals.aiCostUsd - a.totals.aiCostUsd,
  aiCalls: (a, b) => b.totals.aiCalls - a.totals.aiCalls,
  events: (a, b) => b.totals.events - a.totals.events,
  tokens: (a, b) => b.activeTokens - a.activeTokens,
};

function list(q: URLSearchParams) {
  const search = searchOf(q);
  const sort = q.get('sort') ?? 'lastSeen';
  const range = rangeOf(q);
  const windowDays = { today: 1, '7d': 7, '30d': 30 }[q.get('activeIn') ?? ''] ?? 0;
  const since = windowDays ? dayStr(windowDays - 1) : null;
  const rows = people
    .map((_, i) => userRow(i, range))
    .filter((r) => !since || (r.lastSeenAt != null && r.lastSeenAt.slice(0, 10) >= since))
    .filter((r) => !q.get('hasTokens') || r.activeTokens > 0)
    .filter((r) => !search || r.person.name.toLowerCase().includes(search) || r.person.username?.toLowerCase().includes(search));
  return paginate(rows.sort(SORTS[sort] ?? SORTS.lastSeen), q);
}

function detail(id: string, q: URLSearchParams): AdminUserDetail {
  const i = personIndex(id);
  const p = people[i]!;
  const range = rangeOf(q);
  const calls = aiCalls.filter((c) => c.person?.id === p.id && inRange(c.at, range));
  const row = userRow(i, range);
  return {
    ...row,
    groupList: personGroups(i, range),
    daily: personDaily(i, range),
    aiByFeature: featureRows(calls).filter((r) => r.calls > 0),
    aiToday: personToday(i, row.aiDisabled ? null : row.aiDailyLimit),
  };
}

function setAi(id: string, body: Record<string, unknown>) {
  const p = people[personIndex(id)]!;
  const o = userOverrides.get(p.id) ?? {};
  if (typeof body.disabled === 'boolean') o.aiDisabled = body.disabled;
  if ('dailyLimit' in body) {
    if (body.dailyLimit === 0) throw new HttpError(400, 'The daily limit must be at least 1 — to stop AI completely, turn it off instead.');
    o.aiDailyLimit = (body.dailyLimit as number | null) ?? null;
  }
  const row = { ...userRow(personIndex(id)), ...o };
  if (!row.aiDisabled && row.aiDailyLimit == null) o.aiReason = null;
  else if (typeof body.reason === 'string') o.aiReason = body.reason.trim() || null;
  userOverrides.set(p.id, o);
  const auditId = `mock-${Date.now()}`;
  const change = row.aiDisabled ? 'AI turned off' : `Daily AI limit: ${row.aiDailyLimit ?? 'default'}`;
  recordAudit({ id: auditId, action: 'user.ai', summary: `Changed AI limits for user “${p.name}”`, targetType: 'user', targetId: p.id, targetLabel: p.name, reason: o.aiReason ?? null, details: null, changes: [change] });
  return { data: { ...userRow(personIndex(id)), appliesWithinSeconds: 30, auditId } };
}

function revokeTokens(id: string) {
  const i = personIndex(id);
  const mine = tokens.filter((t) => t.status === 'active' && t.person?.id === people[i]!.id);
  for (const t of mine) Object.assign(t, { status: 'revoked', revokedAt: new Date().toISOString() });
  return { data: { revoked: mine.length } };
}

export const userRoutes: Route[] = [
  ['GET', /^\/users$/, ({ q }) => list(q)],
  ['GET', /^\/users\/([^/]+)$/, ({ params, q }) => ({ data: detail(params[0]!, q) })],
  ['PATCH', /^\/users\/([^/]+)\/ai$/, ({ params, body }) => setAi(params[0]!, body)],
  ['POST', /^\/users\/([^/]+)\/revoke-tokens$/, ({ params }) => revokeTokens(params[0]!)],
];
