import mongoose from 'mongoose';
import { decidePreview, savePreview } from 'src/shared/services/ai-command/subtask-preview';
import { createSubtaskItems } from 'src/shared/services/ai-command/subtask-items';
import { redisService } from 'src/shared/services/redis.service';

const store = new Map<string, string>();
jest.mock('src/shared/services/redis.service', () => ({
  redisService: {
    set: jest.fn(async (key: string, value: string, opts?: { NX?: boolean }) => {
      if (opts?.NX && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  },
}));
jest.mock('src/shared/services/ai-command/subtask-items', () => ({ createSubtaskItems: jest.fn() }));
jest.mock('src/database/models/group.model', () => ({ Group: { findById: jest.fn() } }));
jest.mock('src/database/models/user.model', () => ({ User: { findById: jest.fn(), find: jest.fn() } }));
jest.mock('src/database/services/task.service', () => ({ taskService: { getTaskById: jest.fn() } }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { Group } = jest.requireMock('src/database/models/group.model');
const { User } = jest.requireMock('src/database/models/user.model');
const { taskService } = jest.requireMock('src/database/services/task.service');

const oid = () => new mongoose.Types.ObjectId();
const me = { _id: oid(), telegramUserId: 1, username: 'me' } as any;
const an = { _id: oid(), telegramUserId: 2, username: 'an' } as any;
const group = { _id: oid(), telegramGroupId: -100 } as any;
const parent = { _id: oid(), taskNumber: 42, title: 'Checkout v2', groupId: group._id } as any;

async function save() {
  const id = await savePreview(
    { group, requester: me, activityVia: 'ai', request: 'tách nhỏ #42' },
    parent,
    [
      { title: 'API', assignee: an },
      { title: 'UI', assignee: null },
    ],
    ['⚠️ note'],
  );
  expect(id).toMatch(/^[0-9a-f]{12}$/);
  return id as string;
}

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  Group.findById.mockResolvedValue(group);
  User.findById.mockResolvedValue(me);
  User.find.mockResolvedValue([an]);
  taskService.getTaskById.mockResolvedValue(parent);
  (createSubtaskItems as jest.Mock).mockResolvedValue({ parent, created: [{ task: {}, assignee: an }], proposed: true, warnings: [], batchId: 'b1' });
});

describe('subtask preview', () => {
  it('creates the stored items (people resolved again) when the requester accepts — once', async () => {
    const id = await save();
    const result = await decidePreview(id, 'add', { telegramUserId: 1 }, 'telegram');
    expect(result.status).toBe('added');
    const [ctx, p, items, opts] = (createSubtaskItems as jest.Mock).mock.calls[0];
    expect(ctx).toEqual({ group, requester: me, activityVia: 'ai', channel: 'telegram' });
    expect(p).toBe(parent);
    expect(items).toEqual([
      { title: 'API', assignee: an, dueDate: null },
      { title: 'UI', assignee: null, dueDate: null },
    ]);
    expect(opts).toEqual({ proposed: true, warnings: ['⚠️ note'] });
    expect(result.status === 'added' && result.request).toBe('tách nhỏ #42');

    expect((await decidePreview(id, 'add', { telegramUserId: 1 }, 'telegram')).status).toBe('expired');
    expect(createSubtaskItems).toHaveBeenCalledTimes(1);
  });

  it('only the requester decides (web matches the user id)', async () => {
    const id = await save();
    expect(await decidePreview(id, 'add', { telegramUserId: 2 }, 'telegram')).toEqual({ status: 'forbidden', requesterName: '@me' });
    expect((await decidePreview(id, 'cancel', { userId: String(me._id) }, 'web')).status).toBe('cancelled');
    expect(createSubtaskItems).not.toHaveBeenCalled();
  });

  it('a double tap is "busy", an unknown id "expired"', async () => {
    const id = await save();
    store.set(`subprev:${id}:lock`, '1');
    expect((await decidePreview(id, 'add', { telegramUserId: 1 }, 'telegram')).status).toBe('busy');
    expect((await decidePreview('nothex', 'add', { telegramUserId: 1 }, 'telegram')).status).toBe('expired');
    expect(redisService.get).not.toHaveBeenCalledWith('subprev:nothex');
  });
});
