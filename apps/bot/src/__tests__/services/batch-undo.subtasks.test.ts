import mongoose from 'mongoose';
import { taskService } from 'src/database/services/task.service';
import { undoBatch } from 'src/shared/services/batch-undo.service';
import { afterTaskDeleted } from 'src/shared/services/task-mutation/subtasks';

jest.mock('src/database/services/task.service', () => ({
  taskService: { getTasksByBatch: jest.fn(), deleteTasks: jest.fn() },
}));
jest.mock('src/database/services/task-activity.service', () => ({ taskActivityService: { record: jest.fn() } }));
jest.mock('src/shared/services/task-mutation/subtasks', () => ({ afterTaskDeleted: jest.fn().mockResolvedValue([]) }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const oid = () => new mongoose.Types.ObjectId();

it('undoing AI-created subtasks cleans up after each (parent log + card)', async () => {
  const groupId = oid();
  const parentId = oid();
  const tasks = [43, 44].map((n) => ({ _id: oid(), groupId, taskNumber: n, title: `T${n}`, parentTaskId: parentId }));
  (taskService.getTasksByBatch as jest.Mock).mockResolvedValue(tasks);
  (taskService.deleteTasks as jest.Mock).mockResolvedValue(2);
  const actor = oid();

  const { removed } = await undoBatch({ batchId: 'b1', groupId: String(groupId), actor, via: 'app' });

  expect(removed).toBe(2);
  expect(afterTaskDeleted).toHaveBeenCalledTimes(2);
  const [task, actorRef, channel] = (afterTaskDeleted as jest.Mock).mock.calls[0];
  expect(task).toBe(tasks[0]);
  expect(actorRef._id).toBe(actor);
  expect(channel).toEqual({ activity: 'app' });
});

it('nothing removed → no cleanup', async () => {
  (taskService.getTasksByBatch as jest.Mock).mockResolvedValue([]);
  await undoBatch({ batchId: 'b2', groupId: String(oid()), actor: null, via: 'bot' });
  expect(afterTaskDeleted).not.toHaveBeenCalled();
});
