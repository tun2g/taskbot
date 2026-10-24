/** GET /overview — the owner's dashboard. */
import type { GroupStatus } from '../../constants/group.js';
import type { AdminDailyPoint, AdminGroupRef, AdminKpi, AdminRange } from './common.js';
import type { AdminGroupRow } from './groups.js';

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
