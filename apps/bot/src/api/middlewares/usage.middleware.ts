import { UsageKind } from '@tbot/shared';
import { NextFunction, Request, Response } from 'express';
import { AuthenticatedRequest } from 'src/api/middlewares/auth.middleware';
import { withContext } from 'src/shared/services/telemetry/request-context';
import { recordUsage, touchLastSeen } from 'src/shared/services/telemetry/usage-tracker';

/**
 * "GET /groups/:groupId/tasks" — the matched route pattern (never ids), relative to /api. Requests that
 * matched no route are "GET (unmatched)" so a scanner can't flood the names.
 */
export function routeName(req: Pick<Request, 'method' | 'baseUrl'> & { route?: { path?: unknown } }): string {
  const path = typeof req.route?.path === 'string' ? req.route.path : null;
  if (!path) return `${req.method} (unmatched)`;
  const base = (req.baseUrl || '').replace(/^\/api(?=\/|$)/, '');
  const full = `${base}${path === '/' && base ? '' : path}`.replace(/\/{2,}/g, '/');
  return `${req.method} ${full || '/'}`;
}

/** An id or a populated ref → the id. */
const idOf = (ref: unknown): unknown =>
  ref && typeof ref === 'object' && '_id' in (ref as object) ? (ref as { _id: unknown })._id : (ref ?? null);

/**
 * Mini App API usage: one event per request (route pattern, status < 400 = ok, latency), attributed to the
 * signed-in person and the group the route resolved; also refreshes user.lastSeenAt (throttled).
 * AI calls made while handling the request are tagged channel "app".
 */
export function apiUsageMiddleware(req: Request, res: Response, next: NextFunction) {
  const started = Date.now();
  res.on('finish', () => {
    const r = req as AuthenticatedRequest;
    const groupId = idOf(r.group?._id ?? r.task?.groupId ?? r.epic?.groupId);
    recordUsage({
      kind: UsageKind.API,
      name: routeName(req),
      channel: 'app',
      ok: res.statusCode < 400,
      latencyMs: Date.now() - started,
      userId: r.user?._id ?? null,
      groupId,
    });
    if (r.user) touchLastSeen({ userId: r.user._id, groupId });
  });
  withContext({ channel: 'app' }, () => next());
}
