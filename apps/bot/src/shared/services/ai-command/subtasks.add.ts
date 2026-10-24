import { isClosedStatus, SUBTASKS_MAX } from '@tbot/shared';
import mongoose from 'mongoose';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { subtaskService } from 'src/database/services/subtask.service';
import type { AiRequestContext } from 'src/shared/services/ai-command.service';
import { BREAKDOWN_MAX } from 'src/shared/services/ai-command/breakdown.prompt';
import { detectLang, Lang, personName, shorten } from 'src/shared/services/ai-command/format';
import { CreateSubtasksAction, MAX_AI_SUBTASKS } from 'src/shared/services/ai-command/plan.schema';
import { SubtasksOutcome } from 'src/shared/services/ai-command/result';
import { createSubtaskItems, ReadyItem, SubtaskCreateContext } from 'src/shared/services/ai-command/subtask-items';
import { savePreview } from 'src/shared/services/ai-command/subtask-preview';
import { parentNumber } from 'src/shared/services/ai-command/subtasks.parent';
import { proposeSubtasks } from 'src/shared/services/ai-command/subtasks.propose';

// The mutation service's subtask rules load the bot, which loads /ai → this file: import lazily.

const rules = () => import('src/shared/services/task-mutation/subtasks');

// "chia #42 thành subtask …": listed items are created at once; an AI-proposed breakdown is shown as a
// preview first (subtask-preview).

/** What the executor needs from the AI command service (passed in to avoid a circular import). */
export interface SubtaskDeps {
  resolvePerson: (name: string) => IUser | null;
  unknownPersonText: (name: string) => string;
}

const createContextOf = (c: AiRequestContext): SubtaskCreateContext => ({
  group: c.group,
  requester: c.requester,
  activityVia: c.activityVia ?? 'ai',
  channel: c.channel ?? 'telegram',
});
const sameTitle = (a: string, b: string) =>
  a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/** "chia #42 thành subtask: …" in the user's language — how to list items yourself. */
function listYourselfExample(lang: Lang, n: number): string {
  return lang === 'vi' ? `"chia #${n} thành subtask: thiết kế API, viết UI"` : `"split #${n} into subtasks: design the API, build the UI"`;
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
