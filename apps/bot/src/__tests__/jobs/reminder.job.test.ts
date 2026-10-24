import { Group } from 'src/database/models/group.model';
import { Task } from 'src/database/models/task.model';
import { User } from 'src/database/models/user.model';
import { processReminderJob, REMINDER_FROM_HOUR } from 'src/jobs/reminder.job';
import { notificationService } from 'src/shared/services/notification.service';

jest.mock('src/database/models/group.model', () => ({ Group: { findById: jest.fn() } }));
jest.mock('src/database/models/task.model', () => ({ Task: { find: jest.fn(), findByIdAndUpdate: jest.fn() } }));
jest.mock('src/database/models/user.model', () => ({ User: { findById: jest.fn() } }));
jest.mock('src/shared/services/notification.service', () => ({ notificationService: { notifyDueReminder: jest.fn() } }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

describe('due reminders', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    jest.setSystemTime(new Date(`2026-10-19T${String(REMINDER_FROM_HOUR + 1).padStart(2, '0')}:00:00Z`));
  });
  afterAll(() => jest.useRealTimers());

  const task = (groupId: string) => ({
    _id: `t-${groupId}`,
    groupId,
    dueDate: new Date('2026-10-20T00:00:00Z'),
    assigneeId: 'u1',
    createdBy: 'u1',
  });

  beforeEach(() => {
    (Task.find as jest.Mock).mockResolvedValue([task('active'), task('pending'), task('suspended')]);
    (Group.findById as jest.Mock).mockImplementation(async (id: string) => ({ _id: id, status: id, timezone: 'UTC' }));
    (User.findById as jest.Mock).mockResolvedValue({ _id: 'u1' });
  });

  it('only groups that get service send reminders; the others stay unmarked for later', async () => {
    await processReminderJob({} as any);
    expect(notificationService.notifyDueReminder).toHaveBeenCalledTimes(1);
    expect((notificationService.notifyDueReminder as jest.Mock).mock.calls[0][0]._id).toBe('t-active');
    expect(Task.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(Task.findByIdAndUpdate).toHaveBeenCalledWith('t-active', { $set: { reminderSent: true } });
  });
});
