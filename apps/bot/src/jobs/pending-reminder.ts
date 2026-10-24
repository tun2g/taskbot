import { GroupStatus } from '@tbot/shared';
import { configService } from 'src/configs/configuration';
import { Group } from 'src/database/models/group.model';
import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';
import type { OwnerNotifier } from 'src/jobs/ai-alerts';

/** A group counts as forgotten after this long without a decision ("usually within a day" in the group notice). */
export const PENDING_REMIND_AFTER_HOURS = 24;
const MAX_LISTED = 5;

export interface PendingLine {
  name: string;
  hoursWaiting: number;
}

const waited = (hours: number) => (hours < 48 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)} days`);

/** The owner's once-a-day nudge about groups still waiting for a decision. */
export function pendingReminderText(groups: PendingLine[], adminUrl?: string | null): string {
  const shown = groups.slice(0, MAX_LISTED);
  const lines = [
    `⏳ ${groups.length === 1 ? '1 group has' : `${groups.length} groups have`} been waiting for your approval for over a day — they told their members it usually takes less:`,
    '',
    ...shown.map((g) => `• ${g.name} — waiting ${waited(g.hoursWaiting)}`),
    ...(groups.length > shown.length ? [`…and ${groups.length - shown.length} more`] : []),
    '',
    adminUrl ? `Decide here: ${adminUrl}/groups?status=pending` : 'Send /start to get their approval cards again.',
  ];
  return lines.join('\n');
}

/** Hourly check; DMs the owner at most once per UTC day while something has waited over a day. */
export async function remindOwnerOfPendingGroups(notify: OwnerNotifier, now = new Date()): Promise<boolean> {
  const ownerId = configService.botOwnerTelegramId;
  if (!ownerId) return false;
  const cutoff = new Date(now.getTime() - PENDING_REMIND_AFTER_HOURS * 3600_000);
  const groups = await Group.find({ status: GroupStatus.PENDING, addedAt: { $lte: cutoff } })
    .sort({ addedAt: 1 })
    .select('groupName addedAt')
    .lean<{ groupName: string; addedAt: Date }[]>();
  if (!groups.length) return false;
  const claimed = await redisService.set(`pending-reminder:${now.toISOString().slice(0, 10)}`, '1', { NX: true, EX: 2 * 24 * 3600 });
  if (claimed !== 'OK') return false;
  const lines = groups.map((g) => ({ name: g.groupName, hoursWaiting: (now.getTime() - new Date(g.addedAt).getTime()) / 3600_000 }));
  try {
    await notify(ownerId, pendingReminderText(lines, configService.adminUrl || null));
  } catch (error) {
    logger.warn(`[PendingReminder] Could not DM the owner: ${error}`);
  }
  return true;
}
