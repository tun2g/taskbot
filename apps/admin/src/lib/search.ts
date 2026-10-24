import type { AdminAiUsage, AdminRange, AiCallStatus } from '@tbot/shared';
import { AI_CALL_STATUS_VALUES, AI_FEATURE_VALUES, AiFeature, GROUP_STATUS_VALUES, GroupStatus } from '@tbot/shared';

import { AUDIT_TARGET_LABELS, GROUP_SORT_LABELS, type GroupSort, USER_SORT_LABELS, type UserSort } from './labels';

/** URL search params. Filters, tabs, pages and the date range live in the URL so every view is linkable. */

export const RANGES: AdminRange[] = ['7d', '30d', '90d'];
export const DEFAULT_RANGE: AdminRange = '30d';

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function page(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 1 ? n : undefined;
}

export interface RangeSearch {
  range?: AdminRange;
}

export function validateRange(search: Record<string, unknown>): RangeSearch {
  return { range: oneOf(search.range, RANGES) };
}

export interface GroupsSearch extends RangeSearch {
  status?: GroupStatus;
  /** Only groups with activity in this period (the overview's "Active groups"). */
  activeIn?: AdminRange;
  q?: string;
  sort?: GroupSort;
  page?: number;
}

export function validateGroupsSearch(search: Record<string, unknown>): GroupsSearch {
  return {
    ...validateRange(search),
    status: oneOf(search.status, GROUP_STATUS_VALUES),
    activeIn: oneOf(search.activeIn, RANGES),
    q: text(search.q),
    sort: oneOf(search.sort, Object.keys(GROUP_SORT_LABELS) as GroupSort[]),
    page: page(search.page),
  };
}

export const GROUP_TABS = ['overview', 'members', 'ai', 'settings'] as const;
export type GroupTab = (typeof GROUP_TABS)[number];

export interface GroupDetailSearch extends RangeSearch {
  tab?: GroupTab;
}

export function validateGroupDetailSearch(search: Record<string, unknown>): GroupDetailSearch {
  return { ...validateRange(search), tab: oneOf(search.tab, GROUP_TABS) };
}

export interface McpSearch extends RangeSearch {
  /** Narrow the call numbers to one MCP tool ("list_tasks") or one client ("Cursor"). */
  tool?: string;
  client?: string;
}

export function validateMcpSearch(search: Record<string, unknown>): McpSearch {
  return { ...validateRange(search), tool: text(search.tool), client: text(search.client) };
}

export const ACTIVE_WINDOWS = ['today', '7d', '30d'] as const;
export type ActiveWindow = (typeof ACTIVE_WINDOWS)[number];

export interface UsersSearch extends RangeSearch {
  /** Only people who used the bot in this window (DAU / WAU / MAU). */
  activeIn?: ActiveWindow;
  /** Only people holding an active MCP token (MCP → Active tokens). */
  hasTokens?: boolean;
  q?: string;
  sort?: UserSort;
  page?: number;
}

export function validateUsersSearch(search: Record<string, unknown>): UsersSearch {
  return {
    ...validateRange(search),
    activeIn: oneOf(search.activeIn, ACTIVE_WINDOWS),
    hasTokens: search.hasTokens === true || search.hasTokens === 'true' || search.hasTokens === 1 || search.hasTokens === '1' ? true : undefined,
    q: text(search.q),
    sort: oneOf(search.sort, Object.keys(USER_SORT_LABELS) as UserSort[]),
    page: page(search.page),
  };
}

export const GROUP_BY_VALUES: AdminAiUsage['groupBy'][] = ['day', 'feature', 'model', 'group', 'user'];

export interface AiSearch extends RangeSearch {
  groupBy?: AdminAiUsage['groupBy'];
  groupId?: string;
  userId?: string;
  status?: AiCallStatus;
  feature?: AiFeature;
  page?: number;
}

export function validateAiSearch(search: Record<string, unknown>): AiSearch {
  return {
    ...validateRange(search),
    groupBy: oneOf(search.groupBy, GROUP_BY_VALUES),
    groupId: text(search.groupId),
    userId: text(search.userId),
    status: oneOf(search.status, AI_CALL_STATUS_VALUES),
    feature: oneOf(search.feature, AI_FEATURE_VALUES),
    page: page(search.page),
  };
}

export type AuditTarget = keyof typeof AUDIT_TARGET_LABELS;

export interface AuditSearch {
  targetType?: AuditTarget;
  targetId?: string;
  page?: number;
}

export function validateAuditSearch(search: Record<string, unknown>): AuditSearch {
  return {
    targetType: oneOf(search.targetType, Object.keys(AUDIT_TARGET_LABELS) as AuditTarget[]),
    targetId: text(search.targetId),
    page: page(search.page),
  };
}

export interface LoginSearch {
  redirect?: string;
}

/** Only same-app paths are allowed as a post-login target (no open redirects). */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/login')) return undefined;
  return value;
}

export function validateLoginSearch(search: Record<string, unknown>): LoginSearch {
  return { redirect: safeRedirect(search.redirect) };
}

export interface CallbackSearch {
  code?: string;
}

export function validateCallbackSearch(search: Record<string, unknown>): CallbackSearch {
  return { code: text(search.code) };
}

export { GroupStatus };
