/**
 * Pure helpers that turn daily stats rows (rolled-up `stats_daily` and live numbers from the raw collections)
 * into the shapes the admin app shows. No database access here — easy to unit test.
 */
export type { DayStats } from './day-stats';
export { addDayStats, emptyDayStats, fromStatsDoc, roundUsd, sumRecord } from './day-stats';
export type { SeriesTotals } from './series';
export { buildDailySeries, kpi, lastTrustedRollupDay, sumSeries, toDailyPoint } from './series';
export type { GroupActivity } from './activity';
export { countActiveGroups, foldGroupActivity, isActive, topBy } from './activity';
export { earliestDay, personName, sumBreakdown } from './misc';
