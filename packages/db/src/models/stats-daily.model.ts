import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Daily totals (UTC day), one row per group plus one global row (groupId null) whose `activeUsers`
 * counts distinct people across all groups. Written by the nightly rollup; re-running a day overwrites it.
 */
export interface IStatsDaily extends Document {
  /** "YYYY-MM-DD" (UTC). */
  day: string;
  groupId: Types.ObjectId | null;
  /** Distinct people with any usage event that day. */
  activeUsers: number;
  /** Usage events by kind (command, callback, mention, api, mcp_tool, rate_limited). */
  events: Record<string, number>;
  /** Usage events by channel (telegram, app, mcp). */
  channels: Record<string, number>;
  tasksCreated: number;
  tasksCompleted: number;
  aiCalls: number;
  aiFailed: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiCostUsd: number;
  /** AI calls whose model had no price (cost shown as "unknown" for these). */
  aiUnpriced: number;
  mcpCalls: number;
  rateLimited: number;
  updatedAt: Date;
}

const StatsDailySchema = new Schema<IStatsDaily>(
  {
    day: { type: String, required: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    activeUsers: { type: Number, default: 0 },
    events: { type: Schema.Types.Mixed, default: {} },
    channels: { type: Schema.Types.Mixed, default: {} },
    tasksCreated: { type: Number, default: 0 },
    tasksCompleted: { type: Number, default: 0 },
    aiCalls: { type: Number, default: 0 },
    aiFailed: { type: Number, default: 0 },
    aiInputTokens: { type: Number, default: 0 },
    aiOutputTokens: { type: Number, default: 0 },
    aiCostUsd: { type: Number, default: 0 },
    aiUnpriced: { type: Number, default: 0 },
    mcpCalls: { type: Number, default: 0 },
    rateLimited: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: true }, collection: 'stats_daily', minimize: false },
);

StatsDailySchema.index({ day: 1, groupId: 1 }, { unique: true });
StatsDailySchema.index({ groupId: 1, day: -1 });

export const StatsDaily = mongoose.model<IStatsDaily>('StatsDaily', StatsDailySchema);
