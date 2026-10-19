import { Request, Response, NextFunction } from 'express';
import logger from 'src/shared/logger/logger';

/**
 * Wraps an async route handler to catch errors and forward to error middleware.
 * Eliminates repetitive try-catch blocks in controllers.
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Global error handler middleware — must be registered LAST via app.use().
 * Catches all unhandled errors from async route handlers.
 */
export function errorHandler(err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) {
  // Malformed JSON body (from express.json)
  if (err.type === 'entity.parse.failed' || err.status === 400) {
    res.status(400).json({ error: 'Bad Request', message: 'The request could not be read. Please try again.', statusCode: 400 });
    return;
  }
  logger.error(`Unhandled API error: ${err.message}`, { stack: err.stack });
  res.status(500).json({
    error: 'Internal server error',
    message: 'Something went wrong on our side. Please try again in a moment.',
    statusCode: 500,
  });
}
