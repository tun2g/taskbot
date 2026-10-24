import { countGroupData, deleteGroupData } from '@tbot/db';
import type { AdminGroupDeletePreview } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import { BOT_IN_CHAT } from 'src/routes/group-actions';
import { deleteGroupSchema } from 'src/routes/schemas';
import { writeAudit } from 'src/shared/audit';
import { asyncHandler, HttpError, objectIdParam, parseOr400 } from 'src/shared/http';
import { telegram } from 'src/shared/telegram';
import { parseRange } from 'src/stats/range';
import { groupDetail } from './detail.query';
import { findGroup } from './find-group';

export const detailRouter: Router = Router();

// GET /groups/:id?range=30d — numbers only. People: /:id/members; tasks: /:id/tasks.
detailRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const g = await findGroup(objectIdParam(req.params.id, 'group'));
    res.json({ data: await groupDetail(g, parseRange(req.query.range)) });
  }),
);

// GET /groups/:id/delete-preview
detailRouter.get(
  '/:id/delete-preview',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    const g = await findGroup(id);
    const counts = await countGroupData(id);
    const body: AdminGroupDeletePreview = { group: { id: String(g._id), name: g.groupName, status: g.status }, ...counts };
    res.json({ data: body });
  }),
);

// DELETE /groups/:id { confirmName } — the bot leaves the chat first (best effort), then the data is deleted.
detailRouter.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    const { confirmName } = parseOr400(deleteGroupSchema, req.body);
    const g = await findGroup(id);
    if (confirmName !== g.groupName) {
      throw new HttpError(400, `The name doesn't match. Type “${g.groupName}” exactly to delete this group.`);
    }
    const warnings: string[] = [];
    if (BOT_IN_CHAT.includes(g.status)) {
      const left = await telegram.leaveChat(g.telegramGroupId);
      if (!left.ok) warnings.push(`Couldn't make the bot leave the chat (${left.error}). Remove it from the group in Telegram if it is still there.`);
    }
    const deleted = await deleteGroupData(id);
    await writeAudit(req, {
      action: 'group.delete',
      targetType: 'group',
      targetId: String(id),
      targetLabel: g.groupName,
      details: { ...deleted, telegramGroupId: g.telegramGroupId, statusBefore: g.status, ...(warnings.length ? { warnings } : {}) },
    });
    res.json({ data: { deleted, warnings } });
  }),
);
