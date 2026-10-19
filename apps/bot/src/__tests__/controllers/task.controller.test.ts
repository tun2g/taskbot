import mongoose from 'mongoose';
import { TaskController, DELETE_FORBIDDEN_MESSAGE, ASSIGNEE_NOT_MEMBER_MESSAGE } from 'src/api/controllers/task.controller';
import { isTelegramGroupAdmin } from 'src/api/telegram-admin';
import { Task } from 'src/database/models/task.model';
import { User } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { notificationService } from 'src/shared/services/notification.service';
import { taskSyncService } from 'src/shared/services/task-sync.service';

jest.mock('src/database/services/task.service');
jest.mock('src/database/services/group-member.service');
jest.mock('src/database/services/group.service');
jest.mock('src/database/services/task-activity.service');
jest.mock('src/database/models/task.model', () => ({ Task: { countDocuments: jest.fn() } }));
jest.mock('src/database/models/user.model', () => ({ User: { findById: jest.fn() } }));
jest.mock('src/api/telegram-admin', () => ({ isTelegramGroupAdmin: jest.fn() }));
jest.mock('src/shared/services/notification.service', () => ({
  notificationService: {
    notifyAssignment: jest.fn().mockResolvedValue(undefined),
    notifyStatusChange: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('src/shared/services/task-sync.service', () => ({
  taskSyncService: {
    syncTaskCard: jest.fn().mockResolvedValue(undefined),
    postChangeSummary: jest.fn().mockResolvedValue(undefined),
    onTaskDeleted: jest.fn().mockResolvedValue(undefined),
  },
  userDisplayName: (u: any) => (u?.username ? `@${u.username}` : u?.firstName || 'Someone'),
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const taskId = new mongoose.Types.ObjectId();
const groupId = new mongoose.Types.ObjectId();
const me = { _id: new mongoose.Types.ObjectId(), telegramUserId: 111, username: 'an' };
const binh = { _id: new mongoose.Types.ObjectId(), telegramUserId: 222, username: 'binh' };
const group = { _id: groupId, telegramGroupId: -1001, timezone: 'UTC' };

function makeTask(overrides: Record<string, any> = {}) {
  return {
    _id: taskId,
    groupId,
    title: 'Fix login',
    description: null,
    type: 'task',
    status: 'todo',
    priority: 'medium',
    taskNumber: 12,
    createdBy: me,
    assigneeId: null,
    dueDate: null,
    ...overrides,
  };
}

function createMockReqRes(overrides: Record<string, any> = {}) {
  const req: any = { params: {}, query: {}, body: {}, user: me, ...overrides };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { req, res };
}

describe('TaskController', () => {
  let controller: TaskController;

  beforeEach(() => {
    controller = new TaskController();
    jest.clearAllMocks();
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(true);
    (taskActivityService.record as jest.Mock).mockResolvedValue(undefined);
  });

  describe('listTasks', () => {
    const run = async (query: Record<string, string>) => {
      const { req, res } = createMockReqRes({ params: { groupId: groupId.toString() }, query });
      (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks: [], total: 742 });
      await controller.listTasks(req, res);
      return { req, res, filters: (taskService.getTasksByGroup as jest.Mock).mock.calls[0]?.[1] };
    };

    it('returns the true total in meta', async () => {
      const { res } = await run({ limit: '500' });
      expect(res.json).toHaveBeenCalledWith({ data: [], meta: { page: 1, limit: 500, total: 742 } });
    });

    it('maps assigneeId=me to the caller', async () => {
      const { filters } = await run({ assigneeId: 'me' });
      expect(String(filters.assigneeId)).toBe(String(me._id));
    });

    it('maps assigneeId=none to null (unassigned)', async () => {
      const { filters } = await run({ assigneeId: 'none' });
      expect(filters.assigneeId).toBeNull();
    });

    it('maps a user id to an ObjectId and passes type', async () => {
      const { filters } = await run({ assigneeId: binh._id.toString(), type: 'bug' });
      expect(filters.assigneeId).toBeInstanceOf(mongoose.Types.ObjectId);
      expect(String(filters.assigneeId)).toBe(String(binh._id));
      expect(filters.type).toBe('bug');
    });

    it('leaves assigneeId unset when not filtered', async () => {
      const { filters } = await run({});
      expect('assigneeId' in filters).toBe(false);
    });

    it('rejects limit over 500 with a readable message', async () => {
      const { res } = await run({ limit: '501' });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'You can load at most 500 tasks at once.', statusCode: 400 }),
      );
    });

    it('maps category to the statuses in it', async () => {
      const { filters } = await run({ category: 'in_progress' });
      expect(filters.statuses).toEqual(['in_progress', 'in_review', 'pending']);
    });

    it('maps open=true to every status that is not closed', async () => {
      const { filters } = await run({ open: 'true' });
      expect(filters.statuses).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'pending']);
    });

    it('passes a single status as-is', async () => {
      const { filters } = await run({ status: 'in_review' });
      expect(filters.statuses).toEqual(['in_review']);
    });

    it('rejects invalid status', async () => {
      const { res } = await run({ status: 'invalid_status' });
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('createTask', () => {
    const create = async (body: Record<string, any>) => {
      const { req, res } = createMockReqRes({ params: { groupId: groupId.toString() }, body, group });
      const created = makeTask({ title: body.title });
      (taskService.createTask as jest.Mock).mockResolvedValue(created);
      await controller.createTask(req, res);
      return { res, created, input: (taskService.createTask as jest.Mock).mock.calls[0]?.[0] };
    };

    it('creates with type, a date-only due date and the group chat as card chat', async () => {
      const { res, created, input } = await create({ title: 'New', type: 'bug', dueDate: '2026-10-20' });
      expect(input).toEqual(
        expect.objectContaining({ type: 'bug', taskCardChatId: -1001, dueDate: new Date('2026-10-20T00:00:00.000Z') }),
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ data: created });
      expect(taskSyncService.syncTaskCard).toHaveBeenCalledWith(created, { created: true });
      expect(taskActivityService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'created', via: 'app', to: 'New' }),
      );
    });

    it('truncates legacy ISO datetimes to the date', async () => {
      const { input } = await create({ title: 'New', dueDate: '2026-04-01T18:30:00.000Z' });
      expect(input.dueDate).toEqual(new Date('2026-04-01T00:00:00.000Z'));
    });

    it('rejects an assignee who is not a group member', async () => {
      (groupMemberService.isMember as jest.Mock).mockResolvedValue(false);
      const { res } = await create({ title: 'New', assigneeId: binh._id.toString() });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: ASSIGNEE_NOT_MEMBER_MESSAGE }));
      expect(taskService.createTask).not.toHaveBeenCalled();
    });

    it('notifies the assignee', async () => {
      (User.findById as jest.Mock).mockResolvedValue(binh);
      const { created } = await create({ title: 'New', assigneeId: binh._id.toString() });
      expect(notificationService.notifyAssignment).toHaveBeenCalledWith(created, binh, me);
    });

    it('returns 400 with a human message for missing title', async () => {
      const { res } = await create({});
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Please enter a title.' }));
    });

    it('returns 401 when user not authenticated', async () => {
      const { req, res } = createMockReqRes({ params: { groupId: groupId.toString() }, body: { title: 'x' }, user: undefined });
      await controller.createTask(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('getTask', () => {
    it('returns the loaded task', async () => {
      const task = makeTask();
      const { req, res } = createMockReqRes({ params: { taskId: taskId.toString() }, task });
      await controller.getTask(req, res);
      expect(res.json).toHaveBeenCalledWith({ data: task });
    });

    it('returns 404 when task not found', async () => {
      (taskService.getTaskById as jest.Mock).mockResolvedValue(null);
      const { req, res } = createMockReqRes({ params: { taskId: taskId.toString() } });
      await controller.getTask(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('updateTask', () => {
    const patch = async (before: any, body: Record<string, any>, after?: any) => {
      const { req, res } = createMockReqRes({ params: { taskId: taskId.toString() }, body, task: before });
      const updated = after ?? { ...before, ...body };
      (taskService.updateTaskStatus as jest.Mock).mockResolvedValue(updated);
      (taskService.updateTask as jest.Mock).mockResolvedValue(updated);
      await controller.updateTask(req, res);
      const actions = (taskActivityService.record as jest.Mock).mock.calls.map((c) => c[0]);
      return { res, updated, actions };
    };

    it('changes status with changedBy and records a labelled activity', async () => {
      const { res, updated, actions } = await patch(makeTask(), { status: 'in_progress' });
      expect(taskService.updateTaskStatus).toHaveBeenCalledWith(taskId.toString(), 'in_progress', me._id);
      expect(taskService.updateTask).not.toHaveBeenCalled();
      expect(actions).toEqual([
        expect.objectContaining({ action: 'status', from: '📝 To do', to: '🔄 In progress', via: 'app' }),
      ]);
      expect(taskSyncService.syncTaskCard).toHaveBeenCalledWith(updated);
      expect(taskSyncService.postChangeSummary).toHaveBeenCalledWith(updated, me._id, [
        { field: 'status', from: '📝 To do', to: '🔄 In progress' },
      ]);
      expect(res.json).toHaveBeenCalledWith({ data: updated });
    });

    it('only records fields that actually changed', async () => {
      const { actions } = await patch(makeTask({ priority: 'medium' }), {
        title: 'Fix login',
        priority: 'high',
        status: 'todo',
        type: 'task',
      });
      expect(actions).toEqual([
        expect.objectContaining({ action: 'priority', from: '➡️ Medium', to: '⬆️ High' }),
      ]);
      expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
      expect(taskService.updateTask).toHaveBeenCalledWith(taskId.toString(), { priority: 'high' });
    });

    it('does nothing when nothing changed', async () => {
      const before = makeTask();
      const { res, actions } = await patch(before, { title: 'Fix login' });
      expect(actions).toEqual([]);
      expect(taskService.updateTask).not.toHaveBeenCalled();
      expect(taskSyncService.postChangeSummary).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ data: before });
    });

    it('resets reminderSent and records YYYY-MM-DD when the due date changes', async () => {
      const { actions } = await patch(makeTask({ dueDate: new Date('2026-10-01T00:00:00Z') }), { dueDate: '2026-10-05' });
      expect(taskService.updateTask).toHaveBeenCalledWith(taskId.toString(), {
        dueDate: new Date('2026-10-05T00:00:00.000Z'),
        reminderSent: false,
      });
      expect(actions).toEqual([expect.objectContaining({ action: 'due_date', from: '2026-10-01', to: '2026-10-05' })]);
    });

    it('treats the same day as unchanged', async () => {
      const { actions } = await patch(makeTask({ dueDate: new Date('2026-10-01T00:00:00Z') }), {
        dueDate: '2026-10-01T09:00:00.000Z',
      });
      expect(actions).toEqual([]);
    });

    it('clears the due date with null', async () => {
      const { actions } = await patch(makeTask({ dueDate: new Date('2026-10-01T00:00:00Z') }), { dueDate: null });
      expect(actions).toEqual([expect.objectContaining({ action: 'due_date', from: '2026-10-01', to: null })]);
    });

    it('reassigns: validates membership, records names and notifies the new assignee', async () => {
      (User.findById as jest.Mock).mockResolvedValue(binh);
      const { updated, actions } = await patch(makeTask({ assigneeId: me }), { assigneeId: binh._id.toString() });
      expect(groupMemberService.isMember).toHaveBeenCalledWith(groupId, binh._id.toString());
      expect(actions).toEqual([expect.objectContaining({ action: 'assignee', from: '@an', to: '@binh' })]);
      expect(notificationService.notifyAssignment).toHaveBeenCalledWith(updated, binh, me);
    });

    it('rejects assigning a non-member', async () => {
      (groupMemberService.isMember as jest.Mock).mockResolvedValue(false);
      const { res } = await patch(makeTask(), { assigneeId: binh._id.toString() });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: ASSIGNEE_NOT_MEMBER_MESSAGE }));
      expect(taskService.updateTask).not.toHaveBeenCalled();
    });

    it('notifies the assignee about a status change made by someone else', async () => {
      const { updated } = await patch(makeTask({ assigneeId: binh }), { status: 'done' });
      expect(notificationService.notifyStatusChange).toHaveBeenCalledWith(updated, me, binh);
    });

    it('does not notify when the actor is the assignee', async () => {
      await patch(makeTask({ assigneeId: me }), { status: 'done' });
      expect(notificationService.notifyStatusChange).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid update body', async () => {
      const { res } = await patch(makeTask(), { status: 'invalid_status' });
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('deleteTask', () => {
    const del = async (task: any) => {
      const { req, res } = createMockReqRes({ params: { taskId: taskId.toString() }, task, group });
      (taskService.deleteTask as jest.Mock).mockResolvedValue(true);
      await controller.deleteTask(req, res);
      return res;
    };

    it('lets the creator delete, records activity and notifies the group', async () => {
      const task = makeTask({ createdBy: me });
      const res = await del(task);
      expect(isTelegramGroupAdmin).not.toHaveBeenCalled();
      expect(taskActivityService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deleted', from: '#12 Fix login', via: 'app' }),
      );
      expect(taskSyncService.onTaskDeleted).toHaveBeenCalledWith(task, me._id);
      expect(res.json).toHaveBeenCalledWith({ data: { deleted: true } });
    });

    it('lets a Telegram group admin delete', async () => {
      (isTelegramGroupAdmin as jest.Mock).mockResolvedValue(true);
      const res = await del(makeTask({ createdBy: binh }));
      expect(isTelegramGroupAdmin).toHaveBeenCalledWith(-1001, 111);
      expect(res.json).toHaveBeenCalledWith({ data: { deleted: true } });
    });

    it('forbids other members', async () => {
      (isTelegramGroupAdmin as jest.Mock).mockResolvedValue(false);
      const res = await del(makeTask({ createdBy: binh._id }));
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden', message: DELETE_FORBIDDEN_MESSAGE, statusCode: 403 });
      expect(taskService.deleteTask).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('returns per-status counts, overdue (open, due before today in group tz) and byCategory', async () => {
      (taskService.getTaskStats as jest.Mock).mockResolvedValue({
        backlog: 1, todo: 5, in_progress: 3, in_review: 2, pending: 0, done: 10, cancelled: 4,
      });
      (Task.countDocuments as jest.Mock).mockResolvedValue(2);
      const { req, res } = createMockReqRes({ params: { groupId: groupId.toString() }, group });
      await controller.getStats(req, res);

      const query = (Task.countDocuments as jest.Mock).mock.calls[0][0];
      expect(query.status).toEqual({ $nin: ['done', 'cancelled'] });
      expect(query.dueDate.$lt.toISOString()).toMatch(/T00:00:00\.000Z$/);
      expect(res.json).toHaveBeenCalledWith({
        data: {
          backlog: 1, todo: 5, in_progress: 3, in_review: 2, pending: 0, done: 10, cancelled: 4,
          overdue: 2,
          byCategory: { todo: 6, in_progress: 5, done: 14 },
        },
      });
      expect(groupService.findGroupById).not.toHaveBeenCalled();
    });
  });
});
