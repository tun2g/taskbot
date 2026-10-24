import mongoose, { Document, Schema } from 'mongoose';

export interface IGroupMember extends Document {
  groupId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  telegramUserId: number;
  joinedAt: Date;
}

const GroupMemberSchema: Schema = new Schema(
  {
    groupId: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    telegramUserId: {
      type: Number,
      required: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    collection: 'group_members',
  }
);

GroupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true });
GroupMemberSchema.index({ userId: 1 });
GroupMemberSchema.index({ groupId: 1 });

export const GroupMember = mongoose.model<IGroupMember>('GroupMember', GroupMemberSchema);
