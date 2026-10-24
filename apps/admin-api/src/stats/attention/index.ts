/**
 * The overview's "Needs attention" list: anomalies the owner should act on today, each with a link to the
 * page that explains it. Pure rules in `build.ts` / `rules.ts`, data loading in `load.ts`.
 */
export * from './rules';
export { buildAttention } from './build';
export { loadAttention } from './load';
