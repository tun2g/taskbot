import { NextFunction, Request, Response } from 'express';
import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { IApiToken } from 'src/database/models/api-token.model';
import { IGroup } from 'src/database/models/group.model';
import { IUser } from 'src/database/models/user.model';
import { apiTokenService, isApiTokenSecret } from 'src/database/services/api-token.service';
import logger from 'src/shared/logger/logger';
import { rateLimitService } from 'src/shared/services/rate-limit.service';

/** MCP requests per token per minute (tools/call, tools/list, initialize… all count). */
export const MCP_RATE_LIMIT = 120;
/** Per user across all their tokens — otherwise 10 tokens (or revoke + recreate) multiply the limit. */
export const MCP_USER_RATE_LIMIT = 240;
const MCP_RATE_WINDOW_SECONDS = 60;

export interface McpRequest extends Request {
  user?: IUser;
  apiToken?: IApiToken;
  /** Set for group-scoped tokens (membership checked on every request). */
  scopeGroup?: IGroup | null;
}

export const SCOPE_LOST_MESSAGE =
  "This token is limited to a group you're no longer a member of (or that was removed). Create a new token with /mcp in a private chat with the bot.";

const AUTH_HELP =
  'Send "Authorization: Bearer tbot_…". Get a token by sending /mcp to the bot in a private Telegram chat, or on the Tokens page of the app.';

const REASON_TEXT: Record<string, string> = {
  missing: `Missing access token. ${AUTH_HELP}`,
  malformed: `That is not a TaskBot access token (they start with "tbot_"). ${AUTH_HELP}`,
  unknown: `Unknown access token. ${AUTH_HELP}`,
  revoked: 'This access token was revoked. Create a new one with /mcp in a private chat with the bot.',
  expired: 'This access token has expired. Create a new one with /mcp in a private chat with the bot.',
};

/** 401 in both MCP/OAuth style (WWW-Authenticate) and as a JSON-RPC error body the client can show. */
function unauthorized(res: Response, reason: keyof typeof REASON_TEXT) {
  const message = REASON_TEXT[reason];
  const error = reason === 'missing' ? '' : ', error="invalid_token"';
  // Header values must be plain ASCII ("…" would make Node throw).
  const description = message
    .replace(/…/g, '...')
    .replace(/"/g, "'")
    .replace(/[^\x20-\x7E]/g, '');
  res.setHeader('WWW-Authenticate', `Bearer realm="taskbot"${error}, error_description="${description}"`);
  res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null });
}

/**
 * `Authorization: Bearer tbot_…` → `req.user` + `req.apiToken`, then the per-token and per-user rate limits.
 * Web session tokens are not accepted here.
 */
export async function mcpAuthMiddleware(req: McpRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const secret = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!secret) {
    unauthorized(res, 'missing');
    return;
  }
  if (!isApiTokenSecret(secret)) {
    unauthorized(res, 'malformed');
    return;
  }

  try {
    const result = await apiTokenService.authenticate(secret);
    if (!result.ok) {
      unauthorized(res, result.reason);
      return;
    }

    const limits = [
      { id: String(result.token._id), action: 'mcp', max: MCP_RATE_LIMIT, per: 'per token' },
      { id: String(result.user._id), action: 'mcp_user', max: MCP_USER_RATE_LIMIT, per: 'per user (all tokens)' },
    ];
    for (const { id, action, max, per } of limits) {
      const limit = await rateLimitService.checkRateLimit(id, action, max, MCP_RATE_WINDOW_SECONDS, {
        userId: result.user._id,
        channel: 'mcp',
      });
      if (limit.allowed) continue;
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      res.status(429).json({
        jsonrpc: '2.0',
        error: {
          code: -32029,
          message: `Too many requests: at most ${max} per minute ${per}. Try again in ${limit.retryAfterSeconds}s.`,
        },
        id: null,
      });
      return;
    }

    let scopeGroup: IGroup | null = null;
    if (result.token.groupId) {
      // A paused / pending group keeps the connection; its tools explain why they can't run (requireGroup).
      const access = await checkGroupAccess(String(result.token.groupId), result.user, { allowInactive: true });
      if (!access.ok) {
        res.status(403).json({ jsonrpc: '2.0', error: { code: -32003, message: SCOPE_LOST_MESSAGE }, id: null });
        return;
      }
      scopeGroup = access.group;
    }

    void apiTokenService.touch(result.token);
    req.scopeGroup = scopeGroup;
    req.user = result.user;
    req.apiToken = result.token;
    next();
  } catch (error) {
    logger.error(`MCP auth error: ${error}`);
    res
      .status(500)
      .json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Could not check the access token. Try again.' },
        id: null,
      });
  }
}
