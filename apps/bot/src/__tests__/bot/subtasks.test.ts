import mongoose from 'mongoose';
import { parseSubArgs, SUBS_PER_COMMAND_MAX } from 'src/bot/subtasks/parse-sub';
import { refreshParentAfterStatus } from 'src/bot/subtasks/parent-sync';
import {
  allSubtasksDone,
  listSuffixHtml,
  parentLine,
  parentSuffix,
  progressLine,
  subtaskListText,
} from 'src/bot/subtasks/subtask-lines';
import { taggedUserId, tagTextMentions, untag } from 'src/bot/subtasks/sub-mentions';
import { closeAnywayButtonText, closeAnywayText } from 'src/bot/subtasks/close-guard';
import { deleteConfirmText, formatTaskCard } from 'src/bot/task-card.renderer';
import { taskService } from 'src/database/services/task.service';
import { taskSyncService } from 'src/shared/services/task-sync.service';

jest.mock('src/shared/services/callback-data-storage.service', () => ({
  callbackDataStorageService: { setCallbackData: jest.fn() },
}));
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/database/services/task.service', () => ({ taskService: { getTaskById: jest.fn() } }));
jest.mock('src/shared/services/task-sync.service', () => ({
  taskSyncService: { syncTaskCard: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const parent = { _id: new mongoose.Types.ObjectId(), taskNumber: 42, title: 'Fix_login', status: 'todo' };

function task(overrides: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    groupId: new mongoose.Types.ObjectId(),
    taskNumber: 45,
    title: 'Write tests',
    type: 'task',
    status: 'todo',
    priority: 'medium',
    ...overrides,
  } as any;
}

describe('parseSubArgs', () => {
  it('reads a leading task number and a trailing @assignee', () => {
    expect(parseSubArgs(' 42 Write tests @an_dev', false)).toEqual({
      parentNumber: 42,
      items: [{ title: 'Write tests', assignee: '@an_dev' }],
      dropped: 0,
    });
  });

  it('takes one subtask per line, strips list bullets and blank lines', () => {
    const parsed = parseSubArgs('#42\n- Write tests @an\n\n2. Update docs\n• Ship it', false);
    expect(parsed.parentNumber).toBe(42);
    expect(parsed.items).toEqual([{ title: 'Write tests', assignee: '@an' }, { title: 'Update docs' }, { title: 'Ship it' }]);
  });

  it('keeps a leading number as part of the title when replying to a card', () => {
    expect(parseSubArgs('3 screenshots for QA', true)).toEqual({
      parentNumber: undefined,
      items: [{ title: '3 screenshots for QA' }],
      dropped: 0,
    });
  });

  it('caps the batch and reports what was left out', () => {
    const lines = Array.from({ length: SUBS_PER_COMMAND_MAX + 2 }, (_, i) => `Step ${i + 1}`).join('\n');
    const parsed = parseSubArgs(`42\n${lines}`, false);
    expect(parsed.items).toHaveLength(SUBS_PER_COMMAND_MAX);
    expect(parsed.dropped).toBe(2);
  });

  it('accepts names typed with @ in any script', () => {
    expect(parseSubArgs('42 Viết test @Bình', false).items).toEqual([{ title: 'Viết test', assignee: '@Bình' }]);
  });

  it('tap-mentions (no username) become tokens that map back to the user', () => {
    const text = '/sub 42 Viết test Bình';
    const tagged = tagTextMentions(text, [
      { type: 'text_mention', offset: 18, length: 4, user: { id: 777, is_bot: false, first_name: 'Bình' } },
    ]);
    expect(tagged.text).toBe('/sub 42 Viết test @__tm0');
    const item = parseSubArgs(tagged.text.replace(/^\/sub/, ''), false).items[0];
    expect(item).toEqual({ title: 'Viết test', assignee: '@__tm0' });
    expect(taggedUserId(item.assignee!, tagged.taggedIds)).toBe(777);
    expect(taggedUserId('@an', tagged.taggedIds)).toBeNull();
    expect(untag('Pair with @__tm0', tagged.names)).toBe('Pair with Bình');
  });

  it('a lone @mention is a title, not an assignee', () => {
    expect(parseSubArgs('42 @an', false).items).toEqual([{ title: '@an' }]);
  });
});

describe('subtask lines', () => {
  it('parent line escapes the title and cuts it for mobile; group lines get a compact suffix', () => {
    expect(parentLine(parent)).toBe('↳ Subtask of *#42* · Fix\\_login');
    expect(parentSuffix(parent)).toBe(' (↳ #42)');
    expect(parentSuffix(null)).toBe('');
    expect(parentLine({ taskNumber: 1, title: 'x'.repeat(80) })).toMatch(/…$/);
    expect(parentLine(null)).toBeNull();
  });

  it('progress line leaves cancelled subtasks out of the count, with a check when all are done', () => {
    expect(progressLine({ total: 5, done: 2, cancelled: 0 })).toBe('🧩 Subtasks: 2/5 done');
    expect(progressLine({ total: 3, done: 3, cancelled: 1 })).toBe('🧩 Subtasks: 3/3 done ✅ · 1 cancelled');
    expect(progressLine({ total: 0, done: 0, cancelled: 2 })).toBe('🧩 Subtasks: 2 cancelled');
    expect(progressLine(null)).toBeNull();
    expect(progressLine({ total: 0, done: 0, cancelled: 0 })).toBeNull();
    expect(allSubtasksDone({ total: 0, done: 0, cancelled: 2 })).toBe(false);
    expect(allSubtasksDone({ total: 2, done: 2, cancelled: 1 })).toBe(true);
  });

  it('subtask list view: rows with status + assignee, and a how-to when empty', () => {
    const text = subtaskListText(
      [
        { taskNumber: 45, title: 'Write_tests', statusEmoji: '✅', assignee: '@an_dev' },
        { taskNumber: 46, title: 'Docs', statusEmoji: '📝', assignee: null },
      ],
      { total: 2, done: 1, cancelled: 0 },
    );
    expect(text.split('\n')).toEqual([
      '🧩 *Subtasks* · 1/2 done',
      '✅ #45 Write\\_tests — @an\\_dev',
      '📝 #46 Docs — _unassigned_',
      '',
      'Reply `/sub …` to this card to add more.',
    ]);
    expect(subtaskListText([], null)).toContain('🧩 *No subtasks yet*');
  });

  it('close-anyway question', () => {
    expect(closeAnywayText(42, 2, 'done')).toBe('⚠️ *#42 still has 2 open subtasks.* Close it anyway?');
    expect(closeAnywayText(42, 1, 'cancelled')).toBe('⚠️ *#42 still has 1 open subtask.* Cancel it anyway?');
    expect(closeAnywayButtonText(42, 'done')).toBe('✅ Yes, close #42');
  });

  it('/list suffix: ↳ #N for a subtask, 🧩 done/total for a parent', () => {
    expect(listSuffixHtml(parent, undefined)).toBe(' <i>↳ #42</i>');
    expect(listSuffixHtml(null, { total: 4, done: 1, cancelled: 0 })).toBe(' · 🧩 1/4');
    expect(listSuffixHtml(null, undefined)).toBe('');
  });
});

describe('task card', () => {
  it('a subtask shows its parent right under the title', () => {
    const lines = formatTaskCard(task({ parentTaskId: parent })).split('\n');
    expect(lines[1]).toBe('↳ Subtask of *#42* · Fix\\_login');
    expect(lines[2]).toMatch(/^Status:/);
  });

  it('a parent shows subtask progress when it is passed in', () => {
    const card = formatTaskCard(task(), null, null, 'UTC', { total: 5, done: 2, cancelled: 0 });
    expect(card).toContain('🧩 Subtasks: 2/5 done');
    expect(formatTaskCard(task())).not.toContain('Subtasks');
  });

  it('a bare parent id (not populated) shows nothing rather than an id', () => {
    expect(formatTaskCard(task({ parentTaskId: new mongoose.Types.ObjectId() }))).not.toContain('Subtask of');
  });

  it('delete confirmation says the subtasks are kept', () => {
    expect(deleteConfirmText(task(), 3)).toContain('Its 3 subtasks stay as regular tasks.');
    expect(deleteConfirmText(task(), 1)).toContain('Its subtask stays as a regular task.');
    expect(deleteConfirmText(task())).not.toContain('subtask');
  });
});

describe('refreshParentAfterStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('re-renders the parent card when a subtask is closed or reopened', async () => {
    (taskService.getTaskById as jest.Mock).mockResolvedValue(parent);
    await refreshParentAfterStatus({ parentTaskId: parent } as any, 'in_progress', 'done');
    expect(taskService.getTaskById).toHaveBeenCalledWith(String(parent._id));
    expect(taskSyncService.syncTaskCard).toHaveBeenCalledWith(parent);
  });

  it('does nothing for open → open moves or regular tasks', async () => {
    await refreshParentAfterStatus({ parentTaskId: parent } as any, 'todo', 'in_progress');
    await refreshParentAfterStatus({ parentTaskId: null } as any, 'todo', 'done');
    expect(taskSyncService.syncTaskCard).not.toHaveBeenCalled();
  });
});
