import type { ApiError } from '@tbot/shared';
import axios, { AxiosError } from 'axios';

/**
 * The admin API is same-origin at /api and authenticates with an httpOnly session cookie
 * (Path=/api, SameSite=Strict). Mutations carry `X-Requested-With: tbot-admin` as a CSRF guard.
 */
export const apiClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toLowerCase();
  if (method !== 'get' && method !== 'head') {
    config.headers['Content-Type'] = 'application/json';
    config.headers['X-Requested-With'] = 'tbot-admin';
  }
  return config;
});

let onUnauthorized: (() => void) | null = null;

/** The app registers what to do when the session is gone (clear cache, go to /login?redirect=). */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const url = error.config?.url ?? '';
    // Auth endpoints report their own 401s (bad / expired login code, no session yet).
    if (error.response?.status === 401 && !url.startsWith('/auth/')) onUnauthorized?.();
    return Promise.reject(error);
  },
);

/**
 * Dev-only mock mode: VITE_ADMIN_MOCK=1 swaps the HTTP adapter for fixture data from src/mocks.
 * `import.meta.env.DEV` is statically false in production builds, so the import (and every fixture)
 * is dropped from the bundle.
 */
export const isMockMode = import.meta.env.DEV && import.meta.env.VITE_ADMIN_MOCK === '1';

export const apiReady: Promise<void> = isMockMode
  ? import('@/mocks/adapter').then((m) => {
      apiClient.defaults.adapter = m.mockAdapter;
    })
  : Promise.resolve();

export function getErrorStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

/** The server's human-readable message when there is one, else a generic fallback. */
export function getErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as Partial<ApiError> | undefined;
    if (body && typeof body.message === 'string' && body.message) return body.message;
    if (!error.response) return 'Could not reach the admin API. Check your connection and try again.';
    if (error.response.status >= 500) return `The admin API had a problem (HTTP ${error.response.status}). Try again in a moment.`;
    return `${fallback} (HTTP ${error.response.status})`;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Mutation responses may carry `warnings` (e.g. "Could not post in the group: bot was kicked"). */
export function getWarnings(body: unknown): string[] {
  if (body && typeof body === 'object' && 'warnings' in body) {
    const warnings = (body as { warnings?: unknown }).warnings;
    if (Array.isArray(warnings)) return warnings.filter((w): w is string => typeof w === 'string' && !!w);
  }
  return [];
}
