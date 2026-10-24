/**
 * Dev-only fixture data (VITE_ADMIN_MOCK=1). Deterministic (seeded) so screenshots are stable, and every
 * aggregate is computed from the same raw rows — AI totals add up to the calls behind them, like the real API.
 */
export * from './clock';
export * from './random';
export * from './people';
export * from './groups';
export * from './settings';
export * from './ai-calls';
export * from './audit-log';
