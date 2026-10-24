import { apiAuthMiddleware, PAT_NOT_ALLOWED_MESSAGE } from 'src/api/middlewares/auth.middleware';
import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { signWebToken } from 'src/api/auth/web-token';
import { ApiToken } from 'src/database/models/api-token.model';
import { User } from 'src/database/models/user.model';
import {
  apiTokenService,
  generateTokenSecret,
  hashTokenSecret,
  MAX_ACTIVE_TOKENS,
  TooManyTokensError,
} from 'src/database/services/api-token.service';
import { MCP_RATE_LIMIT, MCP_USER_RATE_LIMIT, mcpAuthMiddleware, SCOPE_LOST_MESSAGE } from 'src/mcp/mcp-auth.middleware';
import { rateLimitService } from 'src/shared/services/rate-limit.service';
import { alpha, me, oid } from './mcp-test-helpers';

jest.mock('src/database/models/api-token.model', () => ({
  ApiToken: { findOne: jest.fn(), countDocuments: jest.fn(), create: jest.fn(), updateOne: jest.fn(), find: jest.fn() },
}));
jest.mock('src/database/models/user.model', () => ({ User: { findById: jest.fn(), findOne: jest.fn() } }));
jest.mock('src/api/middlewares/group-access.middleware', () => ({ checkGroupAccess: jest.fn() }));
jest.mock('src/shared/services/rate-limit.service', () => ({ rateLimitService: { checkRateLimit: jest.fn() } }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const secret = generateTokenSecret();
const stored = (overrides: Record<string, unknown> = {}) => ({
  _id: oid(),
  userId: me._id,
  groupId: null,
  tokenHash: hashTokenSecret(secret),
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  ...overrides,
});

function reqRes(authorization?: string) {
  const req: any = { headers: authorization ? { authorization } : {} };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() };
  return { req, res, next: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  (User.findById as jest.Mock).mockResolvedValue(me);
  (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({
    allowed: true,
    remaining: 100,
    retryAfterSeconds: 0,
  });
  (ApiToken.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });
});

describe('token secrets', () => {
  it('are tbot_ + 40 base62 characters, unique, stored only as sha256', () => {
    expect(secret).toMatch(/^tbot_[A-Za-z0-9]{40}$/);
    expect(generateTokenSecret()).not.toBe(secret);
    expect(hashTokenSecret(secret)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('apiTokenService', () => {
  it('create stores hash + 8-char prefix (never the secret), scoped to a group when given', async () => {
    (ApiToken.countDocuments as jest.Mock).mockResolvedValue(0);
    (ApiToken.create as jest.Mock).mockImplementation(async (doc: any) => ({ _id: oid(), ...doc }));
    const { token, secret: s } = await apiTokenService.create(me._id, '  Laptop  ', alpha._id);
    const doc = (ApiToken.create as jest.Mock).mock.calls[0][0];
    expect(doc).toEqual(
      expect.objectContaining({ name: 'Laptop', tokenHash: hashTokenSecret(s), prefix: s.slice(0, 8) }),
    );
    expect(String(doc.groupId)).toBe(String(alpha._id));
    expect(JSON.stringify(doc)).not.toContain(s);
    expect(token.prefix).toBe(s.slice(0, 8));
  });

  it(`refuses the ${MAX_ACTIVE_TOKENS + 1}th active token`, async () => {
    (ApiToken.countDocuments as jest.Mock).mockResolvedValue(MAX_ACTIVE_TOKENS);
    await expect(apiTokenService.create(me._id, 'x')).rejects.toBeInstanceOf(TooManyTokensError);
    expect(ApiToken.create).not.toHaveBeenCalled();
  });

  it('touch writes lastUsedAt at most once a minute', async () => {
    const now = new Date('2026-10-20T10:00:00Z');
    const fresh = stored({ lastUsedAt: new Date(now.getTime() - 30_000) }) as any;
    await apiTokenService.touch(fresh, now);
    expect(ApiToken.updateOne).not.toHaveBeenCalled();
    const stale = stored({ lastUsedAt: new Date(now.getTime() - 61_000) }) as any;
    await apiTokenService.touch(stale, now);
    expect(ApiToken.updateOne).toHaveBeenCalledWith({ _id: stale._id }, { $set: { lastUsedAt: now } });
  });
});

describe('mcpAuthMiddleware', () => {
  it('a valid token → req.user / req.apiToken, rate limited per token', async () => {
    const token = stored();
    (ApiToken.findOne as jest.Mock).mockResolvedValue(token);
    const { req, res, next } = reqRes(`Bearer ${secret}`);
    await mcpAuthMiddleware(req, res, next);
    expect(ApiToken.findOne).toHaveBeenCalledWith({ tokenHash: hashTokenSecret(secret) });
    expect(next).toHaveBeenCalled();
    expect(req.user).toBe(me);
    expect(req.apiToken).toBe(token);
    expect(req.scopeGroup).toBeNull();
    expect(rateLimitService.checkRateLimit).toHaveBeenCalledWith(String(token._id), 'mcp', MCP_RATE_LIMIT, 60);
  });

  it.each([
    ['missing', undefined, /Missing access token/],
    ['a web session token (wrong prefix)', 'Bearer eyJhbGciOi.sig', /start with "tbot_"/],
    ['a malformed tbot_ token', 'Bearer tbot_short', /Unknown access token|not a TaskBot/],
  ])('401 + WWW-Authenticate for %s', async (_label, header, message) => {
    const { req, res, next } = reqRes(header);
    await mcpAuthMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', expect.stringMatching(/^Bearer realm="taskbot"/));
    expect(res.json.mock.calls[0][0].error.message).toMatch(message);
  });

  it('401 for an unknown, revoked or expired token', async () => {
    for (const [token, message] of [
      [null, /Unknown access token/],
      [stored({ revokedAt: new Date() }), /revoked/],
      [stored({ expiresAt: new Date(Date.now() - 1000) }), /expired/],
    ] as const) {
      (ApiToken.findOne as jest.Mock).mockResolvedValue(token);
      const { req, res, next } = reqRes(`Bearer ${secret}`);
      await mcpAuthMiddleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', expect.stringContaining('error="invalid_token"'));
      expect(res.json.mock.calls[0][0].error.message).toMatch(message);
    }
  });

  it('429 with Retry-After over the per-token limit', async () => {
    (ApiToken.findOne as jest.Mock).mockResolvedValue(stored());
    (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 42,
    });
    const { req, res, next } = reqRes(`Bearer ${secret}`);
    await mcpAuthMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '42');
    expect(next).not.toHaveBeenCalled();
  });

  it('429 over the per-user limit, shared by all of that user\'s tokens', async () => {
    (ApiToken.findOne as jest.Mock).mockResolvedValue(stored());
    (rateLimitService.checkRateLimit as jest.Mock).mockImplementation(async (_id, action) =>
      action === 'mcp_user'
        ? { allowed: false, remaining: 0, retryAfterSeconds: 7 }
        : { allowed: true, remaining: 100, retryAfterSeconds: 0 },
    );
    const { req, res, next } = reqRes(`Bearer ${secret}`);
    await mcpAuthMiddleware(req, res, next);
    expect(rateLimitService.checkRateLimit).toHaveBeenCalledWith(String(me._id), 'mcp_user', MCP_USER_RATE_LIMIT, 60);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '7');
    expect(res.json.mock.calls[0][0].error.message).toMatch(/per user/);
    expect(next).not.toHaveBeenCalled();
  });

  it('a group-scoped token loads its group; lost membership → 403', async () => {
    (ApiToken.findOne as jest.Mock).mockResolvedValue(stored({ groupId: alpha._id }));
    (checkGroupAccess as jest.Mock).mockResolvedValue({ ok: true, group: alpha });
    let { req, res, next } = reqRes(`Bearer ${secret}`);
    await mcpAuthMiddleware(req, res, next);
    expect(req.scopeGroup).toBe(alpha);
    expect(next).toHaveBeenCalled();

    (checkGroupAccess as jest.Mock).mockResolvedValue({ ok: false, status: 403, message: 'x' });
    ({ req, res, next } = reqRes(`Bearer ${secret}`));
    await mcpAuthMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].error.message).toBe(SCOPE_LOST_MESSAGE);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('REST auth keeps web tokens working', () => {
  it('a browser Bearer token still signs in', async () => {
    (User.findOne as jest.Mock).mockResolvedValue(me);
    const { req, res, next } = reqRes(`Bearer ${signWebToken(me.telegramUserId).token}`);
    await apiAuthMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBe(me);
  });

  it('a tbot_ token is refused on /api with a clear message', async () => {
    const { req, res, next } = reqRes(`Bearer ${secret}`);
    await apiAuthMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: PAT_NOT_ALLOWED_MESSAGE }));
  });
});
