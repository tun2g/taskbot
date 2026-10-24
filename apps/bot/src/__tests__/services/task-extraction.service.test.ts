import {
  buildExtractionPrompt,
  buildFallbackTask,
  parseExtractionResponse,
  resolveAssignee,
  taskExtractionService,
} from 'src/shared/services/task-extraction.service';
import { aiService } from 'src/shared/services/ai/ai.service';
import { EMPTY_USAGE } from 'src/shared/services/ai/ai.interface';

jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const msg = (messageId: number, text: string, extra: Record<string, unknown> = {}) => ({
  messageId,
  chatId: -100123,
  text,
  fromUserId: 1,
  fromName: '@binh',
  date: 1760000000,
  ...extra,
});

const members = [
  { telegramUserId: 1, username: 'An_Nguyen', firstName: 'An', lastName: 'Nguyễn' },
  { telegramUserId: 2, username: null, firstName: 'Hùng', lastName: 'Trần' },
  { telegramUserId: 3, username: 'lanpham', firstName: 'Lan' },
  { telegramUserId: 4, username: 'lan2', firstName: 'Lan' },
];

describe('parseExtractionResponse', () => {
  it('parses valid JSON and normalises fields', () => {
    const raw = JSON.stringify({
      tasks: [
        {
          title: '  Sửa lỗi đăng nhập trên iOS ',
          type: 'bug',
          priority: 'urgent',
          assignee: '@an_nguyen',
          dueDate: '2026-10-23',
          sourceMessageIds: [10, 999],
        },
      ],
    });
    expect(parseExtractionResponse(raw, [10, 11])).toEqual([
      {
        title: 'Sửa lỗi đăng nhập trên iOS',
        type: 'bug',
        priority: 'urgent',
        assignee: '@an_nguyen',
        dueDate: '2026-10-23',
        sourceMessageIds: [10],
      },
    ]);
  });

  it('accepts code fences, drops bad optional fields and defaults the type', () => {
    const raw = '```json\n{"tasks":[{"title":"Do it","type":"epic","priority":"asap","dueDate":"Friday","sourceMessageIds":[]}]}\n```';
    expect(parseExtractionResponse(raw, [5])).toEqual([{ title: 'Do it', type: 'task', sourceMessageIds: [5] }]);
  });

  it('dedupes titles and caps at 20 tasks', () => {
    const tasks = Array.from({ length: 30 }, (_, i) => ({ title: `Task ${i}`, type: 'task', sourceMessageIds: [] }));
    tasks.push({ title: 'task 0', type: 'task', sourceMessageIds: [] });
    const parsed = parseExtractionResponse(JSON.stringify({ tasks }), [1, 2])!;
    expect(parsed).toHaveLength(20);
    expect(parsed.filter((t) => t.title.toLowerCase() === 'task 0')).toHaveLength(1);
  });

  it('returns null for invalid JSON or a missing title', () => {
    expect(parseExtractionResponse('not json', [1])).toBeNull();
    expect(parseExtractionResponse('{"tasks":[{"type":"bug"}]}', [1])).toBeNull();
  });

  it('returns an empty list when nothing is actionable', () => {
    expect(parseExtractionResponse('{"tasks":[]}', [1])).toEqual([]);
  });
});

describe('buildFallbackTask', () => {
  it('uses the first line as title and a trailing @mention as assignee', () => {
    const task = buildFallbackTask({
      messages: [msg(1, 'Fix the login bug @an\nIt crashes on iOS')],
      members: [],
      timezone: 'UTC',
    });
    expect(task).toEqual(
      expect.objectContaining({ title: 'Fix the login bug', assignee: '@an', type: 'task', sourceMessageIds: [1] }),
    );
    expect(task.description).toContain('It crashes on iOS');
  });

  it('prefers the requester note as title and picks up text_mention users', () => {
    const task = buildFallbackTask({
      messages: [msg(1, 'printer is broken, Hùng can you check', { mentions: [{ text: 'Hùng', telegramUserId: 2 }] })],
      note: 'Fix printer',
      members: [],
      timezone: 'UTC',
    });
    expect(task.title).toBe('Fix printer');
    expect(task.assignee).toBe('Hùng');
  });

  it('caps the title at 200 chars', () => {
    const task = buildFallbackTask({ messages: [msg(1, 'x'.repeat(300))], members: [], timezone: 'UTC' });
    expect(task.title).toHaveLength(200);
  });
});

describe('resolveAssignee', () => {
  it('matches @username case-insensitively', () => {
    expect(resolveAssignee('@an_nguyen', members)?.telegramUserId).toBe(1);
    expect(resolveAssignee('AN_NGUYEN', members)?.telegramUserId).toBe(1);
  });

  it('matches exact full name, then unique first name', () => {
    expect(resolveAssignee('hùng trần', members)?.telegramUserId).toBe(2);
    expect(resolveAssignee('Hùng', members)?.telegramUserId).toBe(2);
  });

  it('does not guess when a first name is ambiguous', () => {
    expect(resolveAssignee('Lan', members)).toBeNull();
  });

  it('falls back to text_mention telegram ids', () => {
    const extra = [...members, { telegramUserId: 9, username: null, firstName: 'Minh' }];
    expect(resolveAssignee('anh Minh', extra, [{ text: 'anh Minh', telegramUserId: 9 }])?.telegramUserId).toBe(9);
  });

  it('returns null for unknown people', () => {
    expect(resolveAssignee('@ghost', members)).toBeNull();
    expect(resolveAssignee('Quang', members)).toBeNull();
  });
});

describe('buildExtractionPrompt', () => {
  it('includes timezone, today, members, message ids, authors and the note', () => {
    const prompt = buildExtractionPrompt({
      messages: [msg(10, 'deploy by thứ 6')],
      note: 'assign to Hùng',
      members,
      timezone: 'Asia/Ho_Chi_Minh',
      now: new Date('2026-10-19T20:00:00Z'),
    });
    expect(prompt).toContain('Group timezone: Asia/Ho_Chi_Minh');
    expect(prompt).toContain('Today: 2026-10-20 Tue');
    expect(prompt).toContain('@An_Nguyen (An Nguyễn)');
    expect(prompt).toContain('[id 10] @binh');
    expect(prompt).toContain("Requester's note: assign to Hùng");
  });
});

describe('TaskExtractionService.extract', () => {
  const input = { messages: [msg(1, 'Fix login @an')], members: [], timezone: 'UTC' };

  let isConfigured: jest.SpyInstance;
  let generateJsonText: jest.SpyInstance;
  const reply = (text: string) => ({ text, usage: EMPTY_USAGE, model: 'gemini-3.5-flash-lite' });

  beforeEach(() => {
    jest.restoreAllMocks();
    isConfigured = jest.spyOn(aiService, 'isConfigured');
    generateJsonText = jest.spyOn(aiService, 'generateJsonCompletion');
  });

  it('uses the fallback when AI is not configured', async () => {
    isConfigured.mockReturnValue(false);
    const result = await taskExtractionService.extract(input);
    expect(result).toEqual(expect.objectContaining({ source: 'fallback', fallbackReason: 'unconfigured' }));
    expect(result.tasks[0].title).toBe('Fix login');
    expect(generateJsonText).not.toHaveBeenCalled();
  });

  it('retries once on invalid JSON', async () => {
    isConfigured.mockReturnValue(true);
    generateJsonText
      .mockResolvedValueOnce(reply('oops'))
      .mockResolvedValueOnce(reply('{"tasks":[{"title":"Fix login","type":"bug","sourceMessageIds":[1]}]}'));
    const result = await taskExtractionService.extract(input);
    expect(generateJsonText).toHaveBeenCalledTimes(2);
    expect(result.source).toBe('ai');
    expect(result.tasks[0].type).toBe('bug');
  });

  it('falls back after two invalid responses', async () => {
    isConfigured.mockReturnValue(true);
    generateJsonText.mockResolvedValue(reply('oops'));
    const result = await taskExtractionService.extract(input);
    expect(generateJsonText).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({ source: 'fallback', fallbackReason: 'failed' }));
  });

  it('classifies into the 7 shared types and defaults unknown ones to task', () => {
    const raw = JSON.stringify({
      tasks: [
        { title: 'Refactor auth module', type: 'improvement', sourceMessageIds: [1] },
        { title: 'Compare queue libraries', type: 'research', sourceMessageIds: [1] },
        { title: 'Rotate logs', type: 'chore', sourceMessageIds: [1] },
        { title: 'Something', type: 'epic', sourceMessageIds: [1] },
      ],
    });
    expect(parseExtractionResponse(raw, [1])!.map((t) => t.type)).toEqual(['improvement', 'research', 'chore', 'task']);
  });

  it('falls back when the provider throws', async () => {
    isConfigured.mockReturnValue(true);
    generateJsonText.mockRejectedValue(new Error('Out of quota'));
    const result = await taskExtractionService.extract(input);
    expect(result.source).toBe('fallback');
    expect(result.tasks).toHaveLength(1);
  });
});
