/**
 * Dev-only axios adapter that answers admin API calls from fixtures (VITE_ADMIN_MOCK=1). Stateful in memory,
 * so approving / suspending / deleting a group changes what the next request returns (until reload).
 */
import { type AxiosAdapter, AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

import { delay, errorBody, HttpError, type Route } from './http';
import { aiRoutes } from './routes/ai';
import { auditRoutes } from './routes/audit';
import { authRoutes } from './routes/auth';
import { groupActionRoutes } from './routes/group-actions';
import { groupRoutes } from './routes/groups';
import { mcpRoutes } from './routes/mcp';
import { overviewRoutes } from './routes/overview';
import { settingsRoutes } from './routes/settings';
import { systemRoutes } from './routes/system';
import { userRoutes } from './routes/users';

export { now } from './fixtures';

const routes: Route[] = [
  ...authRoutes,
  ...overviewRoutes,
  ...groupRoutes,
  ...groupActionRoutes,
  ...userRoutes,
  ...aiRoutes,
  ...mcpRoutes,
  ...systemRoutes,
  ...auditRoutes,
  ...settingsRoutes,
];

/** The query string plus axios `params` (empty values dropped). */
function queryOf(config: InternalAxiosRequestConfig, url: URL): URLSearchParams {
  const q = new URLSearchParams(url.search);
  for (const [k, v] of Object.entries((config.params ?? {}) as Record<string, unknown>)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  return q;
}

function bodyOf(config: InternalAxiosRequestConfig): Record<string, unknown> {
  if (typeof config.data === 'string' && config.data) return JSON.parse(config.data) as Record<string, unknown>;
  return (config.data as Record<string, unknown>) ?? {};
}

export const mockAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  const method = (config.method ?? 'get').toUpperCase();
  const url = new URL(config.url ?? '/', 'http://mock');
  const q = queryOf(config, url);
  const body = bodyOf(config);
  await delay();

  const respond = (status: number, data: unknown): AxiosResponse => ({ data, status, statusText: String(status), headers: {}, config });

  try {
    for (const [m, re, handler] of routes) {
      const match = m === method ? re.exec(url.pathname) : null;
      if (match) return respond(200, handler({ q, body, params: match.slice(1) }));
    }
    throw new HttpError(404, `Mock: no fixture for ${method} ${url.pathname}`);
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    throw new AxiosError(e.message, String(e.status), config, null, respond(e.status, errorBody(e)));
  }
};
