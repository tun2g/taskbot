import { randomBytes } from 'crypto';
import mongoose from 'mongoose';
import { Group } from 'src/database/models/group.model';
import { TaskActivityVia } from 'src/database/models/task-activity.model';
import { ITask } from 'src/database/models/task.model';
import { IUser, User } from 'src/database/models/user.model';
import { taskService } from 'src/database/services/task.service';
import logger from 'src/shared/logger/logger';
import { personName } from 'src/shared/services/ai-command/format';
import { SubtasksOutcome } from 'src/shared/services/ai-command/result';
import { createSubtaskItems, ReadyItem } from 'src/shared/services/ai-command/subtask-items';
import { redisService } from 'src/shared/services/redis.service';

// An AI-proposed breakdown ("break #42 down" with nothing listed) is shown first and created only when the
// requester taps ✅ Add all (Telegram) / Add all (web chat). The proposal waits in Redis for an hour.

export const SUBTASK_PREVIEW_PREFIX = 'subprev';
export const SUBTASK_PREVIEW_TTL_SECONDS = 60 * 60;

interface StoredPreview {
  groupId: string;
  parentTaskId: string;
  parentNumber: number;
  requesterId: string;
  requesterTelegramId: number;
  requesterName: string;
  activityVia: TaskActivityVia;
  items: { title: string; assigneeId: string | null; dueDate: string | null }[];
  /** Plain notes shown with the preview (unknown people, …), kept for the final reply. */
  warnings: string[];
  /** The request as typed (its language picks the wording of the final reply). */
  request: string;
  createdAt: number;
}

const keyOf = (id: string) => `${SUBTASK_PREVIEW_PREFIX}:${id}`;

/** Stores a proposal; returns its id, or null when Redis is unavailable (the caller then creates nothing). */
export async function savePreview(
  ctx: { group: { _id: unknown }; requester: IUser; activityVia: TaskActivityVia; request: string },
  parent: ITask,
  items: ReadyItem[],
  warnings: string[],
): Promise<string | null> {
  const id = randomBytes(6).toString('hex');
  const data: StoredPreview = {
    groupId: String(ctx.group._id),
    parentTaskId: String(parent._id),
    parentNumber: parent.taskNumber,
    requesterId: String(ctx.requester._id),
    requesterTelegramId: ctx.requester.telegramUserId,
    requesterName: personName(ctx.requester),
    activityVia: ctx.activityVia,
    items: items.map((i) => ({
      title: i.title,
      assigneeId: i.assignee ? String(i.assignee._id) : null,
      dueDate: i.dueDate ?? null,
    })),
    warnings,
    request: ctx.request.slice(0, 300),
    createdAt: Date.now(),
  };
  try {
    await redisService.set(keyOf(id), JSON.stringify(data), { EX: SUBTASK_PREVIEW_TTL_SECONDS });
    return id;
  } catch (error) {
    logger.warn(`Could not store subtask preview for #${parent.taskNumber}: ${error}`);
    return null;
  }
}

async function loadPreview(id: string): Promise<StoredPreview | null> {
  if (!/^[0-9a-f]{12}$/.test(id)) return null;
  try {
    const raw = await redisService.get(keyOf(id));
    return raw ? (JSON.parse(raw) as StoredPreview) : null;
  } catch (error) {
    logger.error(`Could not load subtask preview ${id}: ${error}`);
    return null;
  }
}

export type PreviewDecision =
  | { status: 'expired' }
  | { status: 'forbidden'; requesterName: string }
  | { status: 'busy' }
  | { status: 'cancelled'; parentNumber: number }
  | { status: 'added'; outcome: SubtasksOutcome; request: string };

/**
 * Accepts (`add`) or drops (`cancel`) a stored proposal. Only the person who asked may decide. `by` matches
 * the requester by Telegram id (bot buttons) or user id (web chat).
 */
export async function decidePreview(
  id: string,
  decision: 'add' | 'cancel',
  by: { telegramUserId?: number; userId?: string },
  channel: 'telegram' | 'web',
): Promise<PreviewDecision> {
  const preview = await loadPreview(id);
  if (!preview) return { status: 'expired' };
  const isRequester =
    (by.telegramUserId !== undefined && by.telegramUserId === preview.requesterTelegramId) ||
    (by.userId !== undefined && by.userId === preview.requesterId);
  if (!isRequester) return { status: 'forbidden', requesterName: preview.requesterName };

  // Double taps must not create twice.
  const lock = await redisService.set(`${keyOf(id)}:lock`, '1', { NX: true, EX: 60 });
  if (lock === null) return { status: 'busy' };
  await redisService.del(keyOf(id)).catch(() => undefined);
  if (decision === 'cancel') return { status: 'cancelled', parentNumber: preview.parentNumber };

  const [group, requester, parent] = await Promise.all([
    Group.findById(preview.groupId),
    User.findById(preview.requesterId),
    taskService.getTaskById(preview.parentTaskId),
  ]);
  if (!group || !requester || !parent) return { status: 'expired' };

  const ids = preview.items.map((i) => i.assigneeId).filter((v): v is string => !!v);
  const people = ids.length ? await User.find({ _id: { $in: ids.map((v) => new mongoose.Types.ObjectId(v)) } }) : [];
  const byId = new Map(people.map((p) => [String(p._id), p]));
  const items: ReadyItem[] = preview.items.map((i) => ({
    title: i.title,
    assignee: i.assigneeId ? (byId.get(i.assigneeId) ?? null) : null,
    dueDate: i.dueDate,
  }));

  const outcome = await createSubtaskItems(
    { group, requester, activityVia: preview.activityVia, channel },
    parent,
    items,
    { proposed: true, warnings: preview.warnings },
  );
  return { status: 'added', outcome, request: preview.request ?? '' };
}
