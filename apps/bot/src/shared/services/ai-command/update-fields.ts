import mongoose from 'mongoose';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { refId } from 'src/bot/task-card.renderer';
import type { AiRequestContext } from 'src/shared/services/ai-command/context';
import { buildEpicMiss, currentEpic, findEpic, openEpicsOf } from 'src/shared/services/ai-command/epics';
import {
  dayOf,
  epicDot,
  epicLabel,
  labelWord,
  personName,
  priorityText,
  shortDay,
  shorten,
  typeText,
} from 'src/shared/services/ai-command/format';
import { UpdateChanges } from 'src/shared/services/ai-command/plan.schema';
import { resolvePerson, unknownPersonText } from 'src/shared/services/ai-command/resolve';
import { EpicMiss } from 'src/shared/services/ai-command/result';
import { subtaskEpicNote } from 'src/shared/services/ai-command/subtasks';
import type { TaskChange } from 'src/shared/services/task-sync.service';

/** What an AI update will write: plain fields + their activity rows, the reply lines and the sync changes. */
export interface UpdateDraft {
  fields: Record<string, unknown>;
  activities: [string, string | null, string | null][];
  changed: string[];
  notes: string[];
  fieldChanges: TaskChange[];
}

export function emptyDraft(): UpdateDraft {
  return { fields: {}, activities: [], changed: [], notes: [], fieldChanges: [] };
}

/**
 * Assignee: only a known member (or null = unassign). Returns the new assignee, null to unassign,
 * undefined for no change (a note explains why).
 */
export function collectAssignee(
  c: AiRequestContext,
  task: ITask,
  changes: UpdateChanges,
  notes: string[],
): IUser | null | undefined {
  if (changes.assignee === undefined) return undefined;
  const previousAssigneeId = refId(task.assigneeId);
  if (changes.assignee === null) {
    if (previousAssigneeId) return null;
    notes.push('ℹ️ Already unassigned.');
    return undefined;
  }
  const member = resolvePerson(c, changes.assignee);
  if (!member) {
    notes.push(`⚠️ ${unknownPersonText(changes.assignee, c.channel)}`);
  } else if (previousAssigneeId === member._id.toString()) {
    notes.push(`ℹ️ Already assigned to ${personName(member)}.`);
  } else {
    return member;
  }
  return undefined;
}

/** Title and description. */
export function collectTextFields(task: ITask, changes: UpdateChanges, d: UpdateDraft): void {
  if (changes.title !== undefined && changes.title !== task.title) {
    d.fields.title = changes.title;
    d.activities.push(['title', task.title, changes.title]);
    d.fieldChanges.push({ field: 'title', from: task.title, to: changes.title });
    d.changed.push(`✏️ Renamed (was “${shorten(task.title)}”)`);
  }
  if (changes.description !== undefined) {
    const next = changes.description?.trim() || null;
    const prev = task.description?.trim() || null;
    if (next !== prev) {
      d.fields.description = next;
      d.activities.push(['description', prev ? shorten(prev, 80) : null, next ? shorten(next, 80) : null]);
      d.fieldChanges.push({ field: 'description', from: prev, to: next });
      d.changed.push(next ? (prev ? '📝 Description updated' : '📝 Description added') : '📝 Description cleared');
    }
  }
}

/** Type, priority and due date. */
export function collectMetaFields(c: AiRequestContext, task: ITask, changes: UpdateChanges, d: UpdateDraft): void {
  if (changes.type !== undefined) {
    if (changes.type !== (task.type || 'task')) {
      d.fields.type = changes.type;
      d.activities.push(['type', typeText(task.type), typeText(changes.type)]);
      d.fieldChanges.push({ field: 'type', from: typeText(task.type), to: typeText(changes.type) });
      d.changed.push(typeText(changes.type));
    } else d.notes.push(`ℹ️ Already ${typeText(changes.type)}.`);
  }
  if (changes.priority !== undefined) {
    if (changes.priority !== (task.priority || 'medium')) {
      d.fields.priority = changes.priority;
      d.activities.push(['priority', priorityText(task.priority), priorityText(changes.priority)]);
      d.fieldChanges.push({ field: 'priority', from: priorityText(task.priority), to: priorityText(changes.priority) });
      d.changed.push(`${priorityText(changes.priority)} priority`);
    } else d.notes.push(`ℹ️ Priority is already ${labelWord(priorityText(changes.priority)).toLowerCase()}.`);
  }
  if (changes.dueDate !== undefined) {
    const before = task.dueDate ? dayOf(task.dueDate) : null;
    if (changes.dueDate !== before) {
      d.fields.dueDate = changes.dueDate ? new Date(`${changes.dueDate}T00:00:00Z`) : null;
      if (changes.dueDate) d.fields.reminderSent = false;
      const label = (day: string | null) => (day ? shortDay(day, c.today) : 'No due date');
      d.activities.push(['due_date', before ? label(before) : null, label(changes.dueDate)]);
      d.fieldChanges.push({ field: 'due_date', from: before, to: changes.dueDate });
      d.changed.push(changes.dueDate ? `📅 Due ${shortDay(changes.dueDate, c.today)}` : '📅 No due date');
    }
  }
}

/** Epic: an existing epic of this group (by title), never created silently. Returns the "no such epic" miss. */
export async function collectEpicChange(
  c: AiRequestContext,
  task: ITask,
  changes: UpdateChanges,
  newEpic: boolean,
  d: UpdateDraft,
): Promise<EpicMiss | undefined> {
  if (changes.epic === undefined) return undefined;
  if (task.parentTaskId) {
    d.notes.push(subtaskEpicNote(task));
    return undefined;
  }
  const prev = await currentEpic(task);
  if (changes.epic === null) {
    if (prev) {
      d.fields.epicId = null;
      d.activities.push(['epic', prev.title, null]);
      d.fieldChanges.push({ field: 'epic', from: prev.title, to: null, fromIcon: epicDot(prev.color), toIcon: null });
      d.changed.push(`Epic removed (was ${epicLabel(prev)})`);
    } else d.notes.push('ℹ️ Not in an epic.');
    return undefined;
  }
  const next = await findEpic(c, changes.epic, newEpic);
  if (!next) return buildEpicMiss(changes.epic, await openEpicsOf(c));
  if (prev?._id === next.epic._id) {
    d.notes.push(`ℹ️ Already in epic ${epicLabel(next.epic)}.`);
    return undefined;
  }
  d.fields.epicId = new mongoose.Types.ObjectId(next.epic._id);
  d.activities.push(['epic', prev?.title ?? null, next.epic.title]);
  d.fieldChanges.push({
    field: 'epic',
    from: prev?.title ?? null,
    to: next.epic.title,
    fromIcon: prev ? epicDot(prev.color) : null,
    toIcon: epicDot(next.epic.color),
  });
  d.changed.push(
    prev ? `Epic: ${epicLabel(prev)} → ${epicLabel(next.epic)}` : `Epic → ${epicLabel(next.epic)}${next.created ? ' (new)' : ''}`,
  );
  return undefined;
}
