import { AiCall } from '@tbot/db';
import type { AdminAiCallRow, AdminAiUsage, AiCallStatus, AiFeature, UsageChannel } from '@tbot/shared';
import { AI_CALL_STATUS_VALUES, AI_FEATURE_VALUES } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import { Types } from 'mongoose';
import { iso } from 'src/routes/group-rows';
import { asyncHandler, HttpError, paginated, pagination } from 'src/shared/http';
import { loadGroupRefs, loadPersonRefs } from 'src/shared/refs';
import { sumBreakdown } from 'src/stats/aggregate';
import { breakdownRow, breakdownRows, featureLabel } from 'src/stats/breakdown';
import { aiTotalsBy, DAY_EXPR } from 'src/stats/queries';
import { parseRange, rangeWindows } from 'src/stats/range';

export const aiRouter: Router = Router();

const GROUP_BY = ['day', 'feature', 'model', 'group', 'user'] as const;
type GroupBy = (typeof GROUP_BY)[number];

function optionalObjectId(value: unknown, what: string): Types.ObjectId | undefined {
  if (value === undefined || value === '') return undefined;
  const s = String(value);
  if (!/^[a-f0-9]{24}$/i.test(s)) throw new HttpError(400, `The ${what} filter is not a valid id.`);
  return new Types.ObjectId(s);
}

// GET /ai/usage?range=30d&groupBy=day|feature|model|group|user&groupId=&userId=
aiRouter.get(
  '/usage',
  asyncHandler(async (req: Request, res: Response) => {
    const range = parseRange(req.query.range);
    const groupBy: GroupBy = (GROUP_BY as readonly string[]).includes(String(req.query.groupBy)) ? (req.query.groupBy as GroupBy) : 'day';
    const { current: window } = rangeWindows(range);
    const match: Record<string, unknown> = { createdAt: { $gte: window.start, $lt: window.end } };
    const groupId = optionalObjectId(req.query.groupId, 'group');
    const userId = optionalObjectId(req.query.userId, 'person');
    if (groupId) match.groupId = groupId;
    if (userId) match.userId = userId;

    const field = { day: DAY_EXPR('createdAt'), feature: 'feature', model: 'aiModel', group: 'groupId', user: 'userId' }[groupBy];
    const totals = await aiTotalsBy(match, field);

    let rows;
    if (groupBy === 'day') {
      rows = window.days.map((day) => breakdownRow(day, day, totals.get(day)));
    } else if (groupBy === 'group') {
      const refs = await loadGroupRefs(totals.keys());
      rows = breakdownRows(totals, (k) => (k ? (refs.get(k)?.name ?? 'Deleted group') : 'No group (private chat / app)'));
    } else if (groupBy === 'user') {
      const refs = await loadPersonRefs(totals.keys());
      rows = breakdownRows(totals, (k) => (k ? (refs.get(k)?.name ?? 'Unknown person') : 'No person'));
    } else if (groupBy === 'feature') {
      rows = breakdownRows(totals, featureLabel);
    } else {
      rows = breakdownRows(totals, (k) => k || 'Unknown model');
    }
    const body: AdminAiUsage = { range, groupBy, totals: sumBreakdown(rows), rows };
    res.json({ data: body });
  }),
);

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

// GET /ai/calls?status=&feature=&groupId=&userId=&model=&range=&page=&limit=
aiRouter.get(
  '/calls',
  asyncHandler(async (req: Request, res: Response) => {
    const p = pagination(req.query as Record<string, unknown>, 50, 200);
    const filter: Record<string, unknown> = {};
    const status = String(req.query.status ?? '');
    if (status) {
      if (!(AI_CALL_STATUS_VALUES as readonly string[]).includes(status)) throw new HttpError(400, `Unknown status “${status}”.`);
      filter.status = status;
    }
    const feature = String(req.query.feature ?? '');
    if (feature) {
      if (!(AI_FEATURE_VALUES as string[]).includes(feature)) throw new HttpError(400, `Unknown feature “${feature}”.`);
      filter.feature = feature;
    }
    const groupId = optionalObjectId(req.query.groupId, 'group');
    const userId = optionalObjectId(req.query.userId, 'person');
    if (groupId) filter.groupId = groupId;
    if (userId) filter.userId = userId;
    if (typeof req.query.model === 'string' && req.query.model) filter.aiModel = req.query.model.slice(0, 100);
    if (req.query.range) {
      const { current } = rangeWindows(parseRange(req.query.range));
      filter.createdAt = { $gte: current.start, $lt: current.end };
    }

    const [total, calls] = await Promise.all([
      AiCall.countDocuments(filter),
      AiCall.find(filter).sort({ createdAt: -1, _id: -1 }).skip(p.skip).limit(p.limit).lean<LeanAiCall[]>(),
    ]);
    const [groups, people] = await Promise.all([loadGroupRefs(calls.map((c) => c.groupId)), loadPersonRefs(calls.map((c) => c.userId))]);
    const rows: AdminAiCallRow[] = calls.map((c) => ({
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
    res.json(paginated(rows, p, total));
  }),
);
