/** System health, background jobs and their failures. */
import type { UsageChannel } from '../../constants/group.js';

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
  /** When the bot process last started (it reports this to the database on startup; null = never reported). */
  bot?: { startedAt: string | null };
}

/** GET /system/jobs/failures?name=&cron= — the failed runs behind a "Failures" number (newest first). */
export interface AdminJobFailure {
  id: string;
  name: string;
  cron: string | null;
  at: string;
  error: string;
  /** Which try this was (1 = first). */
  attempt: number;
}

export interface AdminJobFailures {
  /** Null = every job. */
  job: { name: string; cron: string | null } | null;
  /** When it runs again on its own (null = unknown / not scheduled). */
  nextRunAt: string | null;
  /** Failures in the last 24 hours. */
  failures: AdminJobFailure[];
  /** Older failures still kept in the queue's history (not listed). */
  olderKept: number;
}

/** POST /system/jobs/run — queue one run of a scheduled job right now. */
export interface AdminRunJobInput {
  name: string;
  cron: string | null;
}

export interface AdminRunJobResult {
  queuedAt: string;
}
