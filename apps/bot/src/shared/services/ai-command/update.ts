import { populatedUser } from 'src/bot/task-card.renderer';
import { refreshParentAfterStatus } from 'src/bot/subtasks/parent-sync';
import { TaskActivityVia } from 'src/database/models/task-activity.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import type { AiRequestContext } from 'src/shared/services/ai-command/context';
import { personName, statusText } from 'src/shared/services/ai-command/format';
import { notifyChange, refreshCard } from 'src/shared/services/ai-command/notify';
import { UpdateChanges } from 'src/shared/services/ai-command/plan.schema';
import { resolveTarget } from 'src/shared/services/ai-command/resolve';
import { CardEditor, UpdateOutcome } from 'src/shared/services/ai-command/result';
import { applyParentChange, moveSubtasksToEpic } from 'src/shared/services/ai-command/subtasks';
import {
  collectAssignee,
  collectEpicChange,
  collectMetaFields,
  collectTextFields,
  emptyDraft,
  UpdateDraft,
} from 'src/shared/services/ai-command/update-fields';

/** Applies one validated update_task: collects every change first, then writes fields, assignee, status. */
export async function applyUpdate(
  c: AiRequestContext,
  original: ITask,
  changes: UpdateChanges,
  editor: CardEditor,
  options: { newEpic?: boolean } = {},
): Promise<UpdateOutcome> {
  const d = emptyDraft();

  // ── Parent (subtask): through the mutation service so the subtask rules and parent cards apply ──
  let task = original;
  if (changes.parent !== undefined) {
    const moved = await applyParentChange(c, task, changes.parent, (ref) => resolveTarget(c, ref));
    task = moved.task;
    d.changed.push(...moved.changes);
    d.notes.push(...moved.notes);
    d.fieldChanges.push(...moved.fieldChanges);
  }

  const previousAssignee = populatedUser(task.assigneeId);
  const newAssignee = collectAssignee(c, task, changes, d.notes);
  collectTextFields(task, changes, d);
  collectMetaFields(c, task, changes, d);
  const epicMiss = await collectEpicChange(c, task, changes, !!options.newEpic, d);

  const statusChange = changes.status !== undefined && changes.status !== task.status ? changes.status : undefined;
  if (changes.status !== undefined && !statusChange) d.notes.push(`ℹ️ Already ${statusText(task.status)}.`);

  const { current, failed } = await writeUpdate(c, task, d, previousAssignee, newAssignee, statusChange);

  if (!failed && d.changed.length) {
    await notifyChange(c, current, previousAssignee, newAssignee, !!statusChange);
    await refreshCard(c, current, editor);
  }

  const outcome: UpdateOutcome = {
    original,
    task: current,
    changes: d.changed,
    notes: failed ? [] : d.notes,
    fieldChanges: d.fieldChanges,
    failed,
  };
  if (epicMiss && !failed) outcome.epicMiss = epicMiss;
  return outcome;
}

/** Writes the collected changes in order (fields → assignee → status); stops at the first failed write. */
async function writeUpdate(
  c: AiRequestContext,
  task: ITask,
  d: UpdateDraft,
  previousAssignee: IUser | null,
  newAssignee: IUser | null | undefined,
  statusChange: UpdateChanges['status'],
): Promise<{ current: ITask; failed: boolean }> {
  const via: TaskActivityVia = c.activityVia ?? 'ai';
  const actor = c.requester._id;
  const record = (action: string, from: string | null, to: string | null) =>
    taskActivityService.record({ taskId: task._id, groupId: task.groupId, actor, action, from, to, via });

  let current: ITask = task;
  let failed = false;

  if (Object.keys(d.fields).length) {
    const updated = await taskService.updateTask(task._id, d.fields);
    if (updated) {
      current = updated;
      for (const [action, from, to] of d.activities) await record(action, from, to);
      if (d.fields.epicId !== undefined) await moveSubtasksToEpic(task, d.fields.epicId);
    } else failed = true;
  }

  if (!failed && newAssignee !== undefined) {
    const updated = await taskService.assignTask(task._id, newAssignee ? newAssignee._id : null);
    if (updated) {
      current = updated;
      const from = previousAssignee ? personName(previousAssignee) : null;
      const to = newAssignee ? personName(newAssignee) : 'Unassigned';
      await record('assignee', from, to);
      d.fieldChanges.unshift({ field: 'assignee', from, to: newAssignee ? to : null });
      d.changed.unshift(`👤 ${from ?? 'Unassigned'} → ${to}`);
    } else failed = true;
  }

  if (!failed && statusChange) {
    const updated = await taskService.updateTaskStatus(task._id, statusChange, actor);
    if (updated) {
      current = updated;
      // A subtask's parent card shows "2/5 done".
      void refreshParentAfterStatus(task, task.status, statusChange);
      await record('status', statusText(task.status), statusText(statusChange));
      d.fieldChanges.push({ field: 'status', from: statusText(task.status), to: statusText(statusChange) });
      d.changed.push(statusText(statusChange));
    } else failed = true;
  }
  return { current, failed };
}
