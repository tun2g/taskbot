import { GroupController } from 'src/api/controllers/group.controller';
import { groupMemberService } from 'src/database/services/group-member.service';
import { Group } from 'src/database/models/group.model';
import { Task } from 'src/database/models/task.model';
import mongoose from 'mongoose';

jest.mock('src/database/services/group-member.service');
jest.mock('src/database/models/group.model', () => ({ Group: { find: jest.fn() } }));
jest.mock('src/database/models/task.model', () => ({
  Task: { aggregate: jest.fn(), countDocuments: jest.fn().mockResolvedValue(0) },
}));
jest.mock('src/shared/logger/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const mockGroupId = new mongoose.Types.ObjectId();
const otherGroupId = new mongoose.Types.ObjectId();
const mockUserId = new mongoose.Types.ObjectId();

function createMockReqRes(overrides: Record<string, any> = {}) {
  const req: any = { params: {}, query: {}, body: {}, ...overrides };
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

describe('GroupController', () => {
  let controller: GroupController;

  beforeEach(() => {
    controller = new GroupController();
    jest.clearAllMocks();
  });

  describe('listGroups', () => {
    it('returns group summaries with counts and mine', async () => {
      const { req, res } = createMockReqRes({ user: { _id: mockUserId } });

      (groupMemberService.getUserGroups as jest.Mock).mockResolvedValue([mockGroupId, otherGroupId]);
      (Group.find as jest.Mock).mockResolvedValue([
        { _id: mockGroupId, groupName: 'Team A' },
        { _id: otherGroupId, groupName: 'Team B' },
      ]);
      (Task.aggregate as jest.Mock)
        .mockResolvedValueOnce([
          { _id: { groupId: mockGroupId, status: 'todo' }, count: 4 },
          { _id: { groupId: mockGroupId, status: 'backlog' }, count: 1 },
          { _id: { groupId: mockGroupId, status: 'in_review' }, count: 5 },
          { _id: { groupId: mockGroupId, status: 'done' }, count: 2 },
          { _id: { groupId: mockGroupId, status: 'cancelled' }, count: 1 },
        ])
        .mockResolvedValueOnce([{ _id: mockGroupId, count: 3 }]);

      await controller.listGroups(req, res);

      expect(groupMemberService.getUserGroups).toHaveBeenCalledWith(mockUserId);
      expect(res.json).toHaveBeenCalledWith({
        data: [
          { _id: mockGroupId, groupName: 'Team A', counts: { todo: 5, in_progress: 5, done: 3 }, mine: 3, overdue: 0 },
          { _id: otherGroupId, groupName: 'Team B', counts: { todo: 0, in_progress: 0, done: 0 }, mine: 0, overdue: 0 },
        ],
      });
    });

    it('returns an empty list without querying when the user has no groups', async () => {
      const { req, res } = createMockReqRes({ user: { _id: mockUserId } });
      (groupMemberService.getUserGroups as jest.Mock).mockResolvedValue([]);

      await controller.listGroups(req, res);

      expect(Group.find).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ data: [] });
    });

    it('should return 401 when user is not authenticated', async () => {
      const { req, res } = createMockReqRes({});

      await controller.listGroups(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('getGroup', () => {
    it('returns the group loaded by the access middleware', async () => {
      const group = { _id: mockGroupId, groupName: 'Team A' };
      const { req, res } = createMockReqRes({ group });
      await controller.getGroup(req, res);
      expect(res.json).toHaveBeenCalledWith({ data: group });
    });
  });

  describe('getMembers', () => {
    it('should return group members', async () => {
      const { req, res } = createMockReqRes({
        params: { groupId: mockGroupId.toString() },
      });

      const mockMembers = [{ username: 'john', firstName: 'John' }];
      (groupMemberService.getMembers as jest.Mock).mockResolvedValue(mockMembers);

      await controller.getMembers(req, res);

      expect(res.json).toHaveBeenCalledWith({ data: mockMembers });
    });
  });
});
