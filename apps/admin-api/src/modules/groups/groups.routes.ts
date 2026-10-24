import { Router } from 'express';
import { DECISIONS, decide, leave, patchAi, reconsider } from 'src/modules/groups/controllers/actions.controller';
import { detail, preview, remove } from 'src/modules/groups/controllers/detail.controller';
import { list } from 'src/modules/groups/controllers/list.controller';
import { members } from 'src/modules/groups/controllers/members.controller';
import { epics, tasks } from 'src/modules/groups/controllers/tasks.controller';
import { asyncHandler } from 'src/shared/http';

/**
 * /api/groups — list, detail (+ delete), lifecycle actions and AI overrides, and the paged lists behind the detail
 * page's numbers (people, tasks, epics).
 */
export const groupsRouter: Router = Router();

groupsRouter.get('/', asyncHandler(list));

groupsRouter.get('/:id', asyncHandler(detail));
groupsRouter.get('/:id/delete-preview', asyncHandler(preview));
groupsRouter.delete('/:id', asyncHandler(remove));

for (const decision of DECISIONS) groupsRouter.post(`/:id/${decision}`, asyncHandler(decide(decision)));
groupsRouter.post('/:id/leave', asyncHandler(leave));
groupsRouter.post('/:id/reconsider', asyncHandler(reconsider));
groupsRouter.patch('/:id/ai', asyncHandler(patchAi));

groupsRouter.get('/:id/members', asyncHandler(members));

groupsRouter.get('/:id/tasks', asyncHandler(tasks));
groupsRouter.get('/:id/epics', asyncHandler(epics));
