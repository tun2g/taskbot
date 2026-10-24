import { GroupStatus, statusesInCategory, TaskStatusCategory } from '@tbot/shared';
import Bull from 'bull';
import { bot } from 'src/bot';
import {
  escapeMarkdown,
  groupTimezone,
  hourIn,
  mdName,
  populatedUser,
  statusWord,
  todayIn,
  truncate,
} from 'src/bot/task-card.renderer';
import { Group, IGroup } from 'src/database/models/group.model';
import { Task } from 'src/database/models/task.model';
import { taskService } from 'src/database/services/task.service';
import logger from 'src/shared/logger/logger';
import { groupMessengerService } from 'src/shared/services/group-messenger.service';
import { redisService } from 'src/shared/services/redis.service';
import { boardButton, taskNumberMarkdown } from 'src/shared/utils/app-links';

/** Local hour (in each group's timezone) at which the daily digest goes out. */
export const DIGEST_HOUR = 9;
const MAX_OVERDUE_LINES = 5;

function categoryTotal(stats: Record<string, number>, category: TaskStatusCategory): number {
  return statusesInCategory(category).reduce((sum, status) => sum + (stats[status] || 0), 0);
}

/** " (2 in review, 1 pending)" — breakdown of the non-headline statuses in a category. */
function breakdown(stats: Record<string, number>, category: TaskStatusCategory, headline: string): string {
  const parts = statusesInCategory(category)
    .filter((status) => status !== headline && stats[status])
    .map((status) => `${stats[status]} ${statusWord(status).toLowerCase()}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/** Claim today's digest for a group; false when it was already sent (idempotent across retries/hours). */
async function claimDigest(group: IGroup, day: string): Promise<boolean> {
  try {
    const result = await redisService.set(`digest:${group._id}:${day}`, '1', { NX: true, EX: 2 * 24 * 60 * 60 });
    return result === 'OK';
  } catch (error) {
    logger.warn(`[DigestJob] Redis claim failed for ${group._id}: ${error}`);
    return true;
  }
}

export async function buildDigest(
  group: IGroup,
  now: Date = new Date(),
): Promise<{ text: string; buttons: { text: string; url: string }[][] } | null> {
  const tz = groupTimezone(group);
  const stats = await taskService.getTaskStats(group._id);
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const doneLast24h = await Task.countDocuments({
    groupId: group._id,
    status: 'done',
    completedAt: { $gte: since },
  });

  const todo = categoryTotal(stats, TaskStatusCategory.TODO);
  const inProgress = categoryTotal(stats, TaskStatusCategory.IN_PROGRESS);
  const open = todo + inProgress;
  if (open === 0 && doneLast24h === 0) return null;

  // Overdue = due day strictly before today in the group's timezone.
  const startOfToday = new Date(`${todayIn(tz, now)}T00:00:00Z`);
  const overdueQuery = { groupId: group._id, status: { $nin: statusesInCategory(TaskStatusCategory.DONE) }, dueDate: { $ne: null, $lt: startOfToday } };
  const [overdueCount, overdueTasks] = await Promise.all([
    Task.countDocuments(overdueQuery),
    Task.find(overdueQuery).populate('assigneeId').sort({ dueDate: 1 }).limit(MAX_OVERDUE_LINES),
  ]);

  const lines = [
    `📊 *Daily summary* · ${escapeMarkdown(group.groupName)}`,
    `📝 To do: *${todo}*${breakdown(stats, TaskStatusCategory.TODO, 'todo')}`,
    `🔄 In progress: *${inProgress}*${breakdown(stats, TaskStatusCategory.IN_PROGRESS, 'in_progress')}`,
    `✅ Done in the last 24h: *${doneLast24h}*`,
  ];

  // url button only — web_app buttons are rejected in groups.
  const board = boardButton(group._id.toString());

  if (overdueCount > 0) {
    lines.push(`⚠️ Overdue: *${overdueCount}*`);
    for (const task of overdueTasks) {
      const assignee = populatedUser(task.assigneeId);
      lines.push(
        `• ${taskNumberMarkdown(task.taskNumber, group._id, task._id)} ${escapeMarkdown(truncate(task.title, 60))} — ${assignee ? mdName(assignee) : 'unassigned'}`,
      );
    }
    if (overdueCount > overdueTasks.length) {
      const more = overdueCount - overdueTasks.length;
      lines.push(`…and ${more} more — ${board ? `tap ${board.text} below` : 'see them with /list'}`);
    }
  }

  const buttons = board && 'url' in board ? [[{ text: board.text, url: board.url }]] : [];

  return { text: lines.join('\n'), buttons };
}

export async function processDigestJob(_job: Bull.Job): Promise<void> {
  logger.info('[DigestJob] Checking which groups are due for their daily digest...');

  try {
    const now = new Date();
    // Only groups that get service: pending / suspended / removed groups get no digest.
    const groups = await Group.find({ status: GroupStatus.ACTIVE });
    let sent = 0;

    for (const group of groups) {
      const tz = groupTimezone(group);
      if (hourIn(tz, now) !== DIGEST_HOUR) continue;

      try {
        const digest = await buildDigest(group, now);
        if (!digest) continue;
        if (!(await claimDigest(group, todayIn(tz, now)))) continue;

        // Forums: the "Task events" topic (General if there is none).
        await groupMessengerService.sendEvent(bot.telegram, group, digest.text, {
          extra: {
            parse_mode: 'Markdown',
            link_preview_options: { is_disabled: true },
            reply_markup: digest.buttons.length ? { inline_keyboard: digest.buttons } : undefined,
          },
        });
        sent++;
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.warn(`[DigestJob] Could not send digest to group ${group.telegramGroupId}: ${errMsg}`);
      }
    }

    logger.info(`[DigestJob] Sent ${sent} digest(s)`);
  } catch (error) {
    logger.error(`[DigestJob] Error: ${error}`);
    throw error;
  }
}
