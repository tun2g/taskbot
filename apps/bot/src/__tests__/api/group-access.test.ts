import mongoose from 'mongoose';
import {
  NOT_A_MEMBER_MESSAGE,
  requireEpicMember,
  requireGroupMember,
  requireTaskMember,
} from 'src/api/middlewares/group-access.middleware';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { epicService } from 'src/database/services/epic.service';
import { taskService } from 'src/database/services/task.service';

jest.mock('src/database/services/group-member.service');
jest.mock('src/database/services/group.service');
jest.mock('src/database/services/task.service');
jest.mock('src/database/services/epic.service');
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const groupId = new mongoose.Types.ObjectId();
const taskId = new mongoose.Types.ObjectId();
const user = { _id: new mongoose.Types.ObjectId(), telegramUserId: 1 };

function createMockReqRes(overrides: Record<string, any> = {}) {
  const req: any = { params: {}, user, ...overrides };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { req, res, next: jest.fn() };
}

describe('requireGroupMember', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sets req.group and continues for members', async () => {
    const group = { _id: groupId, telegramGroupId: -1 };
    (groupService.findGroupById as jest.Mock).mockResolvedValue(group);
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(true);
    const { req, res, next } = createMockReqRes({ params: { groupId: groupId.toString() } });

    await requireGroupMember()(req, res, next);

    expect(groupMemberService.isMember).toHaveBeenCalledWith(groupId, user._id);
    expect(req.group).toBe(group);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 for non-members', async () => {
    (groupService.findGroupById as jest.Mock).mockResolvedValue({ _id: groupId });
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(false);
    const { req, res, next } = createMockReqRes({ params: { groupId: groupId.toString() } });

    await requireGroupMember()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden', message: NOT_A_MEMBER_MESSAGE, statusCode: 403 });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown groups', async () => {
    (groupService.findGroupById as jest.Mock).mockResolvedValue(null);
    const { req, res, next } = createMockReqRes({ params: { groupId: groupId.toString() } });

    await requireGroupMember()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, message: expect.any(String) }));
  });
});

describe('requireTaskMember', () => {
  beforeEach(() => jest.clearAllMocks());

  it('checks membership of the task group and sets req.task', async () => {
    const task = { _id: taskId, groupId };
    (taskService.getTaskById as jest.Mock).mockResolvedValue(task);
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(true);
    const { req, res, next } = createMockReqRes({ params: { taskId: taskId.toString() } });

    await requireTaskMember()(req, res, next);

    expect(groupMemberService.isMember).toHaveBeenCalledWith(groupId, user._id);
    expect(req.task).toBe(task);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when the caller is not in the task group', async () => {
    (taskService.getTaskById as jest.Mock).mockResolvedValue({ _id: taskId, groupId });
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(false);
    const { req, res, next } = createMockReqRes({ params: { taskId: taskId.toString() } });

    await requireTaskMember()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown tasks', async () => {
    (taskService.getTaskById as jest.Mock).mockResolvedValue(null);
    const { req, res, next } = createMockReqRes({ params: { taskId: taskId.toString() } });

    await requireTaskMember()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireEpicMember', () => {
  const epicId = new mongoose.Types.ObjectId();
  beforeEach(() => jest.clearAllMocks());

  it('checks membership of the epic group and sets req.epic', async () => {
    const epic = { _id: epicId, groupId, title: 'Login' };
    (epicService.findById as jest.Mock).mockResolvedValue(epic);
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(true);
    const { req, res, next } = createMockReqRes({ params: { epicId: epicId.toString() } });

    await requireEpicMember()(req, res, next);

    expect(groupMemberService.isMember).toHaveBeenCalledWith(groupId, user._id);
    expect(req.epic).toBe(epic);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when the caller is not in the epic group', async () => {
    (epicService.findById as jest.Mock).mockResolvedValue({ _id: epicId, groupId });
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(false);
    (groupService.findGroupById as jest.Mock).mockResolvedValue(null);
    const { req, res, next } = createMockReqRes({ params: { epicId: epicId.toString() } });

    await requireEpicMember()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown epics', async () => {
    (epicService.findById as jest.Mock).mockResolvedValue(null);
    const { req, res, next } = createMockReqRes({ params: { epicId: epicId.toString() } });

    await requireEpicMember()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });
});
