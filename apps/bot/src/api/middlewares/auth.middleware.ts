import { Request, Response, NextFunction } from 'express';
import { validate, parse } from '@telegram-apps/init-data-node';
import { verifyWebToken } from 'src/api/auth/web-token';
import { sendError } from 'src/api/http-error';
import { configService } from 'src/configs/configuration';
import { IEpic } from 'src/database/models/epic.model';
import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { User } from 'src/database/models/user.model';
import logger from 'src/shared/logger/logger';

export interface AuthenticatedRequest extends Request {
  user?: InstanceType<typeof User>;
  telegramUserId?: number;
  /** Set by requireGroupMember / requireTaskMember. */
  group?: IGroup;
  /** Set by requireTaskMember (createdBy / assigneeId populated). */
  task?: ITask;
  /** Set by requireEpicMember. */
  epic?: IEpic;
}

export interface TelegramUserProfile {
  id: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/** Find or create the user and refresh their profile fields. */
export async function upsertTelegramUser(profile: TelegramUserProfile) {
  return User.findOneAndUpdate(
    { telegramUserId: profile.id },
    {
      $set: {
        username: profile.username ?? null,
        firstName: profile.firstName ?? null,
        lastName: profile.lastName ?? null,
      },
      $setOnInsert: {
        telegramUserId: profile.id,
      },
    },
    { upsert: true, new: true, runValidators: true },
  );
}

const asOptionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const SESSION_EXPIRED = 'Your session has expired. Please sign in again.';

/**
 * Accepts `Authorization: tma <initData>` (inside Telegram, 24h) or
 * `Authorization: Bearer <token>` (browser, from POST /auth/telegram-login).
 */
export const apiAuthMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization || '';

  if (authHeader.startsWith('Bearer ')) {
    const telegramUserId = verifyWebToken(authHeader.slice(7).trim());
    if (telegramUserId === null) {
      sendError(res, 401, SESSION_EXPIRED);
      return;
    }
    try {
      const user = await User.findOne({ telegramUserId });
      if (!user) {
        sendError(res, 401, SESSION_EXPIRED);
        return;
      }
      req.user = user;
      req.telegramUserId = telegramUserId;
      next();
    } catch (error) {
      logger.error(`API auth error (bearer): ${error}`);
      sendError(res, 401, SESSION_EXPIRED);
    }
    return;
  }

  if (!authHeader.startsWith('tma ')) {
    sendError(res, 401, 'Please sign in to continue.');
    return;
  }

  const initData = authHeader.slice(4);

  try {
    // Validate the initData HMAC signature
    validate(initData, configService.botToken, { expiresIn: 86400 }); // 24h expiry

    // Parse to extract user info
    const parsed = parse(initData);
    const telegramUser = parsed.user;

    if (!telegramUser) {
      sendError(res, 401, 'Telegram did not send your user details. Please reopen the app from Telegram.');
      return;
    }

    req.user = await upsertTelegramUser({
      id: telegramUser.id,
      username: asOptionalString(telegramUser.username),
      // init-data-node v2 returns snake_case fields (first_name / last_name)
      firstName: asOptionalString(telegramUser.first_name ?? telegramUser.firstName),
      lastName: asOptionalString(telegramUser.last_name ?? telegramUser.lastName),
    });
    req.telegramUserId = telegramUser.id;
    next();
  } catch (error) {
    logger.error(`API auth error: ${error}`);
    sendError(res, 401, 'Your Telegram session has expired. Please close and reopen the app.');
    return;
  }
};
