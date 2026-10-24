import type { AdminRange, AdminUserAiToday, AdminUserDetail, AdminUserGroupRow } from '@tbot/shared';
import { AI_DEFAULT_USER_DAILY_LIMIT } from '@tbot/shared';
import { Types } from 'mongoose';
import { loadAiSettings } from 'src/modules/settings/settings.service';
import { rangeMatch } from 'src/modules/users/helpers/range-match';
import { userRows } from 'src/modules/users/services/rows.service';
import { eventCountsByDay, findMemberships, LeanUserDoc, personDailyAiCount } from 'src/modules/users/users.repository';
import { iso } from 'src/shared/format';
import { loadGroupRefs } from 'src/shared/refs';
import { roundUsd } from 'src/stats/aggregate';
import { breakdownRows, featureLabel } from 'src/stats/breakdown';
import { AiTotals, aiTotalsBy, DAY_EXPR, eventCountsBy } from 'src/stats/queries';
import { dayOf, lastDays } from 'src/stats/range';
import { refusalsBy, sumReasons } from 'src/stats/refusals';

/** Their own daily AI limit today: the limiter's count (shared Redis), the limit in force and today's refusals. */
export async function aiToday(u: LeanUserDoc, now = new Date()): Promise<AdminUserAiToday> {
  const [settings, refused, count] = await Promise.all([
    loadAiSettings(),
    refusalsBy({ userId: u._id, createdAt: { $gte: lastDays(1, now).start } }, null),
    personDailyAiCount(u.telegramUserId, dayOf(now)),
  ]);
  const own = u.ai?.dailyLimit;
  const limit = typeof own === 'number' ? own : (settings.userDailyLimit ?? AI_DEFAULT_USER_DAILY_LIMIT);
  const limitSource = typeof own === 'number' ? 'override' : settings.userDailyLimit != null ? 'settings' : 'built_in';
  // The limiter counts refused requests too; "used" is what counted toward the limit.
  const used = count == null || !Number.isFinite(count) ? null : Math.min(count, limit);
  return { used, refused: sumReasons(refused.get('')), limit, limitSource };
}

/**
 * Every group with activity in the range (even one they left) plus their current groups, and a "No group" row,
 * so the rows add up to the person's totals.
 */
async function groupList(
  memberships: { groupId: Types.ObjectId; joinedAt?: Date }[],
  events: Map<string, number>,
  ai: Map<string, AiTotals>,
): Promise<AdminUserGroupRow[]> {
  const joined = new Map(memberships.map((m) => [String(m.groupId), m.joinedAt]));
  const ids = new Set([...joined.keys(), ...events.keys(), ...ai.keys()].filter(Boolean));
  const refs = await loadGroupRefs(ids);
  const row = (key: string): AdminUserGroupRow => ({
    group: key ? (refs.get(key) ?? null) : null,
    member: joined.has(key),
    joinedAt: iso(joined.get(key)),
    events: events.get(key) ?? 0,
    aiCalls: ai.get(key)?.calls ?? 0,
    aiCostUsd: roundUsd(ai.get(key)?.costUsd ?? 0),
  });
  const rows = [...ids]
    .filter((g) => refs.has(g))
    .map(row)
    .sort((a, b) => b.events - a.events || (a.group?.name ?? '').localeCompare(b.group?.name ?? ''));
  const none = row('');
  if (none.events + none.aiCalls > 0 || none.aiCostUsd > 0) rows.push(none);
  return rows;
}

/** GET /users/:id — every number from the same window as `totals`. */
export async function userDetail(u: LeanUserDoc, range: AdminRange, now = new Date()): Promise<AdminUserDetail> {
  const { window, createdAt } = rangeMatch(range, now);
  const match = { userId: u._id, createdAt };
  const [[row], memberships, eventsByGroup, aiByGroup, aiByFeature, aiByDay, eventsByDay, today] = await Promise.all([
    userRows([u], range, now),
    findMemberships(u._id),
    eventCountsBy(match, 'groupId'),
    aiTotalsBy(match, 'groupId'),
    aiTotalsBy(match, 'feature'),
    aiTotalsBy(match, DAY_EXPR('createdAt')),
    eventCountsByDay(match),
    aiToday(u, now),
  ]);
  const eventsDay = new Map(eventsByDay.map((e) => [String(e._id), e.n as number]));
  return {
    ...row,
    groupList: await groupList(memberships, eventsByGroup, aiByGroup),
    daily: window.days.map((day) => ({
      day,
      events: eventsDay.get(day) ?? 0,
      aiCalls: aiByDay.get(day)?.calls ?? 0,
      aiCostUsd: roundUsd(aiByDay.get(day)?.costUsd ?? 0),
    })),
    aiByFeature: breakdownRows(aiByFeature, featureLabel),
    aiToday: today,
  };
}
