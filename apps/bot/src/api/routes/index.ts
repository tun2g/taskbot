import { Router, type Router as RouterType } from 'express';
import { authController } from 'src/api/controllers/auth.controller';
import { apiAuthMiddleware } from 'src/api/middlewares/auth.middleware';
import { asyncHandler } from 'src/api/middlewares/error-handler.middleware';
import { aiRoutes } from 'src/api/routes/ai.routes';
import { authRoutes } from 'src/api/routes/auth.routes';
import { epicRoutes } from 'src/api/routes/epic.routes';
import { groupRoutes } from 'src/api/routes/group.routes';
import { taskRoutes } from 'src/api/routes/task.routes';

const router: RouterType = Router();

// Public routes
router.use('/auth', authRoutes);

// Everything below requires auth (`tma <initData>` or `Bearer <token>`)
router.use(apiAuthMiddleware as any);

router.get('/me', asyncHandler((req, res) => authController.me(req, res)));
router.use('/groups', groupRoutes);
router.use('/', taskRoutes);
router.use('/', epicRoutes);
router.use('/', aiRoutes);

export { router as apiRouter };
