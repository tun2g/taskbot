import { ApiToken, Epic, Group, TaskActivity, UsageEvent } from '@tbot/db';
import type { AdminGroupDetail, AdminRange, UsageChannel, UsageKind } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';
import { BOT_IN_CHAT } from 'src/routes/group-actions';
import { groupRows, iso, LeanGroup } from 'src/routes/group-rows';
import { telegram } from 'src/shared/telegram';
import { breakdownRows, featureLabel } from 'src/stats/breakdown';
import { aiTotalsBy, dailySeries, lastRolledDay } from 'src/stats/queries';
import { rangeWindows } from 'src/stats/range';

/** Public link + fresh member count from Telegram (best effort; only while the bot is in the chat). */
async function telegramFacts(g: LeanGroup): Promise<{ publicLink: string | null; memberCount: number | null }> {
  if (!BOT_IN_CHAT.includes(g.status)) return { publicLink: null, memberCount: g.memberCount ?? null };
  const [chat, count] = await Promise.all([telegram.getChat(g.telegramGroupId), telegram.getChatMemberCount(g.telegramGroupId)]);
  const memberCount = count.ok ? count.result : (g.memberCount ?? null);
  if (count.ok && count.result !== g.memberCount) await Group.updateOne({ _id: g._id }, { $set: { memberCount: count.result } });
  return { publicLink: chat.ok && chat.result.username ? `https://t.me/${chat.result.username}` : null, memberCount };
}

/** Everything the group page shows, as numbers (never task titles, descriptions or message text). */
export async function groupDetail(g: LeanGroup, range: AdminRange): Promise<AdminGroupDetail> {
  const id = g._id;
  const { current: window } = rangeWindows(range);
  const inRange = { $gte: window.start, $lt: window.end };
  const now = new Date();

  const [[row], facts, lastRolled, epics, activities, activeTokens, aiFeature, usageRaw] = await Promise.all([
    groupRows([g], now),
    telegramFacts(g),
    lastRolledDay(now),
    Epic.countDocuments({ groupId: id }),
    TaskActivity.countDocuments({ groupId: id }),
    ApiToken.countDocuments({ groupId: id, revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }),
    aiTotalsBy({ groupId: id, createdAt: inRange }, 'feature'),
    UsageEvent.aggregate([
      { $match: { groupId: id, createdAt: inRange } },
      { $group: { _id: { channel: '$channel', kind: '$kind' }, count: { $sum: 1 } } },
    ]),
  ]);
  const daily = await dailySeries(window, id, lastRolled);

  return {
    ...row,
    memberCount: facts.memberCount,
    timezone: g.timezone || 'UTC',
    approvedAt: iso(g.approvedAt),
    botLeftAt: iso(g.botLeftAt),
    statusBeforeLeft: g.status === GroupStatus.LEFT ? (g.statusBeforeLeft ?? null) : null,
    migratedToChatId: g.migratedToChatId ?? null,
    publicLink: facts.publicLink,
    counts: { epics, activities, activeTokens },
    daily,
    aiByFeature: breakdownRows(aiFeature, featureLabel),
    aiRefused: [...aiFeature.values()].reduce((n, t) => n + (t.refused ?? 0), 0),
    usage: usageRaw
      .map((u) => ({ channel: u._id.channel as UsageChannel, kind: u._id.kind as UsageKind, count: u.count as number }))
      .sort((a, b) => b.count - a.count),
  };
}
