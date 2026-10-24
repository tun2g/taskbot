import { AiCall } from '@tbot/db';
import type { AdminAiCallRow, AiCallStatus, AiFeature, UsageChannel } from '@tbot/shared';
import { AI_CALL_STATUS_VALUES, AI_FEATURE_VALUES } from '@tbot/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { iso } from 'src/routes/group-rows';
import { HttpError, Pagination } from 'src/shared/http';
import { loadGroupRefs, loadPersonRefs } from 'src/shared/refs';
import { parseRange, rangeWindows } from 'src/stats/range';
import { scopeMatch } from './params';

interface LeanAiCall {
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

/** The ai_calls filter for ?status=&feature=&groupId=&userId=&model=&range= (400 on unknown values). */
export function callFilter(query: Request['query']): Record<string, unknown> {
  const filter: Record<string, unknown> = scopeMatch(query);
  const status = String(query.status ?? '');
  if (status) {
    if (!(AI_CALL_STATUS_VALUES as readonly string[]).includes(status)) throw new HttpError(400, `Unknown status “${status}”.`);
    filter.status = status;
  }
  const feature = String(query.feature ?? '');
  if (feature) {
    if (!(AI_FEATURE_VALUES as string[]).includes(feature)) throw new HttpError(400, `Unknown feature “${feature}”.`);
    filter.feature = feature;
  }
  if (typeof query.model === 'string' && query.model) filter.aiModel = query.model.slice(0, 100);
  if (query.range) {
    const { current } = rangeWindows(parseRange(query.range));
    filter.createdAt = { $gte: current.start, $lt: current.end };
  }
  return filter;
}

/** One page of calls, newest first, with their group and person. */
export async function callRows(filter: Record<string, unknown>, p: Pagination): Promise<{ rows: AdminAiCallRow[]; total: number }> {
  const [total, calls] = await Promise.all([
    AiCall.countDocuments(filter),
    AiCall.find(filter).sort({ createdAt: -1, _id: -1 }).skip(p.skip).limit(p.limit).lean<LeanAiCall[]>(),
  ]);
  const [groups, people] = await Promise.all([loadGroupRefs(calls.map((c) => c.groupId)), loadPersonRefs(calls.map((c) => c.userId))]);
  const rows = calls.map((c) => ({
    id: String(c._id),
    at: iso(c.createdAt)!,
    feature: c.feature,
    provider: c.provider,
    model: c.aiModel,
    status: c.status,
    attempt: c.attempt ?? 1,
    latencyMs: c.latencyMs ?? 0,
    inputTokens: c.inputTokens ?? 0,
    cachedTokens: c.cachedTokens ?? 0,
    outputTokens: c.outputTokens ?? 0,
    costUsd: c.costUsd ?? 0,
    priced: c.priced !== false,
    group: c.groupId ? (groups.get(String(c.groupId)) ?? null) : null,
    person: c.userId ? (people.get(String(c.userId)) ?? null) : null,
    channel: c.channel ?? null,
    error: c.error ?? null,
  }));
  return { rows, total };
}
