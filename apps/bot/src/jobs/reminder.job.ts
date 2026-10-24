import { statusesInCategory, TaskStatusCategory } from '@tbot/shared';
import Bull from 'bull';
import { addDays, dueDay, groupTimezone, hourIn, refId, todayIn } from 'src/bot/task-card.renderer';
import { Group, IGroup } from 'src/database/models/group.model';
import { isGroupActive } from 'src/shared/utils/group-status';
import { Task } from 'src/database/models/task.model';
import { IUser, User } from 'src/database/models/user.model';
import logger from 'src/shared/logger/logger';
import { notificationService, ReminderReason } from 'src/shared/services/notification.service';

const CLOSED_STATUSES = statusesInCategory(TaskStatusCategory.DONE);

/** Reminders go out from this local hour on (in the group's timezone), so nobody is pinged at night. */
export const REMINDER_FROM_HOUR = 9;

/** Documents by id (string) for a list of ids, in one query. */
async function loadById<T>(model: { find: (filter: object) => PromiseLike<T[]> }, ids: unknown[]): Promise<Map<string, T>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const docs = await model.find({ _id: { $in: unique } });
  return new Map(docs.map((d) => [String((d as { _id: unknown })._id), d]));
}

/**
 * Hourly. Sends one reminder per task, once its due day is today or tomorrow in the group's
 * timezone (so normally the morning of the day before). Due dates are calendar days stored at 00:00Z.
 */
export async function processReminderJob(_job: Bull.Job): Promise<void> {
  logger.info('[ReminderJob] Running due date reminder check...');

  try {
    const now = new Date();
    // Wide UTC window (timezones span ±14h); exact filtering happens per group below.
    const windowStart = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const tasks = await Task.find({
      dueDate: { $gte: windowStart, $lte: windowEnd },
      status: { $nin: CLOSED_STATUSES },
      reminderSent: { $ne: true },
    });

    // Load every group and person these tasks need in two queries, not one per task.
    const groups = await loadById<IGroup>(Group, tasks.map((t) => t.groupId));
    const users = await loadById<IUser>(
      User,
      tasks.map((t) => refId(t.assigneeId) ?? t.createdBy),
    );
    let sent = 0;

    for (const task of tasks) {
      if (!task.dueDate) continue;
      const group = groups.get(task.groupId.toString());
      // No reminders from groups without service (left unmarked: they still go out if it resumes in time).
      if (!group || !isGroupActive(group)) continue;
      const tz = groupTimezone(group);

      const today = todayIn(tz, now);
      const due = dueDay(task.dueDate);
      if (due !== today && due !== addDays(today, 1)) continue;
      if (hourIn(tz, now) < REMINDER_FROM_HOUR) continue;

      const assigneeId = refId(task.assigneeId);
      const reason: ReminderReason = assigneeId ? 'assignee' : 'creator';
      const targetUser = users.get(String(assigneeId ?? task.createdBy));

      if (targetUser) {
        await notificationService.notifyDueReminder(task, targetUser, reason);
        sent++;
      }

      await Task.findByIdAndUpdate(task._id, { $set: { reminderSent: true } });
    }

    logger.info(`[ReminderJob] Sent ${sent} reminder(s)`);
  } catch (error) {
    logger.error(`[ReminderJob] Error: ${error}`);
    throw error;
  }
}
