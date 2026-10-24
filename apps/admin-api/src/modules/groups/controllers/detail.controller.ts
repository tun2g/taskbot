import { Request, Response } from 'express';
import { deleteGroupSchema } from 'src/modules/groups/groups.schemas';
import { findGroup } from 'src/modules/groups/groups.service';
import { deleteGroup, deletePreview, groupDetail } from 'src/modules/groups/services/detail.service';
import { objectIdParam, parseOr400 } from 'src/shared/http';
import { parseRange } from 'src/stats/range';

// GET /groups/:id?range=30d — numbers only. People: /:id/members; tasks: /:id/tasks.
export async function detail(req: Request, res: Response) {
  const g = await findGroup(objectIdParam(req.params.id, 'group'));
  res.json({ data: await groupDetail(g, parseRange(req.query.range)) });
}

// GET /groups/:id/delete-preview
export async function preview(req: Request, res: Response) {
  const id = objectIdParam(req.params.id, 'group');
  res.json({ data: await deletePreview(id) });
}

// DELETE /groups/:id { confirmName } — the bot leaves the chat first (best effort), then the data is deleted.
export async function remove(req: Request, res: Response) {
  const id = objectIdParam(req.params.id, 'group');
  const { confirmName } = parseOr400(deleteGroupSchema, req.body);
  res.json({ data: await deleteGroup(req, id, confirmName) });
}
