/** Groups list, group detail, its members / tasks / epics and the owner's actions on a group. */
import type { GroupStatus, UsageChannel, UsageKind } from '../../constants/group.js';
import type { AdminAiBreakdownRow } from './ai.js';
import type { AdminDailyPoint, AdminGroupRef, AdminPersonRef } from './common.js';

/** Numbers for one group inside the requested period (GET /groups?activeIn=…). */
export interface AdminGroupPeriodStats {
  events: number;
  tasksCreated: number;
  aiCalls: number;
  aiCostUsd: number;
  /** AI calls in the period whose model had no price (their cost counts as $0). */
  aiUnpriced?: number;
}

/** The owner's last decision about a group before it asked again (from the audit log). */
export interface AdminGroupPreviousDecision {
  /** reconsidered = you cleared an earlier rejection (POST /groups/:id/reconsider). */
  action: 'rejected' | 'suspended' | 'removed' | 'reconsidered';
  at: string;
  reason: string | null;
}

/**
 * GET /groups?status=&q=&sort=lastActivity|aiCost|tasks|members|added&activeIn=7d|30d|90d&page=&limit=
 * activeIn keeps only groups with activity in that period (the overview's "Groups with activity") and fills `inPeriod`;
 * with it, sort=tasks ranks by tasks created in the period and the default sort is requests in the period.
 */
export interface AdminGroupRow extends AdminGroupRef {
  telegramGroupId: number;
  isForum: boolean;
  memberCount: number | null;
  /** Members the bot knows about (people who used it). */
  knownMembers: number;
  tasks: number;
  openTasks: number;
  lastActivityAt: string | null;
  /** Last 30 days. */
  aiCostUsd30d: number;
  aiCalls30d: number;
  /** Last 30 days: AI calls whose model had no price, so their cost counts as $0. */
  aiUnpriced30d?: number;
  /** Moved-to-supergroup groups only: the group that continues it (null = not found, e.g. deleted). */
  migratedTo?: AdminGroupRef | null;
  addedBy: AdminPersonRef | null;
  addedAt: string | null;
  statusReason: string | null;
  statusChangedAt: string | null;
  aiDisabled: boolean;
  aiDailyLimit: number | null;
  /** Why you turned AI off / limited this group. */
  aiReason?: string | null;
  createdAt: string;
  /** Only with ?activeIn=. */
  inPeriod?: AdminGroupPeriodStats;
  /** Pending groups only: what the owner decided last time (null = never decided before). */
  previousDecision?: AdminGroupPreviousDecision | null;
}

/** GET /groups/:id?range=30d — numbers only, never task titles or message text. People: GET /groups/:id/members. */
export interface AdminGroupDetail extends AdminGroupRow {
  timezone: string;
  approvedAt: string | null;
  botLeftAt: string | null;
  /** Bot removed only: the status a re-add restores (active / suspended); anything else means it asks for approval again. */
  statusBeforeLeft?: GroupStatus | null;
  migratedToChatId: number | null;
  /** Telegram chat link when the group is public (t.me/username), else null. */
  publicLink: string | null;
  counts: { epics: number; activities: number; activeTokens: number };
  daily: AdminDailyPoint[];
  aiByFeature: AdminAiBreakdownRow[];
  /** AI requests refused in the range (a limit, or AI turned off) — never sent to the model, so not AI calls. */
  aiRefused?: number;
  /** Usage by channel and kind in the range. */
  usage: { channel: UsageChannel; kind: UsageKind; count: number }[];
}

export interface AdminGroupMemberRow {
  person: AdminPersonRef;
  joinedAt: string | null;
  /** Last time they used the bot anywhere (any group). */
  lastSeenAt: string | null;
  /** Last time they used the bot in THIS group (from usage events, kept 90 days; null = not in that time). */
  lastActiveHereAt?: string | null;
  /** Active MCP tokens of this person that can reach this group (scoped to it, or to all their groups). */
  activeTokens?: number;
  /** In the range. */
  events: number;
  aiCalls: number;
  aiCostUsd: number;
  tasksCreated: number;
}

/** POST /groups/:id/approve {} | /reject { reason } | /suspend { reason } | /unsuspend {} | /leave { reason? } | /reconsider {} */
export interface AdminGroupActionInput {
  reason?: string;
  /** Tell the group in Telegram (default true). */
  notifyGroup?: boolean;
}

/** GET /groups/:id/delete-preview → what DELETE /groups/:id { confirmName } would remove. */
export interface AdminGroupDeletePreview {
  group: AdminGroupRef;
  tasks: number;
  epics: number;
  members: number;
  activities: number;
  tokens: number;
}

/** GET /groups/:id/members?range=&q=&sort=&page=&limit= — paginated `AdminGroupMemberRow`s (q = name or @username). */
export type AdminGroupMemberSort = 'lastActive' | 'events' | 'aiCalls' | 'aiCost' | 'tasks' | 'tokens' | 'joined';

/** Which tasks GET /groups/:id/tasks lists. open = not done or cancelled; overdue = open and past the due date. */
export type AdminGroupTaskFilter = 'open' | 'overdue' | 'done' | 'all';

/** Sent next to the page of GET /groups/:id/tasks: how many tasks each filter has (same createdIn / q). */
export type AdminGroupTaskCounts = Record<AdminGroupTaskFilter, number>;

/** Where a task was created (from its activity log): chat, Mini App, AI assistant or an MCP client. null = not recorded. */
export type AdminTaskVia = 'bot' | 'app' | 'ai' | 'mcp';

/**
 * GET /groups/:id/tasks?filter=&createdIn=7d|30d|90d&q=&page=&limit= — read-only. Titles only (never descriptions or
 * message text), so the owner can see what a count is made of.
 */
export interface AdminGroupTaskRow {
  id: string;
  /** Group-local number (#42). */
  number: number;
  title: string;
  /** TaskStatus value. */
  status: string;
  /** Set when this is a subtask. */
  parentNumber: number | null;
  epic: { id: string; title: string } | null;
  assignee: AdminPersonRef | null;
  dueDate: string | null;
  /** Open and past its due date. */
  overdue: boolean;
  createdAt: string;
  completedAt: string | null;
  createdVia: AdminTaskVia | null;
}

/** GET /groups/:id/epics?page=&limit= — the epics behind the group's "Epics" count. */
export interface AdminGroupEpicRow {
  id: string;
  title: string;
  /** EpicStatus value (open / done). */
  status: string;
  tasks: number;
  openTasks: number;
  createdAt: string;
}
