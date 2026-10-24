/** Daily stats rollup: day helpers, pure row building, Mongo aggregations and the writers. */
export { addDays, dayRange, DONE_ACTIVITY_VALUES, NO_GROUP, utcDay } from 'src/shared/services/stats/daily-stats/days';
export { buildDailyRows } from 'src/shared/services/stats/daily-stats/rows';
export type { AiTotals, DailyRow, DayAggregates, UsageCount } from 'src/shared/services/stats/daily-stats/rows';
export { aggregateTaskCounts, mergeTaskCounts } from 'src/shared/services/stats/daily-stats/task-counts';
export { aggregateDay } from 'src/shared/services/stats/daily-stats/aggregate-day';
export { backfillTaskStats, rollupDay } from 'src/shared/services/stats/daily-stats/write';
