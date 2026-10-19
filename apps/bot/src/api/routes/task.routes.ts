import { Router, type Router as RouterType } from 'express';
import { taskController } from 'src/api/controllers/task.controller';
import { asyncHandler } from 'src/api/middlewares/error-handler.middleware';
import { requireGroupMember, requireTaskMember } from 'src/api/middlewares/group-access.middleware';
import { validateObjectId } from 'src/api/middlewares/validate-object-id.middleware';

const router: RouterType = Router();

const groupScope = [validateObjectId('groupId'), asyncHandler(requireGroupMember())];
const taskScope = [validateObjectId('taskId'), asyncHandler(requireTaskMember())];

// Group-scoped task routes (caller must be a member of the group)
router.get('/groups/:groupId/tasks', ...groupScope, asyncHandler((req, res) => taskController.listTasks(req, res)));
router.post('/groups/:groupId/tasks', ...groupScope, asyncHandler((req, res) => taskController.createTask(req, res)));
router.get('/groups/:groupId/stats', ...groupScope, asyncHandler((req, res) => taskController.getStats(req, res)));

// Task-scoped routes (caller must be a member of the task's group)
router.get('/tasks/:taskId', ...taskScope, asyncHandler((req, res) => taskController.getTask(req, res)));
router.get('/tasks/:taskId/activity', ...taskScope, asyncHandler((req, res) => taskController.getActivity(req, res)));
router.patch('/tasks/:taskId', ...taskScope, asyncHandler((req, res) => taskController.updateTask(req, res)));
router.delete('/tasks/:taskId', ...taskScope, asyncHandler((req, res) => taskController.deleteTask(req, res)));

export { router as taskRoutes };
