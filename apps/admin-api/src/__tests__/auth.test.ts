import { AdminAuditLog } from '@tbot/db';
import { createApp } from 'src/app';
import { LINK_LIMIT_GLOBAL, LINK_LIMIT_PER_IP } from 'src/auth/auth.routes';
import { createSession, resetOwnerCache, SESSION_COOKIE } from 'src/auth/auth.service';
import { setKv } from 'src/shared/redis';
import { telegram } from 'src/shared/telegram';
import { cookieFrom, FakeKv, startServer, TestServer } from './helpers';

jest.mock('@tbot/db', () => require('./helpers').dbMock());
jest.mock('src/shared/telegram', () => require('./helpers').telegramMock());

const OWNER = 1001; // jest.setup.ts
let kv: FakeKv;
let server: TestServer;

beforeAll(async () => {
  server = await startServer(createApp());
});
afterAll(() => server.close());

beforeEach(() => {
  kv = new FakeKv();
  setKv(kv);
  resetOwnerCache();
  process.env.BOT_OWNER_TELEGRAM_ID = String(OWNER);
});
afterEach(() => jest.restoreAllMocks());

/** Requests a link and returns the code from the DM button. */
async function requestCode(ip = '10.0.0.1'): Promise<string> {
  const res = await server.req('POST', '/api/auth/request-link', { body: {}, headers: { 'x-forwarded-for': ip } });
  expect(res.status).toBe(200);
  const call = (telegram.sendMessage as jest.Mock).mock.calls.at(-1)!;
  const url: string = call[2].inline_keyboard[0][0].url;
  return new URL(url).searchParams.get('code')!;
}

describe('POST /auth/request-link', () => {
  it('DMs a one-time link to the owner (and only the owner) and stores only a hash of the code', async () => {
    const res = await server.req('POST', '/api/auth/request-link', { body: {} });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sentTo: 'your Telegram account', expiresInSeconds: 300 });

    const [chatId, text, markup] = (telegram.sendMessage as jest.Mock).mock.calls[0];
    expect(chatId).toBe(OWNER);
    expect(text).toContain('expires in 5 minutes');
    expect(text).toContain("If you didn't ask for this, ignore it");
    const button = markup.inline_keyboard[0][0];
    expect(button.text).toBe('Open admin');
    expect(button.url).toMatch(/^https:\/\/admin\.example\.com\/login\/callback\?code=[A-Za-z0-9_-]{43}$/);

    const code = new URL(button.url).searchParams.get('code')!;
    const keys = [...kv.store.keys()].filter((k) => k.startsWith('admin:login:'));
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(code);
  });

  it('shows the owner @username when known', async () => {
    const { User } = jest.requireMock('@tbot/db');
    const { chain } = jest.requireActual('./helpers');
    User.findOne.mockReturnValueOnce(chain({ _id: 'u1', telegramUserId: OWNER, username: 'tun2g', firstName: 'Tung' }));
    const res = await server.req('POST', '/api/auth/request-link', { body: {} });
    expect(res.body.data.sentTo).toBe('@tun2g');
  });

  it('rate limits per IP', async () => {
    for (let i = 0; i < LINK_LIMIT_PER_IP.limit; i++) {
      const ok = await server.req('POST', '/api/auth/request-link', { body: {}, headers: { 'x-forwarded-for': '1.1.1.1' } });
      expect(ok.status).toBe(200);
    }
    const limited = await server.req('POST', '/api/auth/request-link', { body: {}, headers: { 'x-forwarded-for': '1.1.1.1' } });
    expect(limited.status).toBe(429);
    expect(limited.body.message).toMatch(/Try again in/);
    // Another IP still works.
    const other = await server.req('POST', '/api/auth/request-link', { body: {}, headers: { 'x-forwarded-for': '2.2.2.2' } });
    expect(other.status).toBe(200);
  });

  it('rate limits globally across IPs', async () => {
    for (let i = 0; i < LINK_LIMIT_GLOBAL.limit; i++) {
      const res = await server.req('POST', '/api/auth/request-link', { body: {}, headers: { 'x-forwarded-for': `9.9.9.${i}` } });
      expect(res.status).toBe(200);
    }
    const res = await server.req('POST', '/api/auth/request-link', { body: {}, headers: { 'x-forwarded-for': '8.8.8.8' } });
    expect(res.status).toBe(429);
  });

  it('answers 502 and discards the code when Telegram refuses the DM', async () => {
    (telegram.sendMessage as jest.Mock).mockResolvedValueOnce({ ok: false, error: 'Forbidden: bot was blocked by the user' });
    const res = await server.req('POST', '/api/auth/request-link', { body: {} });
    expect(res.status).toBe(502);
    expect([...kv.store.keys()].filter((k) => k.startsWith('admin:login:'))).toHaveLength(0);
  });

  it('requires a JSON content type (CSRF)', async () => {
    const res = await server.req('POST', '/api/auth/request-link', { headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(res.status).toBe(415);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('blocks a cross-site Origin', async () => {
    const res = await server.req('POST', '/api/auth/request-link', { body: {}, headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    const same = await server.req('POST', '/api/auth/request-link', { body: {}, headers: { origin: 'https://admin.example.com' } });
    expect(same.status).toBe(200);
  });
});

describe('POST /auth/exchange', () => {
  it('exchanges a code once for a strict httpOnly cookie, and writes an audit entry', async () => {
    const code = await requestCode();
    const res = await server.req('POST', '/api/auth/exchange', { body: { code } });
    expect(res.status).toBe(200);
    expect(res.body.data.owner.telegramUserId).toBe(OWNER);
    expect(Date.parse(res.body.data.expiresAt)).toBeGreaterThan(Date.now() + 11 * 3600_000);

    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\/api/);
    expect(AdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login', targetType: 'session' }));

    const again = await server.req('POST', '/api/auth/exchange', { body: { code } });
    expect(again.status).toBe(401);

    const me = await server.req('GET', '/api/auth/me', { cookie: cookieFrom(res.headers) });
    expect(me.status).toBe(200);
    expect(me.body.data.owner.telegramUserId).toBe(OWNER);
  });

  it('rejects an expired code', async () => {
    const code = await requestCode();
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000 + 1);
    const res = await server.req('POST', '/api/auth/exchange', { body: { code } });
    expect(res.status).toBe(401);
  });

  it('rejects made-up and malformed codes', async () => {
    expect((await server.req('POST', '/api/auth/exchange', { body: { code: 'A'.repeat(43) } })).status).toBe(401);
    expect((await server.req('POST', '/api/auth/exchange', { body: { code: 'short' } })).status).toBe(401);
    expect((await server.req('POST', '/api/auth/exchange', { body: {} })).status).toBe(400);
  });
});

describe('owner guard', () => {
  it('rejects requests without a session', async () => {
    const res = await server.req('GET', '/api/overview');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', message: expect.any(String), statusCode: 401 });
  });

  it('rejects (and deletes) a session once BOT_OWNER_TELEGRAM_ID changes', async () => {
    const { id } = await createSession(OWNER);
    const cookie = `${SESSION_COOKIE}=${id}`;
    expect((await server.req('GET', '/api/auth/me', { cookie })).status).toBe(200);

    process.env.BOT_OWNER_TELEGRAM_ID = '2002';
    expect((await server.req('GET', '/api/auth/me', { cookie })).status).toBe(401);

    // Even switching back doesn't revive it: it was deleted.
    process.env.BOT_OWNER_TELEGRAM_ID = String(OWNER);
    expect((await server.req('GET', '/api/auth/me', { cookie })).status).toBe(401);
  });

  it('rejects a session created for someone else', async () => {
    const { id } = await createSession(4242);
    expect((await server.req('GET', '/api/groups', { cookie: `${SESSION_COOKIE}=${id}` })).status).toBe(401);
  });

  it('logout ends this session; logout-all ends every session', async () => {
    const a = await createSession(OWNER);
    const b = await createSession(OWNER);
    const c = await createSession(OWNER);
    const out = await server.req('POST', '/api/auth/logout', { body: {}, cookie: `${SESSION_COOKIE}=${a.id}` });
    expect(out.status).toBe(200);
    expect((await server.req('GET', '/api/auth/me', { cookie: `${SESSION_COOKIE}=${a.id}` })).status).toBe(401);

    const all = await server.req('POST', '/api/auth/logout-all', { body: {}, cookie: `${SESSION_COOKIE}=${b.id}` });
    expect(all.status).toBe(200);
    expect(all.body.data.sessions).toBe(2);
    expect(AdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.logout_all' }));
    expect((await server.req('GET', '/api/auth/me', { cookie: `${SESSION_COOKIE}=${c.id}` })).status).toBe(401);
  });

  it('requires JSON on authenticated mutations too', async () => {
    const { id } = await createSession(OWNER);
    const res = await server.req('POST', '/api/groups/0123456789abcdef01234567/approve', {
      cookie: `${SESSION_COOKIE}=${id}`,
      headers: { 'content-type': 'text/plain' },
    });
    expect(res.status).toBe(415);
  });
});
