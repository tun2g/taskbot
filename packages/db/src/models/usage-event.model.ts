import { USAGE_CHANNEL_VALUES, USAGE_KIND_VALUES, UsageChannel, UsageKind } from '@tbot/shared';
import mongoose, { Document, Schema, Types } from 'mongoose';

/** Raw usage events, kept for USAGE_EVENT_TTL_DAYS; `stats_daily` keeps the daily totals forever. */
export const USAGE_EVENT_TTL_DAYS = 90;

export interface IUsageEvent extends Document {
  createdAt: Date;
  kind: UsageKind;
  /** Command ("task", "ai"), callback family ("status"), MCP tool ("list_tasks"), API route ("GET /groups/:groupId/tasks")… */
  name: string;
  channel: UsageChannel;
  groupId?: Types.ObjectId | null;
  userId?: Types.ObjectId | null;
  /** MCP client label ("Claude Code", "Cursor"…) when known. */
  client?: string | null;
  ok: boolean;
  latencyMs?: number | null;
}

const UsageEventSchema = new Schema<IUsageEvent>(
  {
    kind: { type: String, enum: USAGE_KIND_VALUES, required: true },
    name: { type: String, required: true, maxlength: 120 },
    channel: { type: String, enum: USAGE_CHANNEL_VALUES, required: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    client: { type: String, default: null, maxlength: 80 },
    ok: { type: Boolean, default: true },
    latencyMs: { type: Number, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'usage_events' },
);

UsageEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: USAGE_EVENT_TTL_DAYS * 24 * 60 * 60 });
UsageEventSchema.index({ groupId: 1, createdAt: -1 });
UsageEventSchema.index({ userId: 1, createdAt: -1 });
UsageEventSchema.index({ kind: 1, createdAt: -1 });

export const UsageEvent = mongoose.model<IUsageEvent>('UsageEvent', UsageEventSchema);
