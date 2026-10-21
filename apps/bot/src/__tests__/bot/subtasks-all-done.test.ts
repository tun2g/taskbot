import mongoose from 'mongoose';
import { notifyIfAllSubtasksDone } from 'src/bot/subtasks/all-done';
import { Task } from 'src/database/models/task.model';
import { User } from 'src/database/models/user.model';
import { notificationService } from 'src/shared/services/notification.service';
import { redisService } from 'src/shared/services/redis.service';

jest.mock('src/database/models/task.model', () => ({ Task: { findOne: jest.fn() } }));
jest.mock('src/database/models/user.model', () => ({ User: { findById: jest.fn() } }));
jest.mock('src/shared/services/redis.service', () => ({ redisService: { set: jest.fn(), del: jest.fn() } }));
jest.mock('src/shared/services/notification.service', () => ({
  notificationService: { notifyAllSubtasksDone: jest.fn().mockResolvedValue('sent') },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const lead = { _id: new mongoose.Types.ObjectId(), telegramUserId: 1, username: 'lead' };
const dev = new mongoose.Types.ObjectId();
const parent = (o: Record<string, unknown> = {}) =>
  ({ _id: new mongoose.Types.ObjectId(), taskNumber: 42, title: 'Login', status: 'in_progress', assigneeId: lead, ...o }) as any;

function lastCloser(id: unknown) {
  (Task.findOne as jest.Mock).mockReturnValue({ sort: () => ({ select: jest.fn().mockResolvedValue({ completedBy: id }) }) });
}

describe('notifyIfAllSubtasksDone', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (redisService.set as jest.Mock).mockResolvedValue('OK');
    lastCloser(dev);
  });

  it('DMs the parent assignee once when the last subtask is done', async () => {
    const p = parent();
    await notifyIfAllSubtasksDone(p, { total: 3, done: 3, cancelled: 1 });
    expect(redisService.set).toHaveBeenCalledWith(`subtasks_all_done:${p._id}`, '1', expect.objectContaining({ NX: true }));
    expect(notificationService.notifyAllSubtasksDone).toHaveBeenCalledWith(p, lead, 3);

    (redisService.set as jest.Mock).mockResolvedValue(null);
    await notifyIfAllSubtasksDone(p, { total: 3, done: 3, cancelled: 1 });
    expect(notificationService.notifyAllSubtasksDone).toHaveBeenCalledTimes(1);
  });

  it('skips when the owner closed the last subtask themselves', async () => {
    lastCloser(lead._id);
    await notifyIfAllSubtasksDone(parent(), { total: 2, done: 2, cancelled: 0 });
    expect(notificationService.notifyAllSubtasksDone).not.toHaveBeenCalled();
  });

  it('falls back to the creator when nobody is assigned', async () => {
    (User.findById as jest.Mock).mockResolvedValue(lead);
    await notifyIfAllSubtasksDone(parent({ assigneeId: null, createdBy: lead._id }), { total: 1, done: 1, cancelled: 0 });
    expect(notificationService.notifyAllSubtasksDone).toHaveBeenCalledWith(expect.anything(), lead, 1);
  });

  it('re-arms when a subtask reopens; never fires for a closed parent or a subtask', async () => {
    const p = parent();
    await notifyIfAllSubtasksDone(p, { total: 3, done: 2, cancelled: 0 });
    expect(redisService.del).toHaveBeenCalledWith(`subtasks_all_done:${p._id}`);
    await notifyIfAllSubtasksDone(parent({ status: 'done' }), { total: 2, done: 2, cancelled: 0 });
    await notifyIfAllSubtasksDone(parent({ parentTaskId: new mongoose.Types.ObjectId() }), { total: 1, done: 1, cancelled: 0 });
    await notifyIfAllSubtasksDone(parent(), { total: 0, done: 0, cancelled: 2 });
    expect(notificationService.notifyAllSubtasksDone).not.toHaveBeenCalled();
  });
});
