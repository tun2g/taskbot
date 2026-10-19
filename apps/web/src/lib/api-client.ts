import type { ApiError } from '@tbot/shared';
import axios, { AxiosError } from 'axios';

import { clearToken, getStoredToken } from './auth';
import { getInitData } from './telegram';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  // Skip ngrok's free-tier browser interstitial so XHR responses stay JSON
  config.headers['ngrok-skip-browser-warning'] = 'true';

  const initData = getInitData();
  if (initData) {
    config.headers.Authorization = `tma ${initData}`;
  } else {
    const token = getStoredToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const isLoginCall = error.config?.url?.includes('/auth/telegram-login');
    if (error.response?.status === 401 && !getInitData() && !isLoginCall) {
      // Browser session expired or invalid → back to the login page.
      clearToken();
      const { pathname, search, hash } = window.location;
      if (!pathname.startsWith('/login')) {
        const redirect = encodeURIComponent(`${pathname}${search}${hash}`);
        window.location.assign(`/login?redirect=${redirect}`);
      }
    }
    return Promise.reject(error);
  },
);

export function getErrorStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

/** The server's human-readable message when there is one, else a generic fallback. */
export function getErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as Partial<ApiError> | undefined;
    if (body && typeof body.message === 'string' && body.message) return body.message;
    if (!error.response) return 'Could not reach the server. Check your connection and try again.';
    return `${fallback} (HTTP ${error.response.status})`;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
