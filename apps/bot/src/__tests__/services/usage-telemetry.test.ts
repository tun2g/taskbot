import express from 'express';
import type { AddressInfo } from 'net';
import mongoose from 'mongoose';
import { apiUsageMiddleware, routeName } from 'src/api/middlewares/usage.middleware';
import { callbackFamily, commandName, recordMention, trackCommands, usageMiddleware } from 'src/bot/middlewares/usage.middleware';
import { Group } from 'src/database/models/group.model';
import { UsageEvent } from 'src/database/models/usage-event.model';
import { User } from 'src/database/models/user.model';
import { runTool } from 'src/mcp/server';
import { McpToolError } from 'src/mcp/context';
import { RateLimitService } from 'src/shared/services/rate-limit.service';
import { redisService } from 'src/shared/services/redis.service';
import { currentContext } from 'src/shared/services/telemetry/request-context';
import {
  flushUsage,
  pendingUsage,
  resetUsageTracker,
  telemetry,
  touchLastSeen,
} from 'src/shared/services/telemetry/usage-tracker';

jest.mock('src/mcp/tools', () => ({ MCP_TOOLS: [] }));
jest.mock('src/database/models/usage-event.model', () => ({ UsageEvent: { insertMany: jest.fn(async () => []) } }));
jest.mock('src/database/models/user.model', () => ({ User: { find: jest.fn(), updateOne: jest.fn(async () => ({})) } }));
jest.mock('src/database/models/group.model', () => ({ Group: { find: jest.fn(), updateOne: jest.fn(async () => ({})) } }));
jest.mock('src/shared/services/redis.service', () => ({
  redisService: { set: jest.fn(), incr: jest.fn(), expire: jest.fn(), ttl: jest.fn() },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const lean = (docs: unknown[]) => ({ lean: async () => docs });
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(() => {
  jest.clearAllMocks();
  resetUsageTracker();
  telemetry.enabled = true;
});
afterAll(() => {
  resetUsageTracker();
  telemetry.enabled = false;
});

describe('names', () => {
  it('commandName: this bot\'s known commands only, without slash or suffix', () => {
    trackCommands(['task', 'ai']);
    expect(commandName('/task@TBot 3', 'tbot')).toBe('task');
    expect(commandName('/AI tạo task', 'tbot')).toBe('ai');
    expect(commandName('/task@OtherBot', 'tbot')).toBeNull();
    expect(commandName('/unknowncmd', 'tbot')).toBeNull();
    expect(commandName('hello /task', 'tbot')).toBeNull();
  });

  it('callbackFamily: the prefix, never ids or storage keys', () => {
    expect(callbackFamily('task:status_done:k1x9')).toBe('task:status_done');
    expect(callbackFamily('tdm:explain:6620f0c2a1b2c3d4e5f60718')).toBe('tdm:explain');
    expect(callbackFamily('batch:undo:abc123')).toBe('batch:undo');
    expect(callbackFamily('help:ai')).toBe('help:ai');
    expect(callbackFamily('mcp:new:6620f0c2a1b2c3d4e5f60718')).toBe('mcp:new');
    expect(callbackFamily('subprev:add:9f8e')).toBe('subprev:add');
    expect(callbackFamily('12345')).toBe('other');
  });

  it('routeName: the route pattern relative to /api', () => {
    expect(routeName({ method: 'GET', baseUrl: '/api', route: { path: '/groups/:groupId/tasks' } })).toBe('GET /groups/:groupId/tasks');
    expect(routeName({ method: 'PATCH', baseUrl: '/api/groups', route: { path: '/:groupId' } })).toBe('PATCH /groups/:groupId');
    expect(routeName({ method: 'GET', baseUrl: '/api', route: undefined })).toBe('GET (unmatched)');
  });
});

describe('recording + flush', () => {
  it('batches events and resolves Telegram ids to Mongo ids on write', async () => {
    const userId = new mongoose.Types.ObjectId();
    const groupId = new mongoose.Types.ObjectId();
    (User.find as jest.Mock).mockReturnValue(lean([{ _id: userId, telegramUserId: 7 }]));
    (Group.find as jest.Mock).mockReturnValue(lean([{ _id: groupId, telegramGroupId: -100 }]));

    const { recordUsage } = await import('src/shared/services/telemetry/usage-tracker');
    recordUsage({ kind: 'command' as never, name: 'task', telegramUserId: 7, telegramChatId: -100 });
    recordUsage({ kind: 'command' as never, name: 'help', telegramUserId: 7, telegramChatId: 7 }); // private chat: no group
    expect(UsageEvent.insertMany).not.toHaveBeenCalled();
    await flushUsage();

    const [docs] = (UsageEvent.insertMany as jest.Mock).mock.calls[0];
    expect(docs).toEqual([
      expect.objectContaining({ kind: 'command', name: 'task', channel: 'telegram', ok: true, userId: String(userId), groupId: String(groupId) }),
      expect.objectContaining({ name: 'help', userId: String(userId), groupId: null }),
    ]);
    expect(docs[0]).not.toHaveProperty('telegramUserId');
  });

  it('lastSeenAt: written once per throttle window (Redis NX)', async () => {
    (redisService.set as jest.Mock).mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const userId = new mongoose.Types.ObjectId();
    touchLastSeen({ userId });
    await settle();
    touchLastSeen({ userId });
    await settle();
    expect(redisService.set).toHaveBeenCalledWith(`lastseen:u:${userId}`, '1', { NX: true, EX: 300 });
    expect(User.updateOne).toHaveBeenCalledTimes(1);
    expect(User.updateOne).toHaveBeenCalledWith({ _id: String(userId) }, { $set: { lastSeenAt: expect.any(Date) } });
  });

  it('does nothing when telemetry is off', async () => {
    telemetry.enabled = false;
    const { recordUsage } = await import('src/shared/services/telemetry/usage-tracker');
    recordUsage({ kind: 'api' as never, name: 'GET /me' });
    touchLastSeen({ telegramUserId: 1 });
    expect(pendingUsage()).toHaveLength(0);
  });
});

describe('bot updates', () => {
  const ctx = (update: Record<string, unknown>) =>
    ({ from: { id: 7, is_bot: false }, chat: { id: -100, type: 'supergroup' }, botInfo: { username: 'tbot' }, ...update }) as never;

  beforeEach(() => (redisService.set as jest.Mock).mockResolvedValue(null));

  it('a command → one "command" event, with a Telegram context for everything below', async () => {
    trackCommands(['task']);
    let inner: ReturnType<typeof currentContext> | null = null;
    await usageMiddleware(ctx({ message: { text: '/task@tbot fix login' } }), async () => {
      inner = currentContext();
    });
    expect(inner).toEqual(expect.objectContaining({ channel: 'telegram', telegramUserId: 7, telegramChatId: -100 }));
    expect(pendingUsage()).toEqual([
      expect.objectContaining({ kind: 'command', name: 'task', ok: true, telegramUserId: 7, telegramChatId: -100, latencyMs: expect.any(Number) }),
    ]);
  });

  it('a button press → "callback" with its family; a failure is ok: false', async () => {
    await expect(
      usageMiddleware(ctx({ callbackQuery: { id: '1', data: 'task:status_done:k1' } }), async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(pendingUsage()).toEqual([expect.objectContaining({ kind: 'callback', name: 'task:status_done', ok: false })]);
  });

  it('plain chat messages are not events', async () => {
    await usageMiddleware(ctx({ message: { text: 'hello team' } }), async () => undefined);
    expect(pendingUsage()).toHaveLength(0);
  });

  it('mentions handed to the AI', () => {
    recordMention(ctx({}), 'mention');
    expect(pendingUsage()).toEqual([expect.objectContaining({ kind: 'mention', name: 'mention', telegramChatId: -100 })]);
  });
});

describe('rate-limit denials', () => {
  it('records a rate_limited event named after the limit (no per-chat suffix), with the context ids', async () => {
    (redisService.incr as jest.Mock).mockResolvedValue(7);
    (redisService.ttl as jest.Mock).mockResolvedValue(30);
    const userId = new mongoose.Types.ObjectId();
    const result = await new RateLimitService().checkRateLimit(1, 'ai_command:-100', 6, 60, { userId, channel: 'app' });
    expect(result.allowed).toBe(false);
    expect(pendingUsage()).toEqual([
      expect.objectContaining({ kind: 'rate_limited', name: 'ai_command', ok: false, channel: 'app', userId: String(userId) }),
    ]);
  });

  it('allowed calls record nothing', async () => {
    (redisService.incr as jest.Mock).mockResolvedValue(1);
    await new RateLimitService().checkRateLimit(1, 'ai_command:-100', 6, 60);
    expect(pendingUsage()).toHaveLength(0);
  });
});

describe('Mini App API', () => {
  it('one event per request: route pattern, ok by status, latency, person and group', async () => {
    const user = { _id: new mongoose.Types.ObjectId() };
    const group = { _id: new mongoose.Types.ObjectId() };
    const groups = express.Router();
    groups.get('/:groupId/tasks', (req, res) => {
      Object.assign(req, { user, group });
      res.json({ ok: true });
    });
    const api = express.Router();
    api.use(apiUsageMiddleware);
    api.use('/groups', groups);
    const app = express();
    app.use('/api', api);

    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      await fetch(`http://127.0.0.1:${port}/api/groups/${group._id}/tasks`);
      await fetch(`http://127.0.0.1:${port}/api/nope`);
      await settle();
    } finally {
      server.close();
    }
    expect(pendingUsage()).toEqual([
      expect.objectContaining({
        kind: 'api',
        name: 'GET /groups/:groupId/tasks',
        channel: 'app',
        ok: true,
        userId: String(user._id),
        groupId: String(group._id),
        latencyMs: expect.any(Number),
      }),
      expect.objectContaining({ kind: 'api', name: 'GET (unmatched)', ok: false, userId: null }),
    ]);
  });
});

describe('MCP tools', () => {
  const ctx = {
    user: { _id: new mongoose.Types.ObjectId(), telegramUserId: 7 },
    clientLabel: 'Claude Code',
    scopeGroup: null,
  } as never;

  it('records the tool, client, outcome and latency', async () => {
    const tool = { name: 'list_tasks', handler: jest.fn(async () => ({ text: 'ok', data: {} })) };
    const failing = {
      name: 'get_task',
      handler: jest.fn(async () => {
        throw new McpToolError('There is no task #9.');
      }),
    };
    await runTool(tool as never, {}, ctx);
    const result = await runTool(failing as never, {}, ctx);
    expect(result.isError).toBe(true);
    expect(pendingUsage()).toEqual([
      expect.objectContaining({ kind: 'mcp_tool', name: 'list_tasks', channel: 'mcp', client: 'Claude Code', ok: true }),
      expect.objectContaining({ kind: 'mcp_tool', name: 'get_task', ok: false }),
    ]);
  });

  it('picks up the group a tool resolved (noteGroup)', async () => {
    const groupId = new mongoose.Types.ObjectId();
    const { noteGroup } = await import('src/shared/services/telemetry/request-context');
    const tool = {
      name: 'ask_taskbot',
      handler: jest.fn(async () => {
        noteGroup(groupId);
        return { text: 'ok', data: {} };
      }),
    };
    await runTool(tool as never, {}, ctx);
    expect(pendingUsage()).toEqual([expect.objectContaining({ name: 'ask_taskbot', groupId: String(groupId) })]);
  });
});
