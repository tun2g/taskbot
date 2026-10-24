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
// Non-members are re-checked against Telegram; never hit the network in tests.
jest.mock('src/shared/services/member-sync.service', () => ({ memberSyncService: { verifyAndAddMember: jest.fn().mockResolvedValue(false) } }));

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
    (groupService.findGroupById as jest.Mock).mockResolvedValue({ _id: groupId, status: 'active' });
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
    (groupService.findGroupById as jest.Mock).mockResolvedValue({ _id: groupId, status: 'active' });
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

describe('groups without service (not approved / paused / removed)', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['pending', null, "This group is waiting for approval from the bot owner. You'll see a message in the group when it's approved."],
    ['suspended', 'Unpaid invoice', 'The bot is paused in this group by its owner. Your tasks are kept. Reason: Unpaid invoice'],
    ['rejected', 'Private bot', "The bot's owner did not approve this group. Reason: Private bot"],
    ['left', null, 'The bot is no longer in this group. Add it back to the Telegram group to use it again.'],
    ['migrated', null, 'This group moved to a new Telegram chat. Open it again from your group list.'],
  ])('%s → 403 with a plain explanation', async (status, statusReason, message) => {
    (groupService.findGroupById as jest.Mock).mockResolvedValue({ _id: groupId, status, statusReason });
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(true);
    const { req, res, next } = createMockReqRes({ params: { groupId: groupId.toString() } });

    await requireGroupMember()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Group Unavailable', message, statusCode: 403 });
    expect(next).not.toHaveBeenCalled();
  });

  it('non-members get "not a member", not the group status', async () => {
    (groupService.findGroupById as jest.Mock).mockResolvedValue({ _id: groupId, status: 'pending' });
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(false);
    const { req, res, next } = createMockReqRes({ params: { groupId: groupId.toString() } });

    await requireGroupMember()(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: NOT_A_MEMBER_MESSAGE }));
  });

  it('task and epic routes of a pending group are refused too', async () => {
    (taskService.getTaskById as jest.Mock).mockResolvedValue({ _id: taskId, groupId });
    (epicService.findById as jest.Mock).mockResolvedValue({ _id: taskId, groupId });
    (groupService.findGroupById as jest.Mock).mockResolvedValue({ _id: groupId, status: 'pending' });
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(true);

    const task = createMockReqRes({ params: { taskId: taskId.toString() } });
    await requireTaskMember()(task.req, task.res, task.next);
    const epic = createMockReqRes({ params: { epicId: taskId.toString() } });
    await requireEpicMember()(epic.req, epic.res, epic.next);

    for (const { res, next } of [task, epic]) {
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('waiting for approval') }));
      expect(next).not.toHaveBeenCalled();
    }
  });
});
