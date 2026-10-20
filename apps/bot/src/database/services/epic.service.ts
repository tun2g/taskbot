import { EPIC_AUTO_COLORS, EpicColor, EpicStatus, getStatusCategory, TaskStatus, TaskStatusCategory } from '@tbot/shared';
import mongoose from 'mongoose';
import { Epic, IEpic } from 'src/database/models/epic.model';
import { Task } from 'src/database/models/task.model';
import logger from 'src/shared/logger/logger';

export interface EpicProgress {
  /** Tasks in the epic, cancelled ones excluded. */
  total: number;
  /** Tasks in the "done" category (cancelled excluded). */
  done: number;
  /** Tasks in the "in progress" category. */
  inProgress: number;
  /** Cancelled tasks still in the epic (not part of `total`). */
  cancelled: number;
}

export type EpicWithProgress = Record<string, unknown> & { _id: mongoose.Types.ObjectId; progress: EpicProgress };

export interface CreateEpicData {
  groupId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  title: string;
  description?: string | null;
  color?: EpicColor;
  /** Undo of a delete recreates a done epic as done. */
  status?: EpicStatus;
}

export interface UpdateEpicData {
  title?: string;
  description?: string | null;
  color?: EpicColor;
  status?: EpicStatus;
}

/** Thrown when another epic in the same group already has this title (case-insensitive) → 409. */
export class EpicTitleTakenError extends Error {
  constructor(public readonly title: string) {
    super(`An epic called "${title}" already exists in this group. Pick another name.`);
    this.name = 'EpicTitleTakenError';
  }
}

export function emptyProgress(): EpicProgress {
  return { total: 0, done: 0, inProgress: 0, cancelled: 0 };
}

/** Collapse spaces so "Login  page" and "Login page" are the same title. */
export function normalizeEpicTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Least-used color in the group; ties go to the earliest color in palette order. Red is never auto-picked. */
export function pickLeastUsedColor(usage: Partial<Record<string, number>>): EpicColor {
  let best = EPIC_AUTO_COLORS[0];
  let bestCount = Infinity;
  for (const color of EPIC_AUTO_COLORS) {
    const count = usage[color] ?? 0;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

export class EpicService {
  /** Every epic in the group (oldest first) with its task counts — one aggregation over tasks. */
  async listWithProgress(groupId: mongoose.Types.ObjectId): Promise<EpicWithProgress[]> {
    const [epics, progress] = await Promise.all([
      Epic.find({ groupId }).populate('createdBy').sort({ createdAt: 1 }),
      this.getProgress(groupId),
    ]);
    return epics.map((epic) => this.withProgress(epic, progress.get(String(epic._id))));
  }

  /**
   * Task counts per epic: `total` excludes cancelled tasks, `done` = done category, `inProgress` = in-progress
   * category, `cancelled` = cancelled tasks still in the epic. Optionally limited to some epics.
   */
  async getProgress(
    groupId: mongoose.Types.ObjectId,
    epicIds?: mongoose.Types.ObjectId[],
  ): Promise<Map<string, EpicProgress>> {
    const result = new Map<string, EpicProgress>();
    const rows: { _id: { epicId: mongoose.Types.ObjectId; status: string }; count: number }[] = await Task.aggregate([
      {
        $match: {
          groupId,
          epicId: epicIds ? { $in: epicIds } : { $ne: null },
        },
      },
      { $group: { _id: { epicId: '$epicId', status: '$status' }, count: { $sum: 1 } } },
    ]);

    for (const row of rows) {
      const key = String(row._id.epicId);
      const progress = result.get(key) ?? emptyProgress();
      result.set(key, progress);
      if (row._id.status === TaskStatus.CANCELLED) {
        progress.cancelled += row.count;
        continue;
      }
      progress.total += row.count;
      const category = getStatusCategory(row._id.status);
      if (category === TaskStatusCategory.DONE) progress.done += row.count;
      else if (category === TaskStatusCategory.IN_PROGRESS) progress.inProgress += row.count;
      result.set(key, progress);
    }
    return result;
  }

  /** One epic with its progress (for create/update responses). */
  async withProgressFor(epic: IEpic): Promise<EpicWithProgress> {
    if (typeof epic.populate === 'function') await epic.populate('createdBy');
    const progress = await this.getProgress(epic.groupId, [epic._id as mongoose.Types.ObjectId]);
    return this.withProgress(epic, progress.get(String(epic._id)));
  }

  /** Open epics of the group, oldest first (no progress — cheap enough for every /ai request). */
  async listOpen(groupId: mongoose.Types.ObjectId, limit = 100): Promise<IEpic[]> {
    try {
      return await Epic.find({ groupId, status: EpicStatus.OPEN }).sort({ createdAt: 1 }).limit(limit);
    } catch (error) {
      logger.error(`Error listing open epics of group ${groupId}: ${error}`);
      return [];
    }
  }

  async findById(epicId: string | mongoose.Types.ObjectId): Promise<IEpic | null> {
    try {
      return await Epic.findById(epicId);
    } catch (error) {
      logger.error(`Error getting epic ${epicId}: ${error}`);
      return null;
    }
  }

  /** The epic, but only if it belongs to this group (null otherwise). */
  async findInGroup(
    groupId: mongoose.Types.ObjectId,
    epicId: string | mongoose.Types.ObjectId,
  ): Promise<IEpic | null> {
    if (!mongoose.Types.ObjectId.isValid(String(epicId))) return null;
    return Epic.findOne({ _id: epicId, groupId });
  }

  /** Case-insensitive exact title match in the group (e.g. "login" finds "Login"). */
  async findByTitle(groupId: mongoose.Types.ObjectId, title: string): Promise<IEpic | null> {
    const normalized = normalizeEpicTitle(title);
    if (!normalized) return null;
    return Epic.findOne({ groupId, title: { $regex: `^${escapeRegex(normalized)}$`, $options: 'i' } });
  }

  async create(data: CreateEpicData): Promise<IEpic> {
    const title = normalizeEpicTitle(data.title);
    if (await this.findByTitle(data.groupId, title)) throw new EpicTitleTakenError(title);

    const color = data.color ?? (await this.leastUsedColor(data.groupId));
    const epic = await Epic.create({
      groupId: data.groupId,
      createdBy: data.createdBy,
      title,
      description: data.description || null,
      color,
      status: data.status ?? EpicStatus.OPEN,
    });
    logger.info(`Epic "${title}" created in group ${data.groupId}`);
    return epic;
  }

  /** Writes only the given fields. Throws EpicTitleTakenError when renaming onto another epic's title. */
  async update(epic: IEpic, data: UpdateEpicData): Promise<IEpic | null> {
    const updates: Record<string, unknown> = {};
    if (data.title !== undefined) {
      const title = normalizeEpicTitle(data.title);
      if (title !== epic.title) {
        const clash = await this.findByTitle(epic.groupId, title);
        if (clash && String(clash._id) !== String(epic._id)) throw new EpicTitleTakenError(title);
        updates.title = title;
      }
    }
    if (data.description !== undefined) updates.description = data.description || null;
    if (data.color !== undefined) updates.color = data.color;
    if (data.status !== undefined) updates.status = data.status;
    if (Object.keys(updates).length === 0) return epic;

    return Epic.findByIdAndUpdate(epic._id, { $set: updates }, { new: true, runValidators: true });
  }

  /**
   * Delete the epic and take its tasks out of it (tasks are kept).
   * Returns the ids of the tasks that were unlinked (so their cards can be refreshed).
   */
  async delete(epic: IEpic): Promise<mongoose.Types.ObjectId[]> {
    const taskIds = await this.taskIds(epic);
    await Task.updateMany({ groupId: epic.groupId, epicId: epic._id }, { $set: { epicId: null } });
    await Epic.deleteOne({ _id: epic._id });
    logger.info(`Epic "${epic.title}" deleted in group ${epic.groupId} (${taskIds.length} tasks unlinked)`);
    return taskIds;
  }

  /**
   * Ids of the tasks in an epic (e.g. to refresh their cards after a rename) — open tasks first, so a capped card
   * refresh reaches the cards people still look at.
   */
  async taskIds(epic: IEpic): Promise<mongoose.Types.ObjectId[]> {
    const tasks: { _id: mongoose.Types.ObjectId; status?: string }[] = await Task.find(
      { groupId: epic.groupId, epicId: epic._id },
      { _id: 1, status: 1 },
    );
    const isClosed = (status?: string) =>
      status === TaskStatus.CANCELLED || getStatusCategory(status ?? '') === TaskStatusCategory.DONE;
    return [...tasks]
      .sort((a, b) => Number(isClosed(a.status)) - Number(isClosed(b.status)))
      .map((t) => t._id as mongoose.Types.ObjectId);
  }

  /**
   * Put tasks (back) into an epic — only tasks of the epic's group that are in no epic now, so an undo never steals
   * a task someone has since moved elsewhere. Returns the ids actually linked.
   */
  async linkTasks(epic: IEpic, taskIds: string[]): Promise<mongoose.Types.ObjectId[]> {
    const ids = [...new Set(taskIds)].filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (ids.length === 0) return [];
    const filter = { _id: { $in: ids }, groupId: epic.groupId, epicId: null };
    const tasks = await Task.find(filter, { _id: 1 });
    const linked = tasks.map((t) => t._id as mongoose.Types.ObjectId);
    if (linked.length === 0) return [];
    await Task.updateMany({ ...filter, _id: { $in: linked } }, { $set: { epicId: epic._id } });
    logger.info(`Epic "${epic.title}": ${linked.length} task(s) linked back in group ${epic.groupId}`);
    return linked;
  }

  private async leastUsedColor(groupId: mongoose.Types.ObjectId): Promise<EpicColor> {
    const rows: { _id: string; count: number }[] = await Epic.aggregate([
      { $match: { groupId } },
      { $group: { _id: '$color', count: { $sum: 1 } } },
    ]);
    return pickLeastUsedColor(Object.fromEntries(rows.map((r) => [r._id, r.count])));
  }

  private withProgress(epic: IEpic, progress?: EpicProgress): EpicWithProgress {
    const plain = typeof epic.toObject === 'function' ? epic.toObject() : (epic as unknown as Record<string, unknown>);
    return { ...plain, _id: epic._id as mongoose.Types.ObjectId, progress: progress ?? emptyProgress() };
  }
}

export const epicService = new EpicService();
