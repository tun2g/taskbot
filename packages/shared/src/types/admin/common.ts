/** Shared pieces of the admin API contract: ranges, people, groups and daily points. */
import type { GroupStatus, UsageChannel } from '../../constants/group.js';

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

export interface AdminGroupRef {
  id: string;
  name: string;
  status: GroupStatus;
  /** The group was deleted after this record was made (history keeps its numbers; there is no page to open). */
  deleted?: boolean;
}
