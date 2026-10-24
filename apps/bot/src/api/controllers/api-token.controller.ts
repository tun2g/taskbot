import type { CreateApiTokenResponse, McpInfoResponse, RevokeApiTokenResponse } from '@tbot/shared';
import { Request, Response } from 'express';
import { sendError, validationMessage } from 'src/api/http-error';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from 'src/api/middlewares/auth.middleware';
import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { configService } from 'src/configs/configuration';
import { apiTokenService, toApiTokenDto, TooManyTokensError } from 'src/database/services/api-token.service';
import { z } from 'zod';

const SIGN_IN_MESSAGE = 'Please sign in to continue.';
export const TOKEN_NOT_FOUND_MESSAGE = 'This token could not be found. It may already have been revoked.';

export const createApiTokenSchema = z.object({
  name: z
    .string({ message: 'Please give the token a name.' })
    .trim()
    .min(1, 'Please give the token a name.')
    .max(80, 'Token names can be at most 80 characters.'),
  groupId: z
    .string()
    .refine((v) => mongoose.Types.ObjectId.isValid(v), 'That group could not be found. Pick one of your groups.')
    .nullable()
    .optional(),
});

export const TOKEN_GROUP_NOT_ALLOWED_MESSAGE =
  'You can only limit a token to a group you are a member of. Pick one of your groups.';

/** Public MCP endpoint: configured URL, else this server's own address as the browser reached it. */
export function mcpUrlFor(req: Request): string {
  const configured = configService.mcpPublicUrl();
  if (configured) return configured;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol;
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.get('host');
  return `${proto}://${host}/mcp`;
}

export class ApiTokenController {
  /** GET /api/me/tokens → IApiToken[] (active only, newest first). */
  async list(req: Request, res: Response) {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      sendError(res, 401, SIGN_IN_MESSAGE);
      return;
    }
    const tokens = await apiTokenService.listActive(user._id);
    res.json({ data: tokens.map(toApiTokenDto) });
  }

  /** POST /api/me/tokens { name, groupId? } → 201 CreateApiTokenResponse (the secret is shown once). 409 at the limit. */
  async create(req: Request, res: Response) {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      sendError(res, 401, SIGN_IN_MESSAGE);
      return;
    }
    const body = createApiTokenSchema.safeParse(req.body ?? {});
    if (!body.success) {
      sendError(res, 400, validationMessage(body.error), 'Validation error');
      return;
    }
    const groupId = body.data.groupId || null;
    if (groupId) {
      const access = await checkGroupAccess(groupId, user);
      if (!access.ok) {
        sendError(res, 400, access.inactive ? access.message : TOKEN_GROUP_NOT_ALLOWED_MESSAGE, 'Validation error');
        return;
      }
    }
    try {
      const { token, secret } = await apiTokenService.create(user._id, body.data.name, groupId);
      const data: CreateApiTokenResponse = { token: toApiTokenDto(token), secret };
      res.status(201).json({ data });
    } catch (error) {
      if (error instanceof TooManyTokensError) {
        sendError(res, 409, error.message);
        return;
      }
      throw error;
    }
  }

  /** DELETE /api/me/tokens/:id → { revoked: true } (404 when not the caller's active token). */
  async revoke(req: Request, res: Response) {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      sendError(res, 401, SIGN_IN_MESSAGE);
      return;
    }
    const revoked = await apiTokenService.revoke(user._id, String(req.params.id ?? ''));
    if (!revoked) {
      sendError(res, 404, TOKEN_NOT_FOUND_MESSAGE);
      return;
    }
    const data: RevokeApiTokenResponse = { revoked: true };
    res.json({ data });
  }

  /** GET /api/mcp-info → { url } */
  async mcpInfo(req: Request, res: Response) {
    const data: McpInfoResponse = { url: mcpUrlFor(req) };
    res.json({ data });
  }
}

export const apiTokenController = new ApiTokenController();
