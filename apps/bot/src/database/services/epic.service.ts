import { EpicColor, EpicStatus } from '@tbot/shared';
import mongoose from 'mongoose';
import { Epic, IEpic } from 'src/database/models/epic.model';
import { Task } from 'src/database/models/task.model';
import { aggregateEpicProgress, leastUsedColor, withProgress } from 'src/database/services/epic/progress';
import { epicTaskIds, linkEpicTasks } from 'src/database/services/epic/tasks';
import {
  CreateEpicData,
  EpicProgress,
  EpicTitleTakenError,
  EpicWithProgress,
  escapeRegex,
  normalizeEpicTitle,
  UpdateEpicData,
} from 'src/database/services/epic/types';
import logger from 'src/shared/logger/logger';

export {
  emptyProgress,
  EpicTitleTakenError,
  normalizeEpicTitle,
  pickLeastUsedColor,
  type CreateEpicData,
  type EpicProgress,
  type EpicWithProgress,
  type UpdateEpicData,
} from 'src/database/services/epic/types';

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
  getProgress(groupId: mongoose.Types.ObjectId, epicIds?: mongoose.Types.ObjectId[]): Promise<Map<string, EpicProgress>> {
    return aggregateEpicProgress(groupId, epicIds);
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

  /** Ids of the tasks in an epic, open tasks first. */
  taskIds(epic: IEpic): Promise<mongoose.Types.ObjectId[]> {
    return epicTaskIds(epic);
  }

  /** Put tasks (back) into an epic — only tasks of its group that are in no epic now. Returns the ids linked. */
  linkTasks(epic: IEpic, taskIds: string[]): Promise<mongoose.Types.ObjectId[]> {
    return linkEpicTasks(epic, taskIds);
  }

  private leastUsedColor(groupId: mongoose.Types.ObjectId): Promise<EpicColor> {
    return leastUsedColor(groupId);
  }

  private withProgress(epic: IEpic, progress?: EpicProgress): EpicWithProgress {
    return withProgress(epic, progress);
  }
}

export const epicService = new EpicService();
