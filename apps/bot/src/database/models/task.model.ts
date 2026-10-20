import { TASK_PRIORITY_VALUES, TASK_STATUS_VALUES, TASK_TYPE_VALUES } from '@tbot/shared';
import mongoose, { Document, Schema } from 'mongoose';

export interface ISourceMessage {
  messageId: number;
  chatId: number;
  text: string;
  fromUserId: number;
  fromName?: string;
  link: string;
}

export interface ITask extends Document {
  groupId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  type: string;
  status: string;
  priority: string;
  createdBy: mongoose.Types.ObjectId;
  assigneeId?: mongoose.Types.ObjectId;
  dueDate?: Date;
  taskNumber: number;
  /** Epic the task belongs to (at most one); populated as `{ _id, title, color, status }` where cards/API need it. */
  epicId?: mongoose.Types.ObjectId | null;
  sourceMessage?: ISourceMessage;
  sourceMessages?: ISourceMessage[];
  batchId?: string;
  completedAt?: Date;
  completedBy?: mongoose.Types.ObjectId;
  reminderSent?: boolean;
  taskCardMessageId?: number;
  taskCardChatId?: number;
  createdAt: Date;
  updatedAt: Date;
}

const SourceMessageSchema = new Schema(
  {
    messageId: { type: Number, required: true },
    chatId: { type: Number, required: true },
    text: { type: String, default: '' },
    fromUserId: { type: Number, required: true },
    fromName: { type: String, default: '' },
    link: { type: String, default: '' },
  },
  { _id: false }
);

const TaskSchema: Schema = new Schema(
  {
    groupId: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      maxlength: 200,
    },
    description: {
      type: String,
      default: null,
    },
    type: {
      type: String,
      enum: TASK_TYPE_VALUES,
      default: 'task',
    },
    status: {
      type: String,
      enum: TASK_STATUS_VALUES,
      default: 'todo',
    },
    priority: {
      type: String,
      enum: TASK_PRIORITY_VALUES,
      default: 'medium',
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    assigneeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    taskNumber: {
      type: Number,
      required: true,
    },
    epicId: {
      type: Schema.Types.ObjectId,
      ref: 'Epic',
      default: null,
    },
    sourceMessage: {
      type: SourceMessageSchema,
      default: null,
    },
    sourceMessages: {
      type: [SourceMessageSchema],
      default: [],
    },
    batchId: {
      type: String,
      default: null,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    completedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reminderSent: {
      type: Boolean,
      default: false,
    },
    taskCardMessageId: {
      type: Number,
      default: null,
    },
    taskCardChatId: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'tasks',
  }
);

TaskSchema.index({ groupId: 1, status: 1 });
TaskSchema.index({ groupId: 1, assigneeId: 1 });
TaskSchema.index({ groupId: 1, createdAt: -1 });
// Board columns: one status, newest first (paged with an _id tiebreak).
TaskSchema.index({ groupId: 1, status: 1, createdAt: -1, _id: -1 });
TaskSchema.index({ assigneeId: 1, status: 1 });
TaskSchema.index({ groupId: 1, type: 1 });
TaskSchema.index({ groupId: 1, taskNumber: 1 }, { unique: true });
TaskSchema.index({ groupId: 1, epicId: 1 });

export const Task = mongoose.model<ITask>('Task', TaskSchema);
