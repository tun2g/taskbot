import { AiCall } from '@tbot/db';
import type { AiCallStatus, AiFeature, UsageChannel } from '@tbot/shared';
import { Types } from 'mongoose';
import type { Pagination } from 'src/shared/http';

export interface LeanAiCall {
  _id: Types.ObjectId;
  createdAt: Date;
  feature: AiFeature;
  provider: string;
  aiModel: string;
  status: AiCallStatus;
  attempt?: number;
  latencyMs?: number;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  priced?: boolean;
  groupId?: Types.ObjectId | null;
  userId?: Types.ObjectId | null;
  channel?: UsageChannel | null;
  error?: string | null;
}

export async function countCalls(filter: Record<string, unknown>): Promise<number> {
  return AiCall.countDocuments(filter);
}

/** One page of calls, newest first. */
export async function findCallsPage(filter: Record<string, unknown>, p: Pagination): Promise<LeanAiCall[]> {
  return AiCall.find(filter).sort({ createdAt: -1, _id: -1 }).skip(p.skip).limit(p.limit).lean<LeanAiCall[]>();
}
