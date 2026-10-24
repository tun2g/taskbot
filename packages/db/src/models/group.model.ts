import { GROUP_STATUS_VALUES, GroupStatus } from '@tbot/shared';
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

  /** Only ACTIVE groups get service. Existing groups are set ACTIVE by a startup migration. */
  status: GroupStatus;
  /** Owner's reason for reject / suspend — shown to the group. */
  statusReason?: string | null;
  statusChangedAt?: Date | null;
  /** Status before the bot was removed, so re-adding it restores an approval instead of asking again. */
  statusBeforeLeft?: GroupStatus | null;
  /** Who added the bot (snapshot at that time — names change). */
  addedBy?: { telegramUserId: number; name: string; username?: string | null } | null;
  /** When the bot was last added to the chat (= approval requested). */
  addedAt?: Date | null;
  approvedAt?: Date | null;
  /** Bot left / was removed from the chat. */
  botLeftAt?: Date | null;
  /** Set on the old doc when Telegram migrated a basic group to a supergroup. */
  migratedToChatId?: number | null;
  /** Last update/request seen from this group (any channel). */
  lastActivityAt?: Date | null;
  /** Telegram member count, refreshed from time to time. */
  memberCount?: number | null;
  /** The owner's approval DM for this group (edited in place on approve / reject). */
  approvalMessage?: { chatId: number; messageId: number } | null;
  /** Per-group AI overrides set in the admin app. dailyLimit null = default limits. */
  ai: { disabled: boolean; dailyLimit: number | null };

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
    status: { type: String, enum: GROUP_STATUS_VALUES, default: GroupStatus.PENDING, index: true },
    statusReason: { type: String, default: null, maxlength: 500 },
    statusChangedAt: { type: Date, default: null },
    statusBeforeLeft: { type: String, enum: [...GROUP_STATUS_VALUES, null], default: null },
    addedBy: {
      type: new Schema(
        { telegramUserId: { type: Number, required: true }, name: { type: String, required: true }, username: String },
        { _id: false },
      ),
      default: null,
    },
    addedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    botLeftAt: { type: Date, default: null },
    migratedToChatId: { type: Number, default: null },
    lastActivityAt: { type: Date, default: null, index: true },
    memberCount: { type: Number, default: null },
    approvalMessage: {
      type: new Schema({ chatId: { type: Number, required: true }, messageId: { type: Number, required: true } }, { _id: false }),
      default: null,
    },
    ai: {
      type: new Schema(
        { disabled: { type: Boolean, default: false }, dailyLimit: { type: Number, default: null, min: 0 } },
        { _id: false },
      ),
      default: () => ({ disabled: false, dailyLimit: null }),
    },
  },
  {
    timestamps: true,
    collection: 'groups',
  }
);


export const Group = mongoose.model<IGroup>('Group', GroupSchema);
