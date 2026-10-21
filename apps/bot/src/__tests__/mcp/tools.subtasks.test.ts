import { epicEventsService } from 'src/shared/services/epic-events.service';
import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { refreshTaskCards } from 'src/api/controllers/epic.controller';
import { isTelegramGroupAdmin } from 'src/api/telegram-admin';
import { User } from 'src/database/models/user.model';
import { EpicTitleTakenError, epicService } from 'src/database/services/epic.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { subtaskService } from 'src/database/services/subtask.service';
import { createTasksTool } from 'src/mcp/tools/create-tasks';
import { getTaskTool } from 'src/mcp/tools/get-task';
import { listTasksTool } from 'src/mcp/tools/list-tasks';
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
    getTaskById: jest.fn(),
    getTasksByGroup: jest.fn(),
  },
}));
jest.mock('src/database/services/subtask.service', () => ({
  subtaskService: {
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    progress: jest.fn().mockResolvedValue(new Map()),
    detachAll: jest.fn().mockResolvedValue([]),
    setEpic: jest.fn().mockResolvedValue(0),
  },
}));
jest.mock('src/database/services/task-activity.service', () => ({
  taskActivityService: { record: jest.fn(), getForTask: jest.fn().mockResolvedValue([]) },
}));
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
jest.mock('src/shared/services/epic-events.service', () => ({
  epicEventsService: {
    created: jest.fn().mockResolvedValue(undefined),
    statusChanged: jest.fn().mockResolvedValue(undefined),
    deleted: jest.fn().mockResolvedValue(undefined),
  },
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

// Subtasks through MCP: create under a parent, move / detach, list, details and delete.

const parent = makeTask({ taskNumber: 42, title: 'Checkout v2', epicId: login });
const childRef = { _id: parent._id, taskNumber: 42, title: 'Checkout v2', status: 'todo' };

beforeEach(() => {
  (taskService.getTaskByNumber as jest.Mock).mockImplementation(async (_g: unknown, n: number) =>
    n === 42 ? parent : n === 45 ? makeTask({ taskNumber: 45, title: 'API', parentTaskId: childRef }) : n === 12 ? makeTask() : null,
  );
  (taskService.getTaskById as jest.Mock).mockImplementation(async (id: string) =>
    String(id) === String(parent._id) ? parent : null,
  );
  (taskService.updateTask as jest.Mock).mockImplementation(async (_id: string, u: any) => makeTask({ ...u }));
});

describe('create_tasks with parent', () => {
  it('creates subtasks under #42 in its epic, logged on the parent', async () => {
    const out = await call(createTasksTool, {
      group: G,
      tasks: [
        { title: 'Design API', parent: 42, epic: 'Payments' },
        { title: 'Build UI', parent: 42, assignee: '@an' },
      ],
    });
    const inputs = (taskService.createTask as jest.Mock).mock.calls.map((c) => c[0]);
    expect(inputs.map((i) => String(i.parentTaskId))).toEqual([String(parent._id), String(parent._id)]);
    // The epic arg is ignored: a subtask takes the parent's epic.
    expect(inputs.map((i) => String(i.epicId))).toEqual([String(login._id), String(login._id)]);
    expect(taskActivityService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'subtask_added', taskId: parent._id, to: '#41 Design API' }),
    );
    expect(out.data.tasks).toHaveLength(2);
  });

  it('refuses a subtask as parent and points to the top task', async () => {
    await expectToolError(
      call(createTasksTool, { group: G, tasks: [{ title: 'X', parent: 45 }] }),
      /#45 is itself a subtask of #42.*Use parent 42 instead.*Nothing was created/,
    );
    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it('passes the rule message through when the parent is full', async () => {
    (subtaskService.count as jest.Mock).mockResolvedValueOnce(50);
    await expectToolError(call(createTasksTool, { group: G, tasks: [{ title: 'X', parent: 42 }] }), /already has 50 subtasks/);
  });
});

describe('update_task parent', () => {
  it('makes #12 a subtask of #42 and reports it', async () => {
    const out = await call(updateTaskTool, { group: G, taskNumber: 12, parent: 42 });
    const updates = (taskService.updateTask as jest.Mock).mock.calls[0][1];
    expect(String(updates.parentTaskId)).toBe(String(parent._id));
    expect(out.data.changes).toContain('parent task: none → #42 Checkout v2');
  });

  it('null detaches a subtask', async () => {
    const out = await call(updateTaskTool, { group: G, taskNumber: 45, parent: null });
    expect((taskService.updateTask as jest.Mock).mock.calls[0][1]).toEqual(expect.objectContaining({ parentTaskId: null }));
    expect(out.data.changes).toContain('parent task: #42 Checkout v2 → none');
    expect(out.data.changes.at(-1)).toMatch(/^it is a regular task again/);
  });

  it("refuses an epic change on a subtask with the rule's wording", async () => {
    await expectToolError(call(updateTaskTool, { group: G, taskNumber: 45, epic: 'login' }), /Change the epic on #42 instead/);
  });
});

describe('list_tasks / get_task / delete_task', () => {
  it('parent filter lists its subtasks across statuses; summaries carry progress', async () => {
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks: [parent], total: 1, hasMore: false });
    (subtaskService.progress as jest.Mock).mockResolvedValueOnce(new Map([[String(parent._id), { total: 3, done: 1, cancelled: 1 }]]));
    const out = await call(listTasksTool, { group: G, parent: 42 });
    const filters = (taskService.getTasksByGroup as jest.Mock).mock.calls[0][1];
    expect(String(filters.parentTaskId)).toBe(String(parent._id));
    expect(filters.statuses).toBeUndefined();
    expect(out.data.tasks[0].subtasks).toEqual({ total: 3, done: 1, cancelled: 1 });
    expect(out.text).toContain('subtasks 1/3 done · 1 cancelled');

    await call(listTasksTool, { group: G, parent: 'none' });
    expect((taskService.getTasksByGroup as jest.Mock).mock.calls[1][1].parentTaskId).toBeNull();
  });

  it('get_task lists the subtasks; a subtask shows its parent', async () => {
    const sub = makeTask({ taskNumber: 45, title: 'API', status: 'done', parentTaskId: childRef });
    (subtaskService.list as jest.Mock).mockResolvedValueOnce([sub]);
    (subtaskService.progress as jest.Mock).mockImplementation(async (ids: string[]) =>
      new Map(ids.includes(String(parent._id)) ? [[String(parent._id), { total: 1, done: 1 }]] : []),
    );
    const out = await call(getTaskTool, { group: G, taskNumber: 42 });
    expect(out.text).toContain('Subtasks (1/1 done):');
    expect(out.text).toContain('#45 API — Done');
    expect(out.data.subtasks[0]).toMatchObject({ number: 45, parent: 42 });

    const child = await call(getTaskTool, { group: G, taskNumber: 45 });
    expect(child.text).toContain('Subtask of #42 Checkout v2');
    (subtaskService.progress as jest.Mock).mockResolvedValue(new Map());
  });

  it('delete_task says which subtasks were kept', async () => {
    (taskService.deleteTask as jest.Mock).mockResolvedValue(true);
    (subtaskService.detachAll as jest.Mock).mockResolvedValueOnce([makeTask({ taskNumber: 45 }), makeTask({ taskNumber: 46 })]);
    const out = await call(deleteTaskTool, { group: G, taskNumber: 42 });
    expect(out.text).toContain('Its subtasks #45, #46 are kept as regular tasks.');
    expect(out.data.keptSubtasks).toEqual([45, 46]);
  });
});
