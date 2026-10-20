import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { Group } from 'src/database/models/group.model';
import { Task } from 'src/database/models/task.model';
import { epicService } from 'src/database/services/epic.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { getTaskTool } from 'src/mcp/tools/get-task';
import { listGroupsTool, listMembersTool } from 'src/mcp/tools/groups';
import { listEpicsTool } from 'src/mcp/tools/epics';
import { listTasksTool } from 'src/mcp/tools/list-tasks';
import { alpha, an, beta, binh, call, ctx, expectToolError, makeTask, me, oid } from './mcp-test-helpers';

jest.mock('src/bot', () => ({ bot: { telegram: {} } }));
jest.mock('src/shared/services/redis.service', () => ({
  redisService: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));
jest.mock('src/api/middlewares/group-access.middleware', () => ({ checkGroupAccess: jest.fn() }));
jest.mock('src/database/models/group.model', () => ({ Group: { find: jest.fn() } }));
jest.mock('src/database/models/task.model', () => ({ Task: { aggregate: jest.fn() } }));
jest.mock('src/database/services/group-member.service', () => ({
  groupMemberService: { getMembers: jest.fn(), getUserGroups: jest.fn(), isMember: jest.fn() },
}));
jest.mock('src/database/services/task.service', () => ({
  taskService: { getTasksByGroup: jest.fn(), getTaskByNumber: jest.fn() },
}));
jest.mock('src/database/services/task-activity.service', () => ({ taskActivityService: { getForTask: jest.fn() } }));
jest.mock('src/database/services/epic.service', () => ({
  ...jest.requireActual('src/database/services/epic.service'),
  epicService: {
    findInGroup: jest.fn(),
    findByTitle: jest.fn(),
    listOpen: jest.fn(),
    listWithProgress: jest.fn(),
  },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const groupsQuery = (groups: unknown[]) => ({ sort: jest.fn().mockResolvedValue(groups) });

beforeEach(() => {
  jest.clearAllMocks();
  (checkGroupAccess as jest.Mock).mockImplementation(async (id: string) =>
    id === String(alpha._id) ? { ok: true, group: alpha } : { ok: false, status: 403, message: 'no' },
  );
  (groupMemberService.getUserGroups as jest.Mock).mockResolvedValue([alpha._id, beta._id]);
  (groupMemberService.getMembers as jest.Mock).mockResolvedValue([me, an, binh]);
  (Group.find as jest.Mock).mockReturnValue(groupsQuery([alpha, beta]));
});

describe('list_groups', () => {
  it('lists my groups with open task counts', async () => {
    (Task.aggregate as jest.Mock).mockResolvedValue([{ _id: alpha._id, count: 4 }]);
    const out = await call(listGroupsTool, {});
    expect(out.data.groups).toEqual([
      { id: String(alpha._id), title: 'Team Alpha', openTasks: 4 },
      { id: String(beta._id), title: 'Team Beta', openTasks: 0 },
    ]);
    expect(out.text).toContain('Team Alpha — 4 open tasks');
    const match = (Task.aggregate as jest.Mock).mock.calls[0][0][0].$match;
    expect(match.status.$nin).toEqual(['done', 'cancelled']);
  });

  it('says what to do when the user has no groups', async () => {
    (groupMemberService.getUserGroups as jest.Mock).mockResolvedValue([]);
    const out = await call(listGroupsTool, {});
    expect(out.data.groups).toEqual([]);
    expect(out.text).toContain('Add the bot to a Telegram group');
  });

  it('a group-scoped token only sees its group', async () => {
    (Group.find as jest.Mock).mockReturnValue(groupsQuery([alpha]));
    (Task.aggregate as jest.Mock).mockResolvedValue([]);
    const out = await call(listGroupsTool, {}, ctx({ scopeGroup: alpha }));
    expect(groupMemberService.getUserGroups).not.toHaveBeenCalled();
    expect((Group.find as jest.Mock).mock.calls[0][0]._id.$in).toEqual([alpha._id]);
    expect(out.data.scoped).toBe(true);
    expect(out.text).toContain('limited to one group');
  });
});

describe('list_members', () => {
  it('lists assignable people by @username / name', async () => {
    const out = await call(listMembersTool, { group: String(alpha._id) });
    expect(out.data.members).toEqual([
      { name: '@an', username: 'an', fullName: 'An Nguyen', isMe: false },
      { name: '@me', username: 'me', fullName: 'Me', isMe: true },
      { name: 'Bình Trần', username: null, fullName: 'Bình Trần', isMe: false },
    ]);
    expect(out.text).toContain('- @me (Me) — you');
  });

  it('denies a group the user is not a member of', async () => {
    await expectToolError(call(listMembersTool, { group: String(beta._id) }), /don't have access to that group/);
  });
});

describe('list_tasks', () => {
  const run = async (args: Record<string, unknown>) => {
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({
      tasks: [makeTask({ assigneeId: an, dueDate: new Date('2026-10-24T00:00:00Z') })],
      total: 31,
      hasMore: true,
    });
    const out = await call(listTasksTool, { group: String(alpha._id), ...args });
    return { out, filters: (taskService.getTasksByGroup as jest.Mock).mock.calls[0][1] };
  };

  it('defaults to open tasks, page 1 of 20, and returns compact tasks without ObjectIds', async () => {
    const { out, filters } = await run({});
    expect(filters).toEqual(expect.objectContaining({ page: 1, limit: 20 }));
    expect(filters.statuses).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'pending']);
    expect(out.data).toMatchObject({ total: 31, hasMore: true, page: 1 });
    expect(out.data.tasks).toEqual([
      {
        number: 12,
        title: 'Fix login',
        status: 'todo',
        type: 'bug',
        priority: 'medium',
        assignee: '@an',
        dueDate: '2026-10-24',
        epic: null,
        url: null,
      },
    ]);
    expect(out.text).toContain('#12 Fix login — To do · Bug · Medium priority · @an · due 2026-10-24');
    expect(out.text).toContain('more: page 2');
  });

  it('maps status / assignee "me" / epic title / due to the board filters', async () => {
    const login = { _id: oid(), title: 'Login' };
    (epicService.findByTitle as jest.Mock).mockResolvedValue(login);
    const { filters } = await run({
      status: 'in_review',
      assignee: 'me',
      epic: 'login',
      due: 'week',
      type: 'bug',
      limit: 50,
    });
    expect(filters.statuses).toEqual(['in_review']);
    expect(filters.assigneeId).toBe(me._id);
    expect(filters.epicId).toBe(login._id);
    expect(filters.dueFrom).toBeInstanceOf(Date);
    expect(filters).toEqual(expect.objectContaining({ type: 'bug', limit: 50 }));
  });

  it('includeClosed lists every status; assignee none / epic none', async () => {
    const { filters } = await run({ includeClosed: true, assignee: 'none', epic: 'none' });
    expect(filters.statuses).toBeUndefined();
    expect(filters.assigneeId).toBeNull();
    expect(filters.epicId).toBeNull();
  });

  it('resolves @username assignees and suggests close matches when unknown', async () => {
    const { filters } = await run({ assignee: '@an' });
    expect(filters.assigneeId).toBe(an._id);
    await expectToolError(
      call(listTasksTool, { group: String(alpha._id), assignee: '@ann' }),
      /No group member matches "@ann". Did you mean @an/,
    );
  });

  it('lists the open epics when the epic is unknown', async () => {
    (epicService.findByTitle as jest.Mock).mockResolvedValue(null);
    (epicService.listOpen as jest.Mock).mockResolvedValue([{ title: 'Login' }, { title: 'Billing' }]);
    await expectToolError(
      call(listTasksTool, { group: String(alpha._id), epic: 'Payments' }),
      /No epic "Payments" in this group. Open epics: "Login", "Billing"/,
    );
  });

  it('caps limit at 50 (schema)', async () => {
    await expect(call(listTasksTool, { group: String(alpha._id), limit: 51 })).rejects.toThrow();
  });

  it('denies a group the user is not a member of', async () => {
    await expectToolError(call(listTasksTool, { group: String(beta._id) }), /list_groups/);
    expect(taskService.getTasksByGroup).not.toHaveBeenCalled();
  });
});

describe('get_task', () => {
  it('returns description, epic, source messages and the last 10 history entries', async () => {
    const epic = { _id: oid(), title: 'Login', color: 'blue' };
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(
      makeTask({
        description: 'Users bounce back to /login',
        epicId: epic,
        sourceMessages: [{ fromName: 'An', text: 'login is broken on iOS', link: 'https://t.me/c/1/2' }],
      }),
    );
    const activity = Array.from({ length: 12 }, (_, i) => ({
      createdAt: new Date(`2026-10-${10 + i}T09:00:00Z`),
      actor: an,
      action: 'status',
      from: 'To do',
      to: 'In progress',
      via: i === 11 ? 'mcp' : 'app',
    }));
    (taskActivityService.getForTask as jest.Mock).mockResolvedValue(activity);

    const out = await call(getTaskTool, { group: 'Team Alpha', taskNumber: 12 });
    expect(taskService.getTaskByNumber).toHaveBeenCalledWith(alpha._id, 12);
    expect(out.data.task).toMatchObject({
      number: 12,
      description: 'Users bounce back to /login',
      epic: { id: String(epic._id), title: 'Login' },
    });
    expect(out.data.sourceMessages).toEqual([
      { from: 'An', text: 'login is broken on iOS', link: 'https://t.me/c/1/2' },
    ]);
    expect(out.data.activity).toHaveLength(10);
    expect(out.text).toContain('Created from these chat messages:');
    expect(out.text).toContain('(via mcp)');
  });

  it('says how to find the right number when the task does not exist', async () => {
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(null);
    await expectToolError(call(getTaskTool, { group: String(alpha._id), taskNumber: 99 }), /no task #99 in this group/);
  });
});

describe('list_epics', () => {
  it('lists epics with progress, open first', async () => {
    (epicService.listWithProgress as jest.Mock).mockResolvedValue([
      {
        _id: oid(),
        title: 'Old',
        color: 'green',
        status: 'done',
        progress: { total: 2, done: 2, inProgress: 0, cancelled: 0 },
      },
      {
        _id: oid(),
        title: 'Login',
        color: 'blue',
        status: 'open',
        progress: { total: 5, done: 3, inProgress: 1, cancelled: 1 },
      },
    ]);
    const out = await call(listEpicsTool, { group: String(alpha._id) });
    expect(out.data.epics.map((e: any) => e.title)).toEqual(['Login', 'Old']);
    expect(out.text).toContain('Login — open, blue · 3/5 done, 1 in progress');
  });
});
