import type { AdminGroupDeletePreview, AdminGroupDetail, AdminRange, UsageChannel, UsageKind } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { LeanGroup, setGroupFields } from 'src/modules/groups/groups.repository';
import { findGroup } from 'src/modules/groups/groups.service';
import { BOT_IN_CHAT } from 'src/modules/groups/helpers/group-status';
import {
  countActiveTokens,
  countActivities,
  countGroupDataFor,
  deleteGroupDataFor,
  usageByChannelKind,
} from 'src/modules/groups/repositories/detail.repository';
import { countEpics } from 'src/modules/groups/repositories/tasks.repository';
import { leaveChat } from 'src/modules/groups/services/notices.service';
import { groupRows } from 'src/modules/groups/services/rows.service';
import { writeAudit } from 'src/shared/audit';
import { iso } from 'src/shared/format';
import { HttpError } from 'src/shared/http';
import { telegram } from 'src/shared/telegram';
import { breakdownRows, featureLabel } from 'src/stats/breakdown';
import { aiTotalsBy, dailySeries, lastRolledDay } from 'src/stats/queries';
import { rangeWindows } from 'src/stats/range';

/** Public link + fresh member count from Telegram (best effort; only while the bot is in the chat). */
async function telegramFacts(g: LeanGroup): Promise<{ publicLink: string | null; memberCount: number | null }> {
  if (!BOT_IN_CHAT.includes(g.status)) return { publicLink: null, memberCount: g.memberCount ?? null };
  const [chat, count] = await Promise.all([
    telegram.getChat(g.telegramGroupId),
    telegram.getChatMemberCount(g.telegramGroupId),
  ]);
  const memberCount = count.ok ? count.result : (g.memberCount ?? null);
  if (count.ok && count.result !== g.memberCount) await setGroupFields(g._id, { memberCount: count.result });
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
    countEpics(id),
    countActivities(id),
    countActiveTokens(id, now),
    aiTotalsBy({ groupId: id, createdAt: inRange }, 'feature'),
    usageByChannelKind(id, inRange),
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

/** What deleting the group would remove. */
export async function deletePreview(id: Types.ObjectId): Promise<AdminGroupDeletePreview> {
  const g = await findGroup(id);
  const counts = await countGroupDataFor(id);
  return { group: { id: String(g._id), name: g.groupName, status: g.status }, ...counts };
}

/** The bot leaves the chat first (best effort), then the data is deleted. */
export async function deleteGroup(req: Request, id: Types.ObjectId, confirmName: string) {
  const g = await findGroup(id);
  if (confirmName !== g.groupName) {
    throw new HttpError(400, `The name doesn't match. Type “${g.groupName}” exactly to delete this group.`);
  }
  const warnings: string[] = [];
  if (BOT_IN_CHAT.includes(g.status)) await leaveChat(g.telegramGroupId, warnings);
  const deleted = await deleteGroupDataFor(id);
  await writeAudit(req, {
    action: 'group.delete',
    targetType: 'group',
    targetId: String(id),
    targetLabel: g.groupName,
    details: {
      ...deleted,
      telegramGroupId: g.telegramGroupId,
      statusBefore: g.status,
      ...(warnings.length ? { warnings } : {}),
    },
  });
  return { deleted, warnings };
}
