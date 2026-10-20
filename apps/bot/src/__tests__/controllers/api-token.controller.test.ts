import mongoose from 'mongoose';
import {
  ApiTokenController,
  TOKEN_GROUP_NOT_ALLOWED_MESSAGE,
  TOKEN_NOT_FOUND_MESSAGE,
} from 'src/api/controllers/api-token.controller';
import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { configService } from 'src/configs/configuration';
import { apiTokenService, TOO_MANY_TOKENS_MESSAGE, TooManyTokensError } from 'src/database/services/api-token.service';

jest.mock('src/api/middlewares/group-access.middleware', () => ({ checkGroupAccess: jest.fn() }));
jest.mock('src/database/services/api-token.service', () => ({
  ...jest.requireActual('src/database/services/api-token.service'),
  apiTokenService: { listActive: jest.fn(), create: jest.fn(), revoke: jest.fn() },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const oid = () => new mongoose.Types.ObjectId();
const me = { _id: oid(), telegramUserId: 1 };
const alpha = { _id: oid(), groupName: 'Team Alpha' };
const created = new Date('2026-10-20T08:00:00Z');
const tokenDoc = (overrides: Record<string, unknown> = {}) => ({
  _id: oid(),
  name: 'Laptop',
  prefix: 'tbot_AbC',
  createdAt: created,
  lastUsedAt: null,
  groupId: null,
  tokenHash: 'secret-hash',
  ...overrides,
});

function reqRes(overrides: Record<string, any> = {}) {
  const req: any = {
    params: {},
    body: {},
    headers: {},
    user: me,
    protocol: 'http',
    get: () => 'localhost:3000',
    ...overrides,
  };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { req, res };
}

const controller = new ApiTokenController();

beforeEach(() => jest.clearAllMocks());

describe('GET /api/me/tokens', () => {
  it('returns IApiToken[] (no hash), with the scope group', async () => {
    const t1 = tokenDoc({ lastUsedAt: new Date('2026-10-20T09:00:00Z') });
    const t2 = tokenDoc({ name: 'Repo', groupId: alpha });
    (apiTokenService.listActive as jest.Mock).mockResolvedValue([t1, t2]);
    const { req, res } = reqRes();
    await controller.list(req, res);
    expect(res.json).toHaveBeenCalledWith({
      data: [
        {
          _id: String(t1._id),
          name: 'Laptop',
          prefix: 'tbot_AbC',
          createdAt: created.toISOString(),
          lastUsedAt: '2026-10-20T09:00:00.000Z',
          group: null,
        },
        {
          _id: String(t2._id),
          name: 'Repo',
          prefix: 'tbot_AbC',
          createdAt: created.toISOString(),
          lastUsedAt: null,
          group: { _id: String(alpha._id), title: 'Team Alpha' },
        },
      ],
    });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('secret-hash');
  });

  it('401 without a user', async () => {
    const { req, res } = reqRes({ user: undefined });
    await controller.list(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('POST /api/me/tokens', () => {
  it('201 with the token and its one-time secret', async () => {
    const doc = tokenDoc();
    (apiTokenService.create as jest.Mock).mockResolvedValue({ token: doc, secret: 'tbot_secret' });
    const { req, res } = reqRes({ body: { name: 'Laptop' } });
    await controller.create(req, res);
    expect(apiTokenService.create).toHaveBeenCalledWith(me._id, 'Laptop', null);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data).toEqual({
      token: expect.objectContaining({ _id: String(doc._id), group: null }),
      secret: 'tbot_secret',
    });
  });

  it('scopes to a group the user is a member of', async () => {
    (checkGroupAccess as jest.Mock).mockResolvedValue({ ok: true, group: alpha });
    (apiTokenService.create as jest.Mock).mockResolvedValue({ token: tokenDoc({ groupId: alpha }), secret: 's' });
    const { req, res } = reqRes({ body: { name: 'Repo', groupId: String(alpha._id) } });
    await controller.create(req, res);
    expect(apiTokenService.create).toHaveBeenCalledWith(me._id, 'Repo', String(alpha._id));
    expect(res.json.mock.calls[0][0].data.token.group).toEqual({ _id: String(alpha._id), title: 'Team Alpha' });
  });

  it('400 for a group the user is not in, or a bad id', async () => {
    (checkGroupAccess as jest.Mock).mockResolvedValue({ ok: false, status: 403, message: 'x' });
    let { req, res } = reqRes({ body: { name: 'Repo', groupId: String(oid()) } });
    await controller.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: TOKEN_GROUP_NOT_ALLOWED_MESSAGE }));

    ({ req, res } = reqRes({ body: { name: 'Repo', groupId: 'nope' } }));
    await controller.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(apiTokenService.create).not.toHaveBeenCalled();
  });

  it('400 for a missing name', async () => {
    const { req, res } = reqRes({ body: { name: '  ' } });
    await controller.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Please give the token a name.' }));
  });

  it('409 at 10 active tokens', async () => {
    (apiTokenService.create as jest.Mock).mockRejectedValue(new TooManyTokensError());
    const { req, res } = reqRes({ body: { name: 'x' } });
    await controller.create(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: TOO_MANY_TOKENS_MESSAGE }));
  });
});

describe('DELETE /api/me/tokens/:id', () => {
  it('revokes one of my tokens', async () => {
    (apiTokenService.revoke as jest.Mock).mockResolvedValue(true);
    const id = String(oid());
    const { req, res } = reqRes({ params: { id } });
    await controller.revoke(req, res);
    expect(apiTokenService.revoke).toHaveBeenCalledWith(me._id, id);
    expect(res.json).toHaveBeenCalledWith({ data: { revoked: true } });
  });

  it('404 when it is not mine / already revoked', async () => {
    (apiTokenService.revoke as jest.Mock).mockResolvedValue(false);
    const { req, res } = reqRes({ params: { id: String(oid()) } });
    await controller.revoke(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: TOKEN_NOT_FOUND_MESSAGE }));
  });
});

describe('GET /api/mcp-info', () => {
  afterEach(() => {
    configService.mcpPublicUrlOverride = '';
    configService.webhookUrl = '';
  });

  it('MCP_PUBLIC_URL wins, then <WEBHOOK_URL>/mcp, then the request host', async () => {
    const get = async () => {
      const { req, res } = reqRes({ headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'api.example.com' } });
      await controller.mcpInfo(req, res);
      return res.json.mock.calls[0][0].data.url;
    };
    configService.mcpPublicUrlOverride = 'https://mcp.example.com/mcp/';
    configService.webhookUrl = 'https://bot.example.com';
    expect(await get()).toBe('https://mcp.example.com/mcp');
    configService.mcpPublicUrlOverride = '';
    expect(await get()).toBe('https://bot.example.com/mcp');
    configService.webhookUrl = '';
    expect(await get()).toBe('https://api.example.com/mcp');
  });
});
