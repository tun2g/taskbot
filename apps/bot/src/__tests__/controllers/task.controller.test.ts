import mongoose from 'mongoose';
import {
  TaskController,
  DELETE_FORBIDDEN_MESSAGE,
  ASSIGNEE_NOT_MEMBER_MESSAGE,
  EPIC_NOT_IN_GROUP_MESSAGE,
} from 'src/api/controllers/task.controller';
import { Epic } from 'src/database/models/epic.model';
import { epicService } from 'src/database/services/epic.service';
import { isTelegramGroupAdmin } from 'src/api/telegram-admin';
import { Task } from 'src/database/models/task.model';
import { User } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { subtaskService } from 'src/database/services/subtask.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { notificationService } from 'src/shared/services/notification.service';
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

    it('returns the true total and hasMore in meta', async () => {
      const { req, res } = createMockReqRes({ params: { groupId: groupId.toString() }, query: { page: '2' } });
      (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks: [], total: 742, hasMore: true });
      await controller.listTasks(req, res);
      expect(res.json).toHaveBeenCalledWith({ data: [], meta: { page: 2, limit: 20, total: 742, hasMore: true } });
    });

    it('defaults to 20 per page and caps limit at 100', async () => {
      const { filters, res } = await run({ limit: '500' });
      expect(filters.limit).toBe(100);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ limit: 100 }) }));
      jest.clearAllMocks();
      const { filters: defaults } = await run({});
      expect(defaults).toEqual(expect.objectContaining({ page: 1, limit: 20 }));
    });

    it('combines a board column status with every other filter', async () => {
      const epicId = new mongoose.Types.ObjectId().toString();
      const { filters } = await run({
        status: 'in_progress',
        epicId,
        assigneeId: binh._id.toString(),
        type: 'bug',
        priority: 'high',
        search: 'login',
        category: 'in_progress',
        open: 'true',
        page: '3',
        limit: '20',
      });
      expect(filters).toEqual(
        expect.objectContaining({ type: 'bug', priority: 'high', search: 'login', page: 3, limit: 20 }),
      );
      expect(filters.statuses).toEqual(['in_progress']);
      expect(String(filters.epicId)).toBe(epicId);
      expect(String(filters.assigneeId)).toBe(String(binh._id));
    });

    it('a column status outside the category matches nothing', async () => {
      const { filters } = await run({ status: 'done', category: 'todo' });
      expect(filters.statuses).toEqual([]);
    });

    it('passes the list sort through', async () => {
      const { filters } = await run({ sort: 'due', dir: 'desc' });
      expect(filters).toEqual(expect.objectContaining({ sort: 'due', dir: 'desc' }));
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

    it('rejects a non-positive limit with a readable message', async () => {
      const { res } = await run({ limit: '0' });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Limit must be 1 or more.', statusCode: 400 }),
      );
      expect(taskService.getTasksByGroup).not.toHaveBeenCalled();
    });
    describe('countTasks', () => {
      it('counts with the same filters as the list', async () => {
        const { req, res } = createMockReqRes({
          params: { groupId: groupId.toString() },
          query: { assigneeId: 'none', type: 'bug', limit: '5' },
        });
        (taskService.countTasksByStatus as jest.Mock).mockResolvedValue({ byStatus: { todo: 3, done: 1 }, total: 4 });
        await controller.countTasks(req, res);
        const filters = (taskService.countTasksByStatus as jest.Mock).mock.calls[0][1];
        expect(filters.assigneeId).toBeNull();
        expect(filters.type).toBe('bug');
        expect(res.json).toHaveBeenCalledWith({ data: { byStatus: { todo: 3, done: 1 }, total: 4 } });
      });

      it('rejects invalid filters', async () => {
        const { req, res } = createMockReqRes({ params: { groupId: groupId.toString() }, query: { due: 'soon' } });
        await controller.countTasks(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(taskService.countTasksByStatus).not.toHaveBeenCalled();
      });
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

    describe('due filter', () => {
      const runDue = async (due: string, extra: Record<string, string> = {}, tz = 'Asia/Ho_Chi_Minh') => {
        const { req, res } = createMockReqRes({
          params: { groupId: groupId.toString() },
          query: { due, ...extra },
          group: { ...group, timezone: tz },
        });
        (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks: [], total: 0 });
        await controller.listTasks(req, res);
        return { res, filters: (taskService.getTasksByGroup as jest.Mock).mock.calls[0]?.[1] };
      };

      beforeEach(() => {
        // 2026-10-19 20:00Z is already Oct 20 in Ho Chi Minh (UTC+7)
        jest.useFakeTimers({ now: new Date('2026-10-19T20:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
      });
      afterEach(() => jest.useRealTimers());

      it('overdue = due before today (group tz) and not closed', async () => {
        const { filters } = await runDue('overdue');
        expect(filters.dueTo.toISOString()).toBe('2026-10-20T00:00:00.000Z');
        expect(filters.dueFrom).toBeUndefined();
        expect(filters.statuses).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'pending']);
      });

      it('overdue combined with a closed status matches nothing', async () => {
        const { filters } = await runDue('overdue', { status: 'done' });
        expect(filters.statuses).toEqual([]);
      });

      it('today = [today, tomorrow) and keeps every status', async () => {
        const { filters } = await runDue('today');
        expect(filters.dueFrom.toISOString()).toBe('2026-10-20T00:00:00.000Z');
        expect(filters.dueTo.toISOString()).toBe('2026-10-21T00:00:00.000Z');
        expect(filters.statuses).toBeUndefined();
      });

      it('week = today … today+6', async () => {
        const { filters } = await runDue('week', {}, 'UTC');
        expect(filters.dueFrom.toISOString()).toBe('2026-10-19T00:00:00.000Z');
        expect(filters.dueTo.toISOString()).toBe('2026-10-26T00:00:00.000Z');
      });

      it('none = no due date', async () => {
        const { filters } = await runDue('none');
        expect(filters.dueNone).toBe(true);
        expect(filters.dueFrom).toBeUndefined();
        expect(filters.dueTo).toBeUndefined();
      });

      it('rejects an unknown due value', async () => {
        const { res } = await runDue('later');
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'The due filter must be overdue, today, week or none.' }),
        );
      });
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
      expect(res.json).toHaveBeenCalledWith({ data: { ...created, subtaskProgress: null } });
      expect(taskSyncService.syncTaskCard).toHaveBeenCalledWith(created, { created: true, via: 'app' });
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
      expect(res.json).toHaveBeenCalledWith({ data: { ...task, subtaskProgress: null } });
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
      expect(res.json).toHaveBeenCalledWith({ data: { ...updated, subtaskProgress: null } });
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
      expect(res.json).toHaveBeenCalledWith({ data: { ...before, subtaskProgress: null } });
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
      expect(res.json).toHaveBeenCalledWith({ data: { deleted: true, detachedSubtasks: 0 } });
    });

    it('lets a Telegram group admin delete', async () => {
      (isTelegramGroupAdmin as jest.Mock).mockResolvedValue(true);
      const res = await del(makeTask({ createdBy: binh }));
      expect(isTelegramGroupAdmin).toHaveBeenCalledWith(-1001, 111);
      expect(res.json).toHaveBeenCalledWith({ data: { deleted: true, detachedSubtasks: 0 } });
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

describe('TaskController — epics', () => {
  let controller: TaskController;
  const login = { _id: new mongoose.Types.ObjectId(), groupId, title: 'Login', color: 'blue', status: 'open' };
  const billing = { _id: new mongoose.Types.ObjectId(), groupId, title: 'Billing', color: 'green', status: 'open' };

  beforeEach(() => {
    controller = new TaskController();
    jest.clearAllMocks();
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(true);
    (taskActivityService.record as jest.Mock).mockResolvedValue(undefined);
  });

  describe('listTasks epic filter', () => {
    const run = async (query: Record<string, string>) => {
      const { req, res } = createMockReqRes({ params: { groupId: groupId.toString() }, query });
      (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks: [], total: 0 });
      await controller.listTasks(req, res);
      return { res, filters: (taskService.getTasksByGroup as jest.Mock).mock.calls[0]?.[1] };
    };

    it('maps an epic id to an ObjectId', async () => {
      const { filters } = await run({ epicId: login._id.toString() });
      expect(filters.epicId).toBeInstanceOf(mongoose.Types.ObjectId);
      expect(String(filters.epicId)).toBe(String(login._id));
    });

    it('maps epicId=none to null (no epic)', async () => {
      const { filters } = await run({ epicId: 'none' });
      expect(filters.epicId).toBeNull();
    });

    it('leaves epicId unset when not filtered', async () => {
      const { filters } = await run({});
      expect('epicId' in filters).toBe(false);
    });

    it('rejects a malformed epic filter', async () => {
      const { res } = await run({ epicId: 'nope' });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(taskService.getTasksByGroup).not.toHaveBeenCalled();
    });
  });

  describe('createTask with an epic', () => {
    const create = async (body: Record<string, any>) => {
      const { req, res } = createMockReqRes({ params: { groupId: groupId.toString() }, body, group });
      (taskService.createTask as jest.Mock).mockResolvedValue(makeTask({ title: body.title }));
      await controller.createTask(req, res);
      return { res, input: (taskService.createTask as jest.Mock).mock.calls[0]?.[0] };
    };

    it('puts the task in an epic of the same group', async () => {
      (epicService.findInGroup as jest.Mock).mockResolvedValue(login);
      const { res, input } = await create({ title: 'New', epicId: login._id.toString() });
      expect(epicService.findInGroup).toHaveBeenCalledWith(expect.any(mongoose.Types.ObjectId), login._id.toString());
      expect(String((epicService.findInGroup as jest.Mock).mock.calls[0][0])).toBe(String(groupId));
      expect(input.epicId).toBe(login._id);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('rejects an epic from another group with 400', async () => {
      (epicService.findInGroup as jest.Mock).mockResolvedValue(null);
      const { res } = await create({ title: 'New', epicId: new mongoose.Types.ObjectId().toString() });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: EPIC_NOT_IN_GROUP_MESSAGE }));
      expect(taskService.createTask).not.toHaveBeenCalled();
    });
  });

  describe('updateTask epic', () => {
    const patch = async (before: any, body: Record<string, any>) => {
      const { req, res } = createMockReqRes({ params: { taskId: taskId.toString() }, body, task: before });
      const updated = { ...before, ...body };
      (taskService.updateTask as jest.Mock).mockResolvedValue(updated);
      await controller.updateTask(req, res);
      const actions = (taskActivityService.record as jest.Mock).mock.calls.map((c) => c[0]);
      return { res, actions };
    };

    it('adds the task to an epic: writes epicId, logs the title and passes the color square to the change summary', async () => {
      (epicService.findInGroup as jest.Mock).mockResolvedValue(login);
      const { actions } = await patch(makeTask(), { epicId: login._id.toString() });
      expect(taskService.updateTask).toHaveBeenCalledWith(taskId.toString(), { epicId: login._id });
      expect(actions).toEqual([expect.objectContaining({ action: 'epic', from: null, to: 'Login', via: 'app' })]);
      expect(taskSyncService.postChangeSummary).toHaveBeenCalledWith(expect.anything(), me._id, [
        { field: 'epic', from: null, to: 'Login', fromIcon: null, toIcon: '🟦' },
      ]);
    });

    it('moves between epics (previous epic populated on the task)', async () => {
      (epicService.findInGroup as jest.Mock).mockResolvedValue(billing);
      const { actions } = await patch(makeTask({ epicId: login }), { epicId: billing._id.toString() });
      expect(actions).toEqual([expect.objectContaining({ action: 'epic', from: 'Login', to: 'Billing' })]);
    });

    it('removes the task from its epic with null (previous epic loaded by id)', async () => {
      (Epic.findById as jest.Mock).mockResolvedValue(login);
      const { actions } = await patch(makeTask({ epicId: login._id }), { epicId: null });
      expect(taskService.updateTask).toHaveBeenCalledWith(taskId.toString(), { epicId: null });
      expect(actions).toEqual([expect.objectContaining({ action: 'epic', from: 'Login', to: null })]);
    });

    it('treats the same epic as unchanged', async () => {
      const { actions } = await patch(makeTask({ epicId: login }), { epicId: login._id.toString() });
      expect(epicService.findInGroup).not.toHaveBeenCalled();
      expect(taskService.updateTask).not.toHaveBeenCalled();
      expect(actions).toEqual([]);
    });

    it('rejects an epic from another group with 400', async () => {
      (epicService.findInGroup as jest.Mock).mockResolvedValue(null);
      const { res } = await patch(makeTask(), { epicId: new mongoose.Types.ObjectId().toString() });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: EPIC_NOT_IN_GROUP_MESSAGE }));
      expect(String((epicService.findInGroup as jest.Mock).mock.calls[0][0])).toBe(String(groupId));
      expect(taskService.updateTask).not.toHaveBeenCalled();
    });
  });
});

describe('TaskController — subtasks', () => {
  const controller = new TaskController();
  beforeEach(() => jest.clearAllMocks());

  it('list: parentTaskId filter (a task id or "none") and subtaskProgress on every task', async () => {
    const parentId = new mongoose.Types.ObjectId();
    const withKids = { _id: parentId, title: 'Parent', toJSON() { return { _id: parentId, title: 'Parent' }; } };
    const plain = { _id: new mongoose.Types.ObjectId(), title: 'Plain' };
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks: [withKids, plain], total: 2, hasMore: false });
    (subtaskService.progress as jest.Mock).mockResolvedValueOnce(new Map([[String(parentId), { total: 3, done: 1 }]]));

    const { req, res } = createMockReqRes({ params: { groupId: groupId.toString() }, query: { parentTaskId: 'none' } });
    await controller.listTasks(req, res);
    expect((taskService.getTasksByGroup as jest.Mock).mock.calls[0][1].parentTaskId).toBeNull();
    const data = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(data[0]).toEqual({ _id: parentId, title: 'Parent', subtaskProgress: { total: 3, done: 1 } });
    expect(data[1].subtaskProgress).toBeNull();

    const byParent = createMockReqRes({ params: { groupId: groupId.toString() }, query: { parentTaskId: String(parentId) } });
    await controller.listTasks(byParent.req, byParent.res);
    expect(String((taskService.getTasksByGroup as jest.Mock).mock.calls[1][1].parentTaskId)).toBe(String(parentId));
  });

  it('list: rejects a malformed parent filter', async () => {
    const { req, res } = createMockReqRes({ params: { groupId: groupId.toString() }, query: { parentTaskId: 'abc' } });
    await controller.listTasks(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('GET /tasks/:id/subtasks returns the subtasks in order', async () => {
    const kids = [{ taskNumber: 43 }, { taskNumber: 44 }];
    (subtaskService.list as jest.Mock).mockResolvedValueOnce(kids);
    const taskId = new mongoose.Types.ObjectId().toString();
    const { req, res } = createMockReqRes({ params: { taskId } });
    await controller.getSubtasks(req, res);
    expect(subtaskService.list).toHaveBeenCalledWith(taskId);
    expect(res.json).toHaveBeenCalledWith({ data: kids });
  });

  it('delete reports how many subtasks were kept', async () => {
    (isTelegramGroupAdmin as jest.Mock).mockResolvedValue(true);
    (taskService.deleteTask as jest.Mock).mockResolvedValue(true);
    (subtaskService.detachAll as jest.Mock).mockResolvedValueOnce([{ _id: new mongoose.Types.ObjectId(), taskNumber: 43 }]);
    const task = { _id: new mongoose.Types.ObjectId(), groupId, taskNumber: 42, title: 'P', createdBy: me._id };
    const { req, res } = createMockReqRes({ params: { taskId: String(task._id) }, task, group: { telegramGroupId: -1 } });
    await controller.deleteTask(req, res);
    expect(res.json).toHaveBeenCalledWith({ data: { deleted: true, detachedSubtasks: 1 } });
  });
});
