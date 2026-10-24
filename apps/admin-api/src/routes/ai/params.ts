import type { Request } from 'express';
import { Types } from 'mongoose';
import { HttpError } from 'src/shared/http';
import { parseRange, rangeWindows } from 'src/stats/range';

export function optionalObjectId(value: unknown, what: string): Types.ObjectId | undefined {
  if (value === undefined || value === '') return undefined;
  const s = String(value);
  if (!/^[a-f0-9]{24}$/i.test(s)) throw new HttpError(400, `The ${what} filter is not a valid id.`);
  return new Types.ObjectId(s);
}

/** ?groupId= / ?userId= as a match on both AI calls and usage events. */
export function scopeMatch(query: Request['query']): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  const groupId = optionalObjectId(query.groupId, 'group');
  const userId = optionalObjectId(query.userId, 'person');
  if (groupId) match.groupId = groupId;
  if (userId) match.userId = userId;
  return match;
}

/** ?range= (default 30d) + the scope: the window every AI number on the page shares. */
export function rangeScope(query: Request['query']) {
  const range = parseRange(query.range);
  const { current: window } = rangeWindows(range);
  return { range, window, match: { createdAt: { $gte: window.start, $lt: window.end }, ...scopeMatch(query) } };
}
