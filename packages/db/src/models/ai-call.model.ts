import { AI_CALL_STATUS_VALUES, AI_FEATURE_VALUES, AiCallStatus, AiFeature, USAGE_CHANNEL_VALUES, UsageChannel } from '@tbot/shared';
import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * One provider request (each retry is its own row — retries cost money too).
 * Price and names are snapshotted at call time so later price or profile changes don't rewrite history.
 */
export interface IAiCall extends Document {
  createdAt: Date;
  feature: AiFeature;
  provider: string;
  aiModel: string;
  status: AiCallStatus;
  /** 1 = first try, 2 = first retry, … */
  attempt: number;
  latencyMs: number;
  inputTokens: number;
  /** Part of inputTokens served from the provider's cache (cheaper). */
  cachedTokens: number;
  outputTokens: number;
  /** Reasoning tokens (billed as output; already included in outputTokens). */
  thinkingTokens: number;
  /** Computed with the price in effect at call time; 0 when the model has no known price. */
  costUsd: number;
  /** False when the model had no price entry (cost unknown, not free). */
  priced: boolean;
  groupId?: Types.ObjectId | null;
  userId?: Types.ObjectId | null;
  channel?: UsageChannel | null;
  /** Short error text for failed calls. */
  error?: string | null;
}

const AiCallSchema = new Schema<IAiCall>(
  {
    feature: { type: String, enum: AI_FEATURE_VALUES, required: true },
    provider: { type: String, required: true },
    aiModel: { type: String, required: true },
    status: { type: String, enum: AI_CALL_STATUS_VALUES, required: true },
    attempt: { type: Number, default: 1 },
    latencyMs: { type: Number, default: 0 },
    inputTokens: { type: Number, default: 0 },
    cachedTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    thinkingTokens: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    priced: { type: Boolean, default: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    channel: { type: String, enum: [...USAGE_CHANNEL_VALUES, null], default: null },
    error: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'ai_calls' },
);

AiCallSchema.index({ createdAt: -1 });
AiCallSchema.index({ groupId: 1, createdAt: -1 });
AiCallSchema.index({ userId: 1, createdAt: -1 });

export const AiCall = mongoose.model<IAiCall>('AiCall', AiCallSchema);
