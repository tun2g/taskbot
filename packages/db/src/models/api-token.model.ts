import mongoose, { Document, Schema } from 'mongoose';

/**
 * A personal access token for the MCP server (`Authorization: Bearer tbot_…`). Only the SHA-256 of the
 * secret is stored; `prefix` (first 8 characters) is kept so people can tell their tokens apart.
 * `groupId` scopes the token to one group (null = every group the user is a member of).
 */
export interface IApiToken extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  groupId: mongoose.Types.ObjectId | null;
  tokenHash: string;
  prefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

const ApiTokenSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    tokenHash: { type: String, required: true, unique: true },
    prefix: { type: String, required: true },
    lastUsedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'api_tokens',
  },
);

ApiTokenSchema.index({ userId: 1, revokedAt: 1, createdAt: -1 });

export const ApiToken = mongoose.model<IApiToken>('ApiToken', ApiTokenSchema);
