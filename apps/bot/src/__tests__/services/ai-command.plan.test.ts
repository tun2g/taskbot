import { aiPlanSchema } from 'src/shared/services/ai-command/plan.schema';
import { AI_COMMAND_SYSTEM_PROMPT, buildAiCommandPrompt, calendarLines } from 'src/shared/services/ai-command/prompt';
import { buildExplainPrompt, EXPLAIN_TASK_SYSTEM_PROMPT, tidyExplanation } from 'src/shared/services/ai-command/explain.prompt';
import { dueText } from 'src/shared/services/ai-command/format';

describe('aiPlanSchema', () => {
  it('accepts a valid update plan and normalises enums and refs', () => {
    const plan = aiPlanSchema.parse({
      actions: [{ action: 'update_task', taskRef: '#12', changes: { status: 'In Review', priority: 'HIGH' } }],
    });
    expect(plan.actions[0]).toEqual({
      action: 'update_task',
      taskRef: 12,
      changes: { status: 'in_review', priority: 'high' },
    });
  });

  it('accepts reply refs, search refs, null assignee and null due date', () => {
    const plan = aiPlanSchema.parse({
      actions: [
        { action: 'update_task', taskRef: 'reply', changes: { assignee: null } },
        { action: 'update_task', taskRef: { search: 'login' }, changes: { dueDate: null } },
      ],
    });
    expect(plan.actions).toHaveLength(2);
  });

  it('tolerates a bare action object', () => {
    expect(aiPlanSchema.parse({ action: 'query', kind: 'mine' }).actions[0]).toMatchObject({ kind: 'mine' });
  });

  it('rejects unknown statuses, types, priorities and bad dates', () => {
    const bad = (changes: Record<string, unknown>) =>
      aiPlanSchema.safeParse({ actions: [{ action: 'update_task', taskRef: 1, changes }] }).success;
    expect(bad({ status: 'finished' })).toBe(false);
    expect(bad({ type: 'epic' })).toBe(false);
    expect(bad({ priority: 'asap' })).toBe(false);
    expect(bad({ dueDate: 'Friday' })).toBe(false);
    expect(bad({})).toBe(false);
  });

  it('rejects unknown actions and empty plans', () => {
    expect(aiPlanSchema.safeParse({ actions: [{ action: 'drop_database' }] }).success).toBe(false);
    expect(aiPlanSchema.safeParse({ actions: [] }).success).toBe(false);
  });

  it('accepts explain_task with the same taskRef forms as update_task', () => {
    const plan = aiPlanSchema.parse({
      actions: [
        { action: 'explain_task', taskRef: '#5' },
        { action: 'explain_task', taskRef: 'reply' },
        { action: 'explain_task', taskRef: 'Previous' },
        { action: 'explain_task', taskRef: 'login timeout' },
      ],
    });
    expect(plan.actions).toEqual([
      { action: 'explain_task', taskRef: 5 },
      { action: 'explain_task', taskRef: 'reply' },
      { action: 'explain_task', taskRef: 'previous' },
      { action: 'explain_task', taskRef: { search: 'login timeout' } },
    ]);
    expect(aiPlanSchema.safeParse({ action: 'explain_task' }).success).toBe(false);
  });

  it('still parses big plans so the executor can refuse them politely', () => {
    const actions = Array.from({ length: 7 }, (_, i) => ({
      action: 'update_task',
      taskRef: i + 1,
      changes: { status: 'done' },
    }));
    expect(aiPlanSchema.safeParse({ actions }).success).toBe(true);
  });
});

describe('prompt', () => {
  it('includes calendar, members, replied card and request', () => {
    const text = buildAiCommandPrompt({
      request: 'chuyển task này cho @ttt',
      requester: { username: 'me', firstName: 'Me' },
      members: [{ username: 'ttt', firstName: 'Tú' }],
      timezone: 'Asia/Ho_Chi_Minh',
      today: '2026-10-19',
      replyTask: { taskNumber: 12, title: 'Fix login', status: 'in_progress', assignee: '@an' },
    });
    expect(text).toContain('Monday 2026-10-19 (today)');
    expect(text).toContain('@ttt (Tú)');
    expect(text).toContain('Replied task card: #12 "Fix login"');
    expect(text).toContain('Request: chuyển task này cho @ttt');
  });

  it('teaches the planner explain_task with Vietnamese and English examples', () => {
    expect(AI_COMMAND_SYSTEM_PROMPT).toContain('{"action":"explain_task","taskRef":...}');
    expect(AI_COMMAND_SYSTEM_PROMPT).toContain('Request: "#5 là gì?" → {"actions":[{"action":"explain_task","taskRef":5}]}');
    expect(AI_COMMAND_SYSTEM_PROMPT).toContain('Request: "explain #5"');
    expect(AI_COMMAND_SYSTEM_PROMPT).toContain('"taskRef":"reply"}]}');
  });

  it('lists the next 7 days', () => {
    expect(calendarLines('2026-10-19')).toHaveLength(8);
    expect(calendarLines('2026-10-19')[5]).toContain('Saturday 2026-10-24');
  });
});

describe('dueText', () => {
  it('describes due days relative to today', () => {
    expect(dueText('2026-10-19T00:00:00Z', 'todo', '2026-10-19')).toBe('due today');
    expect(dueText('2026-10-20T00:00:00Z', 'todo', '2026-10-19')).toBe('due tomorrow');
    expect(dueText('2026-10-16T00:00:00Z', 'todo', '2026-10-19')).toBe('⚠️ overdue since Fri, Oct 16');
    expect(dueText('2026-10-16T00:00:00Z', 'done', '2026-10-19')).toBe('due Fri, Oct 16');
    expect(dueText(null, 'todo', '2026-10-19')).toBeNull();
  });
});

describe('explain prompt', () => {
  const base = {
    request: 'giải thích #5',
    lang: 'vi' as const,
    today: '2026-10-19',
    timezone: 'UTC',
    task: {
      taskNumber: 5,
      title: 'Fix login timeout',
      description: null,
      type: 'Bug',
      status: 'In progress',
      priority: 'High',
      assignee: '@an',
      creator: '@me',
      createdAt: '2026-10-10',
      dueDate: '2026-10-16',
      closed: false,
    },
    askedBy: 'me',
    whoToAsk: ['Hùng', 'an'],
    sources: [{ from: 'Hùng', text: 'Login bị timeout\nsau 30s trên iOS' }],
    activity: ['2026-10-12 @an: status To do → In progress'],
  };

  it('gives the model every fact: fields, source chat and activity', () => {
    const text = buildExplainPrompt(base);
    expect(text).toContain('Request: giải thích #5');
    expect(text).toContain('answer in Vietnamese');
    expect(text).toContain('Task #5: "Fix login timeout"');
    expect(text).toContain('Assignee: @an');
    expect(text).toContain('Created by: @me on 2026-10-10');
    expect(text).toContain('Due date: 2026-10-16');
    expect(text).not.toContain('overdue');
    expect(text).toContain('Asked by: me');
    expect(text).toContain('Who could answer (best first): Hùng, an');
    expect(text).toContain('Description: none');
    expect(text).toContain('- Hùng: Login bị timeout sau 30s trên iOS');
    expect(text).toContain('- 2026-10-12 @an: status To do → In progress');
  });

  it('says when there is no source discussion and no activity', () => {
    const text = buildExplainPrompt({ ...base, lang: 'en', sources: [], activity: [] });
    expect(text).toContain('Original chat messages: none');
    expect(text).toContain('Activity: none');
    expect(text).not.toContain('Vietnamese');
  });

  it('tidies the model text: no markdown, no other task numbers, no @pings, at most 5 lines / 400 chars', () => {
    expect(tidyExplanation('**🎯 Sửa** lỗi #5, liên quan #7\n\n- 🏁 xong khi login ổn\n💬 hỏi @tu (tu@mail.com)', 5)).toBe(
      '🎯 Sửa lỗi #5, liên quan 7\n🏁 xong khi login ổn\n💬 hỏi tu (tu@mail.com)',
    );
    expect(tidyExplanation(Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n'), 5).split('\n')).toHaveLength(5);
    const long = tidyExplanation(Array.from({ length: 5 }, () => 'x'.repeat(150)).join('\n'), 5);
    expect(long.length).toBe(400);
    expect(long.endsWith('…')).toBe(true);
  });

  it('asks for 🏁 / 💬 lines, never the ✅ / ❓ / 📍 ones', () => {
    expect(EXPLAIN_TASK_SYSTEM_PROMPT).toContain('🏁');
    expect(EXPLAIN_TASK_SYSTEM_PROMPT).toContain('💬');
    expect(EXPLAIN_TASK_SYSTEM_PROMPT).not.toMatch(/✅|❓|📍/);
    expect(EXPLAIN_TASK_SYSTEM_PROMPT).toContain('never the person who asked');
  });
});
