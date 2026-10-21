import mongoose from 'mongoose';
import { isTelegramGroupAdmin } from 'src/api/telegram-admin';
import { User } from 'src/database/models/user.model';
import { epicService } from 'src/database/services/epic.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { notificationService } from 'src/shared/services/notification.service';
import {
  ASSIGNEE_NOT_MEMBER_MESSAGE,
  DELETE_FORBIDDEN_MESSAGE,
  EPIC_NOT_IN_GROUP_MESSAGE,
  TaskMutationError,
  TaskMutationService,
} from 'src/shared/services/task-mutation.service';
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

const service = new TaskMutationService();
const mcp = { activity: 'mcp' as const, label: 'Cursor' };

beforeEach(() => {
  jest.clearAllMocks();
  (groupMemberService.isMember as jest.Mock).mockResolvedValue(true);
  (User.findById as jest.Mock).mockResolvedValue(an);
});

describe('TaskMutationService', () => {
  it('createTask (app default): records via app and posts the card', async () => {
    const created = task();
    (taskService.createTask as jest.Mock).mockResolvedValue(created);
    await service.createTask(group, me, { title: 'Fix', assigneeId: String(an._id) });
    expect(taskActivityService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'created', via: 'app' }));
    expect(notificationService.notifyAssignment).toHaveBeenCalledWith(created, an, me);
    expect(taskSyncService.syncTaskCard).toHaveBeenCalledWith(created, { created: true, via: 'app' });
  });

  it('createTask (mcp, announce none): records via mcp, keeps the batch id, posts nothing itself', async () => {
    (taskService.createTask as jest.Mock).mockResolvedValue(task());
    await service.createTask(group, me, { title: 'Fix' }, { channel: mcp, announce: 'none', batchId: 'b1' });
    expect((taskService.createTask as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({ batchId: 'b1', taskCardChatId: -1001 }),
    );
    expect(taskActivityService.record).toHaveBeenCalledWith(expect.objectContaining({ via: 'mcp' }));
    expect(taskSyncService.syncTaskCard).not.toHaveBeenCalled();
  });

  it('createTask rejects a non-member assignee and a foreign epic before writing', async () => {
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(false);
    await expect(service.createTask(group, me, { title: 'x', assigneeId: String(an._id) })).rejects.toEqual(
      new TaskMutationError('assignee_not_member', ASSIGNEE_NOT_MEMBER_MESSAGE),
    );
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(true);
    (epicService.findInGroup as jest.Mock).mockResolvedValue(null);
    await expect(service.createTask(group, me, { title: 'x', epicId: String(oid()) })).rejects.toThrow(
      EPIC_NOT_IN_GROUP_MESSAGE,
    );
    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it('updateTask with a channel: activity via mcp and "(via Cursor)" change line', async () => {
    const before = task();
    const after = task({ _id: before._id, status: 'done' });
    (taskService.updateTaskStatus as jest.Mock).mockResolvedValue(after);
    const { changes } = await service.updateTask(before, me, { status: 'done' }, mcp);
    expect(changes).toEqual([{ field: 'status', from: '📝 To do', to: '✅ Done' }]);
    expect(taskActivityService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'status', via: 'mcp' }));
    expect(taskSyncService.postChangeSummary).toHaveBeenCalledWith(after, me._id, changes, 'Cursor');
  });

  it('updateTask without a channel keeps the exact app call (3 args)', async () => {
    const before = task();
    (taskService.updateTask as jest.Mock).mockResolvedValue(task({ title: 'New' }));
    await service.updateTask(before, me, { title: 'New' });
    expect((taskSyncService.postChangeSummary as jest.Mock).mock.calls[0]).toHaveLength(3);
  });

  it('updateTask reassign: DMs the new and the previous assignee', async () => {
    const before = task({ assigneeId: me });
    const after = task({ _id: before._id, assigneeId: an });
    (taskService.updateTask as jest.Mock).mockResolvedValue(after);
    await service.updateTask(before, me, { assigneeId: String(an._id) });
    expect(notificationService.notifyAssignment).toHaveBeenCalledWith(after, an, me);
    expect(notificationService.notifyUnassigned).toHaveBeenCalledWith(after, me, me);
  });

  it('updateTask throws not_found when the task vanished mid-way', async () => {
    (taskService.updateTaskStatus as jest.Mock).mockResolvedValue(null);
    await expect(service.updateTask(task(), me, { status: 'done' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('deleteTask: creator ok (via label), others need Telegram admin', async () => {
    (taskService.deleteTask as jest.Mock).mockResolvedValue(true);
    const mine = task();
    await service.deleteTask(mine, me, { group, channel: mcp });
    expect(taskSyncService.onTaskDeleted).toHaveBeenCalledWith(mine, me._id, 'Cursor');
    expect(taskActivityService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'deleted', from: '#7 Fix', via: 'mcp' }),
    );

    (isTelegramGroupAdmin as jest.Mock).mockResolvedValue(false);
    await expect(service.deleteTask(task({ createdBy: an }), me, { group })).rejects.toThrow(DELETE_FORBIDDEN_MESSAGE);
  });
});
