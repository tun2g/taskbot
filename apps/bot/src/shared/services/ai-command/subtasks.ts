import { isClosedStatus, SUBTASKS_MAX } from '@tbot/shared';
import mongoose from 'mongoose';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { subtaskService } from 'src/database/services/subtask.service';
import logger from 'src/shared/logger/logger';
import type { AiRequestContext } from 'src/shared/services/ai-command.service';
import {
  BREAKDOWN_MAX,
  BREAKDOWN_SYSTEM_PROMPT,
  breakdownSchema,
  buildBreakdownPrompt,
} from 'src/shared/services/ai-command/breakdown.prompt';
import {
  detectLang,
  epicLabel,
  epicOf,
  labelWord,
  Lang,
  personName,
  shorten,
  typeText,
} from 'src/shared/services/ai-command/format';
import { CreateSubtasksAction, MAX_AI_SUBTASKS, SubtaskItem, TaskRef } from 'src/shared/services/ai-command/plan.schema';
import { SubtasksOutcome } from 'src/shared/services/ai-command/result';
import { createSubtaskItems, ReadyItem, SubtaskCreateContext } from 'src/shared/services/ai-command/subtask-items';
import { savePreview } from 'src/shared/services/ai-command/subtask-preview';
import { AIUnavailableError, aiService } from 'src/shared/services/ai/ai.service';
import type { TaskChange } from 'src/shared/services/task-event-lines';
import { MutationChannel, refId, TaskMutationError } from 'src/shared/services/task-mutation/common';

// The mutation service, its subtask rules and task-sync load the bot, which loads /ai → this file: import lazily.
const mutation = () => import('src/shared/services/task-mutation.service').then((m) => m.taskMutationService);
const rules = () => import('src/shared/services/task-mutation/subtasks');
const sync = () => import('src/shared/services/task-sync.service').then((m) => m.taskSyncService);

// /ai and the web chat on subtasks: "chia #42 thành subtask …" and the `parent` change of update_task.
// Listed items are created at once; an AI-proposed breakdown is shown as a preview first (subtask-preview).
// Everything goes through the task mutation service, so the subtask rules, activity log, DMs and parent
// cards behave as in the app.

/** What the executor needs from the AI command service (passed in to avoid a circular import). */
export interface SubtaskDeps {
  resolvePerson: (name: string) => IUser | null;
  unknownPersonText: (name: string) => string;
}

const channelOf = (c: AiRequestContext): MutationChannel => ({ activity: c.activityVia ?? 'ai' });
const createContextOf = (c: AiRequestContext): SubtaskCreateContext => ({
  group: c.group,
  requester: c.requester,
  activityVia: c.activityVia ?? 'ai',
  channel: c.channel ?? 'telegram',
});
const sameTitle = (a: string, b: string) =>
  a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
const parentNumber = (ref: unknown): number | null =>
  ref && typeof ref === 'object' && 'taskNumber' in (ref as object) ? (ref as { taskNumber: number }).taskNumber : null;

/** "chia #42 thành subtask: …" in the user's language — how to list items yourself. */
function listYourselfExample(lang: Lang, n: number): string {
  return lang === 'vi' ? `"chia #${n} thành subtask: thiết kế API, viết UI"` : `"split #${n} into subtasks: design the API, build the UI"`;
}

/** The AI's breakdown of `parent` (titles only); [] when it's too vague to split; null when the AI is unavailable. */
async function proposeSubtasks(
  c: AiRequestContext,
  parent: ITask,
  existing: ITask[],
  count: number | null,
): Promise<SubtaskItem[] | null> {
  const user = buildBreakdownPrompt({
    request: c.request,
    lang: detectLang(c.request),
    task: {
      taskNumber: parent.taskNumber,
      title: parent.title,
      description: parent.description || null,
      type: labelWord(typeText(parent.type)),
      epic: epicOf(parent.epicId)?.title ?? null,
    },
    existing: existing.map((t) => t.title),
    count,
  });
  try {
    const { subtasks } = await aiService.generateJson(
      { system: BREAKDOWN_SYSTEM_PROMPT, user, temperature: 0.3 },
      breakdownSchema,
      { retries: 1 },
    );
    return subtasks.slice(0, count ?? BREAKDOWN_MAX).map((s) => ({ title: s.title }));
  } catch (error) {
    if (!(error instanceof AIUnavailableError)) throw error;
    logger.warn(`AI breakdown of #${parent.taskNumber} failed (${error.reason}): ${error.message}`);
    return null;
  }
}

/** Members named for an unlisted split ("cho @an @binh"), in order; unknown names become warnings. */
function namedPeople(action: CreateSubtasksAction, deps: SubtaskDeps, warnings: string[]): IUser[] {
  const people: IUser[] = [];
  for (const name of action.assignees ?? []) {
    const person = deps.resolvePerson(name);
    if (!person) warnings.push(`⚠️ ${deps.unknownPersonText(name)}`);
    else if (!people.some((p) => String(p._id) === String(person._id))) people.push(person);
  }
  return people;
}

/** Drops items that repeat an existing subtask (or each other), with a note per skipped one. */
function freshItems<T extends { title: string }>(items: T[], existing: ITask[], warnings: string[]): T[] {
  const fresh: T[] = [];
  for (const item of items) {
    const dupe = existing.find((t) => sameTitle(t.title, item.title)) ?? null;
    if (dupe) warnings.push(`ℹ️ Skipped “${shorten(item.title, 40)}” — #${dupe.taskNumber} already covers it.`);
    else if (!fresh.some((f) => sameTitle(f.title, item.title))) fresh.push(item);
  }
  return fresh;
}

/**
 * Adds subtasks to `parent`. Listed items are created at once (one batch, undo). With nothing listed the AI
 * proposes a breakdown — assigned in order to the people the user named — returned as a `preview` that is
 * created only when the requester accepts it. Caps at MAX_AI_SUBTASKS / the room left; never assigns an
 * unknown person.
 */
export async function addSubtasks(
  c: AiRequestContext,
  parent: ITask,
  action: CreateSubtasksAction,
  deps: SubtaskDeps,
): Promise<SubtasksOutcome> {
  const empty = (refusal: string, proposed = false): SubtasksOutcome => ({
    parent,
    created: [],
    proposed,
    warnings: [],
    batchId: null,
    refusal,
  });

  const { closedParentMessage, nestedSubtaskMessage, subtasksFullMessage } = await rules();
  if (parent.parentTaskId) {
    return empty(nestedSubtaskMessage(parent.taskNumber, parentNumber(parent.parentTaskId)));
  }
  if (isClosedStatus(parent.status)) return empty(closedParentMessage(parent.taskNumber, parent.status));
  const existing = await subtaskService.list(parent._id as mongoose.Types.ObjectId);
  const room = SUBTASKS_MAX - existing.length;
  if (room <= 0) return empty(subtasksFullMessage(parent.taskNumber));

  const lang = detectLang(c.request);
  const warnings: string[] = [];
  const listed = action.items?.filter((i) => i.title.trim()) ?? [];
  const proposed = listed.length === 0;

  let items: ReadyItem[];
  if (proposed) {
    const people = namedPeople(action, deps, warnings);
    const count = Math.min(action.count ?? (people.length || 0), BREAKDOWN_MAX) || null;
    const ideas = await proposeSubtasks(c, parent, existing, count);
    if (!ideas) {
      return empty(`AI can't suggest subtasks right now. List them yourself, e.g. ${listYourselfExample(lang, parent.taskNumber)}.`, true);
    }
    const fresh = freshItems(ideas, existing, warnings);
    if (fresh.length === 0 && ideas.length === 0) {
      return empty(
        `#${parent.taskNumber} is too vague for me to split. List the subtasks yourself, e.g. ${listYourselfExample(lang, parent.taskNumber)}.`,
        true,
      );
    }
    items = fresh.map((item, i) => ({ title: item.title, assignee: people[i] ?? null }));
    const leftOut = people.slice(fresh.length);
    if (leftOut.length) {
      warnings.push(`ℹ️ Only ${fresh.length} subtask${fresh.length === 1 ? '' : 's'} suggested — ${leftOut.map(personName).join(', ')} not assigned yet.`);
    }
  } else {
    const unknown: string[] = [];
    items = freshItems(listed, existing, warnings).map((item) => {
      const assignee = item.assignee ? deps.resolvePerson(item.assignee) : null;
      if (item.assignee && !assignee && !unknown.includes(item.assignee)) unknown.push(item.assignee);
      return { title: item.title, assignee, dueDate: item.dueDate ?? null };
    });
    for (const name of unknown) warnings.push(`⚠️ ${deps.unknownPersonText(name)}`);
  }

  const cap = Math.min(MAX_AI_SUBTASKS, room);
  if (items.length > cap) {
    warnings.push(
      cap === room && room < MAX_AI_SUBTASKS
        ? `ℹ️ Kept the first ${cap} — #${parent.taskNumber} can have at most ${SUBTASKS_MAX} subtasks.`
        : `ℹ️ Kept the first ${cap} — add the rest in another message.`,
    );
    items = items.slice(0, cap);
  }
  if (items.length === 0) return { parent, created: [], proposed, warnings, batchId: null };

  if (proposed) {
    const previewId = await savePreview({ ...createContextOf(c), request: c.request }, parent, items, warnings);
    if (!previewId) return { ...empty("Couldn't prepare the suggestions. Please try again in a moment.", true), warnings };
    return { parent, created: [], proposed, warnings, batchId: null, preview: { id: previewId, items } };
  }
  return createSubtaskItems(createContextOf(c), parent, items, { proposed, warnings });
}

/** Change lines for the parent / epic part of a mutation-service update ("↳ Subtask of #42 …"). */
function parentLines(changes: TaskChange[], task: ITask): string[] {
  const lines: string[] = [];
  for (const change of changes) {
    if (change.field === 'parent') {
      if (change.to) {
        lines.push(`↳ Subtask of ${shorten(change.to)}`);
      } else {
        // Detaching keeps the epic it had as a subtask — say so, it may need changing.
        const epic = epicOf(task.epicId);
        const kept = epic ? ` — stays in ${epicLabel(epic)}` : '';
        lines.push(`↳ No longer a subtask (was ${shorten(change.from)})${kept}`);
      }
    } else if (change.field === 'epic') {
      const to = change.to ? `${change.toIcon ? `${change.toIcon} ` : ''}${change.to}` : 'none';
      lines.push(`Epic → ${to} (same as its parent)`);
    }
  }
  return lines;
}

export interface ParentChangeResult {
  task: ITask;
  changes: string[];
  notes: string[];
  fieldChanges: TaskChange[];
}

/**
 * update_task `parent`: #N makes the task a subtask of #N (it moves into #N's epic); null turns it back into a
 * regular task. A number must be one the user wrote (same rule as task targets). Broken rules become notes.
 */
export async function applyParentChange(
  c: AiRequestContext,
  task: ITask,
  parent: number | null,
  resolveTarget: (ref: TaskRef) => Promise<{ task: ITask } | { miss: unknown }>,
): Promise<ParentChangeResult> {
  const none: ParentChangeResult = { task, changes: [], notes: [], fieldChanges: [] };
  const currentNumber = parentNumber(task.parentTaskId);

  let parentTaskId: string | null = null;
  if (parent === null) {
    if (!task.parentTaskId) return { ...none, notes: ['ℹ️ Not a subtask.'] };
  } else {
    if (parent === currentNumber) return { ...none, notes: [`ℹ️ Already a subtask of #${parent}.`] };
    const target = await resolveTarget(parent);
    if ('miss' in target) return { ...none, notes: [`⚠️ There's no task #${parent} to put it under.`] };
    parentTaskId = String(target.task._id);
  }

  try {
    const result = await (await mutation()).updateTask(task, c.requester, { parentTaskId }, channelOf(c));
    return {
      task: result.task,
      changes: parentLines(result.changes, result.task),
      notes: [],
      fieldChanges: result.changes,
    };
  } catch (error) {
    if (error instanceof TaskMutationError) return { ...none, notes: [`⚠️ ${error.message}`] };
    throw error;
  }
}

/** A subtask's epic follows its parent: the note shown instead of changing it. */
export function subtaskEpicNote(task: ITask): string {
  const n = parentNumber(task.parentTaskId);
  return `⚠️ #${task.taskNumber} is a subtask, so it stays in its parent's epic.${n ? ` Change the epic on #${n} instead.` : ''}`;
}

/** After a task's epic changed: its subtasks follow (and their cards refresh). Never throws. */
export async function moveSubtasksToEpic(task: ITask, epicId: unknown): Promise<void> {
  try {
    const id = refId(epicId);
    const moved = await subtaskService.setEpic(
      task._id as mongoose.Types.ObjectId,
      id ? new mongoose.Types.ObjectId(id) : null,
    );
    if (moved > 0) {
      const taskSyncService = await sync();
      for (const child of await subtaskService.list(task._id as mongoose.Types.ObjectId)) {
        taskSyncService.syncTaskCard(child).catch(() => undefined);
      }
    }
  } catch (error) {
    logger.warn(`Could not move the subtasks of #${task.taskNumber} with its epic: ${error}`);
  }
}
