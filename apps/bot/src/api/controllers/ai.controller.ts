import type { AiUndoResponse } from '@tbot/shared';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { bot } from 'src/bot';
import { sendError, validationMessage } from 'src/api/http-error';
import { AuthenticatedRequest } from 'src/api/middlewares/auth.middleware';
import { TASK_NOT_FOUND_MESSAGE } from 'src/api/middlewares/group-access.middleware';
import { aiChatSchema } from 'src/api/validation';
import { CardEditor } from 'src/shared/services/ai-command.service';
import { decidePreviewFromApp, WebPreviewResult } from 'src/shared/services/ai-command/subtask-preview.web';
import { handleWebChat, undoAppBatch, UndoAppBatchResult } from 'src/shared/services/ai-command/web-chat';

export {
  BATCH_NOT_FOUND_MESSAGE,
  UNDO_EXPIRED_MESSAGE,
  UNDO_FORBIDDEN_MESSAGE,
} from 'src/shared/services/ai-command/web-chat';
const SIGN_IN_MESSAGE = 'Please sign in to continue.';

const UNDO_STATUS: Record<Exclude<UndoAppBatchResult['status'], 'ok'>, number> = {
  not_found: 404,
  not_member: 403,
  expired: 403,
  forbidden: 403,
};

const PREVIEW_STATUS: Record<Exclude<WebPreviewResult['status'], 'ok'>, number> = {
  expired: 410,
  forbidden: 403,
  busy: 409,
};

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

    const result = await undoAppBatch({ user, batchId: String(req.params.batchId ?? '') });
    if (result.status !== 'ok') {
      sendError(res, UNDO_STATUS[result.status], result.message);
      return;
    }
    const data: AiUndoResponse = { removed: result.removed };
    res.json({ data });
  }

  /**
   * POST /api/ai/previews/:previewId/(accept|cancel) — decide on AI-proposed subtasks (the requester only).
   * accept → { data: AiChatResponse } (kind `created`); cancel → { data: { cancelled: true } }.
   */
  async decidePreview(req: Request, res: Response, decision: 'add' | 'cancel') {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      sendError(res, 401, SIGN_IN_MESSAGE);
      return;
    }
    const result = await decidePreviewFromApp(user, String(req.params.previewId ?? ''), decision);
    if (result.status !== 'ok') {
      sendError(res, PREVIEW_STATUS[result.status], result.message);
      return;
    }
    res.json({ data: result.data });
  }
}

export const aiController = new AiController();
