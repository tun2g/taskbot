import type { AdminGroupRow, AdminPersonRef } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';
import { iso } from 'src/shared/format';
import { LeanUser, personRef, statusOf } from 'src/shared/refs';
import { roundUsd } from 'src/stats/aggregate';
import { aiTotalsBy } from 'src/stats/queries';
import { lastDays } from 'src/stats/range';
import {
  findUsersByTelegramIds,
  LeanGroup,
  memberCountsBy,
  migratedTargets,
  previousDecisions,
  taskCountsBy,
} from 'src/modules/groups/groups.repository';

/** Who added the bot, as a person ref (linked to the users collection when they ever used the bot). */
function addedByRef(g: LeanGroup, usersByTg: Map<number, LeanUser>): AdminPersonRef | null {
  if (!g.addedBy) return null;
  const u = usersByTg.get(g.addedBy.telegramUserId);
  if (u) return personRef(u);
  return {
    id: null,
    telegramUserId: g.addedBy.telegramUserId,
    name: g.addedBy.name,
    username: g.addedBy.username || null,
  };
}

/** Turns group docs into list rows (counts and 30-day AI numbers in a few batched queries). */
export async function groupRows(groups: LeanGroup[], now = new Date()): Promise<AdminGroupRow[]> {
  if (!groups.length) return [];
  const ids = groups.map((g) => g._id);
  const tgIds = groups.map((g) => g.addedBy?.telegramUserId).filter((v): v is number => typeof v === 'number');
  const pendingIds = groups.filter((g) => statusOf(g) === GroupStatus.PENDING).map((g) => String(g._id));
  const [members, tasks, ai, adders, decisions, moved] = await Promise.all([
    memberCountsBy(ids),
    taskCountsBy({ groupId: { $in: ids } }),
    aiTotalsBy({ groupId: { $in: ids }, createdAt: { $gte: lastDays(30, now).start } }, 'groupId'),
    findUsersByTelegramIds(tgIds),
    previousDecisions(pendingIds),
    migratedTargets(groups),
  ]);
  const usersByTg = new Map(adders.map((u) => [u.telegramUserId, u]));
  return groups.map((g) => {
    const id = String(g._id);
    const t = tasks.get(id);
    const a = ai.get(id);
    return {
      id,
      name: g.groupName,
      status: statusOf(g),
      telegramGroupId: g.telegramGroupId,
      isForum: !!g.isForum,
      memberCount: g.memberCount ?? null,
      knownMembers: members.get(id) ?? 0,
      tasks: t?.tasks ?? 0,
      openTasks: t?.open ?? 0,
      lastActivityAt: iso(g.lastActivityAt),
      aiCostUsd30d: roundUsd(a?.costUsd ?? 0),
      aiCalls30d: a?.calls ?? 0,
      aiUnpriced30d: a?.unpriced ?? 0,
      ...(moved.has(id) ? { migratedTo: moved.get(id) ?? null } : {}),
      addedBy: addedByRef(g, usersByTg),
      addedAt: iso(g.addedAt),
      statusReason: g.statusReason ?? null,
      statusChangedAt: iso(g.statusChangedAt),
      aiDisabled: !!g.ai?.disabled,
      aiDailyLimit: g.ai?.dailyLimit ?? null,
      aiReason: g.ai?.reason ?? null,
      createdAt: iso(g.createdAt) ?? new Date(0).toISOString(),
      ...(decisions.has(id) ? { previousDecision: decisions.get(id) ?? null } : {}),
    };
  });
}
