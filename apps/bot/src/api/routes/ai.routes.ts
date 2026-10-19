import { Router, type Router as RouterType } from 'express';
import { aiController } from 'src/api/controllers/ai.controller';
import { asyncHandler } from 'src/api/middlewares/error-handler.middleware';
import { requireGroupMember } from 'src/api/middlewares/group-access.middleware';
import { validateObjectId } from 'src/api/middlewares/validate-object-id.middleware';

const router: RouterType = Router();

// Web "Ask AI" chat (caller must be a member of the group)
router.post(
  '/groups/:groupId/ai',
  validateObjectId('groupId'),
  asyncHandler(requireGroupMember()),
  asyncHandler((req, res) => aiController.chat(req, res)),
);

// Undo a batch created from the web chat (requester or group admin, within 10 minutes)
router.post('/batches/:batchId/undo', asyncHandler((req, res) => aiController.undo(req, res)));

export { router as aiRoutes };
