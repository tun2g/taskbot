import mongoose from 'mongoose';
import { Epic } from 'src/database/models/epic.model';
import { Task } from 'src/database/models/task.model';
import { EpicService, EpicTitleTakenError, pickLeastUsedColor } from 'src/database/services/epic.service';

jest.mock('src/database/models/epic.model', () => ({
  Epic: {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    aggregate: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
  },
}));
jest.mock('src/database/models/task.model', () => ({
  Task: { aggregate: jest.fn(), find: jest.fn(), updateMany: jest.fn() },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const groupId = new mongoose.Types.ObjectId();
const userId = new mongoose.Types.ObjectId();
const loginId = new mongoose.Types.ObjectId();
const billingId = new mongoose.Types.ObjectId();

function epicDoc(overrides: Record<string, any> = {}) {
  return { _id: loginId, groupId, title: 'Login', color: 'blue', status: 'open', ...overrides };
}

describe('EpicService', () => {
  let service: EpicService;

  beforeEach(() => {
    service = new EpicService();
    jest.clearAllMocks();
  });

  describe('getProgress / listWithProgress', () => {
    it('counts per epic in one aggregation: total without cancelled, done / in-progress by category, cancelled apart', async () => {
      (Task.aggregate as jest.Mock).mockResolvedValue([
        { _id: { epicId: loginId, status: 'todo' }, count: 2 },
        { _id: { epicId: loginId, status: 'in_progress' }, count: 1 },
        { _id: { epicId: loginId, status: 'in_review' }, count: 1 },
        { _id: { epicId: loginId, status: 'done' }, count: 3 },
        { _id: { epicId: billingId, status: 'backlog' }, count: 1 },
        { _id: { epicId: billingId, status: 'cancelled' }, count: 2 },
      ]);

      const progress = await service.getProgress(groupId);

      expect(Task.aggregate).toHaveBeenCalledTimes(1);
      const [match] = (Task.aggregate as jest.Mock).mock.calls[0][0];
      expect(match.$match).toEqual({ groupId, epicId: { $ne: null } });
      expect(progress.get(String(loginId))).toEqual({ total: 7, done: 3, inProgress: 2, cancelled: 0 });
      expect(progress.get(String(billingId))).toEqual({ total: 1, done: 0, inProgress: 0, cancelled: 2 });
    });

    it('lists every epic with progress, zeros for epics without tasks', async () => {
      const sort = jest.fn().mockResolvedValue([epicDoc(), epicDoc({ _id: billingId, title: 'Billing' })]);
      (Epic.find as jest.Mock).mockReturnValue({ populate: jest.fn().mockReturnValue({ sort }) });
      (Task.aggregate as jest.Mock).mockResolvedValue([{ _id: { epicId: loginId, status: 'done' }, count: 1 }]);

      const epics = await service.listWithProgress(groupId);

      expect(Epic.find).toHaveBeenCalledWith({ groupId });
      expect(epics.map((e) => [e.title, e.progress])).toEqual([
        ['Login', { total: 1, done: 1, inProgress: 0, cancelled: 0 }],
        ['Billing', { total: 0, done: 0, inProgress: 0, cancelled: 0 }],
      ]);
    });
  });

  describe('create', () => {
    it('rejects a duplicate title in the group (case-insensitive) with EpicTitleTakenError', async () => {
      (Epic.findOne as jest.Mock).mockResolvedValue(epicDoc());
      await expect(service.create({ groupId, createdBy: userId, title: '  login ' })).rejects.toBeInstanceOf(
        EpicTitleTakenError,
      );
      const query = (Epic.findOne as jest.Mock).mock.calls[0][0];
      expect(query.groupId).toBe(groupId);
      expect(query.title).toEqual({ $regex: '^login$', $options: 'i' });
      expect(Epic.create).not.toHaveBeenCalled();
    });

    it('auto-picks the least-used color when none is given', async () => {
      (Epic.findOne as jest.Mock).mockResolvedValue(null);
      (Epic.aggregate as jest.Mock).mockResolvedValue([
        { _id: 'blue', count: 2 },
        { _id: 'green', count: 1 },
      ]);
      (Epic.create as jest.Mock).mockImplementation(async (data) => ({ _id: billingId, ...data }));

      const epic = await service.create({ groupId, createdBy: userId, title: 'Billing  v2' });

      expect(Epic.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Billing v2', color: 'orange', status: 'open', description: null }),
      );
      expect(epic.color).toBe('orange');
    });

    it('keeps an explicit color', async () => {
      (Epic.findOne as jest.Mock).mockResolvedValue(null);
      (Epic.create as jest.Mock).mockImplementation(async (data) => data);
      await service.create({ groupId, createdBy: userId, title: 'Ops', color: 'red' as any });
      expect(Epic.aggregate).not.toHaveBeenCalled();
      expect(Epic.create).toHaveBeenCalledWith(expect.objectContaining({ color: 'red' }));
    });

    it('pickLeastUsedColor breaks ties by palette order', () => {
      expect(pickLeastUsedColor({})).toBe('blue');
      expect(pickLeastUsedColor({ blue: 1, green: 1, orange: 1, purple: 0 })).toBe('purple');
    });

    it('pickLeastUsedColor never auto-picks red', () => {
      expect(pickLeastUsedColor({ blue: 1, green: 1, orange: 1, purple: 1 })).toBe('yellow');
      expect(pickLeastUsedColor({ blue: 2, green: 2, orange: 2, purple: 2, yellow: 2, brown: 2, gray: 2 })).toBe('blue');
    });

    it('creates with a given status (undo of a delete)', async () => {
      (Epic.findOne as jest.Mock).mockResolvedValue(null);
      (Epic.create as jest.Mock).mockImplementation(async (data) => data);
      await service.create({ groupId, createdBy: userId, title: 'Ops', color: 'red' as any, status: 'done' as any });
      expect(Epic.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));
    });
  });

  describe('update', () => {
    it('rejects renaming onto another epic title', async () => {
      (Epic.findOne as jest.Mock).mockResolvedValue(epicDoc({ _id: billingId, title: 'Billing' }));
      await expect(service.update(epicDoc() as any, { title: 'billing' })).rejects.toBeInstanceOf(EpicTitleTakenError);
      expect(Epic.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('allows changing only the case of its own title', async () => {
      (Epic.findOne as jest.Mock).mockResolvedValue(epicDoc());
      (Epic.findByIdAndUpdate as jest.Mock).mockResolvedValue(epicDoc({ title: 'LOGIN' }));
      await service.update(epicDoc() as any, { title: 'LOGIN' });
      expect(Epic.findByIdAndUpdate).toHaveBeenCalledWith(loginId, { $set: { title: 'LOGIN' } }, expect.anything());
    });

    it('writes only the given fields and skips the write when nothing changed', async () => {
      const epic = epicDoc();
      expect(await service.update(epic as any, {})).toBe(epic);
      expect(Epic.findByIdAndUpdate).not.toHaveBeenCalled();

      (Epic.findByIdAndUpdate as jest.Mock).mockResolvedValue(epic);
      await service.update(epic as any, { status: 'done' as any, description: '' });
      expect(Epic.findByIdAndUpdate).toHaveBeenCalledWith(
        loginId,
        { $set: { status: 'done', description: null } },
        expect.anything(),
      );
    });
  });

  describe('delete', () => {
    it('unsets epicId on its tasks (tasks are kept) and deletes the epic', async () => {
      const t1 = new mongoose.Types.ObjectId();
      const t2 = new mongoose.Types.ObjectId();
      const t3 = new mongoose.Types.ObjectId();
      (Task.find as jest.Mock).mockResolvedValue([
        { _id: t1, status: 'done' },
        { _id: t2, status: 'todo' },
        { _id: t3, status: 'cancelled' },
      ]);

      const unlinked = await service.delete(epicDoc() as any);

      expect(Task.updateMany).toHaveBeenCalledWith({ groupId, epicId: loginId }, { $set: { epicId: null } });
      expect(Epic.deleteOne).toHaveBeenCalledWith({ _id: loginId });
      // Open tasks first, so the capped card refresh reaches them.
      expect(unlinked).toEqual([t2, t1, t3]);
    });
  });

  describe('linkTasks', () => {
    it('links back only tasks of the group that have no epic now', async () => {
      const t1 = new mongoose.Types.ObjectId();
      const t2 = new mongoose.Types.ObjectId();
      (Task.find as jest.Mock).mockResolvedValue([{ _id: t1 }]);

      const linked = await service.linkTasks(epicDoc() as any, [String(t1), String(t2), String(t1), 'bad']);

      const [filter] = (Task.find as jest.Mock).mock.calls[0];
      expect(filter).toEqual({ _id: { $in: [String(t1), String(t2)] }, groupId, epicId: null });
      expect(Task.updateMany).toHaveBeenCalledWith(
        { _id: { $in: [t1] }, groupId, epicId: null },
        { $set: { epicId: loginId } },
      );
      expect(linked).toEqual([t1]);
    });

    it('does nothing for an empty list', async () => {
      expect(await service.linkTasks(epicDoc() as any, [])).toEqual([]);
      expect(Task.find).not.toHaveBeenCalled();
    });
  });

  describe('findByTitle / findInGroup', () => {
    it('escapes regex characters and ignores blank titles', async () => {
      (Epic.findOne as jest.Mock).mockResolvedValue(null);
      await service.findByTitle(groupId, 'v1.2 (beta)');
      expect((Epic.findOne as jest.Mock).mock.calls[0][0].title.$regex).toBe('^v1\\.2 \\(beta\\)$');
      expect(await service.findByTitle(groupId, '   ')).toBeNull();
      expect(Epic.findOne).toHaveBeenCalledTimes(1);
    });

    it('only finds an epic inside the given group', async () => {
      (Epic.findOne as jest.Mock).mockResolvedValue(null);
      expect(await service.findInGroup(groupId, loginId.toString())).toBeNull();
      expect(Epic.findOne).toHaveBeenCalledWith({ _id: loginId.toString(), groupId });
      expect(await service.findInGroup(groupId, 'bad-id')).toBeNull();
    });
  });
});
