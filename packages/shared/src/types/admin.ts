/**
 * Admin API contract (apps/admin-api ↔ apps/admin). All routes are under `/api` on the admin domain,
 * authenticated by an httpOnly session cookie. Responses use `ApiResponse<T>` / `PaginatedResponse<T>`;
 * errors use `ApiError`. Money is USD (number), times are ISO strings, days are "YYYY-MM-DD" (UTC).
 */
import type { AiCallStatus, AiFeature, GroupStatus, UsageChannel, UsageKind } from '../constants/group.js';

// ── Auth ────────────────────────────────────────────────────────────────────

/** POST /auth/request-link → sends a one-time login link to the bot owner's Telegram DM. */
export interface AdminLoginLinkResponse {
  /** Where the link went, masked for display ("@tun2g" / "your Telegram account"). */
  sentTo: string;
  /** Seconds until the link expires. */
  expiresInSeconds: number;
}

/** POST /auth/exchange { code } → sets the session cookie. */
export interface AdminSession {
  owner: { telegramUserId: number; name: string; username: string | null };
  expiresAt: string;
}

// ── Shared pieces ───────────────────────────────────────────────────────────

export type AdminRange = '7d' | '30d' | '90d';

/** A person as the admin sees them (no Telegram internals). */
export interface AdminPersonRef {
  id: string | null;
  telegramUserId: number;
  name: string;
  username: string | null;
}

export interface AdminDailyPoint {
  day: string;
  activeUsers: number;
  tasksCreated: number;
  tasksCompleted: number;
  aiCalls: number;
  aiFailed: number;
  aiCostUsd: number;
  mcpCalls: number;
  rateLimited: number;
  /** Usage events by channel. */
  channels: Partial<Record<UsageChannel, number>>;
}

/** A total plus the same total for the previous period of equal length (for "▲ 12%"). */
export interface AdminKpi {
  value: number;
  previous: number;
}

// ── Overview ────────────────────────────────────────────────────────────────

/** GET /overview?range=30d */
export interface AdminOverview {
  range: AdminRange;
  /** Days covered and the first day any stats exist (stats start when tracking was deployed). */
  from: string;
  to: string;
  trackingSince: string | null;
  kpis: {
    /** Distinct people active today / last 7 days / last 30 days (all groups). */
    dau: number;
    wau: number;
    mau: number;
    activeGroups: AdminKpi;
    tasksCreated: AdminKpi;
    aiCalls: AdminKpi;
    aiCostUsd: AdminKpi;
    mcpCalls: AdminKpi;
  };
  /** Today's AI spend vs the configured budget (null budget = none set). */
  aiToday: {
    costUsd: number;
    /** Calls that count toward the daily call limit (requests refused by the limit are not included). */
    calls: number;
    budgetUsd: number | null;
    callLimit: number | null;
    /** Requests refused today because the daily call limit was reached. */
    blocked?: number;
  };
  groupsByStatus: Record<GroupStatus, number>;
  /** Groups waiting for approval, oldest first (max 5) — the overview's call to action. */
  pending: AdminGroupRow[];
  daily: AdminDailyPoint[];
  topGroupsByActivity: { group: AdminGroupRef; events: number }[];
  topGroupsByAiCost: { group: AdminGroupRef; costUsd: number; calls: number }[];
  /** Things the owner should act on now, most severe first (empty = all clear). See docs/admin.md for the rules. */
  attention?: AdminAttentionItem[];
}

export type AdminAttentionKind = 'ai_failures' | 'refused' | 'pending_groups' | 'failed_jobs' | 'ai_spike' | 'mcp_errors';

/** One anomaly on the overview. `title` / `detail` are plain sentences; `link` is an in-app path (with query) that explains it. */
export interface AdminAttentionItem {
  kind: AdminAttentionKind;
  /** danger = something is broken or stopped; warn = unusual, worth a look. */
  severity: 'warn' | 'danger';
  title: string;
  detail: string;
  link: string;
  /** Label for the link ("See the failed calls"). */
  linkLabel?: string;
}

// ── Groups ──────────────────────────────────────────────────────────────────

export interface AdminGroupRef {
  id: string;
  name: string;
  status: GroupStatus;
  /** The group was deleted after this record was made (history keeps its numbers; there is no page to open). */
  deleted?: boolean;
}

/** Numbers for one group inside the requested period (GET /groups?activeIn=…). */
export interface AdminGroupPeriodStats {
  events: number;
  tasksCreated: number;
  aiCalls: number;
  aiCostUsd: number;
}

/** The owner's last decision about a group before it asked again (from the audit log). */
export interface AdminGroupPreviousDecision {
  action: 'rejected' | 'suspended' | 'removed';
  at: string;
  reason: string | null;
}

/**
 * GET /groups?status=&q=&sort=lastActivity|aiCost|tasks|members|added&activeIn=7d|30d|90d&page=&limit=
 * activeIn keeps only groups with activity in that period (the overview's "Active groups") and fills `inPeriod`;
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
  addedBy: AdminPersonRef | null;
  addedAt: string | null;
  statusReason: string | null;
  statusChangedAt: string | null;
  aiDisabled: boolean;
  aiDailyLimit: number | null;
  createdAt: string;
  /** Only with ?activeIn=. */
  inPeriod?: AdminGroupPeriodStats;
  /** Pending groups only: what the owner decided last time (null = never decided before). */
  previousDecision?: AdminGroupPreviousDecision | null;
}

/** GET /groups/:id?range=30d — numbers only, never task titles or message text. */
export interface AdminGroupDetail extends AdminGroupRow {
  timezone: string;
  approvedAt: string | null;
  botLeftAt: string | null;
  migratedToChatId: number | null;
  /** Telegram chat link when the group is public (t.me/username), else null. */
  publicLink: string | null;
  counts: { epics: number; activities: number; activeTokens: number };
  daily: AdminDailyPoint[];
  aiByFeature: AdminAiBreakdownRow[];
  members: AdminGroupMemberRow[];
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

/** POST /groups/:id/approve {} | /reject { reason } | /suspend { reason } | /unsuspend {} | /leave { reason? } */
export interface AdminGroupActionInput {
  reason?: string;
  /** Tell the group in Telegram (default true). */
  notifyGroup?: boolean;
}

/** PATCH /groups/:id/ai and /users/:id/ai */
export interface AdminAiOverrideInput {
  disabled?: boolean;
  /** null = default limits. */
  dailyLimit?: number | null;
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

// ── Users ───────────────────────────────────────────────────────────────────

/**
 * GET /users?q=&sort=lastSeen|aiCost|aiCalls|events|tokens&activeIn=today|7d|30d&hasTokens=1&page=&limit=
 * activeIn = used the bot in that window (DAU/WAU/MAU); hasTokens=1 = only people holding an active MCP token.
 */
export interface AdminUserRow {
  person: AdminPersonRef;
  groups: number;
  lastSeenAt: string | null;
  aiCalls30d: number;
  aiCostUsd30d: number;
  events30d: number;
  activeTokens: number;
  aiDisabled: boolean;
  aiDailyLimit: number | null;
  createdAt: string;
}

/** GET /users/:id?range=30d */
export interface AdminUserDetail extends AdminUserRow {
  groupList: { group: AdminGroupRef; joinedAt: string | null; events: number; aiCostUsd: number }[];
  daily: { day: string; events: number; aiCalls: number; aiCostUsd: number }[];
  aiByFeature: AdminAiBreakdownRow[];
  tokens: { id: string; name: string; prefix: string; group: AdminGroupRef | null; lastUsedAt: string | null; createdAt: string; expiresAt: string | null }[];
}

// ── AI usage & cost ─────────────────────────────────────────────────────────

export interface AdminAiBreakdownRow {
  /** feature id / model id / group id / user id / day, depending on groupBy. */
  key: string;
  /** Human label (feature label, model id, group name, person name, day). */
  label: string;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Calls whose model had no price — cost is a lower bound when > 0. */
  unpriced: number;
  /** Requests refused before reaching the model (a daily limit, or AI turned off) — not in calls / failed. */
  refused?: number;
}

/** GET /ai/usage?range=30d&groupBy=day|feature|model|group|user&groupId=&userId= */
export interface AdminAiUsage {
  range: AdminRange;
  groupBy: 'day' | 'feature' | 'model' | 'group' | 'user';
  totals: Omit<AdminAiBreakdownRow, 'key' | 'label'>;
  rows: AdminAiBreakdownRow[];
}

/** GET /ai/calls?status=&feature=&groupId=&userId=&page=&limit= — the individual calls behind any total. */
export interface AdminAiCallRow {
  id: string;
  at: string;
  feature: AiFeature;
  provider: string;
  model: string;
  status: AiCallStatus;
  attempt: number;
  latencyMs: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  priced: boolean;
  group: AdminGroupRef | null;
  person: AdminPersonRef | null;
  channel: UsageChannel | null;
  error: string | null;
}

/** GET/PUT /settings/ai */
export interface AdminAiSettings {
  dailyCallLimit: number | null;
  dailyBudgetUsd: number | null;
  alertAtPercent: number;
  userDailyLimit: number | null;
  pricing: Record<string, { input: number; cachedInput?: number; output: number }>;
  /** Read-only context for the form. */
  defaults: {
    provider: string;
    model: string;
    /** AI_DAILY_LIMIT from env (0 = none). */
    envDailyCallLimit: number;
    userDailyLimit: number;
    builtInPricing: Record<string, { input: number; cachedInput?: number; output: number }>;
  };
}

// ── MCP ─────────────────────────────────────────────────────────────────────

/**
 * GET /mcp?range=30d&tool=&client= — `tool` / `client` narrow every call number (not the token numbers) to
 * one tool or one client, so a row of "By tool" / "By client" opens into who and which groups.
 */
export interface AdminMcpOverview {
  activeTokens: number;
  tokenOwners: number;
  calls: number;
  /** Tool calls that returned an error. */
  failed: number;
  /** Requests refused because a token sent too many too quickly (not included in `calls`). */
  rateLimited: number;
  byTool: { tool: string; calls: number; failed: number }[];
  byClient: { client: string; calls: number; failed?: number }[];
  topUsers: { person: AdminPersonRef; calls: number; failed?: number; rateLimited?: number }[];
  daily: { day: string; calls: number; failed?: number }[];
  /** Calls per group (top 10). */
  byGroup?: { group: AdminGroupRef; calls: number; failed: number }[];
  /** Who was refused by the rate limit (top 10). */
  rateLimitedBy?: { person: AdminPersonRef; count: number }[];
  /** The active tokens behind `activeTokens` (newest first, max 100). */
  tokens?: AdminMcpTokenRow[];
  /** The filter that was applied (echo). */
  filter?: { tool: string | null; client: string | null };
}

export interface AdminMcpTokenRow {
  id: string;
  name: string;
  prefix: string;
  person: AdminPersonRef | null;
  /** null = works in all of the person's groups. */
  group: AdminGroupRef | null;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

// ── System & audit ──────────────────────────────────────────────────────────

/** GET /system */
export interface AdminSystemStatus {
  mongo: { ok: boolean; latencyMs: number | null };
  redis: { ok: boolean; latencyMs: number | null };
  queue: {
    waiting: number;
    active: number;
    /** Failed jobs still kept in the queue's history (not "failing now" — see failedLast24h). */
    failed: number;
    delayed: number;
    completed: number;
    /** Jobs that failed in the last 24 hours. */
    failedLast24h?: number;
    /** How long the oldest waiting job has waited (null = none waiting). Waiting long = the bot isn't processing jobs. */
    oldestWaitingSeconds?: number | null;
  } | null;
  jobs: {
    name: string;
    cron: string | null;
    lastRunAt: string | null;
    /** Error of the latest run when it failed (null = the latest run succeeded or there's no run yet). */
    lastError: string | null;
    /** Unique per schedule (one job name can run on two schedules). */
    key?: string;
    lastSuccessAt?: string | null;
    failuresLast24h?: number;
    /** When it should run next (UTC). */
    nextRunAt?: string | null;
  }[];
  /** Last time the bot recorded any usage event (a quick "is the bot alive?"). */
  lastEventAt: string | null;
  /** Last usage event per channel in the last 7 days (missing = none in 7 days). */
  lastEventByChannel?: Partial<Record<UsageChannel, string>>;
  /** Requests in the last hour vs the usual for this hour of day (average over the previous 7 days). */
  activity?: { lastHour: number; usualThisHour: number };
  versions: { adminApi: string };
}

/** GET /audit-log?page=&limit=&targetType=&targetId= */
export interface AdminAuditEntry {
  id: string;
  at: string;
  action: string;
  /** Plain sentence, e.g. "Suspended group “Acme Mobile Team”". */
  summary: string;
  targetType: 'group' | 'user' | 'settings' | 'session' | null;
  targetId: string | null;
  targetLabel: string | null;
  /** The group / person no longer exists (deleted) — show the label without a link. */
  targetMissing?: boolean;
  reason: string | null;
  /** Plain-language lines about what changed (e.g. "Daily call limit: 500 → 200"). */
  changes?: string[];
  details: Record<string, unknown> | null;
}
