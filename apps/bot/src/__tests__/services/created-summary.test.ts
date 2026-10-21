import { createdSummaryHeader, sharedParentOf } from 'src/shared/services/created-summary';
import { queryBoardFilters } from 'src/shared/services/ai-command/query-filters';

const sub = (n: number, title = 'Fix <login>') => ({ parentTaskId: { _id: 'p', taskNumber: n, title } }) as any;

describe('created summary header', () => {
  it('says "added N subtasks to #42" when every task shares a parent', () => {
    expect(sharedParentOf([sub(42), sub(42)])).toEqual({ taskNumber: 42, title: 'Fix <login>' });
    expect(createdSummaryHeader('@dev', [sub(42), sub(42), sub(42)], 'Claude Code')).toBe(
      '<b>🧩 @dev added 3 subtasks to #42 · Fix &lt;login&gt; (via Claude Code)</b>',
    );
  });

  it('falls back to "created N tasks" for mixed or no parents', () => {
    expect(sharedParentOf([sub(42), sub(43)])).toBeNull();
    expect(createdSummaryHeader('@dev', [sub(42), { parentTaskId: null } as any], 'app')).toBe(
      '<b>🤖 @dev created 2 tasks (via app)</b>',
    );
  });
});

describe('query board filters', () => {
  it('mirrors the /ai query so the board shows the same tasks', () => {
    const an = { _id: 'u1' } as any;
    expect(queryBoardFilters({ action: 'query', kind: 'overdue' } as any, an, undefined)).toEqual({
      open: true,
      assigneeId: 'u1',
      due: 'overdue',
    });
    expect(
      queryBoardFilters({ action: 'query', kind: 'search', status: 'in_review', type: 'bug', text: 'login' } as any, null, {
        _id: 'e1',
      } as any),
    ).toEqual({ status: 'in_review', type: 'bug', search: 'login', epicId: 'e1' });
  });
});
