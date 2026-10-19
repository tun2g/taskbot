import { Request, Response } from 'express';
import { verifyTelegramLogin } from 'src/api/auth/telegram-login';
import { signWebToken } from 'src/api/auth/web-token';
import { sendError } from 'src/api/http-error';
import { AuthenticatedRequest, upsertTelegramUser } from 'src/api/middlewares/auth.middleware';
import { telegramLoginSchema } from 'src/api/validation';
import { configService } from 'src/configs/configuration';

export class AuthController {
  /** POST /api/auth/telegram-login — Telegram Login Widget payload → bearer token. */
  async telegramLogin(req: Request, res: Response) {
    const parsed = telegramLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'The Telegram login data is incomplete. Please try logging in again.');
      return;
    }

    const check = verifyTelegramLogin(req.body as Record<string, unknown>, configService.botToken);
    if (check === 'expired') {
      sendError(res, 401, 'This Telegram login has expired. Please log in again.');
      return;
    }
    if (check !== 'ok') {
      sendError(res, 401, 'We could not verify your Telegram login. Please try again.');
      return;
    }

    const payload = parsed.data;
    const user = await upsertTelegramUser({
      id: payload.id,
      username: payload.username,
      firstName: payload.first_name,
      lastName: payload.last_name,
    });

    const { token, expiresAt } = signWebToken(payload.id);
    res.json({ data: { token, expiresAt: expiresAt.toISOString(), user } });
  }

  /** GET /api/me */
  async me(req: Request, res: Response) {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      sendError(res, 401, 'Please sign in to continue.');
      return;
    }
    res.json({ data: user });
  }
}

export const authController = new AuthController();
