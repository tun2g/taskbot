import { describeDue, dueState, escapeMarkdown, groupTimezone, mdName, refId } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import {
  findCreator,
  inGroup,
  loadGroup,
  NotifyResult,
  ReminderReason,
  sendDm,
  shouldNotify,
  statusHeadline,
  taskLine,
  taskLines,
} from './dm';
import { assignButton, assignHint, closeParentKeyboard, dmTaskKeyboard } from './keyboards';

export class NotificationService {
  async notifyAssignment(task: ITask, assignee: IUser, assignedBy: IUser): Promise<NotifyResult> {
    if (assignee.telegramUserId === assignedBy.telegramUserId) return 'skipped';
    if (!(await shouldNotify(task._id.toString(), assignee.telegramUserId, 'assign'))) return 'skipped';

    const group = await loadGroup(task);
    const lines = [`👤 *You were assigned #${task.taskNumber}*`, ...(await taskLines(task))];
    const due = describeDue(task, groupTimezone(group));
    if (due) lines.push(`Due: ${due}`);
    lines.push(`By ${mdName(assignedBy)}${inGroup(group)}`);

    return sendDm(task, assignee, lines.join('\n'), dmTaskKeyboard(task));
  }

  async notifyUnassigned(task: ITask, previousAssignee: IUser, changedBy: IUser): Promise<NotifyResult> {
    if (previousAssignee.telegramUserId === changedBy.telegramUserId) return 'skipped';
    if (!(await shouldNotify(task._id.toString(), previousAssignee.telegramUserId, 'unassign'))) return 'skipped';

    const group = await loadGroup(task);
    const lines = [
      `*You're no longer assigned #${task.taskNumber}*`,
      ...(await taskLines(task)),
      `Changed by ${mdName(changedBy)}${inGroup(group)}`,
    ];
    return sendDm(task, previousAssignee, lines.join('\n'));
  }

  async notifyStatusChange(task: ITask, changedBy: IUser, assignee: IUser): Promise<NotifyResult> {
    if (assignee.telegramUserId === changedBy.telegramUserId) return 'skipped';
    if (!(await shouldNotify(task._id.toString(), assignee.telegramUserId, `status_${task.status}`))) {
      return 'skipped';
    }

    const group = await loadGroup(task);
    const headline = statusHeadline(task.status, task.taskNumber);
    const lines = [
      headline,
      ...(await taskLines(task)),
      `By ${mdName(changedBy)}${inGroup(group)}`,
      `You're the assignee.`,
    ];
    return sendDm(task, assignee, lines.join('\n'));
  }

  /**
   * Every counted subtask of `parent` is done → nudge the parent's owner to close it:
   *   🧩 *All 3 subtasks of #42 are done*
   *   🐞 Bug — Fix login
   *   In Team · close #42 too?
   *   [✅ Done #42] [📱 Open #42]
   */
  async notifyAllSubtasksDone(parent: ITask, owner: IUser, total: number): Promise<NotifyResult> {
    const group = await loadGroup(parent);
    const what = total === 1 ? 'The only subtask' : `All ${total} subtasks`;
    const lines = [
      `🧩 *${what} of #${parent.taskNumber} ${total === 1 ? 'is' : 'are'} done*`,
      taskLine(parent),
      `${group?.groupName ? `In ${escapeMarkdown(group.groupName)} · ` : ''}close #${parent.taskNumber} too?`,
    ];
    return sendDm(parent, owner, lines.join('\n'), closeParentKeyboard(parent));
  }

  async notifyDueReminder(task: ITask, targetUser: IUser, reason?: ReminderReason): Promise<NotifyResult> {
    const group = await loadGroup(task);
    const tz = groupTimezone(group);

    let headline = `⏰ *#${task.taskNumber} is due soon*`;
    if (task.dueDate) {
      const state = dueState(task.dueDate, tz);
      if (state === 'today') headline = `⏰ *#${task.taskNumber} is due today*`;
      else if (state === 'tomorrow') headline = `⏰ *#${task.taskNumber} is due tomorrow*`;
      else if (state === 'overdue') headline = `⏰ *#${task.taskNumber} is overdue*`;
    }

    const asAssignee =
      (reason ?? (refId(task.assigneeId) === targetUser._id.toString() ? 'assignee' : 'creator')) === 'assignee';

    const lines = [headline, ...(await taskLines(task))];
    const due = describeDue(task, tz);
    if (due) lines.push(`Due: ${due}`);

    if (asAssignee) {
      // Same "By @a in Team" line as the other DMs (the creator, here).
      const creator = await findCreator(task);
      if (creator && creator.telegramUserId !== targetUser.telegramUserId) {
        lines.push(`By ${mdName(creator)}${inGroup(group)}`);
      } else if (group) {
        lines.push(`In ${escapeMarkdown(group.groupName)}`);
      }
      lines.push("You're the assignee.");
      return sendDm(task, targetUser, lines.join('\n'), dmTaskKeyboard(task));
    }

    // Creator of an unassigned task: let them act on it right away.
    const assign = assignButton(task);
    lines.push(
      `You created it${inGroup(group)} and nobody is assigned yet.` +
        (assign ? ` Tap “${assign.text}” to pick someone.` : ` ${assignHint(task)}`),
    );
    return sendDm(task, targetUser, lines.join('\n'), assign ? [[assign]] : []);
  }
}

export const notificationService = new NotificationService();
