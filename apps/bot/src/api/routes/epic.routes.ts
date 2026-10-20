import { Router, type Router as RouterType } from 'express';
import { epicController } from 'src/api/controllers/epic.controller';
import { asyncHandler } from 'src/api/middlewares/error-handler.middleware';
import { requireEpicMember, requireGroupMember } from 'src/api/middlewares/group-access.middleware';
import { validateObjectId } from 'src/api/middlewares/validate-object-id.middleware';

const router: RouterType = Router();

const groupScope = [validateObjectId('groupId'), asyncHandler(requireGroupMember())];
const epicScope = [validateObjectId('epicId'), asyncHandler(requireEpicMember())];

// Group-scoped epic routes (caller must be a member of the group)
router.get('/groups/:groupId/epics', ...groupScope, asyncHandler((req, res) => epicController.listEpics(req, res)));
router.post('/groups/:groupId/epics', ...groupScope, asyncHandler((req, res) => epicController.createEpic(req, res)));

// Epic-scoped routes (caller must be a member of the epic's group; any member may edit/delete)
router.patch('/epics/:epicId', ...epicScope, asyncHandler((req, res) => epicController.updateEpic(req, res)));
router.delete('/epics/:epicId', ...epicScope, asyncHandler((req, res) => epicController.deleteEpic(req, res)));

export { router as epicRoutes };
