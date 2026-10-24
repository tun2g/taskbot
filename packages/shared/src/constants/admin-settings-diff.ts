import type { AiModelPrice } from './ai-pricing.js';

/**
 * Plain-language lines for a change to the AI settings ("Daily budget: none → $1.50",
 * "gemini-2.5-flash input: $0.30 → $0.35 per 1M tokens"). The admin API writes them into the audit log and the
 * admin app shows the same lines before saving or restoring, so what the owner confirms is what gets recorded.
 */
export interface AiSettingsValues {
  dailyCallLimit?: number | null;
  dailyBudgetUsd?: number | null;
  alertAtPercent?: number | null;
  userDailyLimit?: number | null;
  pricing?: Record<string, AiModelPrice>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const limitText = (v: unknown, none: string) => (num(v) === null ? none : num(v)!.toLocaleString('en-US'));
const usdText = (v: unknown, none: string) => (num(v) === null ? none : `$${num(v)!.toFixed(2)}`);

/** $0.30, $0.075, $10 → "$10.00": at least 2 decimals, more only when the price has them. */
export function formatPricePerMillion(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = String(v);
  const decimals = s.includes('.') ? s.split('.')[1]!.length : 0;
  return `$${v.toFixed(Math.max(2, Math.min(decimals, 6)))}`;
}

const SETTING_FIELDS: { key: keyof AiSettingsValues; label: string; fmt: (v: unknown) => string }[] = [
  { key: 'dailyCallLimit', label: 'Daily AI call limit', fmt: (v) => limitText(v, 'no limit') },
  { key: 'dailyBudgetUsd', label: 'Daily budget', fmt: (v) => usdText(v, 'none') },
  { key: 'alertAtPercent', label: 'Alert at', fmt: (v) => (num(v) === null ? '—' : `${num(v)}% of the budget`) },
  { key: 'userDailyLimit', label: 'Daily limit per person', fmt: (v) => limitText(v, 'built-in default') },
];

const PRICE_FIELDS: { key: keyof AiModelPrice; label: string }[] = [
  { key: 'input', label: 'input' },
  { key: 'cachedInput', label: 'cached input' },
  { key: 'output', label: 'output' },
];

/** Cached input falls back to the input price when it isn't set. */
const effective = (p: Partial<AiModelPrice> | undefined, key: keyof AiModelPrice) =>
  p ? (key === 'cachedInput' ? (num(p.cachedInput) ?? num(p.input)) : num(p[key])) : null;

function priceSummary(p: Partial<AiModelPrice>): string {
  const parts = [`input ${formatPricePerMillion(num(p.input))}`];
  if (num(p.cachedInput) !== null) parts.push(`cached input ${formatPricePerMillion(num(p.cachedInput))}`);
  parts.push(`output ${formatPricePerMillion(num(p.output))}`);
  return `${parts.join(', ')} per 1M tokens`;
}

function priceLines(
  model: string,
  from: Partial<AiModelPrice> | undefined,
  to: Partial<AiModelPrice> | undefined,
): string[] {
  const out: string[] = [];
  for (const f of PRICE_FIELDS) {
    const a = effective(from, f.key);
    const b = effective(to, f.key);
    if (a !== b)
      out.push(
        `${model} ${f.label}: ${a === null ? 'no price' : formatPricePerMillion(a)} → ${b === null ? 'no price' : formatPricePerMillion(b)} per 1M tokens`,
      );
  }
  return out;
}

/**
 * What changes between two AI settings snapshots. `builtIn` is the price table that applies without an
 * override, so adding an override shows "$0.30 → $0.35" and removing one says "back to built-in price".
 */
export function aiSettingsChangeLines(
  before: unknown,
  after: unknown,
  builtIn: Record<string, AiModelPrice>,
): string[] {
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const out: string[] = [];
  for (const f of SETTING_FIELDS) {
    const x = b[f.key] ?? null;
    const y = a[f.key] ?? null;
    if (x !== y) out.push(`${f.label}: ${f.fmt(x)} → ${f.fmt(y)}`);
  }
  const pb = (isObj(b.pricing) ? b.pricing : {}) as Record<string, Partial<AiModelPrice>>;
  const pa = (isObj(a.pricing) ? a.pricing : {}) as Record<string, Partial<AiModelPrice>>;
  for (const model of [...new Set([...Object.keys(pb), ...Object.keys(pa)])].sort()) {
    const base = builtIn[model];
    if (!(model in pb)) {
      // A new override: compare with the built-in price it replaces, or list it when the model had none.
      out.push(
        ...(base ? priceLines(model, base, pa[model]) : [`${model}: price added — ${priceSummary(pa[model]!)}`]),
      );
    } else if (!(model in pa)) {
      out.push(
        base
          ? `${model}: back to built-in price (${priceSummary(base)})`
          : `${model}: price removed — its calls count as unpriced ($0)`,
      );
    } else {
      out.push(...priceLines(model, pb[model], pa[model]));
    }
  }
  return out;
}
