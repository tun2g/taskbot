import { createHash, createHmac } from 'node:crypto';
import { verifyTelegramLogin } from 'src/api/auth/telegram-login';
import { signWebToken, verifyWebToken, WEB_TOKEN_TTL_MS } from 'src/api/auth/web-token';
import { AuthController } from 'src/api/controllers/auth.controller';
import { apiAuthMiddleware } from 'src/api/middlewares/auth.middleware';
import { User } from 'src/database/models/user.model';

jest.mock('src/database/models/user.model', () => ({
  User: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const BOT_TOKEN = 'test-token'; // matches jest.setup.ts

function signLogin(fields: Record<string, string | number>, botToken = BOT_TOKEN) {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return { ...fields, hash };
}

function createMockReqRes(overrides: Record<string, any> = {}) {
  const req: any = { params: {}, query: {}, body: {}, headers: {}, ...overrides };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { req, res };
}

describe('verifyTelegramLogin', () => {
  const now = 1_800_000_000;
  const fields = { id: 42, first_name: 'An', username: 'an', auth_date: now - 60 };

  it('accepts a correctly signed payload', () => {
    expect(verifyTelegramLogin(signLogin(fields), BOT_TOKEN, now)).toBe('ok');
  });

  it('rejects a tampered payload', () => {
    const payload = { ...signLogin(fields), username: 'mallory' };
    expect(verifyTelegramLogin(payload, BOT_TOKEN, now)).toBe('invalid');
  });

  it('rejects a payload signed with another bot token', () => {
    expect(verifyTelegramLogin(signLogin(fields, 'other-token'), BOT_TOKEN, now)).toBe('invalid');
  });

  it('rejects a missing or malformed hash', () => {
    expect(verifyTelegramLogin({ ...fields }, BOT_TOKEN, now)).toBe('invalid');
    expect(verifyTelegramLogin({ ...fields, hash: 'abc' }, BOT_TOKEN, now)).toBe('invalid');
  });

  it('rejects auth_date older than 24h', () => {
    const old = signLogin({ ...fields, auth_date: now - 24 * 3600 - 1 });
    expect(verifyTelegramLogin(old, BOT_TOKEN, now)).toBe('expired');
  });
});

describe('web token', () => {
  it('round-trips the telegram user id', () => {
    const { token, expiresAt } = signWebToken(42, 1000);
    expect(expiresAt.getTime()).toBe(1000 + WEB_TOKEN_TTL_MS);
    expect(verifyWebToken(token, 2000)).toBe(42);
  });

  it('rejects expired tokens', () => {
    const { token } = signWebToken(42, 1000);
    expect(verifyWebToken(token, 1000 + WEB_TOKEN_TTL_MS)).toBeNull();
  });

  it('rejects tampered tokens', () => {
    const { token } = signWebToken(42);
    const [, sig] = token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ uid: 1, exp: Date.now() + 1e9 })).toString('base64url');
    expect(verifyWebToken(`${forgedBody}.${sig}`)).toBeNull();
    expect(verifyWebToken('garbage')).toBeNull();
    expect(verifyWebToken('')).toBeNull();
  });
});

describe('AuthController.telegramLogin', () => {
  const controller = new AuthController();
  const user = { _id: 'u1', telegramUserId: 42, username: 'an' };

  beforeEach(() => {
    jest.clearAllMocks();
    (User.findOneAndUpdate as jest.Mock).mockResolvedValue(user);
  });

  it('returns a token and the upserted user for a valid payload', async () => {
    const body = signLogin({ id: 42, first_name: 'An', username: 'an', auth_date: Math.floor(Date.now() / 1000) });
    const { req, res } = createMockReqRes({ body });

    await controller.telegramLogin(req, res);

    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { telegramUserId: 42 },
      expect.objectContaining({ $set: expect.objectContaining({ username: 'an', firstName: 'An' }) }),
      expect.anything(),
    );
    const { data } = res.json.mock.calls[0][0];
    expect(data.user).toBe(user);
    expect(verifyWebToken(data.token)).toBe(42);
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('returns 401 for an invalid hash', async () => {
    const body = { ...signLogin({ id: 42, first_name: 'An', auth_date: Math.floor(Date.now() / 1000) }), id: 43 };
    const { req, res } = createMockReqRes({ body });
    await controller.telegramLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 401 with a re-login message for an expired payload', async () => {
    const body = signLogin({ id: 42, first_name: 'An', auth_date: Math.floor(Date.now() / 1000) - 2 * 86400 });
    const { req, res } = createMockReqRes({ body });
    await controller.telegramLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'This Telegram login has expired. Please log in again.' }),
    );
  });

  it('returns 400 for an incomplete payload', async () => {
    const { req, res } = createMockReqRes({ body: { id: 42 } });
    await controller.telegramLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('apiAuthMiddleware (Bearer)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sets req.user for a valid bearer token', async () => {
    const user = { _id: 'u1', telegramUserId: 42 };
    (User.findOne as jest.Mock).mockResolvedValue(user);
    const { token } = signWebToken(42);
    const { req, res } = createMockReqRes({ headers: { authorization: `Bearer ${token}` } });
    const next = jest.fn();

    await apiAuthMiddleware(req, res, next);

    expect(User.findOne).toHaveBeenCalledWith({ telegramUserId: 42 });
    expect(req.user).toBe(user);
    expect(req.telegramUserId).toBe(42);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 for an invalid bearer token', async () => {
    const { req, res } = createMockReqRes({ headers: { authorization: 'Bearer nope.nope' } });
    const next = jest.fn();
    await apiAuthMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 without an authorization header', async () => {
    const { req, res } = createMockReqRes();
    const next = jest.fn();
    await apiAuthMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});
