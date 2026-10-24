import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { askTaskbotTool } from 'src/mcp/tools/ask-taskbot';
import { aiCommandService } from 'src/shared/services/ai-command.service';
import { aiPlanSchema } from 'src/shared/services/ai-command/plan.schema';
import { AIUnavailableError, aiService } from 'src/shared/services/ai/ai.service';
import { rateLimitService } from 'src/shared/services/rate-limit.service';
import { redisService } from 'src/shared/services/redis.service';
import { checkGroupAiRateLimit, createTasks } from 'src/shared/services/task-creation.service';
import { taskSyncService } from 'src/shared/services/task-sync.service';
import { epicService } from 'src/database/services/epic.service';
import { epicEventsService } from 'src/shared/services/epic-events.service';
import { handleWebChat } from 'src/shared/services/ai-command/web-chat';
import { alpha, an, beta, call, expectToolError, makeTask, me } from './mcp-test-helpers';

jest.mock('src/bot', () => ({ bot: { telegram: { editMessageText: jest.fn().mockResolvedValue(true) } } }));
jest.mock('src/api/middlewares/group-access.middleware', () => ({ checkGroupAccess: jest.fn() }));
jest.mock('src/database/services/epic.service', () => ({
  ...jest.requireActual('src/database/services/epic.service'),
  epicService: {
    listOpen: jest.fn(async () => []),
    listWithProgress: jest.fn(async () => []),
    findByTitle: jest.fn(async () => null),
    create: jest.fn(),
  },
}));
jest.mock('src/shared/services/epic-events.service', () => ({
  epicEventsService: { created: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('src/shared/services/redis.service', () => {
  const store = new Map<string, string>();
  return {
    redisService: {
      store,
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => (store.set(k, v), 'OK')),
      del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    },
  };
});
jest.mock('src/database/services/task.service', () => ({
  taskService: {
    getTaskById: jest.fn(),
    getTaskByNumber: jest.fn(),
    getTasksByGroup: jest.fn(),
    updateTask: jest.fn(),
    assignTask: jest.fn(),
    updateTaskStatus: jest.fn(),
  },
}));
jest.mock('src/database/services/group-member.service', () => ({
  groupMemberService: { getMembers: jest.fn(), isMember: jest.fn() },
}));
jest.mock('src/database/services/task-activity.service', () => ({ taskActivityService: { record: jest.fn() } }));
jest.mock('src/shared/services/rate-limit.service', () => ({ rateLimitService: { checkRateLimit: jest.fn() } }));
jest.mock('src/shared/services/ai/ai.service', () => {
  class AIUnavailableError extends Error {
    constructor(
      public reason: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    AIUnavailableError,
    aiService: { isConfigured: jest.fn(), generateJson: jest.fn() },
    parseJsonLoose: jest.fn(),
  };
});
jest.mock('src/shared/services/ai-command.service', () => {
  const actual = jest.requireActual('src/shared/services/ai-command.service');
  actual.aiCommandService.plan = jest.fn();
  return actual;
});
jest.mock('src/shared/services/task-creation.service', () => ({
  ...jest.requireActual('src/shared/services/task-creation.service'),
  createTasks: jest.fn(),
  checkGroupAiRateLimit: jest.fn(),
}));
jest.mock('src/shared/services/task-sync.service', () => ({
  ...jest.requireActual('src/shared/services/task-event-lines'),
  taskSyncService: { postChangeSummary: jest.fn().mockResolvedValue(undefined), postCreatedFromApp: jest.fn() },
}));
jest.mock('src/shared/services/notification.service', () => ({
  notificationService: { notifyAssignment: jest.fn(), notifyUnassigned: jest.fn(), notifyStatusChange: jest.fn() },
}));
jest.mock('src/bot/task-card.renderer', () => ({
  ...jest.requireActual('src/bot/task-card.renderer'),
  formatTaskCard: jest.fn(() => 'card'),
  buildTaskButtons: jest.fn().mockResolvedValue([]),
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const plan = (...actions: unknown[]) => aiPlanSchema.parse({ actions });
const G = String(alpha._id);

beforeEach(() => {
  jest.clearAllMocks();
  (redisService as any).store.clear();
  (checkGroupAccess as jest.Mock).mockImplementation(async (id: string) =>
    id === G ? { ok: true, group: alpha } : { ok: false, status: 403, message: 'no' },
  );
  (aiService.isConfigured as jest.Mock).mockReturnValue(true);
  (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({
    allowed: true,
    remaining: 5,
    retryAfterSeconds: 0,
  });
  (checkGroupAiRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
  (groupMemberService.getMembers as jest.Mock).mockResolvedValue([me, an]);
  (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(null);
});

describe('ask_taskbot', () => {
  it('new conversation: runs the AI pipeline as "mcp" and returns a conversationId + touched tasks', async () => {
    const t = makeTask();
    const updated = makeTask({ _id: t._id, assigneeId: an });
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(t);
    (taskService.assignTask as jest.Mock).mockResolvedValue(updated);
    (aiCommandService.plan as jest.Mock).mockResolvedValue(
      plan({ action: 'update_task', taskRef: 12, changes: { assignee: '@an' } }),
    );

    const out = await call(askTaskbotTool, { group: G, message: 'giao #12 cho @an' });

    expect(out.data.conversationId).toMatch(/^[A-Za-z0-9_-]{8,}$/);
    expect(out.data.kind).toBe('updated');
    expect(out.data.tasks).toEqual([expect.objectContaining({ number: 12, assignee: '@an' })]);
    expect(out.text).toContain('✅ #12 Fix login');
    expect(taskActivityService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assignee', via: 'mcp' }),
    );
    expect(taskSyncService.postChangeSummary).toHaveBeenCalledWith(updated, me._id, expect.any(Array), 'Claude Code');
  });

  it('follow-up: the stored history is sent with the next message ("it" = the previous task)', async () => {
    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'clarify', question: 'Task nào vậy?' }));
    const first = await call(askTaskbotTool, { group: G, message: 'xong rồi' });
    const id = first.data.conversationId as string;

    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'clarify', question: 'Ok?' }));
    const second = await call(askTaskbotTool, { group: G, message: '#12', conversationId: id });

    expect(second.data.conversationId).toBe(id);
    const context = (aiCommandService.plan as jest.Mock).mock.calls[1][0];
    expect(context.history).toEqual([
      { role: 'user', content: 'xong rồi' },
      { role: 'assistant', content: '🤔 Task nào vậy?' },
    ]);
  });

  it('clarify: tells the agent to answer with the same conversationId', async () => {
    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'clarify', question: 'Giao cho ai?' }));
    const out = await call(askTaskbotTool, { group: G, message: 'giao task login' });
    expect(out.data.kind).toBe('clarify');
    expect(out.data.reply).toBe('🤔 Giao cho ai?');
    expect(out.text).toContain(`conversationId "${out.data.conversationId}"`);
  });

  it('created tasks come back with an undoToken and a "(via Claude Code)" group post', async () => {
    const created = [{ task: makeTask({ taskNumber: 14, title: 'Fix login' }), assignee: null }];
    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'create_tasks', useReply: false }));
    (createTasks as jest.Mock).mockResolvedValue({
      status: 'created',
      created,
      tasks: [created[0].task],
      warnings: [],
      batchId: 'abcdef0123456789',
      source: 'ai',
    });
    (taskSyncService.postCreatedFromApp as jest.Mock).mockResolvedValue({ chatId: -1001, messageId: 9 });

    const out = await call(askTaskbotTool, { group: G, message: 'tạo task fix login' });
    expect(createTasks).toHaveBeenCalledWith(expect.objectContaining({ activityVia: 'mcp' }));
    expect(taskSyncService.postCreatedFromApp).toHaveBeenCalledWith(alpha, me, created, 'Claude Code');
    expect(out.data).toMatchObject({ kind: 'created', undoToken: 'abcdef0123456789' });
    expect(out.text).toContain('undo_last');
  });

  it('create_epic: the new epic is announced in the group "(via Claude Code)"', async () => {
    const epic = { _id: 'e1', groupId: alpha._id, title: 'Login', color: 'blue', status: 'open', description: null };
    (epicService.create as jest.Mock).mockResolvedValue(epic);
    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'create_epic', title: 'Login' }));
    await call(askTaskbotTool, { group: G, message: 'tạo epic Login' });
    expect(epicEventsService.created).toHaveBeenCalledTimes(1);
    expect(epicEventsService.created).toHaveBeenCalledWith(epic, me, 'Claude Code', { group: alpha });
  });

  it('create_epic: an existing epic with that title is not announced again', async () => {
    (epicService.findByTitle as jest.Mock).mockResolvedValueOnce({ _id: 'e1', title: 'Login', color: 'blue' });
    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'create_epic', title: 'Login' }));
    await call(askTaskbotTool, { group: G, message: 'tạo epic Login' });
    expect(epicService.create).not.toHaveBeenCalled();
    expect(epicEventsService.created).not.toHaveBeenCalled();
  });

  it('web AI chat: a new epic is announced "(via app)"', async () => {
    const epic = { _id: 'e2', groupId: alpha._id, title: 'Billing', color: 'green', status: 'open', description: null };
    (epicService.create as jest.Mock).mockResolvedValue(epic);
    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'create_epic', title: 'Billing' }));
    await handleWebChat({ group: alpha, requester: me, message: 'new epic Billing', editor: {} as any });
    expect(epicEventsService.created).toHaveBeenCalledWith(epic, me, 'app', { group: alpha });
  });

  it('AI unavailable → isError pointing at the structured tools', async () => {
    (aiService.isConfigured as jest.Mock).mockReturnValue(false);
    await expectToolError(call(askTaskbotTool, { group: G, message: 'hi' }), /AI is unavailable.*structured tools/);

    (aiService.isConfigured as jest.Mock).mockReturnValue(true);
    (aiCommandService.plan as jest.Mock).mockRejectedValue(new AIUnavailableError('invalid', 'bad json'));
    await expectToolError(call(askTaskbotTool, { group: G, message: 'hi' }), /create_tasks/);
  });

  it('AI turned off by the owner: says retrying won\'t help, no AI call', async () => {
    (alpha as any).ai = { disabled: true };
    try {
      await expectToolError(call(askTaskbotTool, { group: G, message: 'hi' }), /turned off AI in this group.*Retrying won't help.*structured tools/);
      expect(aiCommandService.plan).not.toHaveBeenCalled();
    } finally {
      (alpha as any).ai = undefined;
    }
  });

  it('per-user AI limit (same as /ai) → isError', async () => {
    (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 30,
    });
    await expectToolError(call(askTaskbotTool, { group: G, message: 'hi' }), /Too many AI requests in a row — try again in 30s/);
  });

  it("group's 10-minute AI limit → says how long to wait", async () => {
    (checkGroupAiRateLimit as jest.Mock).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 120, scope: 'minute' });
    await expectToolError(call(askTaskbotTool, { group: G, message: 'hi' }), /in the last 10 minutes — try again in 2 min\./);
    expect(aiCommandService.plan).not.toHaveBeenCalled();
  });

  it('denies a group the user is not a member of', async () => {
    await expectToolError(call(askTaskbotTool, { group: String(beta._id), message: 'hi' }), /don't have access/);
    expect(aiCommandService.plan).not.toHaveBeenCalled();
  });

  it('a conversation of another group cannot be continued here', async () => {
    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'clarify', question: '?' }));
    const first = await call(askTaskbotTool, { group: G, message: 'x' });
    const key = `mcp_conv:${me._id}:${first.data.conversationId}`;
    const stored = JSON.parse((redisService as any).store.get(key));
    (redisService as any).store.set(key, JSON.stringify({ ...stored, groupId: String(beta._id) }));
    await expectToolError(
      call(askTaskbotTool, { group: G, message: 'y', conversationId: first.data.conversationId }),
      /another group/,
    );
  });
});
