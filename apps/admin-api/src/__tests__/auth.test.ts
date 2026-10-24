/* eslint-disable @typescript-eslint/no-explicit-any */
import { AdminAuditLog } from '@tbot/db';
import { createApp } from 'src/app';
import { LINK_LIMIT_GLOBAL, LINK_LIMIT_PER_IP } from 'src/auth/auth.routes';
import { createSession, resetOwnerCache, SESSION_COOKIE } from 'src/auth/auth.service';
import { setKv } from 'src/shared/redis';
import { describeUserAgent } from 'src/auth/user-agent';
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
    expect(res.body.data).toEqual({
      sentTo: 'your Telegram account',
      expiresInSeconds: 300,
      requestId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });

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
    expect([...kv.store.keys()].some((k) => k.includes(res.body.data.requestId))).toBe(false);
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

describe('sign-in details, sessions and the link status', () => {
  const SAFARI_IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const CHROME_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

  async function signIn(ua: string, ip: string) {
    const link = await server.req('POST', '/api/auth/request-link', { body: {}, headers: { 'x-forwarded-for': ip } });
    const call = (telegram.sendMessage as jest.Mock).mock.calls.at(-1)!;
    const code = new URL(call[2].inline_keyboard[0][0].url).searchParams.get('code')!;
    const res = await server.req('POST', '/api/auth/exchange', {
      body: { code },
      headers: { 'user-agent': ua, 'x-forwarded-for': ip },
    });
    expect(res.status).toBe(200);
    return { cookie: cookieFrom(res.headers), requestId: link.body.data.requestId as string };
  }

  it('the waiting browser learns the link was used — and gets no session from it', async () => {
    const link = await server.req('POST', '/api/auth/request-link', { body: {} });
    const requestId = link.body.data.requestId;
    const status = () => server.req('GET', `/api/auth/link-status?requestId=${requestId}`);
    expect((await status()).body.data).toEqual({ status: 'unused' });

    const call = (telegram.sendMessage as jest.Mock).mock.calls.at(-1)!;
    const code = new URL(call[2].inline_keyboard[0][0].url).searchParams.get('code')!;
    await server.req('POST', '/api/auth/exchange', { body: { code } });

    const used = await status();
    expect(used.body.data).toEqual({ status: 'used' });
    expect(used.headers.get('set-cookie')).toBeNull();
    expect((await server.req('GET', '/api/auth/link-status?requestId=nope')).body.data).toEqual({ status: 'expired' });
  });

  it('records browser + address, audits them and tells the owner on Telegram', async () => {
    await signIn(SAFARI_IPHONE, '1.2.3.4');
    expect(AdminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login', details: { browser: 'Safari on iPhone', ip: '1.2.3.4' } }),
    );
    const [chatId, text] = (telegram.sendMessage as jest.Mock).mock.calls.at(-1)!;
    expect(chatId).toBe(OWNER);
    expect(text).toMatch(
      /New sign-in to TaskBot admin:<\/b> Safari on iPhone · 1\.2\.3\.4 · \d+ \w{3} \d{4}, \d\d:\d\d UTC\./,
    );
    expect(text).toContain('Not you? Open admin → Log out everywhere.');
  });

  it('lists sessions, signs out another one, and audits a single logout', async () => {
    const phone = await signIn(SAFARI_IPHONE, '1.2.3.4');
    const laptop = await signIn(CHROME_MAC, '5.6.7.8');
    const list = await server.req('GET', '/api/auth/sessions', { cookie: laptop.cookie });
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    const mine = list.body.data.find((s: any) => s.current);
    const other = list.body.data.find((s: any) => !s.current);
    expect(mine).toMatchObject({ browser: 'Chrome on Mac', ip: '5.6.7.8' });
    expect(other).toMatchObject({ browser: 'Safari on iPhone', ip: '1.2.3.4', lastSeenAt: expect.any(String) });

    expect(
      (await server.req('POST', `/api/auth/sessions/${mine.id}/revoke`, { body: {}, cookie: laptop.cookie })).status,
    ).toBe(400);
    const revoked = await server.req('POST', `/api/auth/sessions/${other.id}/revoke`, {
      body: {},
      cookie: laptop.cookie,
    });
    expect(revoked.status).toBe(200);
    expect(AdminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.session_revoke',
        details: { browser: 'Safari on iPhone', ip: '1.2.3.4' },
      }),
    );
    expect((await server.req('GET', '/api/auth/me', { cookie: phone.cookie })).status).toBe(401);
    expect(
      (await server.req('POST', `/api/auth/sessions/${other.id}/revoke`, { body: {}, cookie: laptop.cookie })).status,
    ).toBe(404);

    await server.req('POST', '/api/auth/logout', { body: {}, cookie: laptop.cookie });
    expect(AdminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.logout', details: { browser: 'Chrome on Mac', ip: '5.6.7.8' } }),
    );
  });
});

describe('describeUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Mac'],
    ['curl/8.4.0', 'A script'],
    ['', 'Unknown browser'],
  ])('%s → %s', (ua, expected) => expect(describeUserAgent(ua)).toBe(expected));
});
