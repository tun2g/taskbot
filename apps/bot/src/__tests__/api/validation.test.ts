import { createTaskSchema, formatDueDate, parseDueDate, updateTaskSchema, taskQuerySchema } from 'src/api/validation';

describe('Validation Schemas', () => {
  describe('createTaskSchema', () => {
    it('should accept valid input with required title', () => {
      const result = createTaskSchema.safeParse({ title: 'Deploy API' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Deploy API');
        expect(result.data.priority).toBe('medium'); // default
      }
    });

    it('should accept full input', () => {
      const result = createTaskSchema.safeParse({
        title: 'Deploy API',
        description: 'Deploy the API server to production',
        priority: 'high',
        assigneeId: '507f1f77bcf86cd799439011',
        dueDate: '2026-04-01T00:00:00.000Z',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty title', () => {
      const result = createTaskSchema.safeParse({ title: '' });
      expect(result.success).toBe(false);
    });

    it('should reject missing title', () => {
      const result = createTaskSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject title exceeding 200 chars', () => {
      const result = createTaskSchema.safeParse({ title: 'x'.repeat(201) });
      expect(result.success).toBe(false);
    });

    it('should reject invalid priority', () => {
      const result = createTaskSchema.safeParse({ title: 'Task', priority: 'super_high' });
      expect(result.success).toBe(false);
    });

    it('should accept a date-only dueDate and a type', () => {
      expect(createTaskSchema.safeParse({ title: 'Task', dueDate: '2026-10-20', type: 'feature' }).success).toBe(true);
    });

    it('should reject impossible dates', () => {
      expect(createTaskSchema.safeParse({ title: 'Task', dueDate: '2026-02-31' }).success).toBe(false);
    });

    it('should reject invalid dueDate format', () => {
      const result = createTaskSchema.safeParse({ title: 'Task', dueDate: 'not-a-date' });
      expect(result.success).toBe(false);
    });
  });

  describe('updateTaskSchema', () => {
    it('should accept partial updates', () => {
      const result = updateTaskSchema.safeParse({ title: 'Updated' });
      expect(result.success).toBe(true);
    });

    it('should accept empty object (no updates)', () => {
      const result = updateTaskSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept status update', () => {
      const result = updateTaskSchema.safeParse({ status: 'done' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const result = updateTaskSchema.safeParse({ status: 'archived' });
      expect(result.success).toBe(false);
      expect(updateTaskSchema.safeParse({ status: 'cancelled' }).success).toBe(true);
      expect(updateTaskSchema.safeParse({ status: 'in_review' }).success).toBe(true);
    });

    it('should accept nullable assigneeId', () => {
      const result = updateTaskSchema.safeParse({ assigneeId: null });
      expect(result.success).toBe(true);
    });

    it('should accept nullable dueDate', () => {
      const result = updateTaskSchema.safeParse({ dueDate: null });
      expect(result.success).toBe(true);
    });
  });

  describe('taskQuerySchema', () => {
    it('should accept empty query (defaults)', () => {
      const result = taskQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(20);
      }
    });

    it('should coerce string numbers for page/limit', () => {
      const result = taskQuerySchema.safeParse({ page: '2', limit: '50' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(50);
      }
    });

    it('should accept valid filter combination', () => {
      const result = taskQuerySchema.safeParse({
        status: 'todo',
        priority: 'high',
        search: 'deploy',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const result = taskQuerySchema.safeParse({ status: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should cap limit at 100 and reject non-positive limits', () => {
      const capped = taskQuerySchema.safeParse({ limit: '500' });
      expect(capped.success && capped.data.limit).toBe(100);
      const exact = taskQuerySchema.safeParse({ limit: '100' });
      expect(exact.success && exact.data.limit).toBe(100);
      expect(taskQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
      expect(taskQuerySchema.safeParse({ limit: 'abc' }).success).toBe(false);
    });

    it('should accept list sort columns and reject unknown ones', () => {
      expect(taskQuerySchema.safeParse({ sort: 'priority', dir: 'desc' }).success).toBe(true);
      expect(taskQuerySchema.safeParse({ sort: 'createdAt' }).success).toBe(false);
      expect(taskQuerySchema.safeParse({ sort: 'due', dir: 'up' }).success).toBe(false);
    });

    it('should accept assigneeId me / none / object id and reject garbage', () => {
      expect(taskQuerySchema.safeParse({ assigneeId: 'me' }).success).toBe(true);
      expect(taskQuerySchema.safeParse({ assigneeId: 'none' }).success).toBe(true);
      expect(taskQuerySchema.safeParse({ assigneeId: '507f1f77bcf86cd799439011' }).success).toBe(true);
      expect(taskQuerySchema.safeParse({ assigneeId: 'bob' }).success).toBe(false);
    });

    it('should accept type filter', () => {
      expect(taskQuerySchema.safeParse({ type: 'bug' }).success).toBe(true);
      expect(taskQuerySchema.safeParse({ type: 'chore' }).success).toBe(true);
      expect(taskQuerySchema.safeParse({ type: 'epic' }).success).toBe(false);
    });

    it('should accept category and open filters', () => {
      const r = taskQuerySchema.safeParse({ category: 'done', open: 'true' });
      expect(r.success && r.data.open).toBe(true);
      expect(taskQuerySchema.safeParse({}).success && taskQuerySchema.parse({}).open).toBe(false);
      expect(taskQuerySchema.safeParse({ category: 'later' }).success).toBe(false);
    });

    it('should reject negative page', () => {
      const result = taskQuerySchema.safeParse({ page: '-1' });
      expect(result.success).toBe(false);
    });
  });

  describe('parseDueDate / formatDueDate', () => {
    it('parses YYYY-MM-DD to 00:00Z of that day', () => {
      expect(parseDueDate('2026-10-20')?.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    });

    it('truncates ISO datetimes to their date part', () => {
      expect(parseDueDate('2026-10-20T23:30:00+07:00')?.toISOString()).toBe('2026-10-20T00:00:00.000Z');
      expect(parseDueDate('2026-10-20T05:00:00.000Z')?.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    });

    it('rejects invalid input', () => {
      expect(parseDueDate('tomorrow')).toBeNull();
      expect(parseDueDate('2026-13-01')).toBeNull();
      expect(parseDueDate('2026-10-20Tgarbage')).toBeNull();
    });

    it('formats stored dates as UTC calendar days', () => {
      expect(formatDueDate(new Date('2026-10-20T00:00:00.000Z'))).toBe('2026-10-20');
      expect(formatDueDate(null)).toBeNull();
    });
  });
});
