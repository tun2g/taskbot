import type { AiUndoResponse } from '@tbot/shared';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { bot } from 'src/bot';
import { refId } from 'src/bot/task-card.renderer';
import { sendError, validationMessage } from 'src/api/http-error';
import { AuthenticatedRequest } from 'src/api/middlewares/auth.middleware';
import { NOT_A_MEMBER_MESSAGE, TASK_NOT_FOUND_MESSAGE } from 'src/api/middlewares/group-access.middleware';
import { isTelegramGroupAdmin } from 'src/api/telegram-admin';
import { aiChatSchema } from 'src/api/validation';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { taskService } from 'src/database/services/task.service';
import { CardEditor } from 'src/shared/services/ai-command.service';
import { forgetAppBatchPost, getAppBatchPost, handleWebChat } from 'src/shared/services/ai-command/web-chat';
import { undoBatch } from 'src/shared/services/batch-undo.service';
import { BATCH_UNDO_WINDOW_MS } from 'src/shared/services/task-creation.service';
import { taskSyncService, userDisplayName } from 'src/shared/services/task-sync.service';

export const UNDO_EXPIRED_MESSAGE = 'Undo is only available for 10 minutes after creating.';
export const UNDO_FORBIDDEN_MESSAGE = 'Only the person who created these tasks or a group admin can undo.';
export const BATCH_NOT_FOUND_MESSAGE = 'These tasks were already removed or could not be found.';
const SIGN_IN_MESSAGE = 'Please sign in to continue.';
const BATCH_ID = /^[0-9a-f]{16}$/;

export class AiController {
  /** POST /api/groups/:groupId/ai → { data: AiChatResponse } */
  async chat(req: Request, res: Response) {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const group = authReq.group;
    if (!user || !group) {
      sendError(res, 401, SIGN_IN_MESSAGE);
      return;
    }

    const body = aiChatSchema.safeParse(req.body ?? {});
    if (!body.success) {
      sendError(res, 400, validationMessage(body.error));
      return;
    }

    const outcome = await handleWebChat({
      group,
      requester: user,
      message: body.data.message,
      taskId: body.data.taskId,
      history: body.data.history,
      editor: bot.telegram as unknown as CardEditor,
    });

    if (outcome.status === 'task_not_found') {
      sendError(res, 404, TASK_NOT_FOUND_MESSAGE);
      return;
    }
    if (outcome.status === 'rate_limited') {
      res.status(429).json({ error: 'Too Many Requests', message: outcome.message, statusCode: 429 });
      return;
    }
    res.json({ data: outcome.data });
  }

  /** POST /api/batches/:batchId/undo → { data: AiUndoResponse }. Same rules as the chat ↩️ Undo button. */
  async undo(req: Request, res: Response) {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    if (!user) {
      sendError(res, 401, SIGN_IN_MESSAGE);
      return;
    }

    const batchId = String(req.params.batchId ?? '');
    const tasks = BATCH_ID.test(batchId) ? await taskService.getTasksByBatch(batchId) : [];
    if (tasks.length === 0) {
      sendError(res, 404, BATCH_NOT_FOUND_MESSAGE);
      return;
    }

    const groupId = tasks[0].groupId as mongoose.Types.ObjectId;
    if (!(await groupMemberService.isMember(groupId, user._id))) {
      sendError(res, 403, NOT_A_MEMBER_MESSAGE);
      return;
    }

    const createdAt = Math.min(...tasks.map((t) => new Date(t.createdAt ?? 0).getTime()));
    if (Date.now() - createdAt > BATCH_UNDO_WINDOW_MS) {
      sendError(res, 403, UNDO_EXPIRED_MESSAGE);
      return;
    }

    const isRequester = refId(tasks[0].createdBy) === String(user._id);
    if (!isRequester) {
      const group = await groupService.findGroupById(groupId);
      const isAdmin = group ? await isTelegramGroupAdmin(group.telegramGroupId, user.telegramUserId) : false;
      if (!isAdmin) {
        sendError(res, 403, UNDO_FORBIDDEN_MESSAGE);
        return;
      }
    }

    const { removed, tasks: removedTasks } = await undoBatch({
      batchId,
      groupId: groupId.toString(),
      actor: user._id as mongoose.Types.ObjectId,
      via: 'app',
      tasks,
    });

    const post = await getAppBatchPost(batchId);
    if (post) {
      await taskSyncService.markBatchUndone(post, userDisplayName(user), removed, removedTasks, groupId);
      await forgetAppBatchPost(batchId);
    }

    const data: AiUndoResponse = { removed };
    res.json({ data });
  }
}

export const aiController = new AiController();
