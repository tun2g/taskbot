import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import type { ZodError, ZodType } from 'zod';
import logger from 'src/shared/logger';

const ERROR_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
};

/** `{ error, message, statusCode }` — `message` is a plain sentence the admin app shows as-is. */
export function sendError(res: Response, statusCode: number, message: string, error?: string) {
  res.status(statusCode).json({ error: error ?? ERROR_NAMES[statusCode] ?? 'Error', message, statusCode });
}

/** Thrown from handlers; turned into an ApiError response by the error handler. */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function validationMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Some of the details are invalid. Please check and try again.';
  const message = issue.message;
  if (!message || /^(Invalid|Expected|Unrecognized|Too )/i.test(message)) {
    const field = issue.path.length ? String(issue.path[issue.path.length - 1]) : '';
    return field ? `The ${field} value is invalid. Please check it and try again.` : 'Some of the details are invalid. Please check and try again.';
  }
  return message;
}

/** Parses with a zod schema or throws a 400 with the first issue as a sentence. */
export function parseOr400<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw new HttpError(400, validationMessage(result.error));
  return result.data;
}

/** Route param as an ObjectId, or 404 (a malformed id can't exist). */
export function objectIdParam(value: unknown, what = 'item'): mongoose.Types.ObjectId {
  const s = String(value ?? '');
  if (!/^[a-f0-9]{24}$/i.test(s)) throw new HttpError(404, `This ${what} doesn't exist (it may have been deleted).`);
  return new mongoose.Types.ObjectId(s);
}

export function errorHandler(err: Error & { status?: number; type?: string; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    sendError(res, err.statusCode, err.message);
    return;
  }
  if (err.type === 'entity.too.large') {
    sendError(res, 413, 'The request is too large.');
    return;
  }
  if (err.type === 'entity.parse.failed' || err.status === 400) {
    sendError(res, 400, 'The request could not be read. Please try again.');
    return;
  }
  logger.error(`Unhandled admin API error: ${err.message}`, { stack: err.stack });
  sendError(res, 500, 'Something went wrong on our side. Please try again in a moment.');
}

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

export function pagination(query: Record<string, unknown>, defaultLimit = 25, maxLimit = 100): Pagination {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(String(query.limit ?? defaultLimit), 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export function paginated<T>(data: T[], p: Pagination, total: number) {
  return { data, meta: { page: p.page, limit: p.limit, total, hasMore: p.page * p.limit < total } };
}

/** Escapes a user search string for a case-insensitive regex. */
export function searchRegex(q: unknown): RegExp | null {
  const s = typeof q === 'string' ? q.trim().slice(0, 100) : '';
  return s ? new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
}
