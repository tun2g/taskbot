import mongoose, { Document, Schema } from 'mongoose';

export interface IGroup extends Document {
  telegramGroupId: number;
  groupName: string;
  taskCounter: number;
  timezone: string;
  /** Supergroup with Topics enabled. */
  isForum: boolean;
  /** Topic where task events (cards, status lines, digest) are posted; null = not set up yet. */
  eventsTopicId?: number | null;
  /** Topic names the bot has seen (Bot API can't list topics), used to find "task events". */
  knownTopics: { id: number; name: string }[];
  /** Last time admins were told how to set up the events topic (avoid repeating). */
  topicSetupHintAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const GroupSchema: Schema = new Schema(
  {
    telegramGroupId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    groupName: {
      type: String,
      required: true,
    },
    taskCounter: {
      type: Number,
      default: 0,
    },
    timezone: {
      type: String,
      default: 'UTC',
    },
    isForum: {
      type: Boolean,
      default: false,
    },
    eventsTopicId: {
      type: Number,
      default: null,
    },
    knownTopics: {
      type: [{ _id: false, id: { type: Number, required: true }, name: { type: String, required: true } }],
      default: [],
    },
    topicSetupHintAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'groups',
  }
);

GroupSchema.index({ telegramGroupId: 1 });

export const Group = mongoose.model<IGroup>('Group', GroupSchema);
