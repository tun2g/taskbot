import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_TYPE_LABELS, TaskPriority, TaskStatus, TaskType } from '@tbot/shared';
import mongoose from 'mongoose';
import { formatDueDate, parseDueDate } from 'src/api/validation';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { clip, refId, resolveUser } from 'src/shared/services/task-mutation/common';
import { UpdateTaskFields } from 'src/shared/services/task-mutation/fields';
import { memberOrThrow } from 'src/shared/services/task-mutation/guards';
import { TaskChange, userDisplayName } from 'src/shared/services/task-sync.service';

const statusLabel = (s: string) => TASK_STATUS_LABELS[s as TaskStatus] ?? s;
const priorityLabel = (p: string) => TASK_PRIORITY_LABELS[p as TaskPriority] ?? p;
const typeLabel = (t: string) => TASK_TYPE_LABELS[t as TaskType] ?? t;

/** The plain-field part of an update (everything but parent / epic). */
export interface FieldPlan {
  changes: TaskChange[];
  updates: Record<string, unknown>;
  newStatus: string | undefined;
  previousAssignee: IUser | null;
  newAssignee: IUser | null;
  assigneeChanged: boolean;
}

/** Status, assignee, title, priority, type, description and due date — only those that actually change. */
export async function planFieldChanges(before: ITask, data: UpdateTaskFields): Promise<FieldPlan> {
  const changes: TaskChange[] = [];
  const updates: Record<string, unknown> = {};
  let newStatus: string | undefined;

  if (data.status !== undefined && data.status !== before.status) {
    newStatus = data.status;
    changes.push({ field: 'status', from: statusLabel(before.status), to: statusLabel(data.status) });
  }

  const previousAssignee = await resolveUser(before.assigneeId);
  let newAssignee: IUser | null = null;
  let assigneeChanged = false;
  if (data.assigneeId !== undefined) {
    const nextId = data.assigneeId || null;
    if (nextId !== refId(before.assigneeId)) {
      if (nextId) newAssignee = await memberOrThrow(before.groupId, nextId);
      assigneeChanged = true;
      updates.assigneeId = nextId ? new mongoose.Types.ObjectId(nextId) : null;
      changes.push({
        field: 'assignee',
        from: previousAssignee ? userDisplayName(previousAssignee) : null,
        to: newAssignee ? userDisplayName(newAssignee) : null,
      });
    }
  }

  planTextFields(before, data, updates, changes);
  return { changes, updates, newStatus, previousAssignee, newAssignee, assigneeChanged };
}

/** Title, priority, type, description, due date. */
function planTextFields(before: ITask, data: UpdateTaskFields, updates: Record<string, unknown>, changes: TaskChange[]) {
  if (data.title !== undefined && data.title !== before.title) {
    updates.title = data.title;
    changes.push({ field: 'title', from: clip(before.title), to: clip(data.title) });
  }

  if (data.priority !== undefined && data.priority !== before.priority) {
    updates.priority = data.priority;
    changes.push({ field: 'priority', from: priorityLabel(before.priority), to: priorityLabel(data.priority) });
  }

  const beforeType = before.type || 'task';
  if (data.type !== undefined && data.type !== beforeType) {
    updates.type = data.type;
    changes.push({ field: 'type', from: typeLabel(beforeType), to: typeLabel(data.type) });
  }

  if (data.description !== undefined) {
    const next = data.description || null;
    const prev = before.description || null;
    if (next !== prev) {
      updates.description = next;
      changes.push({ field: 'description', from: clip(prev), to: clip(next) });
    }
  }

  if (data.dueDate !== undefined) {
    const next = data.dueDate ? parseDueDate(data.dueDate) : null;
    const nextDay = formatDueDate(next);
    const prevDay = formatDueDate(before.dueDate);
    if (nextDay !== prevDay) {
      updates.dueDate = next;
      updates.reminderSent = false;
      changes.push({ field: 'due_date', from: prevDay, to: nextDay });
    }
  }
}
