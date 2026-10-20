import { EPIC_COLOR_VALUES, EPIC_STATUS_VALUES, EPIC_TITLE_MAX, EpicColor, EpicStatus } from '@tbot/shared';
import mongoose, { Document, Schema } from 'mongoose';

/** A group-scoped bucket of related tasks (Jira-style epic). Tasks point at it via `Task.epicId`. */
export interface IEpic extends Document {
  groupId: mongoose.Types.ObjectId;
  title: string;
  description?: string | null;
  color: EpicColor;
  status: EpicStatus;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const EpicSchema: Schema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: EPIC_TITLE_MAX },
    description: { type: String, default: null },
    color: { type: String, enum: EPIC_COLOR_VALUES, default: EpicColor.BLUE },
    status: { type: String, enum: EPIC_STATUS_VALUES, default: EpicStatus.OPEN },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    collection: 'epics',
  },
);

EpicSchema.index({ groupId: 1, createdAt: 1 });

export const Epic = mongoose.model<IEpic>('Epic', EpicSchema);
