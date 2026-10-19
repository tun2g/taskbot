import { Router, type Router as RouterType } from 'express';
import { authController } from 'src/api/controllers/auth.controller';
import { asyncHandler } from 'src/api/middlewares/error-handler.middleware';

const router: RouterType = Router();

// Public — exchanges a Telegram Login Widget payload for a bearer token
router.post('/telegram-login', asyncHandler((req, res) => authController.telegramLogin(req, res)));

export { router as authRoutes };
