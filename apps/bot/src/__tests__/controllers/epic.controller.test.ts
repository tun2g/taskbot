import mongoose from 'mongoose';
import { EpicController } from 'src/api/controllers/epic.controller';
import { EpicTitleTakenError, epicService } from 'src/database/services/epic.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { epicEventsService } from 'src/shared/services/epic-events.service';
import { taskSyncService } from 'src/shared/services/task-sync.service';

jest.mock('src/database/services/epic.service', () => {
  class EpicTitleTakenError extends Error {}
  return {
    EpicTitleTakenError,
    epicService: {
      listWithProgress: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findById: jest.fn(),
      taskIds: jest.fn(),
      linkTasks: jest.fn(),
      withProgressFor: jest.fn(async (e: any) => ({ ...e, progress: { total: 0, done: 0, inProgress: 0 } })),
    },
  };
});
jest.mock('src/shared/services/task-sync.service', () => ({
  taskSyncService: { syncTaskCard: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('src/shared/services/epic-events.service', () => ({
  epicEventsService: {
    created: jest.fn().mockResolvedValue(undefined),
    statusChanged: jest.fn().mockResolvedValue(undefined),
    deleted: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('src/database/services/task-activity.service', () => ({
  taskActivityService: { record: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const groupId = new mongoose.Types.ObjectId();
const epicId = new mongoose.Types.ObjectId();
const me = { _id: new mongoose.Types.ObjectId(), telegramUserId: 111, username: 'an' };
const login = { _id: epicId, groupId, title: 'Login', color: 'blue', status: 'open' };

function createMockReqRes(overrides: Record<string, any> = {}) {
  const req: any = { params: {}, query: {}, body: {}, user: me, ...overrides };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { req, res };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('EpicController', () => {
  let controller: EpicController;

  beforeEach(() => {
    controller = new EpicController();
    jest.clearAllMocks();
  });

  it('lists the group epics with progress', async () => {
    const list = [{ ...login, progress: { total: 3, done: 1, inProgress: 1 } }];
    (epicService.listWithProgress as jest.Mock).mockResolvedValue(list);
    const { req, res } = createMockReqRes({ params: { groupId: groupId.toString() } });
    await controller.listEpics(req, res);
    expect(String((epicService.listWithProgress as jest.Mock).mock.calls[0][0])).toBe(String(groupId));
    expect(res.json).toHaveBeenCalledWith({ data: list });
  });

  describe('createEpic', () => {
    const create = async (body: Record<string, any>) => {
      const { req, res } = createMockReqRes({ params: { groupId: groupId.toString() }, body });
      await controller.createEpic(req, res);
      return res;
    };

    it('creates with the caller as creator → 201 with progress', async () => {
      (epicService.create as jest.Mock).mockResolvedValue(login);
      const res = await create({ title: ' Login ', color: 'blue' });
      expect(epicService.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Login', color: 'blue', createdBy: me._id }),
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ title: 'Login', progress: expect.anything() }) });
    });

    it('announces a new epic in the group "(via app)"', async () => {
      (epicService.create as jest.Mock).mockResolvedValue(login);
      await create({ title: 'Login' });
      expect(epicEventsService.created).toHaveBeenCalledWith(login, me, 'app');
    });

    it('a restore (undo of a delete) stays quiet — even with no tasks to put back', async () => {
      (epicService.create as jest.Mock).mockResolvedValue(login);
      (epicService.linkTasks as jest.Mock).mockResolvedValue([]);
      await create({ title: 'Login', taskIds: [String(new mongoose.Types.ObjectId())] });
      await create({ title: 'Login', taskIds: [] });
      expect(epicService.create).toHaveBeenCalledTimes(2);
      expect(epicEventsService.created).not.toHaveBeenCalled();
    });

    it('a failed announcement never fails the request', async () => {
      (epicService.create as jest.Mock).mockResolvedValue(login);
      (epicEventsService.created as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
      const res = await create({ title: 'Login' });
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('400 for a missing title, a too-long title or an unknown color', async () => {
      for (const body of [{}, { title: 'x'.repeat(81) }, { title: 'Ok', color: 'gold' }]) {
        const res = await create(body);
        expect(res.status).toHaveBeenCalledWith(400);
      }
      expect(epicService.create).not.toHaveBeenCalled();
    });

    it('409 with a readable message for a duplicate title', async () => {
      (epicService.create as jest.Mock).mockRejectedValue(new EpicTitleTakenError('An epic called "Login" already exists.'));
      const res = await create({ title: 'login' });
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, error: 'Conflict' }));
    });

    it('undo of a delete: recreates with its status and links its tasks back, with an activity row each', async () => {
      const t1 = new mongoose.Types.ObjectId();
      (epicService.create as jest.Mock).mockResolvedValue({ ...login, status: 'done' });
      (epicService.linkTasks as jest.Mock).mockResolvedValue([t1]);
      const res = await create({ title: 'Login', color: 'blue', status: 'done', taskIds: [String(t1), String(epicId)] });
      await flush();
      expect(epicService.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));
      expect(epicService.linkTasks).toHaveBeenCalledWith(expect.objectContaining({ _id: epicId }), [
        String(t1),
        String(epicId),
      ]);
      expect(taskActivityService.record).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: t1, action: 'epic', from: null, to: 'Login', via: 'app', actor: me._id }),
      );
      expect(taskSyncService.syncTaskCard).toHaveBeenCalledWith({ _id: t1 });
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('400 for malformed taskIds', async () => {
      const res = await create({ title: 'Login', taskIds: ['nope'] });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(epicService.create).not.toHaveBeenCalled();
    });

    it('401 without a user', async () => {
      const { req, res } = createMockReqRes({ params: { groupId: groupId.toString() }, body: { title: 'x' }, user: undefined });
      await controller.createEpic(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('updateEpic', () => {
    const update = async (body: Record<string, any>, after: any) => {
      (epicService.update as jest.Mock).mockResolvedValue(after);
      const { req, res } = createMockReqRes({ params: { epicId: epicId.toString() }, body, epic: { ...login } });
      await controller.updateEpic(req, res);
      await flush();
      return res;
    };

    it('renames and refreshes the cards of its tasks', async () => {
      const taskIds = [new mongoose.Types.ObjectId()];
      (epicService.taskIds as jest.Mock).mockResolvedValue(taskIds);
      const res = await update({ title: 'Sign-in' }, { ...login, title: 'Sign-in' });
      expect(epicService.update).toHaveBeenCalledWith(expect.objectContaining({ _id: epicId }), { title: 'Sign-in' });
      expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ title: 'Sign-in' }) });
      expect(taskSyncService.syncTaskCard).toHaveBeenCalledWith({ _id: taskIds[0] });
    });

    it('does not touch cards when only the status changed', async () => {
      await update({ status: 'done' }, { ...login, status: 'done' });
      expect(epicService.taskIds).not.toHaveBeenCalled();
    });

    it('announces done / reopened with the status before the change', async () => {
      await update({ status: 'done' }, { ...login, status: 'done' });
      expect(epicEventsService.statusChanged).toHaveBeenCalledWith('open', expect.objectContaining({ status: 'done' }), me, 'app');
    });

    it('rename / recolor / description edits are not announced', async () => {
      (epicService.taskIds as jest.Mock).mockResolvedValue([]);
      await update({ title: 'Sign-in', color: 'green', description: 'x' }, { ...login, title: 'Sign-in', color: 'green', description: 'x' });
      expect(epicEventsService.statusChanged).not.toHaveBeenCalled();
      expect(epicEventsService.created).not.toHaveBeenCalled();
    });

    it('400 for an invalid status, 409 for a taken title', async () => {
      let res = await update({ status: 'archived' }, login);
      expect(res.status).toHaveBeenCalledWith(400);

      (epicService.update as jest.Mock).mockRejectedValue(new EpicTitleTakenError('taken'));
      const { req, res: res2 } = createMockReqRes({ params: { epicId: epicId.toString() }, body: { title: 'Billing' }, epic: login });
      await controller.updateEpic(req, res2);
      res = res2;
      expect(res.status).toHaveBeenCalledWith(409);
    });
  });

  describe('deleteEpic', () => {
    it('deletes, reports unlinked tasks and refreshes their cards', async () => {
      const taskIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
      (epicService.delete as jest.Mock).mockResolvedValue(taskIds);
      const { req, res } = createMockReqRes({ params: { epicId: epicId.toString() }, epic: login });
      await controller.deleteEpic(req, res);
      await flush();
      expect(epicService.delete).toHaveBeenCalledWith(login);
      expect(res.json).toHaveBeenCalledWith({
        data: { deleted: true, tasksUnlinked: 2, taskIds: taskIds.map(String) },
      });
      expect(taskSyncService.syncTaskCard).toHaveBeenCalledTimes(2);
      expect(taskActivityService.record).toHaveBeenCalledTimes(2);
      expect(taskActivityService.record).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: taskIds[0], groupId, action: 'epic', from: 'Login', to: null, via: 'app' }),
      );
      expect(epicEventsService.deleted).toHaveBeenCalledWith(login, me, 2, 'app');
    });

    it('404 when the epic is gone', async () => {
      (epicService.findById as jest.Mock).mockResolvedValue(null);
      const { req, res } = createMockReqRes({ params: { epicId: epicId.toString() } });
      await controller.deleteEpic(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
