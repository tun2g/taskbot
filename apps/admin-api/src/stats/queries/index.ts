/**
 * Read-only aggregations over the bot's collections. Everything here returns NUMBERS (and ids) only —
 * never task titles, descriptions or message text.
 */
export type { LiveFilter } from './exprs';
export { CLOSED_STATUSES, DAY_EXPR } from './exprs';
export { liveDayStats } from './live';
export { dailySeries, groupActivity, lastRolledDay } from './series';
export type { AiTotals } from './totals';
export { aiTotalsBy, distinctActiveUsers, eventCountsBy, trackingSince } from './totals';
