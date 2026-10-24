import mongoose, { Document, Schema } from 'mongoose';

/** 'mcp' = an external agent (Claude Code, Cursor, …) through the MCP server. */
export type TaskActivityVia = 'bot' | 'app' | 'ai' | 'mcp';

export interface ITaskActivity extends Document {
  taskId: mongoose.Types.ObjectId;
  groupId: mongoose.Types.ObjectId;
  actor?: mongoose.Types.ObjectId | null;
  action: string;
  // Human-readable snapshots, so the log still reads correctly after the referenced data changes
  from?: string | null;
  to?: string | null;
  via: TaskActivityVia;
  createdAt: Date;
}

const TaskActivitySchema: Schema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    from: { type: String, default: null },
    to: { type: String, default: null },
    via: { type: String, enum: ['bot', 'app', 'ai', 'mcp'], required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'task_activities',
  }
);

TaskActivitySchema.index({ taskId: 1, createdAt: 1 });
// Admin stats: per-group and per-day aggregations.
TaskActivitySchema.index({ groupId: 1, createdAt: -1 });
TaskActivitySchema.index({ createdAt: -1 });

export const TaskActivity = mongoose.model<ITaskActivity>('TaskActivity', TaskActivitySchema);
