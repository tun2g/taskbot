/** AI usage & cost: breakdowns, who was refused, and the individual calls. */
import type { AdminAiCallRow, AdminAiRefusalReason, AdminAiUsage, AdminRange } from '@tbot/shared';
import { AI_FEATURE_LABELS, GroupStatus } from '@tbot/shared';

import { breakdown, emptyBreakdown, totals } from '../derive/ai';
import { liveRef, ref } from '../derive/group-row';
import { countReasons, type MockRefusal, refusals } from '../derive/refusals';
import { aiCalls, days, groups, inRange, people, personRef } from '../fixtures';
import { paginate, rangeOf, type Route } from '../http';

const KEY_OF: Record<AdminAiUsage['groupBy'], (c: AdminAiCallRow) => [string, string]> = {
  day: (c) => [c.at.slice(0, 10), c.at.slice(0, 10)],
  feature: (c) => [c.feature, AI_FEATURE_LABELS[c.feature]],
  model: (c) => [c.model, c.model],
  group: (c) => [c.group?.id ?? 'none', liveRef(c.group)?.name ?? 'No group'],
  user: (c) => [c.person?.id ?? 'none', c.person?.name ?? 'Unknown'],
};

const REASON_ORDER: AdminAiRefusalReason[] = ['person_limit', 'person_burst', 'group_limit', 'bot_limit', 'ai_off'];

const matchesScope = (c: AdminAiCallRow, q: URLSearchParams) =>
  (!q.get('groupId') || c.group?.id === q.get('groupId')) && (!q.get('userId') || c.person?.id === q.get('userId'));

function usage(q: URLSearchParams): AdminAiUsage {
  const range = rangeOf(q);
  const groupBy = (q.get('groupBy') ?? 'day') as AdminAiUsage['groupBy'];
  const calls = aiCalls.filter((c) => inRange(c.at, range) && matchesScope(c, q));
  let rows = breakdown(calls, KEY_OF[groupBy]);
  if (groupBy === 'day') {
    const map = new Map(rows.map((r) => [r.key, r]));
    rows = days(range).map((d) => map.get(d) ?? emptyBreakdown(d, d));
  } else rows.sort((a, b) => b.costUsd - a.costUsd);
  const refusedRows = refusals({ days: days(range), groupId: q.get('groupId'), userId: q.get('userId') });
  if (groupBy === 'group' || groupBy === 'user') {
    for (const r of rows) r.refused = refusedRows.filter((x) => (groupBy === 'group' ? (x.groupId ?? 'none') : x.personId || 'none') === r.key).length;
  }
  const byReason = countReasons(refusedRows);
  return {
    range,
    groupBy,
    totals: { ...totals(calls), refused: refusedRows.length },
    rows,
    refusedByReason: REASON_ORDER.filter((r) => byReason[r]).map((reason) => ({ reason, count: byReason[reason]! })),
  };
}

function refusedBy(q: URLSearchParams) {
  const by = q.get('by') === 'group' ? 'group' : 'person';
  const list = refusals({ days: days(rangeOf(q)), groupId: q.get('groupId'), userId: q.get('userId') });
  const keys = new Map<string, MockRefusal[]>();
  for (const r of list) {
    const k = by === 'group' ? (r.groupId ?? '') : r.personId;
    keys.set(k, [...(keys.get(k) ?? []), r]);
  }
  const rows = [...keys.entries()]
    .map(([k, rs]) => {
      const g = groups.find((x) => x.id === k);
      const p = people.find((x) => x.id === k);
      const base = { count: rs.length, byReason: countReasons(rs) };
      if (by === 'person') return { ...base, person: p ? personRef(p) : null };
      return { ...base, group: k ? (g ? ref(g) : { id: k, name: 'Deleted group', status: GroupStatus.LEFT, deleted: true }) : null };
    })
    .sort((a, b) => b.count - a.count);
  return paginate(rows, q);
}

function calls(q: URLSearchParams) {
  const range = q.get('range') as AdminRange | null;
  const rows = aiCalls.filter(
    (c) =>
      (!range || inRange(c.at, range)) &&
      (!q.get('status') || c.status === q.get('status')) &&
      (!q.get('feature') || c.feature === q.get('feature')) &&
      matchesScope(c, q),
  );
  const page = paginate(rows, q);
  return { ...page, data: page.data.map((c) => ({ ...c, group: liveRef(c.group) })) };
}

export const aiRoutes: Route[] = [
  ['GET', /^\/ai\/usage$/, ({ q }) => ({ data: usage(q) })],
  ['GET', /^\/ai\/refused$/, ({ q }) => refusedBy(q)],
  ['GET', /^\/ai\/calls$/, ({ q }) => calls(q)],
];
