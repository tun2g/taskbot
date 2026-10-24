/** HTTP-ish helpers for the mock routes: the route type, errors, paging, query parsing and fake latency. */
import type { AdminRange } from '@tbot/shared';

export type Handler = (ctx: { q: URLSearchParams; body: Record<string, unknown>; params: string[] }) => unknown;

/** [method, path pattern (groups become `params`), handler] */
export type Route = [string, RegExp, Handler];

/** Thrown by a handler to answer with an API error (`{ error, message, statusCode }`). */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const ERROR_NAMES: Record<number, string> = { 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 409: 'Conflict' };

export function errorBody(e: HttpError) {
  return { error: ERROR_NAMES[e.status] ?? 'Error', message: e.message, statusCode: e.status };
}

/** `?page=&limit=` like the API's PaginatedResponse. */
export function paginate<T>(rows: T[], q: URLSearchParams, defaultLimit = 20) {
  const page = Math.max(1, Number(q.get('page')) || 1);
  const limit = Math.max(1, Number(q.get('limit')) || defaultLimit);
  const data = rows.slice((page - 1) * limit, page * limit);
  return { data, meta: { page, limit, total: rows.length, hasMore: page * limit < rows.length } };
}

export const rangeOf = (q: URLSearchParams): AdminRange => (q.get('range') as AdminRange) || '30d';

/** Lower-cased search text without a leading "@" / "#" (names, usernames, task numbers). */
export const searchOf = (q: URLSearchParams, prefix: RegExp = /^@/) => q.get('q')?.toLowerCase().replace(prefix, '');

/** Feels like a network round-trip. */
export const delay = () => new Promise((r) => setTimeout(r, 200 + Math.random() * 250));
