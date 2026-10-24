import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  telegramUserId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  /** Last update/request from this person (any channel), written at most every few minutes. */
  lastSeenAt?: Date | null;
  /** Per-person AI overrides set in the admin app. dailyLimit null = default limits. */
  ai: { disabled: boolean; dailyLimit: number | null };
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    telegramUserId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    username: {
      type: String,
      default: null,
    },
    firstName: {
      type: String,
      default: null,
    },
    lastName: {
      type: String,
      default: null,
    },
    lastSeenAt: { type: Date, default: null, index: true },
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
    collection: 'users',
  }
);


export const User = mongoose.model<IUser>('User', UserSchema);
