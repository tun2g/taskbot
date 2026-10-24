import mongoose from 'mongoose';
import { ITask, Task } from 'src/database/models/task.model';
import { groupService } from 'src/database/services/group.service';
import { TASK_POPULATE } from 'src/database/services/task-populate';
import { CreateTaskData } from 'src/database/services/task/types';
import logger from 'src/shared/logger/logger';

type TaskId = string | mongoose.Types.ObjectId;

export async function createTask(data: CreateTaskData): Promise<ITask> {
  const taskNumber = await groupService.incrementTaskCounter(data.groupId);

  const task = await Task.create({
    ...data,
    taskNumber,
    status: 'todo',
    type: data.type || 'task',
    priority: data.priority || 'medium',
  });

  logger.info(`Task #${taskNumber} created in group ${data.groupId}`);
  return task;
}

export async function updateTaskStatus(
  taskId: TaskId,
  status: string,
  changedBy?: mongoose.Types.ObjectId,
): Promise<ITask | null> {
  try {
    const updateData: Record<string, unknown> = { status };

    if (status === 'done') {
      updateData.completedAt = new Date();
      updateData.completedBy = changedBy ?? null;
    } else {
      updateData.completedAt = null;
      updateData.completedBy = null;
    }

    return await Task.findByIdAndUpdate(taskId, { $set: updateData }, { new: true, runValidators: true }).populate(
      TASK_POPULATE,
    );
  } catch (error) {
    logger.error(`Error updating task status ${taskId}: ${error}`);
    return null;
  }
}

export async function updateTask(taskId: TaskId, updates: Record<string, unknown>): Promise<ITask | null> {
  try {
    return await Task.findByIdAndUpdate(taskId, { $set: updates }, { new: true, runValidators: true }).populate(
      TASK_POPULATE,
    );
  } catch (error) {
    logger.error(`Error updating task ${taskId}: ${error}`);
    return null;
  }
}

export async function assignTask(taskId: TaskId, assigneeId: mongoose.Types.ObjectId | null): Promise<ITask | null> {
  try {
    return await Task.findByIdAndUpdate(
      taskId,
      { $set: { assigneeId } },
      { new: true, runValidators: true },
    ).populate(TASK_POPULATE);
  } catch (error) {
    logger.error(`Error assigning task ${taskId}: ${error}`);
    return null;
  }
}

export async function deleteTask(taskId: TaskId): Promise<boolean> {
  try {
    const result = await Task.findByIdAndDelete(taskId);
    return !!result;
  } catch (error) {
    logger.error(`Error deleting task ${taskId}: ${error}`);
    return false;
  }
}

export async function deleteTasks(taskIds: TaskId[]): Promise<number> {
  try {
    const result = await Task.deleteMany({ _id: { $in: taskIds } });
    return result.deletedCount ?? 0;
  } catch (error) {
    logger.error(`Error deleting tasks ${taskIds.join(',')}: ${error}`);
    return 0;
  }
}
