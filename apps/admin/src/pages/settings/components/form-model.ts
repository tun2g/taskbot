import type { AdminAiSettings } from '@tbot/shared';

import type { AiSettingsInput } from '@/api/settings';

/** Form state is kept as strings (what the inputs hold) and converted on save. */
export interface PriceDraft {
  /** Stable React key. */
  key: string;
  model: string;
  input: string;
  cachedInput: string;
  output: string;
  /** Added in this session via "Add a model" (model id is editable). */
  isNew: boolean;
}

export interface SettingsDraft {
  dailyCallLimit: string;
  dailyBudgetUsd: string;
  alertAtPercent: string;
  userDailyLimit: string;
  overrides: PriceDraft[];
}

type Price = AdminAiSettings['pricing'][string];

const str = (n: number | null | undefined) => (n == null ? '' : String(n));

let keySeq = 0;
export const newKey = () => `p${++keySeq}`;

export function toDraft(s: AdminAiSettings): SettingsDraft {
  return {
    dailyCallLimit: str(s.dailyCallLimit),
    dailyBudgetUsd: str(s.dailyBudgetUsd),
    alertAtPercent: str(s.alertAtPercent),
    userDailyLimit: str(s.userDailyLimit),
    overrides: Object.entries(s.pricing)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([model, p]) => ({
        key: newKey(),
        model,
        input: str(p.input),
        cachedInput: str(p.cachedInput),
        output: str(p.output),
        isNew: false,
      })),
  };
}

export function priceToDraft(model: string, p: Price | undefined, isNew = false): PriceDraft {
  return {
    key: newKey(),
    model,
    input: str(p?.input),
    cachedInput: str(p?.cachedInput),
    output: str(p?.output),
    isNew,
  };
}

// ── validation ──────────────────────────────────────────────────────────────

const NUM = /^\d+(\.\d+)?$/;
const INT = /^\d+$/;

export interface DraftErrors {
  dailyCallLimit?: string;
  dailyBudgetUsd?: string;
  alertAtPercent?: string;
  userDailyLimit?: string;
  /** Keyed by PriceDraft.key. */
  prices: Record<string, { model?: string; input?: string; cachedInput?: string; output?: string }>;
}

function optionalInt(v: string, min: number, max: number, msg: string): string | undefined {
  const t = v.trim();
  if (!t) return undefined;
  if (!INT.test(t) || Number(t) < min || Number(t) > max) return msg;
  return undefined;
}

function price(v: string, required: boolean): string | undefined {
  const t = v.trim();
  if (!t) return required ? 'Required' : undefined;
  if (!NUM.test(t)) return 'Use a number like 0.30';
  if (Number(t) > 10_000) return 'Too large';
  return undefined;
}

export function validate(d: SettingsDraft, builtIn: Record<string, Price>): DraftErrors {
  const errors: DraftErrors = { prices: {} };
  errors.dailyCallLimit = optionalInt(d.dailyCallLimit, 1, 1_000_000, 'Enter a whole number of at least 1, or leave it empty.');
  const budget = d.dailyBudgetUsd.trim();
  if (budget && (!NUM.test(budget) || Number(budget) <= 0 || Number(budget) > 100_000)) {
    errors.dailyBudgetUsd = 'Enter an amount in dollars, like 2 or 2.50, or leave it empty.';
  }
  const alert = d.alertAtPercent.trim();
  if (!INT.test(alert) || Number(alert) < 1 || Number(alert) > 100) {
    errors.alertAtPercent = 'Enter a whole number from 1 to 100.';
  }
  errors.userDailyLimit = optionalInt(d.userDailyLimit, 0, 100_000, 'Enter a whole number, or leave it empty.');

  const seen = new Map<string, number>();
  for (const o of d.overrides) seen.set(o.model.trim(), (seen.get(o.model.trim()) ?? 0) + 1);
  for (const o of d.overrides) {
    const e: DraftErrors['prices'][string] = {};
    const model = o.model.trim();
    if (!model) e.model = 'Enter the model id, e.g. gemini-2.5-pro';
    else if (/\s/.test(model)) e.model = 'Model ids have no spaces';
    else if ((seen.get(model) ?? 0) > 1) e.model = 'This model is listed twice';
    else if (o.isNew && builtIn[model]) e.model = 'Already in the table — edit its row instead';
    e.input = price(o.input, true);
    e.cachedInput = price(o.cachedInput, false);
    e.output = price(o.output, true);
    if (e.model || e.input || e.cachedInput || e.output) errors.prices[o.key] = e;
  }
  return errors;
}

export function hasErrors(e: DraftErrors): boolean {
  return (
    !!(e.dailyCallLimit || e.dailyBudgetUsd || e.alertAtPercent || e.userDailyLimit) || Object.keys(e.prices).length > 0
  );
}

// ── serialization ───────────────────────────────────────────────────────────

const optNum = (v: string) => (v.trim() ? Number(v.trim()) : null);

export function toInput(d: SettingsDraft): AiSettingsInput {
  const pricing: AiSettingsInput['pricing'] = {};
  for (const o of [...d.overrides].sort((a, b) => a.model.trim().localeCompare(b.model.trim()))) {
    const p: Price = { input: Number(o.input.trim()), output: Number(o.output.trim()) };
    if (o.cachedInput.trim()) p.cachedInput = Number(o.cachedInput.trim());
    pricing[o.model.trim()] = p;
  }
  return {
    dailyCallLimit: optNum(d.dailyCallLimit),
    dailyBudgetUsd: optNum(d.dailyBudgetUsd),
    alertAtPercent: Number(d.alertAtPercent.trim()),
    userDailyLimit: optNum(d.userDailyLimit),
    pricing,
  };
}

/** Comparable snapshot (string-level, so typing "0.30" vs "0.3" still counts as a change only if the value differs). */
export function snapshot(d: SettingsDraft): string {
  const norm = (v: string) => (v.trim() && NUM.test(v.trim()) ? String(Number(v.trim())) : v.trim());
  return JSON.stringify({
    a: norm(d.dailyCallLimit),
    b: norm(d.dailyBudgetUsd),
    c: norm(d.alertAtPercent),
    u: norm(d.userDailyLimit),
    p: [...d.overrides]
      .map((o) => [o.model.trim(), norm(o.input), norm(o.cachedInput), norm(o.output)])
      .sort((x, y) => x[0]!.localeCompare(y[0]!)),
  });
}
