import mongoose from 'mongoose';
import { User } from 'src/database/models/user.model';
import { epicService } from 'src/database/services/epic.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { subtaskService } from 'src/database/services/subtask.service';
import { TaskMutationError, TaskMutationService } from 'src/shared/services/task-mutation.service';
import { taskSyncService } from 'src/shared/services/task-sync.service';

jest.mock('src/database/services/task.service');
jest.mock('src/database/services/group-member.service');
jest.mock('src/database/services/group.service');
jest.mock('src/database/services/task-activity.service');
jest.mock('src/database/services/subtask.service', () => ({
  subtaskService: {
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    progress: jest.fn().mockResolvedValue(new Map()),
    detachAll: jest.fn().mockResolvedValue([]),
    setEpic: jest.fn().mockResolvedValue(0),
  },
}));
jest.mock('src/database/services/epic.service');
jest.mock('src/database/models/epic.model', () => ({ Epic: { findById: jest.fn() } }));
jest.mock('src/database/models/user.model', () => ({ User: { findById: jest.fn() } }));
jest.mock('src/api/telegram-admin', () => ({ isTelegramGroupAdmin: jest.fn() }));
jest.mock('src/shared/services/notification.service', () => ({
  notificationService: {
    notifyAssignment: jest.fn().mockResolvedValue(undefined),
    notifyUnassigned: jest.fn().mockResolvedValue(undefined),
    notifyStatusChange: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('src/shared/services/task-sync.service', () => ({
  taskSyncService: {
    syncTaskCard: jest.fn().mockResolvedValue(undefined),
    postChangeSummary: jest.fn().mockResolvedValue(undefined),
    onTaskDeleted: jest.fn().mockResolvedValue(undefined),
  },
  userDisplayName: (u: any) => (u?.username ? `@${u.username}` : 'Someone'),
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const oid = () => new mongoose.Types.ObjectId();
const me = { _id: oid(), telegramUserId: 1, username: 'me' } as any;
const an = { _id: oid(), telegramUserId: 2, username: 'an' } as any;
const group = { _id: oid(), telegramGroupId: -1001 } as any;
const task = (o: Record<string, unknown> = {}) =>
  ({
    _id: oid(),
    groupId: group._id,
    taskNumber: 7,
    title: 'Fix',
    status: 'todo',
    priority: 'medium',
    type: 'task',
    createdBy: me,
    assigneeId: null,
    ...o,
  }) as any;

// The subtask rules of the task mutation service (task-mutation/subtasks.ts).

const service = new TaskMutationService();
const login = { _id: oid(), title: 'Login', color: 'blue' };
const pay = { _id: oid(), title: 'Payments', color: 'green' };
const parent = task({ taskNumber: 42, title: 'Checkout v2', epicId: login });

beforeEach(() => {
  jest.clearAllMocks();
  (groupMemberService.isMember as jest.Mock).mockResolvedValue(true);
  (User.findById as jest.Mock).mockResolvedValue(an);
  (subtaskService.count as jest.Mock).mockResolvedValue(0);
  (subtaskService.detachAll as jest.Mock).mockResolvedValue([]);
  (subtaskService.setEpic as jest.Mock).mockResolvedValue(0);
  (subtaskService.list as jest.Mock).mockResolvedValue([]);
  (taskService.getTaskById as jest.Mock).mockImplementation(async (id: string) =>
    String(id) === String(parent._id) ? parent : null,
  );
  (taskService.updateTask as jest.Mock).mockImplementation(async (id: string, u: any) => task({ _id: id, ...u }));
  (epicService.findInGroup as jest.Mock).mockImplementation(async (_g: unknown, id: string) =>
    [login, pay].find((e) => String(e._id) === String(id)) ?? null,
  );
});

const record = () => (taskActivityService.record as jest.Mock).mock.calls.map((c) => c[0]);
const rule = async (promise: Promise<unknown>, pattern: RegExp) => {
  await expect(promise).rejects.toBeInstanceOf(TaskMutationError);
  await expect(promise).rejects.toThrow(pattern);
};

describe('create a subtask', () => {
  it("takes the parent's epic (ignoring the one passed), logs on the parent and refreshes its card", async () => {
    const created = task({ taskNumber: 43, title: 'API' });
    (taskService.createTask as jest.Mock).mockResolvedValue(created);
    await service.createTask(group, me, { title: 'API', parentTaskId: String(parent._id), epicId: String(pay._id) });

    const input = (taskService.createTask as jest.Mock).mock.calls[0][0];
    expect(String(input.parentTaskId)).toBe(String(parent._id));
    expect(String(input.epicId)).toBe(String(login._id));
    expect(epicService.findInGroup).not.toHaveBeenCalled();
    expect(record()).toContainEqual(
      expect.objectContaining({ action: 'subtask_added', to: '#43 API', taskId: expect.anything() }),
    );
    expect(String(record().find((r) => r.action === 'subtask_added').taskId)).toBe(String(parent._id));
    await new Promise((r) => setImmediate(r));
    expect(taskSyncService.syncTaskCard).toHaveBeenCalledWith(parent);
  });

  it('refuses a parent from another group, a subtask as parent and a full parent', async () => {
    const foreign = task({ groupId: oid() });
    (taskService.getTaskById as jest.Mock).mockResolvedValueOnce(foreign);
    await rule(service.createTask(group, me, { title: 'X', parentTaskId: String(foreign._id) }), /could not be found in this group/);

    const sub = task({ taskNumber: 45, parentTaskId: { _id: parent._id, taskNumber: 42, title: 'Checkout v2' } });
    (taskService.getTaskById as jest.Mock).mockResolvedValueOnce(sub);
    await rule(service.createTask(group, me, { title: 'X', parentTaskId: String(sub._id) }), /#45 is already a subtask of #42.*Add it to #42 instead/);

    (subtaskService.count as jest.Mock).mockResolvedValueOnce(50);
    await rule(service.createTask(group, me, { title: 'X', parentTaskId: String(parent._id) }), /already has 50 subtasks/);
    expect(taskService.createTask).not.toHaveBeenCalled();
  });
});

describe('move / detach', () => {
  it("joining a parent moves it into the parent's epic; both changes are logged and the parent is told", async () => {
    const t = task({ taskNumber: 45, title: 'API', epicId: pay });
    (taskService.updateTask as jest.Mock).mockImplementationOnce(async (_id: string, u: any) => ({ ...t, ...u }));
    const { changes } = await service.updateTask(t, me, { parentTaskId: String(parent._id) });
    expect(changes.map((c) => c.field)).toEqual(['parent', 'epic']);
    expect(changes[0]).toMatchObject({ from: null, to: '#42 Checkout v2' });
    expect(changes[1]).toMatchObject({ from: 'Payments', to: 'Login' });
    const updates = (taskService.updateTask as jest.Mock).mock.calls[0][1];
    expect(String(updates.parentTaskId)).toBe(String(parent._id));
    expect(String(updates.epicId)).toBe(String(login._id));
    expect(record()).toContainEqual(expect.objectContaining({ action: 'subtask_added', to: '#45 API' }));
  });

  it('refuses itself as parent and a task that has subtasks of its own', async () => {
    await rule(service.updateTask(parent, me, { parentTaskId: String(parent._id) }), /can't be a subtask of itself/);
    const t = task({ taskNumber: 50 });
    (subtaskService.count as jest.Mock).mockResolvedValueOnce(2);
    await rule(service.updateTask(t, me, { parentTaskId: String(parent._id) }), /#50 has 2 subtasks of its own/);
  });

  it('null detaches: logged on the subtask and as subtask_removed on the old parent; the epic stays', async () => {
    const sub = task({ taskNumber: 45, title: 'API', epicId: login, parentTaskId: { _id: parent._id, taskNumber: 42, title: 'Checkout v2' } });
    (taskService.updateTask as jest.Mock).mockImplementationOnce(async (_id: string, u: any) => ({ ...sub, ...u }));
    const { changes } = await service.updateTask(sub, me, { parentTaskId: null });
    expect(changes).toEqual([{ field: 'parent', from: '#42 Checkout v2', to: null }]);
    expect((taskService.updateTask as jest.Mock).mock.calls[0][1]).toEqual({ parentTaskId: null });
    const removed = record().find((r) => r.action === 'subtask_removed');
    expect(removed).toMatchObject({ from: '#45 API' });
    expect(String(removed.taskId)).toBe(String(parent._id));
  });
});

describe('epics', () => {
  it("refuses an epic change on a subtask, but accepts the parent's epic as a no-op", async () => {
    const sub = task({ taskNumber: 45, epicId: login, parentTaskId: { _id: parent._id, taskNumber: 42, title: 'Checkout v2' } });
    await rule(service.updateTask(sub, me, { epicId: String(pay._id) }), /Change the epic on #42 instead/);
    const same = await service.updateTask(sub, me, { epicId: String(login._id) });
    expect(same.changes).toEqual([]);
  });

  it("a parent's subtasks follow it into its new epic", async () => {
    const p = task({ taskNumber: 42, epicId: login });
    (subtaskService.setEpic as jest.Mock).mockResolvedValueOnce(2);
    (subtaskService.list as jest.Mock).mockResolvedValueOnce([task({ taskNumber: 43 }), task({ taskNumber: 44 })]);
    await service.updateTask(p, me, { epicId: String(pay._id) });
    expect(String((subtaskService.setEpic as jest.Mock).mock.calls[0][1])).toBe(String(pay._id));
    expect(taskSyncService.syncTaskCard).toHaveBeenCalledTimes(3); // the parent + its 2 subtasks
  });
});

describe('status', () => {
  it("closing a subtask refreshes the parent's card (progress)", async () => {
    const sub = task({ taskNumber: 45, parentTaskId: { _id: parent._id, taskNumber: 42, title: 'Checkout v2' } });
    (taskService.updateTaskStatus as jest.Mock).mockResolvedValue({ ...sub, status: 'done' });
    await service.updateTask(sub, me, { status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(taskSyncService.syncTaskCard).toHaveBeenCalledWith(parent);
  });
});

describe('delete', () => {
  it('a deleted parent keeps its subtasks as regular tasks, logged on each', async () => {
    (taskService.deleteTask as jest.Mock).mockResolvedValue(true);
    const kids = [task({ taskNumber: 43 }), task({ taskNumber: 44 })];
    (subtaskService.detachAll as jest.Mock).mockResolvedValueOnce(kids);
    const { detached } = await service.deleteTask(parent, me);
    expect(detached).toBe(kids);
    const logged = record().filter((r) => r.action === 'parent');
    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatchObject({ from: '#42 Checkout v2', to: null });
  });

  it('a deleted subtask is logged on its parent', async () => {
    (taskService.deleteTask as jest.Mock).mockResolvedValue(true);
    const sub = task({ taskNumber: 45, title: 'API', parentTaskId: parent._id });
    await service.deleteTask(sub, me);
    expect(record()).toContainEqual(expect.objectContaining({ action: 'subtask_removed', from: '#45 API' }));
  });
});
