import { AI_CALL_STATUS_VALUES, AI_FEATURE_VALUES } from '@tbot/shared';
import type { Request } from 'express';
import { scopeMatch } from 'src/modules/ai/helpers/params';
import { HttpError } from 'src/shared/http';
import { parseRange, rangeWindows } from 'src/stats/range';

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
