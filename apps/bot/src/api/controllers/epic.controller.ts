import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { sendError, validationMessage } from 'src/api/http-error';
import { AuthenticatedRequest } from 'src/api/middlewares/auth.middleware';
import { EPIC_NOT_FOUND_MESSAGE } from 'src/api/middlewares/group-access.middleware';
import { createEpicSchema, updateEpicSchema } from 'src/api/validation';
import { IEpic } from 'src/database/models/epic.model';
import { EpicTitleTakenError, epicService } from 'src/database/services/epic.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { epicEventsService } from 'src/shared/services/epic-events.service';
import logger from 'src/shared/logger/logger';
import { taskSyncService } from 'src/shared/services/task-sync.service';

const SIGN_IN_MESSAGE = 'Please sign in to continue.';
/** Cards edited after an epic rename / recolor / delete — enough for real epics, gentle on Telegram limits. */
const CARD_REFRESH_MAX = 50;

/**
 * Re-render the group cards of these tasks (they show the epic) — best effort, in the background.
 * Only the first CARD_REFRESH_MAX are refreshed; `epicService.taskIds()` lists open tasks first for that reason.
 */
export async function refreshTaskCards(taskIds: mongoose.Types.ObjectId[]): Promise<void> {
  for (const taskId of taskIds.slice(0, CARD_REFRESH_MAX)) {
    await taskSyncService.syncTaskCard({ _id: taskId } as never).catch((error: unknown) => {
      logger.warn(`Could not refresh card of task ${taskId}: ${error}`);
    });
  }
}

/** One "epic" activity row per task (`from` / `to` are plain epic titles, like a change from the task page). */
async function recordEpicActivity(
  epic: IEpic,
  taskIds: mongoose.Types.ObjectId[],
  actor: mongoose.Types.ObjectId,
  change: { from: string | null; to: string | null },
): Promise<void> {
  await Promise.all(
    taskIds.map((taskId) =>
      taskActivityService.record({ taskId, groupId: epic.groupId, actor, action: 'epic', ...change, via: 'app' }),
    ),
  );
}

function sendTitleTaken(res: Response, error: unknown): boolean {
  if (error instanceof EpicTitleTakenError) {
    sendError(res, 409, error.message);
    return true;
  }
  return false;
}

export class EpicController {
  /** GET /api/groups/:groupId/epics → EpicWithProgress[] (oldest first). */
  async listEpics(req: Request, res: Response) {
    const groupId = new mongoose.Types.ObjectId(req.params.groupId as string);
    const epics = await epicService.listWithProgress(groupId);
    res.json({ data: epics });
  }

  /**
   * POST /api/groups/:groupId/epics (CreateEpicInput) → 201 EpicWithProgress. Any member may create.
   * With `taskIds` (undo of a delete) those tasks go back into it — only ones of this group that have no epic now.
   * A new epic is announced in the group; a restore (`taskIds` present, even empty) stays quiet.
   */
  async createEpic(req: Request, res: Response) {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      sendError(res, 401, SIGN_IN_MESSAGE);
      return;
    }

    const bodyResult = createEpicSchema.safeParse(req.body);
    if (!bodyResult.success) {
      sendError(res, 400, validationMessage(bodyResult.error), 'Validation error');
      return;
    }
    const data = bodyResult.data;

    try {
      const epic = await epicService.create({
        groupId: new mongoose.Types.ObjectId(req.params.groupId as string),
        createdBy: user._id as mongoose.Types.ObjectId,
        title: data.title,
        description: data.description,
        color: data.color,
        status: data.status,
      });
      if (data.taskIds?.length) {
        const linked = await epicService.linkTasks(epic, data.taskIds);
        await recordEpicActivity(epic, linked, user._id as mongoose.Types.ObjectId, { from: null, to: epic.title });
        refreshTaskCards(linked).catch(() => {});
      }
      if (data.taskIds === undefined) void epicEventsService.created(epic, user, 'app');
      res.status(201).json({ data: await epicService.withProgressFor(epic) });
    } catch (error) {
      if (!sendTitleTaken(res, error)) throw error;
    }
  }

  /** PATCH /api/epics/:epicId (UpdateEpicInput) → EpicWithProgress. Any member may edit. */
  async updateEpic(req: Request, res: Response) {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      sendError(res, 401, SIGN_IN_MESSAGE);
      return;
    }

    const bodyResult = updateEpicSchema.safeParse(req.body);
    if (!bodyResult.success) {
      sendError(res, 400, validationMessage(bodyResult.error), 'Validation error');
      return;
    }

    const before: IEpic | null = authReq.epic ?? (await epicService.findById(req.params.epicId as string));
    if (!before) {
      sendError(res, 404, EPIC_NOT_FOUND_MESSAGE);
      return;
    }
    const previous = { title: before.title, color: before.color, status: before.status };

    let epic: IEpic | null;
    try {
      epic = await epicService.update(before, bodyResult.data);
    } catch (error) {
      if (sendTitleTaken(res, error)) return;
      throw error;
    }
    if (!epic) {
      sendError(res, 404, EPIC_NOT_FOUND_MESSAGE);
      return;
    }

    // Cards show "🔵 Login" — refresh them when the name or color changed.
    if (epic.title !== previous.title || epic.color !== previous.color) {
      epicService
        .taskIds(epic)
        .then(refreshTaskCards)
        .catch(() => {});
    }
    // Done / reopened are announced in the group; rename / recolor / description edits are not.
    if (epic.status !== previous.status) {
      void epicEventsService.statusChanged(previous.status, epic, authReq.user, 'app');
    }

    res.json({ data: await epicService.withProgressFor(epic) });
  }

  /**
   * DELETE /api/epics/:epicId → { deleted: true, tasksUnlinked, taskIds }. Tasks are kept, just taken out of the
   * epic; each gets an "epic" activity row. `taskIds` lets the app undo (POST epics with `taskIds`).
   */
  async deleteEpic(req: Request, res: Response) {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      sendError(res, 401, SIGN_IN_MESSAGE);
      return;
    }

    const epic = authReq.epic ?? (await epicService.findById(req.params.epicId as string));
    if (!epic) {
      sendError(res, 404, EPIC_NOT_FOUND_MESSAGE);
      return;
    }

    const taskIds = await epicService.delete(epic);
    await recordEpicActivity(epic, taskIds, authReq.user._id as mongoose.Types.ObjectId, {
      from: epic.title,
      to: null,
    });
    refreshTaskCards(taskIds).catch(() => {});
    void epicEventsService.deleted(epic, authReq.user, taskIds.length, 'app');

    res.json({ data: { deleted: true, tasksUnlinked: taskIds.length, taskIds: taskIds.map(String) } });
  }
}

export const epicController = new EpicController();
