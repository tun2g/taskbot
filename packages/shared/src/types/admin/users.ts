/** People: the list, one person's page and their numbers. */
import type { AdminAiBreakdownRow } from './ai.js';
import type { AdminGroupRef, AdminPersonRef, AdminRange } from './common.js';

/**
 * GET /users?q=&sort=lastSeen|aiCost|aiCalls|events|tokens&range=7d|30d|90d&activeIn=today|7d|30d&hasTokens=1&page=&limit=
 * activeIn = used the bot in that window (DAU/WAU/MAU); hasTokens=1 = only people holding an active MCP token.
 * `totals` cover `range` (default 30d) — the same numbers the person's page shows for that range.
 */
export interface AdminUserRow {
  person: AdminPersonRef;
  groups: number;
  lastSeenAt: string | null;
  range: AdminRange;
  totals: AdminPersonTotals;
  activeTokens: number;
  aiDisabled: boolean;
  aiDailyLimit: number | null;
  /** Why you turned AI off / limited this person (null = no reason given). */
  aiReason: string | null;
  createdAt: string;
}

/**
 * GET /users/:id?range=30d — `totals` (from AdminUserRow) is the one set of range totals: the KPIs, the feature
 * table footer and the groups table footer all equal it (groupList includes a `group: null` "No group" row).
 */
export interface AdminUserDetail extends AdminUserRow {
  groupList: AdminUserGroupRow[];
  /** For the charts only — never re-summed for totals. */
  daily: { day: string; events: number; aiCalls: number; aiCostUsd: number }[];
  aiByFeature: AdminAiBreakdownRow[];
  aiToday: AdminUserAiToday;
}

/** One person's numbers for a range. */
export interface AdminPersonTotals {
  /** Bot actions: commands, button taps, Mini App & MCP requests. */
  events: number;
  aiCalls: number;
  aiFailed: number;
  aiCostUsd: number;
  /** AI calls whose model had no price (cost is a lower bound when > 0). */
  aiUnpriced: number;
  /** AI requests refused by a limit or because AI is off (not in aiCalls). */
  aiRefused: number;
}

/** A row of the person's groups table; `group: null` = actions and AI calls not tied to a group (private chat, Mini App home, MCP). */
export interface AdminUserGroupRow {
  group: AdminGroupRef | null;
  /** Still a member the bot knows about (false = activity in a group they left, or the "No group" row). */
  member: boolean;
  joinedAt: string | null;
  events: number;
  aiCalls: number;
  aiCostUsd: number;
}

/** The person's own daily AI limit today (UTC day). */
export interface AdminUserAiToday {
  /** Requests counted toward their daily limit today (null = unknown, the limiter couldn't be read). */
  used: number | null;
  /** Requests refused today, for any reason. */
  refused: number;
  /** The daily limit that applies to them now (null = no per-person limit). */
  limit: number | null;
  limitSource: 'override' | 'settings' | 'built_in';
}
