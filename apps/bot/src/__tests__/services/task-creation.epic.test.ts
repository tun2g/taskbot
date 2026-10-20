import mongoose from 'mongoose';
import { epicService } from 'src/database/services/epic.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { aiService } from 'src/shared/services/ai/ai.service';
import { rateLimitService } from 'src/shared/services/rate-limit.service';
import { createdSummaryLines, createTasks, matchEpic } from 'src/shared/services/task-creation.service';
import {
  buildExtractionPrompt,
  parseExtractionResponse,
  taskExtractionService,
} from 'src/shared/services/task-extraction.service';
import { EPIC_COLOR_EMOJI, EpicColor } from '@tbot/shared';

jest.mock('src/database/services/epic.service', () => ({
  ...jest.requireActual('src/database/services/epic.service'),
  epicService: { listOpen: jest.fn() },
}));
jest.mock('src/database/services/task.service', () => ({ taskService: { createTask: jest.fn() } }));
jest.mock('src/database/services/group-member.service', () => ({ groupMemberService: { getMembers: jest.fn() } }));
jest.mock('src/database/services/task-activity.service', () => ({ taskActivityService: { record: jest.fn() } }));
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/shared/services/ai/ai.service', () => ({
  ...jest.requireActual('src/shared/services/ai/ai.service'),
  aiService: { isConfigured: jest.fn(), generateJson: jest.fn() },
}));
jest.mock('src/shared/services/task-extraction.service', () => ({
  ...jest.requireActual('src/shared/services/task-extraction.service'),
  taskExtractionService: { extract: jest.fn() },
}));
jest.mock('src/shared/services/rate-limit.service', () => ({ rateLimitService: { checkRateLimit: jest.fn() } }));
jest.mock('src/shared/services/notification.service', () => ({ notificationService: { notifyAssignment: jest.fn() } }));
jest.mock('src/shared/utils/app-links', () => ({
  boardButton: jest.fn(() => null),
  taskNumberHtml: (n: number) => `<b>#${n}</b>`,
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

/** Expected text written with the blue/green/… dots, mapped to the current EPIC_COLOR_EMOJI palette. */
const DOTS: Record<string, string> = { '🔵': 'blue', '🟢': 'green', '🟠': 'orange', '🔴': 'red', '⚪': 'gray' };
const e = (text: string) => text.replace(/🔵|🟢|🟠|🔴|⚪/gu, (d) => EPIC_COLOR_EMOJI[DOTS[d] as EpicColor]);

const oid = () => new mongoose.Types.ObjectId();
const me = { _id: oid(), telegramUserId: 1, username: 'me' } as any;
const group = { _id: oid(), telegramGroupId: -100, timezone: 'UTC' } as any;
const epic = (title: string, extra: Record<string, unknown> = {}) =>
  ({ _id: oid(), groupId: group._id, title, color: 'blue', status: 'open', description: null, ...extra }) as any;
const login = epic('Login', { description: 'Sign-in, sign-up and password reset' });
const payments = epic('Payments', { color: 'green' });
const archived = epic('Archive', { status: 'done' });

const message = { messageId: 10, chatId: -100, text: 'login crash on iOS', fromUserId: 1, fromName: 'me', date: 1760000000, mentions: [] };

describe('matchEpic', () => {
  it('matches an open epic by name, case- and space-insensitively', () => {
    expect(matchEpic('  login ', [login, payments])).toBe(login);
  });

  it('returns null when nothing matches or the title was made up', () => {
    expect(matchEpic('Search', [login, payments])).toBeNull();
    expect(matchEpic('Login page', [login, payments])).toBeNull();
    expect(matchEpic('', [login])).toBeNull();
  });

  it('never picks a closed epic', () => {
    expect(matchEpic('Archive', [login, archived])).toBeNull();
  });
});

describe('extraction prompt and parsing', () => {
  it('shows open epics with a truncated description, and nothing when there are none', () => {
    const long = 'x'.repeat(400);
    const prompt = buildExtractionPrompt({
      messages: [message],
      members: [],
      timezone: 'UTC',
      epics: [{ title: 'Login', description: 'Sign-in flows' }, { title: 'Payments', description: long }],
    });
    expect(prompt).toContain('Open epics (groups of related tasks):\n- "Login" — Sign-in flows');
    expect(prompt).not.toContain(long);
    expect(buildExtractionPrompt({ messages: [message], members: [], timezone: 'UTC' })).not.toContain('Open epics');
  });

  it('keeps an optional epic per task (absent by default)', () => {
    const tasks = parseExtractionResponse(
      JSON.stringify({ tasks: [{ title: 'Fix login crash', epic: 'Login', sourceMessageIds: [10] }, { title: 'Call A' }] }),
      [10],
    );
    expect(tasks?.[0].epic).toBe('Login');
    expect(tasks?.[1].epic).toBeUndefined();
  });
});

describe('createTasks with epics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (groupMemberService.getMembers as jest.Mock).mockResolvedValue([me]);
    (aiService.isConfigured as jest.Mock).mockReturnValue(true);
    (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });
    (epicService.listOpen as jest.Mock).mockResolvedValue([login, payments]);
    let n = 0;
    (taskService.createTask as jest.Mock).mockImplementation(async (data: any) => ({ _id: oid(), taskNumber: ++n, ...data }));
  });

  it('sends open epics to the extractor and links only a matching one (activity via ai)', async () => {
    (taskExtractionService.extract as jest.Mock).mockResolvedValue({
      source: 'ai',
      tasks: [
        { title: 'Fix login crash', type: 'bug', epic: 'login', sourceMessageIds: [10] },
        { title: 'Invent', type: 'task', epic: 'Made Up', sourceMessageIds: [10] },
        { title: 'Plain', type: 'task', sourceMessageIds: [10] },
      ],
    });

    const result = await createTasks({ origin: 'telegram', requester: me, group, messages: [message] });

    const input = (taskExtractionService.extract as jest.Mock).mock.calls[0][0];
    expect(input.epics).toEqual([
      { title: 'Login', description: 'Sign-in, sign-up and password reset' },
      { title: 'Payments', description: null },
    ]);
    const calls = (taskService.createTask as jest.Mock).mock.calls.map((c) => c[0]);
    expect(calls[0].epicId).toBe(login._id);
    expect(calls[1].epicId).toBeUndefined();
    expect(calls[2].epicId).toBeUndefined();
    expect(taskActivityService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'epic', from: null, to: 'Login', via: 'ai' }),
    );
    expect((taskActivityService.record as jest.Mock).mock.calls.filter((c) => c[0].action === 'epic')).toHaveLength(1);
    expect(result.status).toBe('created');
  });

  it('no open epics → no epic list and no epic', async () => {
    (epicService.listOpen as jest.Mock).mockResolvedValue([]);
    (taskExtractionService.extract as jest.Mock).mockResolvedValue({
      source: 'ai',
      tasks: [{ title: 'Fix login crash', type: 'bug', epic: 'Login', sourceMessageIds: [10] }],
    });
    await createTasks({ origin: 'app', requester: me, group, messages: [message] });
    expect((taskExtractionService.extract as jest.Mock).mock.calls[0][0].epics).toBeUndefined();
    expect((taskService.createTask as jest.Mock).mock.calls[0][0].epicId).toBeUndefined();
  });
});

describe('batch summary lines', () => {
  it('shows the epic per task compactly', () => {
    const lines = createdSummaryLines(
      [
        { task: { _id: oid(), taskNumber: 12, type: 'bug', title: 'Fix login', epicId: login } as any, assignee: null },
        { task: { _id: oid(), taskNumber: 13, type: 'task', title: 'Call A', epicId: null } as any, assignee: me },
      ],
      group._id,
    );
    expect(lines[0]).toMatch(/^<b>#12<\/b> .+ Fix login · /);
    expect(lines[0].endsWith(e(' · 🔵 Login'))).toBe(true);
    expect(lines[1]).toMatch(/Call A → @me$/);
  });
});
