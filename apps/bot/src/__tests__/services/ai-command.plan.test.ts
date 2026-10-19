import { aiPlanSchema } from 'src/shared/services/ai-command/plan.schema';
import { buildAiCommandPrompt, calendarLines } from 'src/shared/services/ai-command/prompt';
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

  it('lists the next 7 days', () => {
    expect(calendarLines('2026-10-19')).toHaveLength(8);
    expect(calendarLines('2026-10-19')[5]).toContain('Saturday 2026-10-24');
  });
});

describe('dueText', () => {
  it('describes due days relative to today', () => {
    expect(dueText('2026-10-19T00:00:00Z', 'todo', '2026-10-19')).toBe('due today');
    expect(dueText('2026-10-20T00:00:00Z', 'todo', '2026-10-19')).toBe('due tomorrow');
    expect(dueText('2026-10-16T00:00:00Z', 'todo', '2026-10-19')).toBe('⚠️ overdue (Fri, Oct 16)');
    expect(dueText('2026-10-16T00:00:00Z', 'done', '2026-10-19')).toBe('due Fri, Oct 16');
    expect(dueText(null, 'todo', '2026-10-19')).toBeNull();
  });
});
