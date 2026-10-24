import mongoose from 'mongoose';
import { refId } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import { EpicTitleTakenError, epicService } from 'src/database/services/epic.service';
import { AiRequestContext, toEpicRef } from 'src/shared/services/ai-command/context';
import { epicOf, MAX_EPIC_SUGGESTIONS } from 'src/shared/services/ai-command/format';
import { CreateEpicAction } from 'src/shared/services/ai-command/plan.schema';
import { EpicCreateOutcome, EpicMiss, EpicRef } from 'src/shared/services/ai-command/result';

const normalizeTitle = (title: string) => title.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * "No epic “Logn”" + the group's open epics to pick from — the closest ones first (one title contains
 * the other), at most MAX_EPIC_SUGGESTIONS.
 */
export function buildEpicMiss(title: string, openEpics: EpicRef[]): EpicMiss {
  const wanted = normalizeTitle(title);
  const close = (e: EpicRef) => {
    const t = normalizeTitle(e.title);
    return !!wanted && (t.includes(wanted) || wanted.includes(t));
  };
  const sorted = [...openEpics.filter(close), ...openEpics.filter((e) => !close(e))];
  return {
    title,
    suggestions: sorted.slice(0, MAX_EPIC_SUGGESTIONS),
    more: Math.max(0, sorted.length - MAX_EPIC_SUGGESTIONS),
  };
}

/** "/ai tạo epic Login": creates it (auto color) unless an epic with that title already exists. */
export async function createEpic(c: AiRequestContext, action: CreateEpicAction): Promise<EpicCreateOutcome> {
  const existing = await epicService.findByTitle(c.group._id, action.title);
  if (existing) return { epic: toEpicRef(existing), duplicate: true };
  try {
    const doc = await epicService.create({
      groupId: c.group._id,
      createdBy: c.requester._id as mongoose.Types.ObjectId,
      title: action.title,
      description: action.description ?? null,
    });
    const epic = toEpicRef(doc);
    c.openEpics?.push(epic);
    (c.createdEpics ??= []).push(doc);
    return { epic, duplicate: false };
  } catch (error) {
    if (!(error instanceof EpicTitleTakenError)) throw error;
    const clash = await epicService.findByTitle(c.group._id, action.title);
    if (!clash) throw error;
    return { epic: toEpicRef(clash), duplicate: true };
  }
}

/** The task's epic (populated ref, else loaded by id), or null. */
export async function currentEpic(task: ITask): Promise<EpicRef | null> {
  const populated = epicOf(task.epicId);
  if (populated) return toEpicRef(populated as unknown as EpicRef);
  const id = refId(task.epicId);
  if (!id) return null;
  const epic = await epicService.findById(id);
  return epic ? toEpicRef(epic) : null;
}

/** Finds the epic by title in the group; with `create` (the user said "epic mới") a missing one is created. */
export async function findEpic(c: AiRequestContext, title: string, create: boolean): Promise<{ epic: EpicRef; created: boolean } | null> {
  const found = await epicService.findByTitle(c.group._id, title);
  if (found) return { epic: toEpicRef(found), created: false };
  if (!create) return null;
  const outcome = await createEpic(c, { action: 'create_epic', title });
  return { epic: outcome.epic, created: !outcome.duplicate };
}

/** The group's open epics, loaded once per request (cached on the context). */
export async function openEpicsOf(c: AiRequestContext): Promise<EpicRef[]> {
  if (!c.openEpics) c.openEpics = (await epicService.listOpen(c.group._id)).map(toEpicRef);
  return c.openEpics;
}
