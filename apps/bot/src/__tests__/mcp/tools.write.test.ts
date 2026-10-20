import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { refreshTaskCards } from 'src/api/controllers/epic.controller';
import { isTelegramGroupAdmin } from 'src/api/telegram-admin';
import { User } from 'src/database/models/user.model';
import { EpicTitleTakenError, epicService } from 'src/database/services/epic.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { createTasksTool } from 'src/mcp/tools/create-tasks';
import { deleteTaskTool } from 'src/mcp/tools/delete-task';
import { createEpicTool, updateEpicTool } from 'src/mcp/tools/epics';
import { undoLastTool } from 'src/mcp/tools/undo-last';
import { updateTaskTool } from 'src/mcp/tools/update-task';
import { rememberAppBatchPost, undoAppBatch } from 'src/shared/services/ai-command/web-chat';
import { notificationService } from 'src/shared/services/notification.service';
import { taskSyncService } from 'src/shared/services/task-sync.service';
import { alpha, an, beta, binh, call, expectToolError, makeTask, me, oid } from './mcp-test-helpers';

jest.mock('src/bot', () => ({ bot: { telegram: {} } }));
jest.mock('src/shared/services/redis.service', () => ({
  redisService: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));
jest.mock('src/api/middlewares/group-access.middleware', () => ({ checkGroupAccess: jest.fn() }));
jest.mock('src/api/telegram-admin', () => ({ isTelegramGroupAdmin: jest.fn() }));
jest.mock('src/api/controllers/epic.controller', () => ({ refreshTaskCards: jest.fn().mockResolvedValue(undefined) }));
jest.mock('src/database/models/group.model', () => ({ Group: { find: jest.fn() } }));
jest.mock('src/database/models/user.model', () => ({ User: { findById: jest.fn() } }));
jest.mock('src/database/models/epic.model', () => ({ Epic: { findById: jest.fn() } }));
jest.mock('src/database/services/group-member.service', () => ({
  groupMemberService: { getMembers: jest.fn(), getUserGroups: jest.fn(), isMember: jest.fn() },
}));
jest.mock('src/database/services/task.service', () => ({
  taskService: {
    createTask: jest.fn(),
    getTaskByNumber: jest.fn(),
    updateTask: jest.fn(),
    updateTaskStatus: jest.fn(),
    deleteTask: jest.fn(),
  },
}));
jest.mock('src/database/services/task-activity.service', () => ({ taskActivityService: { record: jest.fn() } }));
jest.mock('src/database/services/epic.service', () => ({
  ...jest.requireActual('src/database/services/epic.service'),
  epicService: {
    findInGroup: jest.fn(),
    findByTitle: jest.fn(),
    listOpen: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    taskIds: jest.fn().mockResolvedValue([]),
    getProgress: jest.fn().mockResolvedValue(new Map()),
  },
}));
jest.mock('src/shared/services/notification.service', () => ({
  notificationService: {
    notifyAssignment: jest.fn().mockResolvedValue(undefined),
    notifyUnassigned: jest.fn().mockResolvedValue(undefined),
    notifyStatusChange: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('src/shared/services/task-sync.service', () => ({
  ...jest.requireActual('src/shared/services/task-event-lines'),
  taskSyncService: {
    syncTaskCard: jest.fn().mockResolvedValue(undefined),
    postChangeSummary: jest.fn().mockResolvedValue(undefined),
    onTaskDeleted: jest.fn().mockResolvedValue(undefined),
    postCreatedFromApp: jest.fn(),
  },
}));
jest.mock('src/shared/services/ai-command/web-chat', () => ({
  rememberAppBatchPost: jest.fn().mockResolvedValue(undefined),
  undoAppBatch: jest.fn(),
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const login = { _id: oid(), groupId: alpha._id, title: 'Login', color: 'blue', status: 'open' } as any;
const G = String(alpha._id);

beforeEach(() => {
  jest.clearAllMocks();
  (checkGroupAccess as jest.Mock).mockImplementation(async (id: string) =>
    id === G ? { ok: true, group: alpha } : { ok: false, status: 403, message: 'no' },
  );
  (groupMemberService.getMembers as jest.Mock).mockResolvedValue([me, an, binh]);
  (groupMemberService.isMember as jest.Mock).mockResolvedValue(true);
  (User.findById as jest.Mock).mockImplementation(
    async (id: string) => [me, an, binh].find((u) => String(u._id) === String(id)) ?? null,
  );
  (epicService.findByTitle as jest.Mock).mockImplementation(async (_g: unknown, t: string) =>
    t.toLowerCase() === 'login' ? login : null,
  );
  (epicService.findInGroup as jest.Mock).mockImplementation(async (_g: unknown, id: string) =>
    String(id) === String(login._id) ? login : null,
  );
  (epicService.listOpen as jest.Mock).mockResolvedValue([login]);
  let n = 40;
  (taskService.createTask as jest.Mock).mockImplementation(async (input: any) =>
    makeTask({ ...input, _id: oid(), taskNumber: ++n }),
  );
  (taskSyncService.postCreatedFromApp as jest.Mock).mockResolvedValue({ chatId: -1001, messageId: 77 });
});

describe('create_tasks', () => {
  it('one task: resolves assignee + epic, logs via mcp, DMs the assignee and posts ONE card "(via Claude Code)"', async () => {
    const out = await call(createTasksTool, {
      group: G,
      tasks: [
        {
          title: 'Fix login redirect',
          type: 'bug',
          priority: 'high',
          assignee: '@an',
          dueDate: '2026-10-24',
          epic: 'login',
        },
      ],
    });

    const input = (taskService.createTask as jest.Mock).mock.calls[0][0];
    expect(input).toEqual(
      expect.objectContaining({
        title: 'Fix login redirect',
        type: 'bug',
        priority: 'high',
        epicId: login._id,
        taskCardChatId: -1001,
        dueDate: new Date('2026-10-24T00:00:00.000Z'),
        batchId: out.data.undoToken,
      }),
    );
    expect(String(input.assigneeId)).toBe(String(an._id));
    expect(taskActivityService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'created', via: 'mcp' }));
    expect(notificationService.notifyAssignment).toHaveBeenCalledWith(expect.anything(), an, me);
    expect(taskSyncService.syncTaskCard).not.toHaveBeenCalled();
    expect(taskSyncService.postCreatedFromApp).toHaveBeenCalledTimes(1);
    expect((taskSyncService.postCreatedFromApp as jest.Mock).mock.calls[0][3]).toBe('Claude Code');
    expect(rememberAppBatchPost).toHaveBeenCalledWith(out.data.undoToken, { chatId: -1001, messageId: 77 });
    expect(out.data.tasks).toHaveLength(1);
    expect(out.text).toContain('Created 1 task in Team Alpha');
    expect(out.text).toContain('undo_last');
  });

  it('several tasks share one batch and ONE group post (summary)', async () => {
    const out = await call(createTasksTool, {
      group: G,
      tasks: [{ title: 'A' }, { title: 'B', assignee: 'me' }, { title: 'C' }],
    });
    const batchIds = (taskService.createTask as jest.Mock).mock.calls.map((c) => c[0].batchId);
    expect(new Set(batchIds).size).toBe(1);
    expect(taskSyncService.postCreatedFromApp).toHaveBeenCalledTimes(1);
    expect((taskSyncService.postCreatedFromApp as jest.Mock).mock.calls[0][2]).toHaveLength(3);
    expect(out.data.tasks.map((t: any) => t.number)).toEqual([41, 42, 43]);
  });

  it('an unknown assignee fails the whole call before anything is created, with close matches', async () => {
    await expectToolError(
      call(createTasksTool, { group: G, tasks: [{ title: 'A' }, { title: 'B', assignee: 'Binhh' }] }),
      /tasks\[1\] \("B"\): No group member matches "Binhh". Did you mean Bình Trần\?.*Nothing was created/,
    );
    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it('an unknown epic lists the open epics', async () => {
    await expectToolError(
      call(createTasksTool, { group: G, tasks: [{ title: 'A', epic: 'Payments' }] }),
      /Open epics: "Login"/,
    );
  });

  it('rejects more than 20 tasks and bad dates (schema)', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ title: `T${i}` }));
    await expect(call(createTasksTool, { group: G, tasks: many })).rejects.toThrow(/At most 20/);
    await expect(call(createTasksTool, { group: G, tasks: [{ title: 'A', dueDate: 'friday' }] })).rejects.toThrow(
      /YYYY-MM-DD/,
    );
  });

  it('denies a group the user is not a member of', async () => {
    await expectToolError(
      call(createTasksTool, { group: String(beta._id), tasks: [{ title: 'A' }] }),
      /don't have access/,
    );
    expect(taskService.createTask).not.toHaveBeenCalled();
  });
});

describe('update_task', () => {
  it('changes status + assignee + epic like the app, labelled "(via Claude Code)"', async () => {
    const before = makeTask({ assigneeId: me });
    const after = makeTask({ _id: before._id, status: 'in_progress', assigneeId: an, epicId: login });
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(before);
    (taskService.updateTaskStatus as jest.Mock).mockResolvedValue(after);
    (taskService.updateTask as jest.Mock).mockResolvedValue(after);

    const out = await call(updateTaskTool, {
      group: G,
      taskNumber: 12,
      status: 'in_progress',
      assignee: 'An Nguyen',
      epic: 'Login',
    });

    expect(taskService.updateTaskStatus).toHaveBeenCalledWith(String(before._id), 'in_progress', me._id);
    const actions = (taskActivityService.record as jest.Mock).mock.calls.map((c) => [c[0].action, c[0].via]);
    expect(actions).toEqual([
      ['status', 'mcp'],
      ['assignee', 'mcp'],
      ['epic', 'mcp'],
    ]);
    expect(notificationService.notifyAssignment).toHaveBeenCalledWith(after, an, me);
    expect(taskSyncService.syncTaskCard).toHaveBeenCalledWith(after);
    expect(taskSyncService.postChangeSummary).toHaveBeenCalledWith(after, me._id, expect.any(Array), 'Claude Code');
    expect(out.data.changes).toEqual(['status: To do → In progress', 'assignee: @me → @an', 'epic: none → Login']);
  });

  it('null clears assignee / due date / epic', async () => {
    const before = makeTask({ assigneeId: an, dueDate: new Date('2026-10-01T00:00:00Z'), epicId: login });
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(before);
    (taskService.updateTask as jest.Mock).mockResolvedValue({
      ...before,
      assigneeId: null,
      dueDate: null,
      epicId: null,
    });
    await call(updateTaskTool, { group: G, taskNumber: 12, assignee: null, dueDate: null, epic: null });
    expect(taskService.updateTask).toHaveBeenCalledWith(String(before._id), {
      assigneeId: null,
      dueDate: null,
      reminderSent: false,
      epicId: null,
    });
  });

  it('reports nothing changed without writing', async () => {
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(makeTask());
    const out = await call(updateTaskTool, { group: G, taskNumber: 12, status: 'todo' });
    expect(out.text).toContain('Nothing changed');
    expect(taskService.updateTask).not.toHaveBeenCalled();
  });

  it('asks for at least one field', async () => {
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(makeTask());
    await expectToolError(call(updateTaskTool, { group: G, taskNumber: 12 }), /at least one field/);
  });

  it('unknown assignee → error listing the members', async () => {
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(makeTask());
    await expectToolError(
      call(updateTaskTool, { group: G, taskNumber: 12, assignee: 'Zed' }),
      /Members: @me, @an, Bình Trần/,
    );
  });

  it('denies a group the user is not a member of', async () => {
    await expectToolError(
      call(updateTaskTool, { group: String(beta._id), taskNumber: 12, status: 'done' }),
      /don't have access/,
    );
  });
});

describe('delete_task', () => {
  it('the creator deletes; logged via mcp and announced "(via Claude Code)"', async () => {
    const task = makeTask({ createdBy: me });
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(task);
    (taskService.deleteTask as jest.Mock).mockResolvedValue(true);
    const out = await call(deleteTaskTool, { group: G, taskNumber: 12 });
    expect(taskActivityService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted', via: 'mcp' }));
    expect(taskSyncService.onTaskDeleted).toHaveBeenCalledWith(task, me._id, 'Claude Code');
    expect(out.data).toEqual({ deleted: true, number: 12, title: 'Fix login' });
  });

  it('others get an actionable refusal', async () => {
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(makeTask({ createdBy: an }));
    (isTelegramGroupAdmin as jest.Mock).mockResolvedValue(false);
    await expectToolError(call(deleteTaskTool, { group: G, taskNumber: 12 }), /cancelled/);
    expect(taskService.deleteTask).not.toHaveBeenCalled();
  });

  it('is annotated destructive', () => {
    expect(deleteTaskTool.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
  });
});

describe('undo_last', () => {
  it('undoes a batch of this group, labelled with the client', async () => {
    (undoAppBatch as jest.Mock).mockResolvedValue({ status: 'ok', removed: 3 });
    const out = await call(undoLastTool, { group: G, undoToken: 'abcdef0123456789' });
    expect(undoAppBatch).toHaveBeenCalledWith({
      user: me,
      batchId: 'abcdef0123456789',
      groupId: G,
      channel: { activity: 'mcp', label: 'Claude Code' },
    });
    expect(out.text).toBe('Undone: removed 3 tasks.');
  });

  it('passes the refusal through', async () => {
    (undoAppBatch as jest.Mock).mockResolvedValue({
      status: 'expired',
      message: 'Undo is only available for 10 minutes after creating.',
    });
    await expectToolError(call(undoLastTool, { group: G, undoToken: 'abcdef0123456789' }), /10 minutes/);
  });
});

describe('epics', () => {
  it('create_epic creates in the group', async () => {
    (epicService.create as jest.Mock).mockResolvedValue({ ...login, description: null });
    const out = await call(createEpicTool, { group: G, title: 'Login', color: 'blue' });
    expect(epicService.create).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: alpha._id, createdBy: me._id, title: 'Login', color: 'blue' }),
    );
    expect(out.data.epic).toMatchObject({ id: String(login._id), title: 'Login', status: 'open' });
  });

  it('create_epic: a taken title is an actionable error', async () => {
    (epicService.create as jest.Mock).mockRejectedValue(new EpicTitleTakenError('Login'));
    await expectToolError(call(createEpicTool, { group: G, title: 'login' }), /already exists.*list_epics/);
  });

  it('update_epic renames by title and refreshes cards', async () => {
    (epicService.update as jest.Mock).mockResolvedValue({ ...login, title: 'Auth' });
    (epicService.taskIds as jest.Mock).mockResolvedValue([oid()]);
    const out = await call(updateEpicTool, { group: G, epic: 'login', title: 'Auth', status: 'done' });
    expect(epicService.update).toHaveBeenCalledWith(login, { title: 'Auth', status: 'done' });
    await new Promise((r) => setImmediate(r));
    expect(refreshTaskCards).toHaveBeenCalled();
    expect(out.text).toContain('Updated epic Auth');
  });

  it('update_epic: unknown epic lists the open ones', async () => {
    await expectToolError(call(updateEpicTool, { group: G, epic: 'Nope', title: 'X' }), /No epic "Nope".*"Login"/);
  });
});
