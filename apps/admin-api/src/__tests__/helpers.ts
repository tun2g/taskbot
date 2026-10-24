/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Express } from 'express';
import type { AddressInfo } from 'node:net';
import type { AdminKv } from 'src/shared/redis';

/** A thenable mongoose-query stand-in: select/sort/skip/limit/lean chain and resolve to `value`. */
export function chain(value: unknown): any {
  const q: any = {};
  for (const m of ['select', 'sort', 'skip', 'limit', 'lean', 'populate']) q[m] = jest.fn(() => q);
  q.then = (res: any, rej: any) => Promise.resolve(value).then(res, rej);
  q.catch = (rej: any) => Promise.resolve(value).catch(rej);
  return q;
}

function model() {
  return {
    find: jest.fn(() => chain([])),
    findOne: jest.fn(() => chain(null)),
    findById: jest.fn(() => chain(null)),
    countDocuments: jest.fn(async () => 0),
    aggregate: jest.fn(async () => []),
    updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    updateMany: jest.fn(async () => ({ modifiedCount: 0 })),
    create: jest.fn(async (d: unknown) => d),
    distinct: jest.fn(async () => []),
  };
}

/** Factory for jest.mock('@tbot/db', ...): every model mocked, constants real. */
export function dbMock() {
  const actual = jest.requireActual('@tbot/db');
  return {
    ...actual,
    AdminAuditLog: model(),
    AiCall: model(),
    ApiToken: model(),
    Epic: model(),
    Group: model(),
    GroupMember: model(),
    Setting: model(),
    StatsDaily: model(),
    Task: model(),
    TaskActivity: model(),
    UsageEvent: model(),
    User: model(),
    decideGroup: jest.fn(),
    countGroupData: jest.fn(),
    deleteGroupData: jest.fn(),
  };
}

export function telegramMock() {
  const ok = (result: unknown = true) => jest.fn(async () => ({ ok: true, result }));
  return {
    telegram: {
      sendMessage: ok({ message_id: 1 }),
      editMessageText: ok(),
      editMessageReplyMarkup: ok(),
      leaveChat: ok(true),
      getChat: jest.fn(async () => ({ ok: false, error: 'chat not found' })),
      getChatMemberCount: jest.fn(async () => ({ ok: false, error: 'chat not found' })),
      getMe: ok({ id: 1, first_name: 'TaskBot' }),
    },
    botDisplayName: jest.fn(async () => 'TaskBot'),
    boardButton: jest.fn(async (groupId: string) => ({ text: '📋 Open board', url: `https://t.me/taskbot?startapp=${groupId}` })),
  };
}

/** In-memory AdminKv with TTLs on Date.now() (so tests can move the clock). */
export class FakeKv implements AdminKv {
  store = new Map<string, { value: string; expiresAt: number | null }>();
  sets = new Map<string, Set<string>>();

  private live(key: string) {
    const e = this.store.get(key);
    if (e && e.expiresAt !== null && e.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }
  async get(key: string) {
    return this.live(key)?.value ?? null;
  }
  async setEx(key: string, seconds: number, value: string) {
    this.store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return 'OK';
  }
  async getDel(key: string) {
    const v = this.live(key)?.value ?? null;
    this.store.delete(key);
    return v;
  }
  async del(keys: string | string[]) {
    let n = 0;
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      if (this.live(k)) n++;
      this.store.delete(k);
      this.sets.delete(k);
    }
    return n;
  }
  async incrWithTtl(key: string, seconds: number) {
    const e = this.live(key);
    const next = (e ? Number(e.value) : 0) + 1;
    this.store.set(key, { value: String(next), expiresAt: e?.expiresAt ?? Date.now() + seconds * 1000 });
    return next;
  }
  async ttl(key: string) {
    const e = this.live(key);
    if (!e) return -2;
    return e.expiresAt === null ? -1 : Math.ceil((e.expiresAt - Date.now()) / 1000);
  }
  async sAdd(key: string, member: string) {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    this.sets.get(key)!.add(member);
    return 1;
  }
  async sRem(key: string, member: string) {
    return this.sets.get(key)?.delete(member) ? 1 : 0;
  }
  async sMembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }
  async ping() {
    return 'PONG';
  }
}

export interface TestServer {
  url: string;
  close: () => Promise<void>;
  /** JSON request; mutations get Content-Type: application/json unless `headers` overrides it. */
  req: (method: string, path: string, opts?: { body?: unknown; cookie?: string; headers?: Record<string, string> }) => Promise<{ status: number; body: any; headers: Headers }>;
}

export async function startServer(app: Express): Promise<TestServer> {
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    close: () => new Promise((r) => server.close(() => r())),
    req: async (method, path, opts = {}) => {
      const headers: Record<string, string> = {};
      if (method !== 'GET') headers['content-type'] = 'application/json';
      if (opts.cookie) headers.cookie = opts.cookie;
      Object.assign(headers, opts.headers ?? {});
      const res = await fetch(`${url}${path}`, {
        method,
        headers,
        body: method === 'GET' ? undefined : opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: res.status, body, headers: res.headers };
    },
  };
}

/** A Bull queue stand-in for setBotQueue (an empty, healthy queue unless overridden). */
export function fakeQueue(overrides: Record<string, unknown> = {}): any {
  return {
    getJobCounts: async () => ({ waiting: 0, active: 0, failed: 0, delayed: 0, completed: 0 }),
    getRepeatableJobs: async () => [],
    getCompleted: async () => [],
    getFailed: async () => [],
    getWaiting: async () => [],
    ...overrides,
  };
}

/** "tbot_admin=…" from a Set-Cookie header. */
export function cookieFrom(headers: Headers): string {
  const raw = headers.get('set-cookie') ?? '';
  return raw.split(';')[0];
}
