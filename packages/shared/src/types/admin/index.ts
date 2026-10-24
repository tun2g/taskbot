/**
 * Admin API contract (apps/admin-api ↔ apps/admin). All routes are under `/api` on the admin domain,
 * authenticated by an httpOnly session cookie. Responses use `ApiResponse<T>` / `PaginatedResponse<T>`;
 * errors use `ApiError`. Money is USD (number), times are ISO strings, days are "YYYY-MM-DD" (UTC).
 */
export type * from './common.js';
export type * from './auth.js';
export type * from './overview.js';
export type * from './groups.js';
export type * from './users.js';
export type * from './ai.js';
export type * from './settings.js';
export type * from './mcp.js';
export type * from './system.js';
export type * from './audit.js';
