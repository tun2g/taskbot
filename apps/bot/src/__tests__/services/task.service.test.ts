import { TaskService } from 'src/database/services/task.service';
import { Task } from 'src/database/models/task.model';
import { groupService } from 'src/database/services/group.service';
import mongoose from 'mongoose';

// Mock dependencies
jest.mock('src/database/models/task.model');
jest.mock('src/database/services/group.service');
jest.mock('src/shared/logger/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const mockObjectId = new mongoose.Types.ObjectId();
const mockGroupId = new mongoose.Types.ObjectId();
const mockUserId = new mongoose.Types.ObjectId();

const mockTask = {
  _id: mockObjectId,
  groupId: mockGroupId,
  title: 'Test task',
  description: 'A test description',
  status: 'todo',
  priority: 'medium',
  taskNumber: 1,
  createdBy: mockUserId,
  assigneeId: null,
  dueDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('TaskService', () => {
  let service: TaskService;

  beforeEach(() => {
    service = new TaskService();
    jest.clearAllMocks();
  });

  describe('createTask', () => {
    it('should create a task with auto-incremented task number', async () => {
      (groupService.incrementTaskCounter as jest.Mock).mockResolvedValue(42);
      (Task.create as jest.Mock).mockResolvedValue({ ...mockTask, taskNumber: 42 });

      const result = await service.createTask({
        groupId: mockGroupId,
        title: 'New task',
        createdBy: mockUserId,
      });

      expect(groupService.incrementTaskCounter).toHaveBeenCalledWith(mockGroupId);
      expect(Task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: mockGroupId,
          title: 'New task',
          createdBy: mockUserId,
          taskNumber: 42,
          status: 'todo',
          priority: 'medium',
        })
      );
      expect(result.taskNumber).toBe(42);
    });

    it('should use provided priority instead of default', async () => {
      (groupService.incrementTaskCounter as jest.Mock).mockResolvedValue(1);
      (Task.create as jest.Mock).mockResolvedValue({ ...mockTask, priority: 'high' });

      await service.createTask({
        groupId: mockGroupId,
        title: 'Urgent task',
        createdBy: mockUserId,
        priority: 'high',
      });

      expect(Task.create).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'high' })
      );
    });

    it('should pass sourceMessage when creating from a reply', async () => {
      (groupService.incrementTaskCounter as jest.Mock).mockResolvedValue(1);
      (Task.create as jest.Mock).mockResolvedValue(mockTask);

      const sourceMessage = {
        messageId: 100,
        chatId: -1001234,
        text: 'Original message',
        fromUserId: 999,
        link: 'https://t.me/c/1234/100',
      };

      await service.createTask({
        groupId: mockGroupId,
        title: 'From reply',
        createdBy: mockUserId,
        sourceMessage,
      });

      expect(Task.create).toHaveBeenCalledWith(
        expect.objectContaining({ sourceMessage })
      );
    });
  });

  describe('getTaskById', () => {
    it('should return task with populated fields', async () => {
      const mockPopulate = jest.fn().mockResolvedValue(mockTask);
      (Task.findById as jest.Mock).mockReturnValue({ populate: mockPopulate });

      const result = await service.getTaskById(mockObjectId.toString());

      expect(Task.findById).toHaveBeenCalledWith(mockObjectId.toString());
      expect(mockPopulate).toHaveBeenCalledWith(expect.arrayContaining([{ path: 'createdBy' }, { path: 'assigneeId' }, { path: 'completedBy' }, expect.objectContaining({ path: 'epicId' })]));
      expect(result).toEqual(mockTask);
    });

    it('should return null on error', async () => {
      (Task.findById as jest.Mock).mockReturnValue({
        populate: jest.fn().mockRejectedValue(new Error('DB error')),
      });

      const result = await service.getTaskById('invalid');
      expect(result).toBeNull();
    });
  });

  describe('getTasksByGroup', () => {
    it('should return tasks with pagination', async () => {
      const mockSort = jest.fn().mockReturnThis();
      const mockSkip = jest.fn().mockReturnThis();
      const mockLimit = jest.fn().mockResolvedValue([mockTask]);
      const mockPopulate = jest.fn().mockReturnValue({ sort: mockSort, skip: mockSkip, limit: mockLimit });

      (Task.find as jest.Mock).mockReturnValue({ populate: mockPopulate });
      (Task.countDocuments as jest.Mock).mockResolvedValue(1);

      const result = await service.getTasksByGroup(mockGroupId, { page: 1, limit: 10 });

      expect(result.tasks).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockSkip).toHaveBeenCalledWith(0);
      expect(mockLimit).toHaveBeenCalledWith(10);
    });

    it('should apply status filter', async () => {
      const mockSort = jest.fn().mockReturnThis();
      const mockSkip = jest.fn().mockReturnThis();
      const mockLimit = jest.fn().mockResolvedValue([]);
      const mockPopulate = jest.fn().mockReturnValue({ sort: mockSort, skip: mockSkip, limit: mockLimit });

      (Task.find as jest.Mock).mockReturnValue({ populate: mockPopulate });
      (Task.countDocuments as jest.Mock).mockResolvedValue(0);

      await service.getTasksByGroup(mockGroupId, { status: 'done' });

      expect(Task.find).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: mockGroupId, status: 'done' })
      );
    });

    it('should apply search filter with regex', async () => {
      const mockSort = jest.fn().mockReturnThis();
      const mockSkip = jest.fn().mockReturnThis();
      const mockLimit = jest.fn().mockResolvedValue([]);
      const mockPopulate = jest.fn().mockReturnValue({ sort: mockSort, skip: mockSkip, limit: mockLimit });

      (Task.find as jest.Mock).mockReturnValue({ populate: mockPopulate });
      (Task.countDocuments as jest.Mock).mockResolvedValue(0);

      await service.getTasksByGroup(mockGroupId, { search: 'deploy' });

      expect(Task.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: [
            { title: { $regex: 'deploy', $options: 'i' } },
            { description: { $regex: 'deploy', $options: 'i' } },
          ],
        })
      );
    });

    it('should match task number when searching "#12"', async () => {
      const mockLimit = jest.fn().mockResolvedValue([]);
      const chain = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: mockLimit };
      (Task.find as jest.Mock).mockReturnValue({ populate: jest.fn().mockReturnValue(chain) });
      (Task.countDocuments as jest.Mock).mockResolvedValue(0);

      await service.getTasksByGroup(mockGroupId, { search: '#12' });

      expect(Task.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([{ taskNumber: 12 }]),
        })
      );
    });

    it('should escape regex characters in search', async () => {
      const chain = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([]) };
      (Task.find as jest.Mock).mockReturnValue({ populate: jest.fn().mockReturnValue(chain) });
      (Task.countDocuments as jest.Mock).mockResolvedValue(0);

      await service.getTasksByGroup(mockGroupId, { search: 'a.b(' });

      expect(Task.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([{ title: { $regex: 'a\\.b\\(', $options: 'i' } }]),
        })
      );
    });
  });

  describe('getTasksByGroup pagination', () => {
    const chain = (rows: unknown[]) => {
      const c = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(rows),
      };
      (Task.find as jest.Mock).mockReturnValue({ populate: jest.fn().mockReturnValue(c) });
      return c;
    };

    it('orders newest first with an _id tiebreak so pages never skip or repeat', async () => {
      const c = chain([]);
      (Task.countDocuments as jest.Mock).mockResolvedValue(0);
      await service.getTasksByGroup(mockGroupId, { page: 2, limit: 20 });
      expect(c.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
      expect(c.skip).toHaveBeenCalledWith(20);
      expect(c.limit).toHaveBeenCalledWith(20);
    });

    it('hasMore is true while later pages exist', async () => {
      chain(new Array(20).fill(mockTask));
      (Task.countDocuments as jest.Mock).mockResolvedValue(45);
      const result = await service.getTasksByGroup(mockGroupId, { page: 2, limit: 20 });
      expect(result).toEqual(expect.objectContaining({ total: 45, hasMore: true }));
    });

    it('hasMore is false on the last page', async () => {
      chain(new Array(5).fill(mockTask));
      (Task.countDocuments as jest.Mock).mockResolvedValue(45);
      const result = await service.getTasksByGroup(mockGroupId, { page: 3, limit: 20 });
      expect(result.hasMore).toBe(false);
    });

    it('hasMore is false when everything fits on one page', async () => {
      chain([mockTask]);
      (Task.countDocuments as jest.Mock).mockResolvedValue(1);
      expect((await service.getTasksByGroup(mockGroupId)).hasMore).toBe(false);
    });

    it('combines a column status with the other filters in one query (list and count)', async () => {
      chain([]);
      (Task.countDocuments as jest.Mock).mockResolvedValue(0);
      const epicId = new mongoose.Types.ObjectId();
      await service.getTasksByGroup(mockGroupId, {
        status: 'in_review',
        statuses: ['in_progress', 'in_review', 'pending'],
        epicId,
        assigneeId: null,
        type: 'bug',
        priority: 'high',
        search: 'login',
      });
      const expected = expect.objectContaining({
        groupId: mockGroupId,
        status: 'in_review',
        epicId,
        assigneeId: null,
        type: 'bug',
        priority: 'high',
        $or: expect.any(Array),
      });
      expect(Task.find).toHaveBeenCalledWith(expected);
      expect(Task.countDocuments).toHaveBeenCalledWith(expected);
    });

    it('sorts by a list column with empty values last and a stable tiebreak', async () => {
      (Task.aggregate as jest.Mock).mockResolvedValue([{ _id: mockObjectId }]);
      (Task.hydrate as jest.Mock).mockImplementation((row) => row);
      (Task.populate as jest.Mock).mockImplementation(async (docs) => docs);
      (Task.countDocuments as jest.Mock).mockResolvedValue(30);

      const result = await service.getTasksByGroup(mockGroupId, { sort: 'due', dir: 'desc', page: 2, limit: 10 });

      const pipeline = (Task.aggregate as jest.Mock).mock.calls[0][0];
      expect(pipeline[0]).toEqual({ $match: expect.objectContaining({ groupId: mockGroupId }) });
      expect(pipeline).toContainEqual({ $sort: { _sortEmpty: 1, _sortKey: -1, taskNumber: -1, _id: -1 } });
      expect(pipeline).toContainEqual({ $skip: 10 });
      expect(pipeline).toContainEqual({ $limit: 10 });
      expect(Task.find).not.toHaveBeenCalled();
      expect(result).toEqual({ tasks: [{ _id: mockObjectId }], total: 30, hasMore: true });
    });

    it('sorts priority by its display order, not alphabetically', async () => {
      (Task.aggregate as jest.Mock).mockResolvedValue([]);
      (Task.populate as jest.Mock).mockImplementation(async (docs) => docs);
      (Task.countDocuments as jest.Mock).mockResolvedValue(0);
      await service.getTasksByGroup(mockGroupId, { sort: 'priority' });
      const pipeline = (Task.aggregate as jest.Mock).mock.calls[0][0];
      const set = pipeline.find((stage: Record<string, unknown>) => '$set' in stage && '_sortKey' in (stage.$set as object));
      expect(set.$set._sortKey).toEqual({ $indexOfArray: [['low', 'medium', 'high', 'urgent'], '$priority'] });
    });
  });

  describe('countTasksByStatus', () => {
    it('counts per status with the list filters, every status present', async () => {
      (Task.aggregate as jest.Mock).mockResolvedValue([
        { _id: { status: 'todo', assigneeId: mockGroupId }, count: 3 },
        { _id: { status: 'todo', assigneeId: null }, count: 1 },
        { _id: { status: 'done', assigneeId: null }, count: 2 },
      ]);
      const result = await service.countTasksByStatus(mockGroupId, { type: 'bug' });
      expect((Task.aggregate as jest.Mock).mock.calls[0][0][0]).toEqual({
        $match: expect.objectContaining({ groupId: mockGroupId, type: 'bug' }),
      });
      expect(result.total).toBe(6);
      expect(result.byStatus).toEqual(expect.objectContaining({ todo: 4, done: 2, in_progress: 0, backlog: 0 }));
      expect(result.byAssignee).toEqual({ [String(mockGroupId)]: 3, none: 3 });
    });
  });

  describe('getTasksByGroup due filter', () => {
    const mockChain = () => {
      const chain = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([]) };
      (Task.find as jest.Mock).mockReturnValue({ populate: jest.fn().mockReturnValue(chain) });
      (Task.countDocuments as jest.Mock).mockResolvedValue(0);
    };
    const from = new Date('2026-10-19T00:00:00.000Z');
    const to = new Date('2026-10-26T00:00:00.000Z');

    it('should apply a dueFrom/dueTo range (inclusive from, exclusive to)', async () => {
      mockChain();
      await service.getTasksByGroup(mockGroupId, { dueFrom: from, dueTo: to });
      expect(Task.find).toHaveBeenCalledWith(
        expect.objectContaining({ dueDate: { $ne: null, $gte: from, $lt: to } }),
      );
      expect(Task.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ dueDate: { $ne: null, $gte: from, $lt: to } }),
      );
    });

    it('should apply only an upper bound for overdue', async () => {
      mockChain();
      await service.getTasksByGroup(mockGroupId, { dueTo: from });
      expect(Task.find).toHaveBeenCalledWith(expect.objectContaining({ dueDate: { $ne: null, $lt: from } }));
    });

    it('should match tasks without a due date for dueNone', async () => {
      mockChain();
      await service.getTasksByGroup(mockGroupId, { dueNone: true, dueFrom: from });
      expect(Task.find).toHaveBeenCalledWith(expect.objectContaining({ dueDate: null }));
    });

    it('should not filter by due date by default', async () => {
      mockChain();
      await service.getTasksByGroup(mockGroupId, {});
      expect((Task.find as jest.Mock).mock.calls[0][0]).not.toHaveProperty('dueDate');
    });
  });

  describe('getTasksByGroup statuses filter', () => {
    const mockChain = () => {
      const chain = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([]) };
      (Task.find as jest.Mock).mockReturnValue({ populate: jest.fn().mockReturnValue(chain) });
      (Task.countDocuments as jest.Mock).mockResolvedValue(0);
    };

    it('should match any of several statuses', async () => {
      mockChain();
      await service.getTasksByGroup(mockGroupId, { statuses: ['todo', 'backlog'] });
      expect(Task.find).toHaveBeenCalledWith(expect.objectContaining({ status: { $in: ['todo', 'backlog'] } }));
    });

    it('should match nothing when status is outside the statuses set', async () => {
      mockChain();
      await service.getTasksByGroup(mockGroupId, { status: 'done', statuses: ['todo'] });
      expect(Task.find).toHaveBeenCalledWith(expect.objectContaining({ status: { $in: [] } }));
    });
  });

  describe('updateTaskStatus', () => {
    it('should set completedAt when status is done', async () => {
      const mockPopulate = jest.fn().mockResolvedValue({ ...mockTask, status: 'done' });
      (Task.findByIdAndUpdate as jest.Mock).mockReturnValue({ populate: mockPopulate });

      await service.updateTaskStatus(mockObjectId.toString(), 'done');

      expect(Task.findByIdAndUpdate).toHaveBeenCalledWith(
        mockObjectId.toString(),
        { $set: expect.objectContaining({ status: 'done', completedAt: expect.any(Date) }) },
        { new: true, runValidators: true }
      );
    });

    it('should clear completedAt when status is not done', async () => {
      const mockPopulate = jest.fn().mockResolvedValue({ ...mockTask, status: 'in_progress' });
      (Task.findByIdAndUpdate as jest.Mock).mockReturnValue({ populate: mockPopulate });

      await service.updateTaskStatus(mockObjectId.toString(), 'in_progress');

      expect(Task.findByIdAndUpdate).toHaveBeenCalledWith(
        mockObjectId.toString(),
        { $set: expect.objectContaining({ status: 'in_progress', completedAt: null }) },
        { new: true, runValidators: true }
      );
    });
  });

  describe('deleteTask', () => {
    it('should return true when task is deleted', async () => {
      (Task.findByIdAndDelete as jest.Mock).mockResolvedValue(mockTask);

      const result = await service.deleteTask(mockObjectId.toString());
      expect(result).toBe(true);
    });

    it('should return false when task not found', async () => {
      (Task.findByIdAndDelete as jest.Mock).mockResolvedValue(null);

      const result = await service.deleteTask(mockObjectId.toString());
      expect(result).toBe(false);
    });
  });

  describe('getTaskStats', () => {
    it('should return aggregated stats by status', async () => {
      (Task.aggregate as jest.Mock).mockResolvedValue([
        { _id: 'todo', count: 5 },
        { _id: 'in_progress', count: 3 },
        { _id: 'done', count: 10 },
      ]);

      const result = await service.getTaskStats(mockGroupId);

      expect(result).toEqual({
        backlog: 0, todo: 5, in_progress: 3, in_review: 0, pending: 0, done: 10, cancelled: 0,
      });
    });

    it('should return zeros when no tasks', async () => {
      (Task.aggregate as jest.Mock).mockResolvedValue([]);

      const result = await service.getTaskStats(mockGroupId);

      expect(result).toEqual({
        backlog: 0, todo: 0, in_progress: 0, in_review: 0, pending: 0, done: 0, cancelled: 0,
      });
    });
  });

  describe('getTaskByNumber', () => {
    it('should find task by group and number', async () => {
      const mockPopulate = jest.fn().mockResolvedValue(mockTask);
      (Task.findOne as jest.Mock).mockReturnValue({ populate: mockPopulate });

      const result = await service.getTaskByNumber(mockGroupId, 1);

      expect(Task.findOne).toHaveBeenCalledWith({ groupId: mockGroupId, taskNumber: 1 });
      expect(result).toEqual(mockTask);
    });
  });

  describe('assignTask', () => {
    it('should update assigneeId', async () => {
      const newAssignee = new mongoose.Types.ObjectId();
      const mockPopulate = jest.fn().mockResolvedValue({ ...mockTask, assigneeId: newAssignee });
      (Task.findByIdAndUpdate as jest.Mock).mockReturnValue({ populate: mockPopulate });

      const result = await service.assignTask(mockObjectId, newAssignee);

      expect(Task.findByIdAndUpdate).toHaveBeenCalledWith(
        mockObjectId,
        { $set: { assigneeId: newAssignee } },
        { new: true, runValidators: true }
      );
      expect(result?.assigneeId).toBe(newAssignee);
    });

    it('should unassign by setting null', async () => {
      const mockPopulate = jest.fn().mockResolvedValue({ ...mockTask, assigneeId: null });
      (Task.findByIdAndUpdate as jest.Mock).mockReturnValue({ populate: mockPopulate });

      await service.assignTask(mockObjectId, null);

      expect(Task.findByIdAndUpdate).toHaveBeenCalledWith(
        mockObjectId,
        { $set: { assigneeId: null } },
        { new: true, runValidators: true }
      );
    });
  });
});
